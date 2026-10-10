use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;

use sonar_core::{AnalyzerClient, Direction, GraphRequest, GraphStore, GraphView};

fn fixture(name: &str) -> (PathBuf, GraphStore) {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let helper = std::env::var_os("GO_SONAR_ANALYZER")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repository.join("src-tauri/binaries/go-sonar-analyzer-x86_64-unknown-linux-gnu")
        });
    assert!(
        helper.is_file(),
        "build the analyzer before running learning acceptance tests"
    );
    let root = repository
        .join("fixtures")
        .join(name)
        .canonicalize()
        .unwrap();
    let mut analyzer = AnalyzerClient::start(&helper).unwrap();
    let batch = analyzer.analyze(&root).unwrap();
    assert!(
        batch.diagnostics.iter().all(|d| d.severity != "error"),
        "{:?}",
        batch.diagnostics
    );
    let mut store = GraphStore::memory(&root).unwrap();
    store.apply(&batch).unwrap();
    (root, store)
}

fn query(id: &str) -> GraphRequest {
    GraphRequest {
        focus: id.into(),
        limit: 80,
        kinds: vec!["calls".into()],
        direction: Direction::Outgoing,
        neighbor_limit: 8,
        ..Default::default()
    }
}

fn ancestors(view: &GraphView, target: &str) -> HashSet<String> {
    let mut result = HashSet::new();
    let mut queue = VecDeque::from([target.to_owned()]);
    while let Some(id) = queue.pop_front() {
        if !result.insert(id.clone()) {
            continue;
        }
        for edge in view
            .edges
            .iter()
            .filter(|e| e.kind == "control" && e.target == id)
        {
            queue.push_back(edge.source.clone());
        }
    }
    result
}

#[test]
fn sample_paths_distinguish_cache_hit_lookup_failure_and_normalizing_write() {
    let (_, store) = fixture("sample");
    let get = store.search("Get", 10).unwrap().remove(0);
    assert!(
        get.signature
            .starts_with("func (s *Service) Get(key string)")
    );
    let mut request = query(&get.id);
    request.internals = vec![get.id.clone()];
    let view = store.graph(&request).unwrap();
    let returns = &view.behaviors[0].returns;
    assert_eq!(returns.len(), 3);
    let call = view
        .nodes
        .iter()
        .find(|n| n.name == "s.Repository.Lookup(key)")
        .unwrap();
    assert_eq!(
        call.details
            .as_ref()
            .unwrap()
            .call
            .as_ref()
            .unwrap()
            .dispatch,
        "interface"
    );
    let normalize = view
        .nodes
        .iter()
        .find(|n| n.name == "store.Normalize(record)")
        .unwrap();
    let boundary = normalize.details.as_ref().unwrap().call.as_ref().unwrap();
    assert_eq!(boundary.arguments[0].expression, "record");
    assert_eq!(boundary.results[0].destination, "record");
    let write = view
        .nodes
        .iter()
        .find(|n| n.name == "s.Cache[key] = record")
        .unwrap();
    let mutation = write
        .details
        .as_ref()
        .unwrap()
        .accesses
        .iter()
        .find(|a| a.name == "Cache")
        .unwrap();
    assert_eq!(mutation.kind, "write");
    assert!(mutation.mutation.contains("indexed element"));
    let hit = ancestors(&view, &returns[0].id);
    assert!(!hit.contains(&call.id));
    assert!(!hit.contains(&write.id));
    let failure = ancestors(&view, &returns[1].id);
    assert!(failure.contains(&call.id));
    assert!(!failure.contains(&write.id));
    let result = ancestors(&view, &returns[2].id);
    assert!(result.contains(&normalize.id));
    assert!(result.contains(&write.id));
    let continuation: Vec<_> = view
        .edges
        .iter()
        .filter(|e| e.kind == "control" && e.source == normalize.id)
        .collect();
    assert_eq!(continuation.len(), 1);
    let target = normalize.related_symbol_id.as_ref().unwrap();
    let mut entered = query(target);
    entered.internals = vec![target.clone()];
    let callee = store.graph(&entered).unwrap();
    assert_eq!(callee.behaviors[0].returns[0].name, "return record");
    let restored = store.graph(&request).unwrap();
    assert!(restored.nodes.iter().any(|n| n.id == normalize.id));
    assert!(
        restored
            .edges
            .iter()
            .any(|e| e.id == continuation[0].id && e.target == continuation[0].target)
    );
}

#[test]
fn long_entry_projects_regions_and_reveals_exact_hidden_continuations() {
    let (_, store) = fixture("learning");
    let discovery = store.discovery().unwrap();
    let main = &discovery.entrypoints[0];
    let mut request = query(&main.id);
    let initial = store.graph(&request).unwrap();
    assert!(initial.nodes.len() <= 9);
    let repeated = initial
        .edges
        .iter()
        .find(|e| e.target.ends_with("::Normalize"))
        .unwrap();
    assert_eq!(repeated.site_count, 121);
    assert_eq!(repeated.sites.len(), 40);
    assert!(
        repeated
            .sites
            .iter()
            .all(|site| site.expression == "library.Normalize(record)")
    );
    request.internals = vec![main.id.clone()];
    let view = store.graph(&request).unwrap();
    assert!(view.nodes.len() <= 80);
    assert!(view.nodes.iter().any(|n| n.kind == "entry"));
    assert!(view.nodes.iter().any(|n| n.kind == "loop"));
    assert!(view.nodes.iter().any(|n| n.kind == "region"));
    assert!(view.behaviors[0].hidden_nodes > 0);
    let region = view.nodes.iter().find(|n| n.kind == "region").unwrap();
    let first = &region
        .details
        .as_ref()
        .unwrap()
        .region
        .as_ref()
        .unwrap()
        .first_node_id;
    request.regions = vec![region.id.clone()];
    request.behavior_anchors = HashMap::from([(main.id.clone(), first.clone())]);
    let expanded = store.graph(&request).unwrap();
    assert!(expanded.nodes.iter().any(|n| n.id == *first));
    assert!(expanded.nodes.len() <= 80);
    if let Some(edge) = view.edges.iter().find(|e| e.hidden_target_id.is_some()) {
        let target = edge.hidden_target_id.clone().unwrap();
        request
            .behavior_anchors
            .insert(main.id.clone(), target.clone());
        let continued = store.graph(&request).unwrap();
        assert!(continued.nodes.iter().any(|n| n.id == target));
        assert!(continued.nodes.iter().any(|n| n.kind == "entry"));
    }
    let second_region = view
        .nodes
        .iter()
        .filter(|n| n.kind == "region")
        .nth(1)
        .unwrap();
    let second_first = second_region
        .details
        .as_ref()
        .unwrap()
        .region
        .as_ref()
        .unwrap()
        .first_node_id
        .clone();
    request.regions.push(second_region.id.clone());
    request
        .behavior_anchors
        .insert(main.id.clone(), second_first.clone());
    let moved = store.graph(&request).unwrap();
    assert!(moved.nodes.iter().any(|n| n.id == second_first));
    assert!(moved.nodes.iter().all(|n| n.id != *first));
    assert!(moved.nodes.iter().any(|n| n.id == region.id));
    request.limit = 3;
    let partial = store.graph(&request).unwrap();
    assert!(partial.nodes.len() <= 3);
    assert!(partial.behaviors[0].hidden_nodes > 0);
    assert!(partial.nodes.iter().any(|n| n.kind == "boundary"));
}

#[test]
fn recursion_counts_both_degrees_without_double_counting_evidence() {
    let (_, store) = fixture("learning");
    let recursive = store.search("Recurse", 10).unwrap().remove(0);
    for direction in [Direction::Incoming, Direction::Outgoing, Direction::Both] {
        let mut request = query(&recursive.id);
        request.direction = direction;
        let view = store.graph(&request).unwrap();
        let summary = view
            .summaries
            .iter()
            .find(|s| s.node_id == recursive.id)
            .unwrap();
        assert_eq!(summary.incoming, 1);
        assert!(summary.outgoing >= 1);
        assert_eq!(summary.source_sites, summary.outgoing);
        assert_eq!(view.edges.len(), 1);
        assert_eq!(summary.hidden, summary.source_sites - 1);
        assert_eq!(
            summary.hidden,
            summary.filtered + summary.collapsed + summary.paginated + summary.limited
        );
    }
}

#[test]
fn unsupported_behavior_and_binding_aliases_stay_visible() {
    let (_, store) = fixture("learning");
    let unsupported = store.search("Unsupported", 10).unwrap().remove(0);
    let mut request = query(&unsupported.id);
    request.internals = vec![unsupported.id.clone()];
    let view = store.graph(&request).unwrap();
    assert!(view.behaviors[0].incomplete);
    let stop = view
        .nodes
        .iter()
        .find(|n| n.details.as_ref().is_some_and(|d| d.role == "unsupported"))
        .unwrap();
    assert!(view.edges.iter().all(|e| e.source != stop.id));
    let mapping = store.search("Mappings", 10).unwrap().remove(0);
    let mut request = query(&mapping.id);
    request.internals = vec![mapping.id.clone()];
    let view = store.graph(&request).unwrap();
    assert!(view.nodes.iter().any(|n| {
        n.details
            .as_ref()
            .is_some_and(|d| d.limitation.contains("Aliasing"))
    }));
    let ids: HashSet<_> = view
        .nodes
        .iter()
        .flat_map(|n| n.details.iter().flat_map(|d| &d.accesses))
        .filter(|a| a.name == "value")
        .map(|a| a.id.clone())
        .collect();
    assert_eq!(ids.len(), 2);
}
