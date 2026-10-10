# Design decisions

This record explains the confirmed product choices. A working implementation now exists; these decisions remain the basis for development. Read [implementation notes](implementation-notes.md) for current scope rather than treating a design goal as a completed feature.

## Graph as the main interface

Users start at any symbol and expand incoming or outgoing relationships. A small initial neighborhood and explicit reveal actions keep large codebases readable. Connections need meanings, source evidence, and explanations of hidden detail.

This supports libraries as well as executables. It avoids requiring every investigation to begin at `main` or display a complete repository graph.

## Function internals stay grouped

Expand behavior inside a collapsible function subgraph. Conditions, operations, transformations, and returns stay together while preserving connections to surrounding declarations.

Grouping retains context when crossing between a function's internals and external relationships. The cost is more complex layout and routing across group boundaries. Focus controls and region expansion provide room without requiring a separate exploration model.

## Static analysis first

Analyze source without running the inspected application. Runtime tracing is outside the initial scope because it adds execution setup and a second kind of evidence before the source explorer is validated.

Static analysis can describe source-defined paths and relationships. It cannot establish observed execution, concrete values, or the feasibility of every branch combination. The UI must preserve that distinction.

Offline operation and avoiding project execution are separate requirements. Package loading may invoke compiler tools even though the app does not run the project's application, tests, or generators.

## Source-based explanations without AI

Use declarations, documentation, types, expressions, and control facts for contextual explanations. Link claims to inspectable source and leave undocumented design intent unknown.

This keeps explanations available offline and tied to evidence. It also limits the app to what its analysis and supplied documentation establish.

## Hypothetical changes first

Start impact exploration with a selected symbol and a signature, field, or behavior change category. Users can inspect relevant consumers before editing source or selecting a previous version.

The trade-off is that a category describes potential effects rather than the consequences of an exact patch. Git diff comparison would require a baseline and entity matching across revisions. It remains outside the current scope. Current impact queries cover direct incoming candidates, not complete transitive effects.

## Desktop and analysis boundaries

Use Tauri and React Flow for presentation, Rust for index ownership and graph queries, and Go for language-specific analysis. Keep ELK.js replaceable through an independent layout contract.

These choices reuse existing desktop, graph, and Go language tooling. They introduce transport and process boundaries that need failure handling and whole-application measurement. Rust does not eliminate Go loading costs or WebView memory.

The durable decision is [ADR 0001](adr/0001-desktop-and-analysis-boundaries.md). [Architecture](architecture.md) explains the current responsibilities.

## Incremental updates and bounded views

Refresh affected analysis and reuse valid facts. Body edits, declaration changes, and source-location changes can have different invalidation scopes. Correctness determines which consumers need replacement.

Keep the full index in Rust and send only bounded display projections to the frontend. Pagination, connection groups, and region summaries explain omitted detail without loading hidden repository graphs into React Flow.

Benchmarks must include indexing, request-to-render expansion, and simultaneous process-tree memory. Initial smoke runs exist; numerical release budgets and production workload checks remain pending.

## Decisions still open

Further work needs to establish release performance budgets, representative production workloads, and usability results. Layout tuning, relevance ranking, broader analysis coverage, and build-configuration controls need verification against those workloads.

Routine tuning and reversible library choices belong in the architecture, implementation, and performance documents. Add a new decision record when a durable boundary or product choice changes.
