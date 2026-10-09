use sonar_core::Backend;
use std::path::PathBuf;

#[test]
fn persistence_failure_restarts_helper_before_retrying() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let helper = repository.join("src-tauri/binaries/go-sonar-analyzer-x86_64-unknown-linux-gnu");
    if !helper.is_file() {
        eprintln!("SKIPPED: build the real analyzer helper first");
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    let cache = temporary.path().join("cache");
    std::fs::write(&cache, "not a directory").unwrap();
    let backend = Backend::new(helper, cache.clone());
    let root = repository.join("fixtures/sample");
    assert!(backend.open(&root).is_err());
    std::fs::remove_file(&cache).unwrap();
    let recovered = backend.open(&root).unwrap();
    assert!(recovered.symbol_count >= 8);
    assert_eq!(recovered.stats.analyzed_packages, 2);
    assert!(
        backend
            .search("Get", 10)
            .unwrap()
            .iter()
            .any(|s| s.name == "Get")
    );
    assert_eq!(backend.refresh().unwrap().stats.analyzed_packages, 0);
}

#[test]
fn changed_source_cannot_be_displayed_using_published_coordinates() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let helper = repository.join("src-tauri/binaries/go-sonar-analyzer-x86_64-unknown-linux-gnu");
    if !helper.is_file() {
        eprintln!("SKIPPED: build the real analyzer helper first");
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("module");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("go.mod"), "module evidence\n\ngo 1.26.0\n").unwrap();
    let source = root.join("evidence.go");
    let original = "package evidence\nfunc Get() int { return 1 }\n";
    std::fs::write(&source, original).unwrap();
    let backend = Backend::new(helper, temporary.path().join("cache"));
    backend.open(&root).unwrap();
    let symbol = backend.search("Get", 10).unwrap().remove(0);
    assert!(
        backend
            .source(&symbol.source)
            .unwrap()
            .text
            .contains("return 1")
    );
    std::fs::write(&source, format!("// edited before refreshing\n{original}")).unwrap();
    let error = backend.source(&symbol.source).unwrap_err();
    assert!(error.to_string().contains("source changed since analysis"));
    backend.refresh().unwrap();
    let refreshed = backend.search("Get", 10).unwrap().remove(0);
    assert_eq!(refreshed.source.line, 3);
    assert!(
        backend
            .source(&refreshed.source)
            .unwrap()
            .text
            .contains("return 1")
    );
}
