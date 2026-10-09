use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::json;
use sonar_core::{Backend, Direction, GraphRequest};

/// Headless measurement client; the Python harness separately samples this process tree.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let argument = |name: &str| {
        args.windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| pair[1].clone())
    };

    let root =
        PathBuf::from(argument("--project").ok_or("--project ROOT is required")?).canonicalize()?;
    let analyzer = PathBuf::from(argument("--analyzer").ok_or("--analyzer PATH is required")?)
        .canonicalize()?;
    let cache = PathBuf::from(argument("--cache").ok_or("--cache DIR is required")?);
    let query = argument("--query").unwrap_or_else(|| "Get".into());
    let iterations: usize = argument("--iterations")
        .unwrap_or_else(|| "30".into())
        .parse()?;
    if !(1..=1000).contains(&iterations) {
        return Err("iterations must be between 1 and 1000".into());
    }

    let backend = Backend::new(analyzer, cache);
    let started = Instant::now();
    let first = backend.open(&root)?;
    emit(json!({
        "phase": "initial_index",
        "durationMs": started.elapsed().as_secs_f64() * 1000.0,
        "summary": first,
    }))?;

    let started = Instant::now();
    let warm = backend.refresh()?;
    emit(json!({
        "phase": "unchanged_refresh",
        "durationMs": started.elapsed().as_secs_f64() * 1000.0,
        "summary": warm,
    }))?;

    let symbols = backend.search(&query, 40)?;
    let focus = symbols
        .iter()
        .find(|s| s.name == query)
        .or_else(|| symbols.first())
        .ok_or("no matching focus symbol")?;

    let mut request = GraphRequest {
        focus: focus.id.clone(),
        expanded: vec![],
        internals: vec![],
        kinds: vec![
            "calls".into(),
            "reads".into(),
            "writes".into(),
            "constructs".into(),
            "uses_type".into(),
            "references".into(),
            "implements".into(),
        ],
        limit: 80,
        direction: Direction::Both,
        offsets: Default::default(),
    };

    for phase in ["neighborhood", "expanded", "internals"] {
        if phase == "expanded" {
            request.expanded = backend
                .graph(&request)?
                .nodes
                .into_iter()
                .filter(|n| n.id != request.focus)
                .take(20)
                .map(|n| n.id)
                .collect();
        }
        if phase == "internals" {
            request.internals = vec![request.focus.clone()];
        }

        let mut times = Vec::with_capacity(iterations);
        let mut node_count = 0;
        let mut edge_count = 0;
        let mut payload_bytes = 0;
        let mut truncated = false;

        for _ in 0..iterations {
            let started = Instant::now();
            let view = backend.graph(&request)?;
            let payload = serde_json::to_vec(&view)?;
            times.push(started.elapsed().as_secs_f64() * 1000.0);

            node_count = view.nodes.len();
            edge_count = view.edges.len();
            payload_bytes = payload.len();
            truncated = view.truncated;
        }

        times.sort_by(f64::total_cmp);
        let median_ms = times[iterations / 2];
        let p95_index = ((iterations as f64 * 0.95).ceil() as usize).saturating_sub(1);

        emit(json!({
            "phase": phase,
            "iterations": iterations,
            "medianMs": median_ms,
            "p95Ms": times[p95_index],
            "nodes": node_count,
            "edges": edge_count,
            "payloadBytes": payload_bytes,
            "truncated": truncated,
            "includesRendering": false,
        }))?;
    }

    if args.iter().any(|a| a == "--exercise-edits") {
        if !root.join(".sonar-benchmark-fixture").is_file() {
            return Err("edit measurements require a generated benchmark fixture".into());
        }

        let path = root.join("leaf/leaf.go");
        measure_edit(&backend, &path, "return 1", "return 2", "body_edit")?;
        measure_edit(
            &backend,
            &path,
            "Value int",
            "Value int; Version int",
            "declaration_edit",
        )?;
    }

    emit(json!({
        "phase": "complete",
        "includesRendering": false,
    }))?;

    Ok(())
}

/// Replace one marker in the owned fixture and time its refreshed index.
fn measure_edit(
    backend: &Backend,
    file: &Path,
    from: &str,
    to: &str,
    phase: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let original = std::fs::read_to_string(file)?;
    if !original.contains(from) {
        return Err(format!("fixture edit marker missing: {from}").into());
    }

    std::fs::write(file, original.replacen(from, to, 1))?;
    let started = Instant::now();
    let summary = backend.refresh()?;
    emit(json!({
        "phase": phase,
        "durationMs": started.elapsed().as_secs_f64() * 1000.0,
        "summary": summary,
    }))?;

    Ok(())
}

/// Flush one JSON-lines measurement for the external process sampler.
fn emit(mut event: serde_json::Value) -> io::Result<()> {
    event["kind"] = json!("core");
    println!("{event}");
    io::stdout().flush()
}
