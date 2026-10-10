# Architecture

Go Sonar uses Tauri, React Flow, a Rust application core, and a local Go analyzer. ELK.js computes layout through a replaceable adapter. These boundaries are approved; the current implementation uses SQLite for the index and a bundled worker for layout.

This document explains component responsibilities and required boundaries. [Implementation notes](implementation-notes.md) record current coverage and limitations. [ADR 0001](adr/0001-desktop-and-analysis-boundaries.md) records the decision and its trade-offs.

## Components

### Desktop and frontend

Tauri hosts the native app and connects React to Rust through desktop commands. React, TypeScript, and Vite provide the frontend; React Flow displays symbols, connections, and nested function groups.

The frontend owns interaction, selection, exploration history, flow navigation, and viewport state. It requests bounded views rather than receiving the complete source index. Browser preview uses labelled illustrative data; the desktop uses the real analyzer.

### Rust core

Rust owns the SQLite index, transactional publication, search, graph projection, filtering, grouping, source inspection, potential-impact queries, and the analyzer lifecycle.

Queries return one published snapshot. During analysis, queries can continue against the previous snapshot. Publication holds the index lock so a response cannot combine facts from before and after an update.

The index remains behind the query interface. Keeping this work in Rust does not establish a latency or memory budget by itself.

### Go analyzer

The persistent Go helper loads packages with Go tooling and extracts syntax, type-resolved relationships, source evidence, and static behavior facts. Rust imports changed package facts into the index.

The helper retains file and declaration fingerprints, rather than a second full graph. Body edits usually update one package. Shared declaration and source-location changes can invalidate reverse consumers. A full snapshot after a new session or configuration change removes obsolete cached packages.

Analysis does not run the project's application, tests, or generators. Package loading can invoke Go compilation tools. Downloads and custom package drivers are disabled; dependencies must exist locally.

SSA, alias analysis, and complete dynamic call-target analysis are not part of the current implementation. Add deeper analysis only where required coverage justifies its cost.

### Layout

A local dedicated worker runs ELK behind an engine-independent contract. Layout receives bounded topology, dimensions, groups, and placement information and returns geometry.

Source facts contain no ELK options or React Flow objects. Replacing the adapter must not require rebuilding the index or changing relationship meanings. Exploration state remains meaningful across a layout change.

Worker replacement bounds obsolete layout work. Geometry and native WebKit compatibility require their own verification; browser tests alone do not establish native behavior.

## Data boundaries

The analyzer uses versioned, line-delimited JSON over stdin and stdout. Logs use stderr. Rust and the frontend communicate through Tauri commands. The [implementation contract](implementation-contract.md) describes the messages and query options.

Rust sends only the requested visible projection, including bounded summaries and evidence. Unrequested or collapsed repository detail stays in the index. Panning outside the viewport does not by itself remove nodes from that projection.

Layout metadata, renderer payloads, and saved exploration history have separate purposes and bounds. None should retain an unbounded second copy of the repository graph.

Requests and results carry identities and snapshot information. Superseded frontend work must not overwrite a newer view. Serialized analysis and bounded query queues prevent concurrent requests from creating unlimited pending work.

## Refresh and failures

Refresh is currently manual. The analyzer identifies changed inputs, recomputes affected packages, and reuses unaffected facts. Module or build configuration changes can legitimately require a broader update than a body edit.

Rust applies replacements and deletions atomically. Transport or persistence failures discard the helper session so retries resend uncommitted facts. Invalid source must produce diagnostics and incomplete coverage rather than publish old affected facts as current.

The analyzer verifies source consistency before publication. Source inspection checks the snapshot fingerprint and confines reads to the active module. Edits to external local dependencies require a restart under the current analysis scope.

## Performance requirements

The UI requests at most 80 nodes per graph view. Rust also enforces node, edge, expansion, and function-group limits. Pagination and region summaries keep omitted detail discoverable.

Measure the whole process tree, including Go tooling and WebKit. A layout worker avoids doing layout on the UI thread but still consumes CPU and memory. See [Performance requirements](performance.md) for measurement rules and unfinished release criteria.
