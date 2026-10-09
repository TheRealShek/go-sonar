# Architecture

## Status and authority

The user approved Tauri + React Flow + Rust + a Go analyzer, subject to incremental analysis, bounded rendering, and whole-application performance benchmarks. ELK.js is an acceptable starting layout engine and must remain replaceable.

This document specifies intended responsibilities and boundaries. It does not describe an implementation that already exists.

## Approved components

### Tauri desktop application

Tauri hosts the desktop workspace and connects the frontend to the Rust core. The application and its resources operate locally. Source analysis does not run the project's application or tests.

### React Flow presentation

React Flow presents symbols, labelled relationships, and visually grouped function internals. The frontend handles interaction and requests expansions; it does not receive or query the complete repository graph.

React with TypeScript and Vite is the frontend recommendation. Exact versions and secondary UI libraries are not frozen by the architecture approval.

### Rust application core

Rust owns the indexed source facts, graph queries, search, traversal, filtering, grouping, impact exploration, cache policy, and analyzer lifecycle. It derives bounded views for the current exploration and tracks the source snapshot associated with results.

The core decides what is available for display and retains the codebase index behind its query interface. Keeping the core in Rust is a responsibility decision, not proof of latency or memory performance.

### Go analyzer

A local Go analyzer supplies language-specific facts, types, source evidence, and internal function behavior. Rust coordinates its work and imports results into the index.

The working analysis approach uses Go package loading, syntax trees, type information, and control-flow analysis. Deeper SSA and call-target analysis are added when required coverage justifies their cost; they must not become an unconditional whole-program startup task.

Go analysis remains potentially expensive. It needs incremental reuse, controlled concurrency, explicit diagnostics, and measurement alongside the Rust core.

### Replaceable layout engine

ELK.js is the initial layout engine, with a local worker as the proposed execution model. Layout operates on a bounded display scope and remains separate from source analysis.

The canonical graph model records identities, symbol kinds, relationship meanings, source evidence, and analysis scope. It must not contain ELK-specific option names, React Flow node objects, or assumptions that a particular layout engine defines a relationship.

Define an engine-independent layout request containing the necessary identities, dimensions, groups, connection endpoints, and position constraints. A layout result contains geometry, such as node bounds and edge paths. Engine adapters translate between this contract and the chosen layout library.

Exploration state, including focus, filters, expansion, history, and pinned positions, remains meaningful if the layout adapter changes. Replacing ELK must not require rebuilding the source index or changing relationship semantics.

Stable incremental placement, group resizing, and routing across function boundaries still require validation. An engine change can alter geometry without changing code facts.

## Data boundaries

The frontend requests a symbol, relationship category, function expansion, or other bounded view. Rust returns the current display projection and its snapshot identity. Further relationships stay queryable in the core and appear only when requested.

Renderer payloads contain only the visible nodes, edges, and summaries needed for that display. Collapsed detail and unrequested repository relationships are not hydrated into React Flow and then hidden. Viewport handling must preserve meaningful boundary connections through the necessary endpoints or lightweight boundary representations.

Layout requests may carry bounded structural metadata needed to place the display scope. They do not carry the full repository graph or duplicate source bodies and semantic analysis state. Layout metadata and React Flow renderer payloads are distinct contracts.

The proposed transport is Tauri commands and channels between the frontend and Rust, with versioned messages over stdin/stdout between Rust and the Go analyzer. Requests and results need identities, snapshot information, errors, and cancellation handling so obsolete work does not overwrite newer analysis.

Storage format and frontend state libraries remain implementation choices. SQLite with Rust-owned access and a small frontend exploration store are working recommendations, not additional approved architecture constraints.

## Incremental updates

For an edit, identify changed source and invalidate the facts that depend on it. Go package semantics may require checking more than the edited file; changes to shared declarations can require updating consumers as well.

Recompute affected facts and reuse valid facts outside that scope. Remove obsolete declarations and relationships, refresh source locations, and publish a consistent new snapshot. Results from an older request must not replace newer facts.

Dependency tracking and invalidation must account for source changes, declarations, package relationships, build configuration, and relevant tool versions. Broad changes to workspace or module configuration can legitimately affect more scope than a function-body edit. Correctness determines that scope; clearing the full index is not the normal edit path.

Invalid source, unavailable dependencies, cancellation, or analyzer failure must leave a clearly marked incomplete or stale view. The system must not silently present stale relationships as current or fall back to a full reindex without reporting the reason.

The exact invalidation algorithm and cache keys need implementation validation. Incremental analysis is a required outcome, not a promise that all edits can be analyzed one file at a time.

## Performance boundary

Only the requested exploration crosses into the UI. Use bounded responses, caches, task concurrency, and pending work. Cancellation and backpressure must prevent rapid expansion or edits from creating an unbounded work queue.

All application processes count toward performance measurement, including Go analysis and WebView work. Running layout in a worker prevents that work from occupying the UI thread but does not eliminate its CPU or memory cost.

The benchmark plan and acceptance requirements are in [Performance requirements](performance.md). The durable stack decision is recorded in [ADR 0001](adr/0001-desktop-and-analysis-boundaries.md).
