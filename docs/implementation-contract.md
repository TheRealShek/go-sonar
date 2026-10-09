# First implementation contract

The first working slice loads a local Go module, indexes source-backed symbols and relationships, expands bounded graph neighborhoods, and opens function internals inside their parent. It preserves offline operation, targeted updates, and an engine-independent graph model. This is a milestone, not a claim that every product requirement is finished.

## Go analyzer transport

The analyzer is a persistent executable under `analyzer/`, with its entry point in `analyzer/cmd/go-sonar-analyzer`. It reads one JSON request per line from stdin and writes one JSON response per line to stdout. Logs go to stderr. Maximum accepted request size is explicitly bounded; EOF stops the process cleanly.

Request: `{ "version": 1, "id": "request-id", "method": "analyze", "root": "/absolute/project/path" }`.

Response: `{ "version": 1, "id": "request-id", "result": AnalysisBatch }`, or the same envelope with `error` instead of `result`. Field names are camelCase. Every array below is emitted as an array, never null.

An analysis request scans file/configuration fingerprints and returns changed package facts only. It includes dependencies and consumers when required, and removes obsolete package facts. Diagnostics and statistics state the scope and whether facts are complete. The application never runs project code.

`AnalysisBatch` has `root`, `snapshot`, `full`, `packages`, `removedPackages`, `stats`, and `diagnostics`. `snapshot` is a stable fingerprint of the current analyzed source/configuration. `full` resets the stored package scope after a new analyzer session or configuration change, preventing obsolete cached packages from surviving. `packages` contains replacements, not the complete index on every update.

`PackageFacts` has `id`, `files`, `sourceFingerprints`, `fingerprint`, `imports`, `symbols`, `edges`, and `behaviors`.

`Symbol` has `id`, `name`, `qualifiedName`, `kind`, `packageId`, `source`, `signature`, `documentation`, and `exported`. Supported kind strings describe source entities, such as function, method, struct, interface, field, variable, constant, type, and package.

`sourceFingerprints` maps source paths to SHA-256 fingerprints for the published snapshot. Source inspection rejects a file changed since that snapshot.

`SourceSpan` has `file`, `line`, `column`, `endLine`, and `endColumn`. Paths are absolute; positions are one-based.

`Relation` has `id`, `source`, `target`, `kind`, `label`, `certainty`, and `evidence`. Source and target are symbol IDs. Kinds include calls, references, reads, writes, constructs, implements, and uses_type. Certainty is resolved or possible. External declarations may be represented as symbols with honest source evidence and package ownership, or unresolved relationships may be reported as diagnostics. Never manufacture a resolved target from a spelling match.

`Behavior` has `symbolId`, `nodes`, and `edges`. A behavior node has `id`, `kind`, `label`, `source`, and optional `relatedSymbolId`. Kinds include entry, condition, operation, return, exit, loop, and call. Behavior edges have `id`, `source`, `target`, `kind`, and `label`; kind is control or data. These describe static structure, not observed execution or guaranteed path feasibility.

`AnalysisStats` has `analyzedPackages`, `reusedPackages`, `changedFiles`, and `durationMs`. A diagnostic has `message`, `packageId`, and `severity` of warning or error. Syntax/type failures must not publish stale facts as a fresh complete snapshot.

## Rust desktop commands

`open_project({ root })` and `refresh_project()` return `ProjectSummary` with `root`, `name`, `snapshot`, `symbolCount`, `relationCount`, `stats`, and `diagnostics`.

`search_symbols({ query, limit })` returns a bounded list of symbols, defaulting to at most 40 results.

`graph_view({ request })` takes `{ focus, expanded, internals, kinds, limit, direction?, offsets? }`. Direction is incoming, outgoing, or both (default). Optional offsets map symbol IDs to relation-site offsets; each seed reveals at most 40 sorted relationship sites per page. Focus and expanded are symbol IDs; internals is a list of function IDs whose internals are open; kinds filters relationship categories. Direction and category filters apply in Rust before neighbors are hydrated. A finite limit applies to the whole visible view. It returns `{ snapshot, focus, nodes, edges, summaries, truncated }`.

A view node has `id`, `name`, `qualifiedName`, `kind`, `packageId`, `source`, `signature`, `documentation`, and optional `parentId` and `relatedSymbolId`. A view edge has `id`, `source`, `target`, `kind`, `label`, `certainty`, and `evidence`. Behavior edges use their source node's span for evidence and resolved certainty refers to source structure only.

A summary has `nodeId`, `incoming`, `outgoing`, and `hidden`. Processed seeds also have `pageOffset`, `pageSize`, and `hasMore` for on-demand pagination. It reports known source relationships without hydrating undisclosed neighbors. Expansions remain bounded, cycles and shared dependencies reuse IDs, and internals belong to their function parent.

`source_excerpt({ source })` returns `{ file, firstLine, text }` from a bounded range within the open project. The backend validates paths and range sizes; the frontend cannot read arbitrary files through this command.

`impact_view({ symbolId, category, limit })` returns a bounded graph view for incoming affected candidates. Categories are signature, field, and behavior, and the view explains potential effects rather than claiming breakage.

## Frontend and layout

The frontend uses React, TypeScript, Vite, and React Flow. It calls Tauri commands through a small backend module; browser-only preview may use an explicitly labelled fixture, never pretend a fixture is real analysis. The desktop defaults to real project selection.

ELK is isolated behind an engine-independent layout contract. Layout input is bounded view topology plus dimensions and groups; output is geometry. Tauri, analyzer, and persisted source facts contain no ELK or React Flow objects. Use a locally bundled worker, asynchronous result versioning, and stable positions where possible.

The graph is the primary interface. Show search, relationship toggles, expansion/collapse, internal behavior, history, contextual evidence, and an optional source inspector. Users can select any symbol, including structs and fields. Source-derived edges are not editable into invented code relationships.
