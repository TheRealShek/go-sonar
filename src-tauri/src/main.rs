#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use sonar_core::{
    Backend, GraphRequest, GraphView, ProjectSummary, SourceExcerpt, SourceSpan, Symbol,
};
use tauri::Manager;

type State<'a> = tauri::State<'a, Arc<Backend>>;

#[derive(serde::Serialize)]
struct BenchmarkConfig {
    root: String,
    query: String,
    iterations: usize,
    presentation: &'static str,
}

/// Native benchmarks are enabled only by an explicit process argument.
#[tauri::command]
fn benchmark_config() -> Result<Option<BenchmarkConfig>, String> {
    let args: Vec<String> = std::env::args().collect();
    let argument = |name: &str| {
        args.windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| pair[1].clone())
    };

    let Some(root) = argument("--benchmark") else {
        return Ok(None);
    };

    let iterations: usize = argument("--iterations")
        .unwrap_or_else(|| "20".into())
        .parse()
        .map_err(|_| "invalid benchmark iterations".to_string())?;
    if !(1..=1000).contains(&iterations) {
        return Err("benchmark iterations must be 1..1000".into());
    }

    Ok(Some(BenchmarkConfig {
        root,
        query: argument("--query").unwrap_or_else(|| "Get".into()),
        iterations,
        presentation: if args.iter().any(|a| a == "--background-commit") {
            "commit"
        } else {
            "frames"
        },
    }))
}

/// Publish bounded renderer measurements to the external process-tree sampler.
#[tauri::command]
fn benchmark_report(report: serde_json::Value) -> Result<(), String> {
    use std::io::Write;

    if benchmark_config()?.is_none() {
        return Err("benchmark mode is disabled".into());
    }

    let event = serde_json::json!({
        "kind": "renderer",
        "report": report,
    });
    let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    if line.len() > 16 * 1024 {
        return Err("benchmark report exceeds 16 KiB".into());
    }

    println!("{line}");
    std::io::stdout().flush().map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_project(state: State<'_>, root: String) -> Result<ProjectSummary, String> {
    let backend = Arc::clone(state.inner());
    let result = tauri::async_runtime::spawn_blocking(move || backend.open(&PathBuf::from(root)))
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_project(state: State<'_>) -> Result<ProjectSummary, String> {
    let backend = Arc::clone(state.inner());
    let result = tauri::async_runtime::spawn_blocking(move || backend.refresh())
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_symbols(
    state: State<'_>,
    query: String,
    limit: usize,
) -> Result<Vec<Symbol>, String> {
    let backend = Arc::clone(state.inner());
    let result = tauri::async_runtime::spawn_blocking(move || backend.search(&query, limit))
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn graph_view(state: State<'_>, request: GraphRequest) -> Result<GraphView, String> {
    let backend = Arc::clone(state.inner());
    let result = tauri::async_runtime::spawn_blocking(move || backend.graph(&request))
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn impact_view(
    state: State<'_>,
    symbol_id: String,
    category: String,
    limit: usize,
) -> Result<GraphView, String> {
    let backend = Arc::clone(state.inner());
    let result =
        tauri::async_runtime::spawn_blocking(move || backend.impact(&symbol_id, &category, limit))
            .await
            .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn source_excerpt(state: State<'_>, source: SourceSpan) -> Result<SourceExcerpt, String> {
    let backend = Arc::clone(state.inner());
    let result = tauri::async_runtime::spawn_blocking(move || backend.source(&source))
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn browse_symbols(
    state: State<'_>,
    kind: String,
    package: String,
    offset: usize,
) -> Result<sonar_core::SymbolPage, String> {
    let backend = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || backend.browse(&kind, &package, offset))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn discover_project(state: State<'_>) -> Result<sonar_core::Discovery, String> {
    let backend = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || backend.discovery())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn relation_sites(
    state: State<'_>,
    source: String,
    target: String,
    kind: String,
    offset: usize,
) -> Result<sonar_core::RelationSites, String> {
    let backend = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        backend.relation_sites(&source, &target, &kind, offset)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn choose_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a Go module folder")
            .blocking_pick_folder()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Resolve only the packaged helper or a developer-specified trusted executable.
fn analyzer_path() -> std::io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("GO_SONAR_ANALYZER") {
        return Ok(PathBuf::from(path));
    }

    let executable = std::env::current_exe()?;
    let sibling = executable.with_file_name(if cfg!(windows) {
        "go-sonar-analyzer.exe"
    } else {
        "go-sonar-analyzer"
    });
    if sibling.is_file() {
        return Ok(sibling);
    }

    #[cfg(debug_assertions)]
    {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        for entry in std::fs::read_dir(directory)? {
            let path = entry?.path();
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("go-sonar-analyzer-"))
            {
                return Ok(path);
            }
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "bundled Go analyzer is missing",
    ))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cache = if benchmark_config()?.is_some() {
                std::env::var_os("GO_SONAR_BENCHMARK_CACHE_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(app.path().app_cache_dir()?.join("indexes"))
            } else {
                app.path().app_cache_dir()?.join("indexes")
            };

            let analyzer = analyzer_path()?;
            let backend = Backend::new(analyzer, cache);
            app.manage(Arc::new(backend));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            refresh_project,
            search_symbols,
            browse_symbols,
            discover_project,
            relation_sites,
            choose_project_folder,
            graph_view,
            impact_view,
            source_excerpt,
            benchmark_config,
            benchmark_report
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
