# ADR 0001: Desktop and analysis boundaries

Status: accepted.

## Context

Go Sonar needs an interactive desktop graph, accurate Go source analysis, and control over query latency and memory. Source facts must remain independent of the renderer and layout engine so presentation changes do not require rebuilding the analysis model.

## Decision

Use Tauri for the desktop app, React Flow for graph presentation, Rust for the index and bounded graph queries, and a local Go analyzer for language-specific facts. Use ELK.js initially behind an engine-independent layout contract.

Keep the full index in the Rust core. Send only requested display projections to the frontend. Run analysis locally without executing the inspected application's behavior.

## Consequences

The project reuses Go's language tooling and existing graph UI libraries. It also has a mixed-language process boundary, a versioned transport, and WebView resources to build and verify.

Incremental reuse, consistent publication, bounded queries, and explicit failure handling are required. Performance measurements must include Rust, Go, toolchain children, and WebView processes. The language choice alone provides no performance guarantee.

The layout adapter can change without altering source identities, relationship meanings, or index storage. See [Architecture](../architecture.md) for component responsibilities and [Performance requirements](../performance.md) for verification rules.
