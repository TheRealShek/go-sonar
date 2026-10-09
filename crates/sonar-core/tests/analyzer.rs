use sonar_core::{AnalyzerClient, Direction, GraphRequest, GraphStore};
use std::collections::HashSet;
use std::path::PathBuf;

#[test]
fn real_helper_indexes_demo_and_reuses_unchanged_packages() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let helper = std::env::var_os("GO_SONAR_ANALYZER")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repository.join("src-tauri/binaries/go-sonar-analyzer-x86_64-unknown-linux-gnu")
        });
    if !helper.is_file() {
        eprintln!(
            "SKIPPED real analyzer integration: helper unavailable at {}",
            helper.display()
        );
        return;
    }
    let root = repository.join("fixtures/sample").canonicalize().unwrap();
    let mut analyzer = AnalyzerClient::start(&helper).unwrap();
    let first = analyzer.analyze(&root).unwrap();
    assert!(first.full);
    assert_eq!(first.stats.analyzed_packages, 2);
    assert!(first.diagnostics.iter().all(|d| d.severity != "error"));
    let mut store = GraphStore::memory(&root).unwrap();
    let summary = store.apply(&first).unwrap();
    assert!(summary.symbol_count >= 8);
    assert!(summary.relation_count > 0);
    let symbols = store.search("Get", 20).unwrap();
    let get = symbols.iter().find(|s| s.name == "Get").unwrap();
    let view = store
        .graph(&GraphRequest {
            focus: get.id.clone(),
            expanded: vec![],
            internals: vec![get.id.clone()],
            kinds: vec![],
            limit: 100,
            direction: Direction::Both,
            offsets: Default::default(),
        })
        .unwrap();
    let ids: HashSet<_> = view.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids.len(), view.nodes.len());
    assert!(
        view.nodes
            .iter()
            .any(|n| n.parent_id.as_deref() == Some(get.id.as_str()) && n.kind == "condition")
    );
    for edge in &view.edges {
        assert!(ids.contains(edge.source.as_str()));
        assert!(ids.contains(edge.target.as_str()));
    }
    let unchanged = analyzer.analyze(&root).unwrap();
    assert!(!unchanged.full);
    assert_eq!(unchanged.stats.analyzed_packages, 0);
    assert_eq!(unchanged.stats.reused_packages, 2);
    assert!(unchanged.packages.is_empty());
    let update = store.apply(&unchanged).unwrap();
    assert_eq!(update.symbol_count, summary.symbol_count);
    assert_eq!(update.relation_count, summary.relation_count);
}
