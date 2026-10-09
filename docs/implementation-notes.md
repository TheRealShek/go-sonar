# Initial working slice

The current application turns a local Go module into an explorable graph. It is the first implementation of the approved intent, with an explicit analysis scope and limits. The product acceptance scenarios remain the target; this milestone does not claim complete Go semantics or release readiness.

## Data and publication

The Go helper uses `go/packages`, ASTs, and type information to extract declarations, source-backed relationships, and internal control structure. It never runs the project's application, tests, or generators. It disables network module downloads, toolchain downloads, and custom package drivers. The installed Go toolchain may invoke compilation tools, including cgo tools, while loading packages. Dependencies must already exist locally. The current helper requires Go 1.26 or newer.

The helper stays alive while the application runs. It retains source and declaration fingerprints. Rust receives package replacements, owns the SQLite graph, and commits updates atomically. Declaration changes invalidate reverse consumers; body edits usually replace just their package. A source-location change can also require updating consumers so evidence does not point to old lines. A new analyzer session or build scope sends a full snapshot that clears stale disk-cache packages. External local dependency edits outside the selected module require an application restart; this scope is also shown in analyzer diagnostics. Warm startup still performs initial source analysis; the disk cache is not a serialized Go compiler state.

Queries continue to use the previously published snapshot during analysis. Publication holds the Rust index lock while committing the replacement, so one graph response cannot straddle a source update. Analysis requests are serialized and duplicate concurrent requests return a busy error. A failed transport or persistence operation discards the helper session, ensuring retries resend facts that were not committed.

## Visible graph

Focus expands one neighborhood. Only explicitly expanded nodes reveal another level. Incoming/outgoing direction and relationship kinds are applied before Rust hydrates neighboring symbols. Cycles and shared dependencies retain one identity. Counts report undisclosed source relationships without fetching their nodes.

The UI requests 80 nodes. Rust clamps requests to 300 nodes, 1,200 edges, 64 expansion seeds, and 16 opened function groups. Empty relationship filters reveal no external edges. Function internals consume the same node budget; opening focus behavior reserves its space before external fan-out. Truncation is visible. Neighbor pages expose up to 40 relation sites per expanded seed with Previous/Next controls. These are edge pages, not counts of distinct symbols. Refocusing or collapsing other groups frees room when the overall node limit is reached. Very large functions may show only a bounded part of their internal graph.

Function groups include conditions, loops, operations, calls, returns, and source control connections. Call nodes link to visible targets and retain a target identity for refocusing. Assignment labels expose transformations as source expressions. Detailed value-dependence, aliases, and SSA are not implemented. Unsupported select/type-switch/goto/label control flow stops at a marked operation. Deferred and concurrent execution is described as registration/start operations rather than a fabricated sequential execution trace.

Desktop builds fingerprint the built frontend explicitly so compiler caches cannot reuse an executable containing older assets.

The graph model contains no ELK or React Flow objects. The ELK adapter uses its API on the UI side and an explicitly bundled dedicated worker for layout computation. Worker replacement bounds obsolete layout work. A nested bundled ELK worker failed under native WebKit, so the desktop benchmark now exercises the production worker boundary rather than relying on browser-only tests.

## Explanation and impact

Documentation, signatures, typed edge labels, branch labels, and source positions supply context. Missing author intent is reported as unknown. There is no model, AI endpoint, or generated explanation service.

Potential impact filters direct incoming source uses for signature, field, or behavior changes. It changes the framing of existing evidence to possible effects; it does not prove callers break or enumerate all transitive effects. Users can refocus a candidate to continue normal graph exploration. Runtime tracing and Git diff analysis remain outside this milestone.

The analyzer verifies that the source/configuration set has not changed before publication and requests a retry if it has. The source inspector verifies the published file fingerprint before using its coordinates, canonicalizes paths and limits reads to the active module. It caps excerpts at 160 lines and 256 KiB and rejects files larger than 8 MiB. External declarations can be visible with unavailable source; they cannot grant arbitrary file access. Opening the source in an external editor is not implemented.

## Current scope

Open an individual directory containing `go.mod`. Workspace-root selection, test-package analysis, configurable build tags, file watching, detailed dynamic target enumeration, and closure-body exploration remain future work. Refresh is manual. Type or syntax errors remove stale affected facts and expose an incomplete snapshot. Coverage warnings appear even for a valid graph.

Inactive workspaces can suspend WebKit animation frames. The explicit background benchmark measures layout and React DOM commit, and reports that it does not include frame presentation. Foreground mode still awaits actual frames. No timed callback substitutes for a rendered frame.

Benchmarks use optimized binaries and distinguish query/serialization timing from rendered timing. The Linux sampler records simultaneous PSS for all observed descendants, including the Go toolchain and WebKit. It reports unavailable process measurements instead of treating them as zero. A 25 ms interval can miss short peaks. Initial indexing retains existing Go and OS caches; it is not a filesystem-cold measurement. Numerical budgets and production-repository workloads remain to be established.

## Validation

Go tests cover incremental body and declaration edits, consumer source positions, package deletion, syntax failure/recovery, a clean-analysis oracle, type-resolved relationships, interface identities, internal paths, offline transport, EOF, and request limits. Rust tests cover transactional replacements, shared external ownership, full-snapshot cleanup, rollback, bounds, filters, duplicate internal requests, source containment, the real helper, and persistence-failure recovery. Frontend tests cover bounded view validation, request supersession, benchmark publication, and the production ELK API/worker protocol.

Run the commands in [README](../README.md) to reproduce checks and measurements. The performance requirements in [performance.md](performance.md) remain the release criteria.
