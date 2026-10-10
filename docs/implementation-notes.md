# Analysis scope and implementation notes

The current app opens a local Go module and turns source-backed declarations, relationships, and static function behavior into a bounded graph. It is an early implementation of the [product intent](product-intent.md), not complete Go semantic analysis or a release readiness claim.

For the controls and a worked example, use the [user guide](user-guide.md).

## Supported scope

Analysis covers active non-test packages under a selected directory containing `go.mod`. The Go helper uses `go/packages`, syntax trees, and type information. It requires Go 1.26 or newer.

The app does not run project applications, tests, or generators. It disables module downloads, toolchain downloads, and custom package drivers. Go package loading may invoke compilation tools, including cgo tools. Required dependencies must already exist locally.

Relationships include calls, references, reads, writes, construction, interface satisfaction, and type uses where the analyzer can establish them. A resolved relationship describes source facts. It does not prove that the relationship executes for every input.

## Function behavior

Function groups contain entry points, conditions, loops, calls, operations, returns, and control connections. Regions summarize hidden detail and provide explicit reveal actions. Flow navigation follows a bounded static path; return selection highlights possible control routes.

Direct-call navigation retains the exact caller occurrence. Interface and dynamic calls remain unresolved implementation boundaries. Call facts can map argument expressions to parameters and returned positions to destinations. Operation facts can identify field accesses, mutations, and local binding occurrences.

These mappings do not establish SSA-based value dependence, complete alias tracking, or how a passed argument influences a returned result. Local binding occurrences are not a complete reaching-definition analysis.

Unsupported select, type-switch, goto, and labelled control flow stops at a marked operation. Deferred and concurrent work appears as registration or start operations, not a fabricated sequential execution trace. Closure-body exploration and concrete dynamic target enumeration remain incomplete.

## Indexing and refresh

Refresh is manual. The persistent helper retains source and declaration fingerprints; Rust owns the SQLite graph. A body edit usually replaces its package. Declaration changes invalidate reverse consumers. Source-location changes can also update consumers so evidence points to current lines.

A new helper session or build scope sends a full snapshot that clears obsolete disk-cache packages. Warm startup still analyzes source; the disk index is not serialized Go compiler state. Edits to local dependencies outside the selected module require restarting the app.

Queries use the previous published snapshot while analysis runs. Rust commits updates atomically under the index lock. Analysis requests are serialized; duplicate concurrent analysis requests return a busy error. A transport or persistence failure discards the helper session so the next request resends uncommitted facts.

The analyzer checks that source and configuration inputs remain consistent before publication. Syntax or type errors remove stale affected facts and expose incomplete coverage. Fixing the source and refreshing can restore those facts.

## Graph bounds and grouping

The UI requests 80 nodes. Rust caps a view at 300 nodes and 1,200 edges, with at most 64 expansion seeds and 16 open function groups. Function internals share the node budget with external neighbors; focus internals receive space before external fan-out.

Initial UI requests use eight neighbor connections. The backend permits pages of up to 40 grouped endpoint/kind connections. Repeated source occurrences share a displayed connection and remain inspectable through source-site pages. These page counts differ from both individual source sites and distinct symbols.

Package and relationship summaries distinguish filtered, collapsed, paginated, and limited connections. Empty relationship filters show no external edges. Explicit expansions, shared identities, and bounded internal regions keep cycles and large functions finite. Refocusing or collapsing detail can free room when the view is limited.

## Evidence and impact

Explanations use source facts, signatures, declaration documentation, and operation details. Missing author intent remains unknown. There is no AI model or explanation endpoint.

The source inspector canonicalizes paths, confines reads to the module, and verifies the published file fingerprint. Excerpts are capped at 160 lines and 256 KiB; files larger than 8 MiB are rejected. External declarations can have useful metadata without readable declaration source. Inspect local call sites instead. External editor navigation is not implemented.

Potential-impact queries filter direct incoming uses by signature, field, or behavior category. They identify candidates for inspection, not proven breakage or all transitive effects. Runtime tracing and Git diff comparison remain outside the current scope.

## Layout and measurement

The graph model contains no ELK or React Flow objects. A bundled dedicated worker computes ELK layout through a separate contract. Worker replacement bounds obsolete work. Desktop builds fingerprint frontend assets so compiler caches cannot reuse an executable containing older assets.

Native WebKit can suspend animation frames on an inactive workspace. Background benchmark mode measures layout and DOM commit and excludes frame presentation. Foreground mode waits for frames; a timer does not substitute for a rendered frame.

The Linux benchmark sampler measures simultaneous process-tree PSS, including Go tooling and WebKit. Its 25 ms interval can miss short peaks. Initial indexing retains existing Go and OS caches. Production workloads and numerical release budgets remain to be established.

## Remaining work

Automatic file watching, workspace-root loading, test-package analysis, configurable build tags, external editor navigation, deeper value and alias analysis, and complete dynamic or concurrent execution coverage remain unfinished.

The [validation record](validation.md) describes checks on an earlier slice. The [development guide](development.md) lists commands to verify the current revision; historical results do not validate subsequent changes.
