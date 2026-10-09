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
