# Go Sonar

Go Sonar is an offline visual explorer for understanding Go codebases. Users start at any symbol, expand its relationships in either direction, and explore how functions behave internally.

The graph is the primary interface. It should explain most relationships visually, with contextual explanations and links to the source evidence when the user wants more detail.

Progressive disclosure keeps exploration readable. The initial graph shows a small set of relevant relationships, and users choose which connections and function internals to expand.

## Project documents

- [Product intent](docs/product-intent.md) records the confirmed purpose, expected experience, and concrete acceptance scenarios.
- [Domain language](CONTEXT.md) defines the terms used throughout the project.
- [Design discussion](docs/design-discussion.md) records confirmed decisions, their reasons, and the details deferred until implementation planning.
- [Architecture](docs/architecture.md) defines the approved stack, component responsibilities, and replaceable layout boundary.
- [Performance requirements](docs/performance.md) defines incremental updates, bounded rendering, and the benchmark plan.
- [Architecture decision](docs/adr/0001-desktop-and-analysis-boundaries.md) records the reason for the desktop and analysis boundaries.

## Current state

This directory contains planning documents only. Product intent and architecture are approved. Function internals expand as visually grouped, collapsible subgraphs; the initial explorer uses static source analysis; and impact exploration starts with a selected symbol and a hypothetical change category.

The approved stack is Tauri + React Flow + a Rust application core + a Go analyzer. ELK.js is the starting layout engine and must remain replaceable. Rust owns graph queries, traversal, filtering, grouping, impact analysis, and cache management.

Incremental analysis, bounded graph rendering, and benchmarks covering Rust, Go, and WebView processes are required. Go is the initial target language. No application has been implemented and no performance benchmarks have been run.
