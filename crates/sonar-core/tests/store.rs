use std::collections::HashSet;
use std::path::Path;

use serde_json::json;
use sonar_core::{AnalysisBatch, Direction, GraphRequest, GraphStore, PackageFacts};

fn package(root: &Path, id: &str, names: &[&str], connections: &[(&str, &str)]) -> PackageFacts {
    let source = json!({
        "file": root.join("main.go"),
        "line": 1,
        "column": 1,
        "endLine": 1,
        "endColumn": 2,
    });
    let symbols: Vec<_> = names
        .iter()
        .map(|name| {
            json!({
                "id": name,
                "name": name,
                "qualifiedName": name,
                "kind": "function",
                "packageId": id,
                "source": source,
                "signature": "func()",
                "documentation": "test",
                "exported": true,
            })
        })
        .collect();
    let edges: Vec<_> = connections
        .iter()
        .map(|(from, to)| {
            json!({
                "id": format!("{from}:{to}"),
                "source": from,
                "target": to,
                "kind": "calls",
                "label": "calls",
                "certainty": "resolved",
                "evidence": source,
            })
        })
        .collect();

    serde_json::from_value(json!({
        "id": id,
        "fingerprint": "test",
        "files": [],
        "imports": [],
        "symbols": symbols,
        "edges": edges,
        "behaviors": [],
    }))
    .unwrap()
}

fn batch(root: &Path, packages: Vec<PackageFacts>, full: bool) -> AnalysisBatch {
    AnalysisBatch {
        root: root.to_string_lossy().into(),
        snapshot: "test-snapshot".into(),
        full,
        packages,
        removed_packages: vec![],
        stats: Default::default(),
        diagnostics: vec![],
    }
}

fn request(focus: &str, expanded: &[&str], limit: usize, direction: Direction) -> GraphRequest {
    GraphRequest {
        focus: focus.into(),
        expanded: expanded.iter().map(|s| (*s).into()).collect(),
        internals: vec![],
        kinds: vec!["calls".into()],
        limit,
        direction,
        offsets: Default::default(),
        neighbor_limit: 40,
        ..Default::default()
    }
}

fn valid_endpoints(view: &sonar_core::GraphView) {
    let ids: HashSet<_> = view.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids.len(), view.nodes.len(), "duplicate nodes");

    for edge in &view.edges {
        assert!(ids.contains(edge.source.as_str()));
        assert!(ids.contains(edge.target.as_str()));
    }

    let edges: HashSet<_> = view.edges.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(edges.len(), view.edges.len());
}

#[test]
fn bounded_directional_expansion_preserves_cycles_and_shared_nodes() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    store
        .apply(&batch(
            root,
            vec![package(
                root,
                "p",
                &["a", "b", "c", "shared", "incoming"],
                &[
                    ("a", "b"),
                    ("a", "c"),
                    ("b", "shared"),
                    ("c", "shared"),
                    ("shared", "a"),
                    ("incoming", "a"),
                ],
            )],
            true,
        ))
        .unwrap();

    let initial = store
        .graph(&request("a", &[], 20, Direction::Outgoing))
        .unwrap();
    assert_eq!(initial.nodes.len(), 3);
    assert_eq!(initial.edges.len(), 2);
    valid_endpoints(&initial);

    let expanded = store
        .graph(&request(
            "a",
            &["b", "c", "shared"],
            20,
            Direction::Outgoing,
        ))
        .unwrap();
    assert_eq!(expanded.nodes.len(), 4);
    assert_eq!(expanded.edges.len(), 5);
    valid_endpoints(&expanded);

    let incoming = store
        .graph(&request("a", &[], 20, Direction::Incoming))
        .unwrap();
    assert!(incoming.edges.iter().all(|e| e.target == "a"));
    assert_eq!(incoming.nodes.len(), 3);

    let bounded = store
        .graph(&request("a", &["b", "c", "shared"], 2, Direction::Both))
        .unwrap();
    assert_eq!(bounded.nodes.len(), 2);
    assert!(bounded.truncated);
    valid_endpoints(&bounded);
    assert!(bounded.summaries.iter().any(|s| s.hidden > 0));
}

#[test]
fn replacement_and_deletion_preserve_shared_external_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    let mut first = package(root, "p", &["a", "external"], &[("a", "external")]);
    let mut second = package(root, "q", &["b", "external"], &[("b", "external")]);
    for owner in [&mut first, &mut second] {
        let external = owner
            .symbols
            .iter_mut()
            .find(|s| s.id == "external")
            .unwrap();
        external.package_id = "std".into();
        external.source = Default::default();
    }

    store
        .apply(&batch(root, vec![first, second], true))
        .unwrap();

    let update = batch(root, vec![package(root, "p", &["new"], &[])], false);
    store.apply(&update).unwrap();
    assert!(store.graph(&request("a", &[], 5, Direction::Both)).is_err());

    let remaining = store
        .graph(&request("b", &[], 5, Direction::Outgoing))
        .unwrap();
    assert_eq!(remaining.nodes.len(), 2);
    valid_endpoints(&remaining);

    let mut removed = batch(root, vec![], false);
    removed.removed_packages = vec!["q".into()];
    store.apply(&removed).unwrap();
    assert!(
        store
            .graph(&request("external", &[], 5, Direction::Both))
            .is_err()
    );
}

#[test]
fn full_batch_clears_stale_packages_across_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let database = root.join("cache.sqlite");

    {
        let mut store = GraphStore::open(&database, root).unwrap();
        store
            .apply(&batch(
                root,
                vec![package(root, "old", &["stale"], &[])],
                true,
            ))
            .unwrap();
    }

    let mut store = GraphStore::open(&database, root).unwrap();
    assert_eq!(store.search("stale", 10).unwrap().len(), 1);

    store
        .apply(&batch(
            root,
            vec![package(root, "new", &["current"], &[])],
            true,
        ))
        .unwrap();
    assert!(store.search("stale", 10).unwrap().is_empty());
    assert_eq!(store.search("current", 10).unwrap().len(), 1);
}

#[test]
fn dangling_replacement_rolls_back_symbols_and_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    store
        .apply(&batch(
            root,
            vec![package(root, "p", &["a", "b"], &[("a", "b")])],
            true,
        ))
        .unwrap();

    let mut invalid = batch(
        root,
        vec![package(root, "p", &["a"], &[("a", "missing")])],
        false,
    );
    invalid.snapshot = "invalid".into();
    assert!(store.apply(&invalid).is_err());

    let view = store
        .graph(&request("a", &[], 10, Direction::Outgoing))
        .unwrap();
    assert_eq!(view.snapshot, "test-snapshot");
    assert_eq!(view.nodes.len(), 2);
    assert_eq!(view.edges.len(), 1);
}

#[test]
fn internals_are_grouped_and_keep_valid_endpoints_under_limits() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    let mut function_package = package(root, "p", &["a"], &[]);
    let source = json!({
        "file": root.join("main.go"),
        "line": 1,
        "column": 1,
        "endLine": 1,
        "endColumn": 2,
    });
    function_package.behaviors = serde_json::from_value(json!([{
        "symbolId": "a",
        "nodes": [
            {"id": "entry", "kind": "entry", "label": "entry", "source": source},
            {"id": "return", "kind": "return", "label": "return", "source": source},
            {"id": "exit", "kind": "exit", "label": "exit", "source": source},
        ],
        "edges": [
            {
                "id": "first",
                "source": "entry",
                "target": "return",
                "kind": "control",
                "label": "",
            },
            {
                "id": "last",
                "source": "return",
                "target": "exit",
                "kind": "control",
                "label": "",
            },
        ],
    }]))
    .unwrap();
    store
        .apply(&batch(root, vec![function_package], true))
        .unwrap();

    let mut req = request("a", &[], 20, Direction::Both);
    req.internals = vec!["a".into()];
    let complete = store.graph(&req).unwrap();
    assert_eq!(complete.nodes.len(), 4);
    assert_eq!(complete.edges.len(), 2);
    valid_endpoints(&complete);
    assert!(
        complete
            .nodes
            .iter()
            .filter(|n| n.id != "a")
            .all(|n| n.parent_id.as_deref() == Some("a"))
    );

    req.internals = vec!["a".into(), "a".into()];
    let duplicate_request = store.graph(&req).unwrap();
    assert_eq!(duplicate_request.nodes.len(), 4);
    assert_eq!(duplicate_request.edges.len(), 2);
    valid_endpoints(&duplicate_request);

    req.limit = 3;
    let limited = store.graph(&req).unwrap();
    assert!(limited.truncated);
    assert_eq!(limited.nodes.len(), 3);
    valid_endpoints(&limited);
}

#[test]
fn unknown_relationship_filters_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    store
        .apply(&batch(root, vec![package(root, "p", &["a"], &[])], true))
        .unwrap();

    let mut req = request("a", &[], 10, Direction::Both);
    req.kinds = vec!["calls'); DROP TABLE symbols; --".into()];
    assert!(store.graph(&req).is_err());
    assert_eq!(store.search("a", 10).unwrap().len(), 1);
}

#[test]
fn large_neighborhoods_can_be_paged_without_hydrating_all_neighbors() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    let names: Vec<String> = std::iter::once("focus".into())
        .chain((0..60).map(|i| format!("neighbor-{i:03}")))
        .collect();
    let references: Vec<&str> = names.iter().map(String::as_str).collect();
    let connections: Vec<(&str, &str)> = names
        .iter()
        .skip(1)
        .map(|n| ("focus", n.as_str()))
        .collect();
    store
        .apply(&batch(
            root,
            vec![package(root, "p", &references, &connections)],
            true,
        ))
        .unwrap();

    let mut req = request("focus", &[], 80, Direction::Outgoing);
    let first = store.graph(&req).unwrap();
    assert_eq!(first.nodes.len(), 41);
    assert_eq!(first.edges.len(), 40);
    let summary = first
        .summaries
        .iter()
        .find(|s| s.node_id == "focus")
        .unwrap();
    assert_eq!(summary.hidden, 20);
    assert_eq!(summary.has_more, Some(true));
    assert_eq!(summary.page_size, Some(40));

    req.offsets.insert("focus".into(), 40);
    let second = store.graph(&req).unwrap();
    assert_eq!(second.nodes.len(), 21);
    assert_eq!(second.edges.len(), 20);
    assert_eq!(
        second
            .summaries
            .iter()
            .find(|s| s.node_id == "focus")
            .unwrap()
            .has_more,
        Some(false)
    );

    let ids: HashSet<_> = first
        .edges
        .iter()
        .chain(&second.edges)
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(ids.len(), 60);
    valid_endpoints(&first);
    valid_endpoints(&second);

    req.offsets.insert("focus".into(), 1_000_001);
    assert!(store.graph(&req).is_err());
}

#[test]
fn empty_relationship_filters_hide_all_external_edges() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut store = GraphStore::memory(root).unwrap();
    store
        .apply(&batch(
            root,
            vec![package(
                root,
                "p",
                &["a", "b", "c"],
                &[("a", "b"), ("c", "a")],
            )],
            true,
        ))
        .unwrap();

    let mut req = request("a", &[], 10, Direction::Both);
    req.kinds.clear();
    let view = store.graph(&req).unwrap();
    assert_eq!(view.nodes.len(), 1);
    assert!(view.edges.is_empty());
    assert_eq!(view.summaries[0].hidden, 2);
}

#[test]
fn repeated_sites_share_a_connection_and_omission_counts_remain_disjoint() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut facts = package(root, "p", &["a", "b", "c"], &[("a", "b"), ("a", "c")]);
    for i in 1..65 {
        let mut site = facts.edges[0].clone();
        site.id = format!("a:b:site:{i:03}");
        site.evidence.line = i;
        site.expression = format!("b({i})");
        facts.edges.push(site);
    }
    let mut read = facts.edges[1].clone();
    read.id = "read-c".into();
    read.kind = "reads".into();
    facts.edges.push(read);
    let mut store = GraphStore::memory(root).unwrap();
    store.apply(&batch(root, vec![facts], true)).unwrap();
    let mut query = request("a", &[], 80, Direction::Outgoing);
    query.neighbor_limit = 1;
    let first = store.graph(&query).unwrap();
    assert_eq!(first.nodes.len(), 2);
    assert_eq!(first.edges.len(), 1);
    assert_eq!(first.edges[0].site_count, 65);
    assert_eq!(first.edges[0].sites.len(), 40);
    assert_eq!(
        store
            .relation_sites("a", "b", "calls", 40)
            .unwrap()
            .sites
            .len(),
        25
    );
    let summary = &first.summaries[0];
    assert_eq!(summary.distinct_symbols, 2);
    assert_eq!(summary.filtered, 1);
    assert_eq!(summary.paginated, 1);
    assert_eq!(
        summary.hidden,
        summary.filtered + summary.collapsed + summary.paginated + summary.limited
    );
    query.limit = 1;
    let limited = store.graph(&query).unwrap();
    let summary = &limited.summaries[0];
    assert_eq!(summary.limited, 65);
    assert_eq!(
        summary.hidden,
        summary.filtered + summary.collapsed + summary.paginated + summary.limited
    );
    query.limit = 80;
    query.groups.insert(
        "a".into(),
        sonar_core::NeighborFilter {
            package_id: "p".into(),
            kind: "reads".into(),
            direction: "outgoing".into(),
        },
    );
    query.kinds = vec!["calls".into(), "reads".into()];
    let reads = store.graph(&query).unwrap();
    assert_eq!(reads.edges.len(), 1);
    assert_eq!(reads.edges[0].kind, "reads");
    assert_eq!(reads.summaries[0].collapsed, 66);
}

#[test]
fn discovery_and_browsing_page_canonical_local_declarations() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut facts = package(root, "p", &["a", "main", "Record"], &[]);
    facts.symbols[2].kind = "struct".into();
    let mut store = GraphStore::memory(root).unwrap();
    store.apply(&batch(root, vec![facts], true)).unwrap();
    assert_eq!(store.discovery().unwrap().entrypoints[0].name, "main");
    assert_eq!(
        store.browse("struct", "p", 0).unwrap().symbols[0].name,
        "Record"
    );
    assert_eq!(store.browse("struct", "other", 0).unwrap().total, 0);
    assert!(store.browse("unknown", "", 0).is_err());
    assert!(store.relation_sites("a", "b", "unknown", 0).is_err());
}

#[test]
fn long_behavior_projection_is_bounded_with_and_without_a_distant_anchor() {
    for count in [1000, 4000] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut pkg = package(root, "p", &["long"], &[]);
        let source = serde_json::to_value(&pkg.symbols[0].source).unwrap();
        let nodes: Vec<_> = (0..count+2).map(|i| json!({
   "id":format!("long/behavior/{i}"), "kind": if i==0 {"entry"} else if i==count+1 {"exit"} else {"operation"},
   "label":format!("operation {i}"),"source":source
  })).collect();
        let edges: Vec<_> = (0..count+1).map(|i| json!({"id":format!("edge/{i}"),"source":format!("long/behavior/{i}"),"target":format!("long/behavior/{}",i+1),"kind":"control","label":"next"})).collect();
        pkg.behaviors = vec![
            serde_json::from_value(json!({"symbolId":"long","nodes":nodes,"edges":edges})).unwrap(),
        ];
        let mut store = GraphStore::memory(root).unwrap();
        store.apply(&batch(root, vec![pkg], true)).unwrap();
        let mut req = request("long", &[], 80, Direction::Outgoing);
        req.internals = vec!["long".into()];
        for anchored in [false, true] {
            if anchored {
                req.behavior_anchors
                    .insert("long".into(), format!("long/behavior/{count}"));
            }
            let mut times = vec![];
            for _ in 0..3 {
                let began = std::time::Instant::now();
                let view = store.graph(&req).unwrap();
                times.push(began.elapsed());
                assert!(view.nodes.len() <= 38);
                assert!(view.nodes.iter().any(|n| n.kind == "entry"));
                assert!(view.nodes.iter().any(|n| n.kind == "boundary"));
                assert!(view.behaviors[0].hidden_nodes > 0);
                if anchored {
                    assert!(
                        view.nodes
                            .iter()
                            .any(|n| n.id == format!("long/behavior/{count}"))
                    );
                }
                valid_endpoints(&view);
            }
            times.sort();
            println!(
                "{count} statements, anchored={anchored}: median {:?}",
                times[1]
            );
        }
    }
}

#[test]
fn local_groups_override_only_the_selected_seed_in_both_directions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut facts = package(
        root,
        "p",
        &["a", "b", "c", "d", "e"],
        &[("a", "b"), ("a", "c"), ("b", "d"), ("e", "b")],
    );
    facts.edges[2].kind = "reads".into();
    facts.edges[3].kind = "reads".into();
    let mut store = GraphStore::memory(root).unwrap();
    store.apply(&batch(root, vec![facts], true)).unwrap();
    for (direction, target) in [("outgoing", "d"), ("incoming", "e")] {
        let mut query = request("a", &["b"], 80, Direction::Outgoing);
        query.neighbor_limit = 1;
        query.groups.insert(
            "b".into(),
            sonar_core::NeighborFilter {
                package_id: "p".into(),
                kind: "reads".into(),
                direction: direction.into(),
            },
        );
        let view = store.graph(&query).unwrap();
        valid_endpoints(&view);
        assert_eq!(query.kinds, vec!["calls"]);
        assert!(matches!(query.direction, Direction::Outgoing));
        assert!(
            view.edges
                .iter()
                .any(|edge| edge.source == "a" && edge.target == "b" && edge.kind == "calls")
        );
        assert!(view.nodes.iter().any(|node| node.id == target));
        let summary = view.summaries.iter().find(|s| s.node_id == "b").unwrap();
        assert_eq!(
            summary.hidden,
            summary.filtered + summary.collapsed + summary.paginated + summary.limited
        );
        assert!(
            summary
                .groups
                .iter()
                .any(|group| group.direction == direction
                    && group.kind == "reads"
                    && !group.filtered)
        );
        query.groups.clear();
        assert!(
            !store
                .graph(&query)
                .unwrap()
                .nodes
                .iter()
                .any(|node| node.id == target)
        );
    }
}

#[test]
fn methods_question_filters_before_paging_and_counts_other_type_uses() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut facts = package(
        root,
        "p",
        &["T", "function", "method1", "method2"],
        &[("function", "T"), ("method1", "T"), ("method2", "T")],
    );
    facts.symbols[0].kind = "struct".into();
    facts.symbols[2].kind = "method".into();
    facts.symbols[3].kind = "method".into();
    for edge in &mut facts.edges {
        edge.kind = "uses_type".into();
    }
    let mut store = GraphStore::memory(root).unwrap();
    store.apply(&batch(root, vec![facts], true)).unwrap();
    let mut query = request("T", &[], 80, Direction::Incoming);
    query.kinds = vec!["uses_type".into()];
    query.neighbor_kind = "method".into();
    query.neighbor_limit = 1;
    for offset in [0, 1] {
        query.offsets.insert("T".into(), offset);
        let view = store.graph(&query).unwrap();
        assert_eq!(view.edges.len(), 1);
        assert_eq!(
            view.nodes
                .iter()
                .filter(|node| node.kind == "method")
                .count(),
            1
        );
        assert!(!view.nodes.iter().any(|node| node.id == "function"));
        let summary = view.summaries.iter().find(|s| s.node_id == "T").unwrap();
        assert_eq!(summary.filtered, 1);
        assert_eq!(summary.paginated, 1);
        assert_eq!(summary.hidden, 2);
    }
    query.neighbor_kind = "unknown".into();
    assert!(store.graph(&query).is_err());
}
