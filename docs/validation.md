# Implementation validation

This historical record covers the first working slice checked on 2026-10-09. Subsequent code changes require their own checks; this record does not validate the current working tree. They do not establish release performance budgets or complete Go analysis coverage. See [implementation notes](implementation-notes.md) for the supported scope.

## Checks

| Check                                                       | Result                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Go analyzer tests with the race detector                    | Passed                                                           |
| Go vet and formatting                                       | Passed                                                           |
| Rust core integration tests                                 | Passed, 14 tests, including the real Go helper                   |
| Rust workspace Clippy with warnings denied                  | Passed                                                           |
| Rust formatting                                             | Passed                                                           |
| Frontend tests                                              | Passed, 22 tests                                                 |
| TypeScript and production frontend build                    | Passed                                                           |
| Frontend formatting                                         | Passed                                                           |
| Native Linux release build without installer packaging      | Passed                                                           |
| npm dependency audit                                        | Passed, no reported vulnerabilities                              |
| Native analysis, expansion, behavior, refocus, and collapse | Passed in background commit mode                                 |
| Foreground frame timing                                     | Incomplete, inactive workspace suspended WebKit animation frames |

All native test windows used workspace 5 without switching the user's workspace. Background commit mode exercises the real Tauri IPC, analyzer, index, ELK worker, and React DOM commit. Its reports explicitly exclude frame presentation. The normal application and foreground benchmark still await actual animation frames.

## Performance measurements

The machine used Arch Linux, an Intel Core i7-12650H, approximately 15.2 GiB RAM, Wayland, and WebKitGTK 2.52.6. Measurements used optimized binaries, a fresh analyzer session, and a fresh Rust index. Existing Go toolchain and OS caches remained available. These are individual smoke runs, not repeated production workload measurements.

The generated module contained 52 packages and 1,605 symbols. Its imports form a chain so a leaf declaration change deliberately affects every package. Forty headless queries measured Rust traversal and JSON serialization together.

| Headless operation            | Measurement                                |
| ----------------------------- | ------------------------------------------ |
| Initial index                 | 649.46 ms                                  |
| Unchanged refresh             | 7.22 ms, zero packages analyzed, 52 reused |
| Leaf function body edit       | 42.40 ms, one package analyzed, 51 reused  |
| Leaf declaration edit         | 379.61 ms, 52 packages analyzed            |
| Initial neighborhood          | Median 0.263 ms, p95 0.296 ms, 4 nodes     |
| Expanded neighborhood         | Median 1.657 ms, p95 1.715 ms, 38 nodes    |
| Expanded graph with internals | Median 1.693 ms, p95 1.769 ms, 42 nodes    |

Native background measurements include IPC, layout, and DOM commit. They exclude viewport fitting and displayed frames. The included sample used six exploration cycles; the generated module used twelve. The first view includes worker startup and is separate from repeated expansions.

| Native background operation     | Included sample | Generated module |
| ------------------------------- | --------------- | ---------------- |
| Initial view                    | 184 ms          | 84 ms            |
| Expansion median / p95          | 15.5 / 33 ms    | 31 / 71 ms       |
| Function internals median / p95 | 38.5 / 71 ms    | 20 / 36 ms       |
| Largest view observed           | 24 nodes        | 36 nodes         |
| Largest graph payload observed  | 27,551 bytes    | 28,621 bytes     |

The sampler measures simultaneous process-tree proportional set size, or PSS, every 25 ms. It includes transient Go compiler processes and WebKit descendants. It can miss short peaks. The headless run recorded one unavailable transient process sample; both final desktop runs recorded none.

| Workload                            | Peak total PSS |
| ----------------------------------- | -------------- |
| Generated module, headless          | 114.85 MiB     |
| Included sample, native background  | 543.91 MiB     |
| Generated module, native background | 662.19 MiB     |

At the generated desktop peak, the main Tauri and GTK process used 103.88 MiB, the Go helper 53.60 MiB, the WebKit web process 461.32 MiB, and its network process 43.39 MiB. Rust ownership and bounded payloads do not by themselves make the whole desktop small. WebView memory needs further measurement and tuning before claiming a low memory footprint.

Raw local results are in ignored files under `benchmark-results/`: `generated-core.json`, `sample-desktop-final.json`, and `generated-desktop-final.json`. The commands in the [development guide](development.md#run-benchmarks) regenerate workloads and measurements without editing a supplied project.

## Review fixes

The review found a blocking input-handling issue: the analyzer could block while reading a FIFO named as a Go input. Regular-file checks now reject these inputs before reading, with a regression test. A separate maintainability concern identified the application's mixed UI and benchmark responsibilities. Benchmark orchestration now lives in `useNativeBenchmark.ts`; further UI decomposition can follow actual feature growth.

The input-handling issue was fixed and checked. UI decomposition was partly addressed and was not a correctness blocker.

## Correctness and remaining coverage

The review found three incorrect behaviors. Analysis could publish facts from source that changed after fingerprinting. The source inspector could use old coordinates against newly edited text. Local function parameters could acquire invented package-level target identities.

The analyzer now checks parser inputs and verifies the input set before publication. Rust verifies the published source fingerprint before showing an excerpt. Indirect local calls retain no invented target. Regression checks passed for all three fixes.

The review also identified partial roadmap requirements. Automatic file watching, detailed value flow, broader internal control semantics, transitive impact, and production performance budgets remain outside this initial slice. The implementation notes record those limits.

The three correctness fixes passed their regression checks at the recorded revision. The roadmap requirements remain incomplete. See [current analysis scope](implementation-notes.md) for subsequent capabilities and limits.

## Horizontal layout check, 2026-10-10

LLM Gate was used as a read-only reference project. Its `main` call neighborhood contains nine nodes and eight edges. The previous layout occupied 520 × 1,019 layout units, with five nodes visible on initial focus at a 1,440 × 900 window. The revised layout occupies 1,120 × 653 units. All nine nodes are visible at 100% zoom.

The layout limits sibling layers to three nodes and uses a smaller vertical gap. Initial focus frames a neighborhood when it fits at 80% zoom or higher; larger views retain readable focus centering. Columns describe graph placement, not execution order.

Checks passed:

- All 39 frontend tests, including outgoing and incoming fan-out, cycles, shared targets, group containment, position reuse, and initial framing.
- TypeScript, production frontend build, and native Linux release build without installer packaging.
- Browser checks using the real analyzer and Rust backend through a temporary local bridge: source inspection, expansion to 17 nodes, function behavior with 27 nodes and 34 edges, navigation back to Calls, and overflow checks at widths of 1,280 and 960 pixels. No browser errors were observed.
- Three native background cycles of expansion, behavior, refocus, and collapse through Tauri IPC, WebKit, the layout worker, and React DOM commit. The run completed without timeout or stderr diagnostics. These checks exclude displayed frames and foreground frame timing.
- SHA-256 and Git status comparison of all 22 tracked and nonignored reference files. LLM Gate was unchanged.

The native run's raw report is the ignored local file `benchmark-results/latest.json`. It records a smoke check, not a release performance budget.

## Routed lines and dark palette check, 2026-10-10

The renderer now uses ELK's orthogonal edge sections, including container offsets for nested behavior and cross-boundary calls. Focus translation moves nodes, edge sections, and labels together. Individual saved node positions are no longer reused because they would invalidate the obstacle routes.

The application palette matches the active Omarchy `colors.toml`: Nord backgrounds, foreground, and accents. CSS, React Flow, and the native window explicitly use dark mode.

Checks passed:

- All 39 frontend tests. Route checks cover outgoing and incoming fan-out, shared targets, cycles, nested behavior, and old manual positions.
- Production frontend and native release builds.
- Real LLM Gate geometry: 22 segments in the initial view, 44 in the expanded view, and 96 in Flow. None crossed unrelated leaf-node interiors.
- Browser checks under a light system preference: dark backgrounds, distinct connection colors, hover labels, selected-edge color, crossing masks, source evidence, expansion, and Flow navigation. No browser errors occurred.
- Three native background cycles of expansion, behavior, refocus, and collapse completed without timeout or stderr diagnostics. These checks exclude displayed frames.
- Standards and behavior review found no actionable issues.

Manual dragging clears obstacle routes and uses endpoint routing until the next graph query. The next query restores automatic node placement.

## Intermediate rounded call paths check, 2026-10-10

This intermediate design was tested before the original Bézier curves were selected. Its rounding helper and two tests have since been removed. The final behavior and checks are recorded below.

Calls and Callers in this intermediate design rounded the bends of ELK's routed paths. Flow keeps right-angle bends, including its dependency connections. Rounding is limited to 12 layout units and half the length of either neighboring segment, so short segments cannot overshoot. Both modes retain the Nord palette, crossing masks, arrows, and label behavior.

All 41 frontend tests passed, including separate sections, unchanged endpoints, reverse-direction bends, short segments, and repeated points. Production frontend and native release builds passed. The LLM Gate browser check confirmed rounded call paths avoided unrelated nodes, Flow paths retained square bends, and source inspection and expansion still worked. Dark mode, colors, hover labels, and selection checks passed with no browser errors. LLM Gate's 22 file hashes and Git status remained unchanged.

## Final call curves check, 2026-10-10

The three line-style images were compared with identical LLM Gate node positions, colors, and zoom. Calls and Callers now use the original Bézier curves between node handles. These curves can pass behind intermediate nodes. Flow retains square ELK routes around nodes. Nord colors, crossing masks, hover labels, and selection highlights apply in both modes.

The unused corner-rounding helper and its two tests were removed. All 39 remaining frontend tests passed. TypeScript, production frontend, native release build, formatting, and diff checks passed. Browser checks confirmed original call curves, square Flow routes, source inspection, neighbor expansion, dark mode under a light system preference, hover labels, and selection colors. No browser errors were observed.

Three native background cycles of expansion, behavior, refocus, and collapse completed without timeout or stderr diagnostics. These checks exclude displayed frames. LLM Gate remained unchanged, confirmed by matching all 22 file hashes and Git status.

## Reconcile graph presentation with exploration behavior, 2026-10-11

PR [#2](https://github.com/TheRealShek/go-sonar/pull/2) now includes the behavior merged in PR [#3](https://github.com/TheRealShek/go-sonar/pull/3). The reconciliation retains horizontal call neighborhoods, Nord call curves, readable initial framing, dark mode, the comparison images, and collapsible project, Symbols, and filter controls.

Selection and Escape keep the exploration and source investigation. Inspection remains explicit. Flow opens an overview with explicit walkthrough actions. Category preferences, scoped collapse, reset preview, source recovery, binding investigations, disclosure landmarks, and return-route emphasis retain the merged behavior.

ELK routes are valid only while displayed node positions and sizes match the routing geometry. Preserving disclosure landmarks or dragging nodes can invalidate those routes. Flow then uses square bends attached to the current handles; these paths can cross intervening nodes. Landmark preservation takes precedence over rerouting the entire view.

Validation passed:

- All 82 frontend tests, including incoming/outgoing fan-out route presence, obstacle avoidance, saved landmark retention, invalidated routes, and readable initial framing.
- TypeScript and the production frontend build, formatting, and diff whitespace checks.
- All 28 native integration tests and the native workspace build.
- Headless Chromium checks on the illustrative sample at 1440 × 900 and 700 × 800. Covered dark mode under a light system preference, explicit inspection, preserved selection after Escape, ordered project-menu and compact Symbols dismissal with focus restoration, repeated search shortcuts, and Flow overview/start/pause/resume. No page errors occurred.
- Standards and specification reviews. Route-presence coverage and transient dismissal/focus findings were corrected and rechecked.

The T3 preview opened, but two snapshot attempts timed out. The browser checks used a separate local Chromium instance. They did not exercise native WebKit, real-project analysis, or clipboard/folder transports. Earlier real-project validation above remains historical evidence, not a new acceptance run for this reconciliation.

## Rounded routes and compact columns, 2026-10-11

Calls and Callers now follow the `02-rounded-routed.png` reference: routed lines with bounded rounded corners, compact horizontal columns, question controls beside the canvas, and project coverage in a collapsed top-bar menu. Flow retains square bends and its existing placement strategy. Explicit inspection, navigation, disclosure landmarks, and walkthrough actions remain available.

The three-node layer bound alone allowed an uneven fan-out to form a tall staircase. Compact node placement fixes that drift in relationship views. In the real LLM Gate `main` neighborhood, all nine nodes and eight edges fit the initial 1440 × 900 window across four columns. The rendered node footprint measured approximately 1151 × 419 pixels. Sampling the rendered edge paths every two pixels found no unrelated node-interior crossings in that initial view.

Validation passed:

- All 85 frontend tests, including rounded corner bounds, duplicate and collinear vertices, square paths, representative production-card fan-out framing, and existing exploration regressions.
- TypeScript, production frontend build, frontend formatting, and diff whitespace checks.
- Native Linux release workspace build without installer packaging.
- Chromium acceptance using the real Go analyzer and Rust backend through a temporary local bridge against `/Drive2/Coding_Skills/Projects/llmgate`: initial rounded routes and framing, dark mode under a light system preference, explicit inspection, ordered Coverage dismissal, expansion to 17 nodes, real `run.go` source excerpts, incoming Callers, Flow overview with square bends and explicit start/pause/resume, and no page overflow at 960 pixels. No page errors occurred.
- Matching SHA-256 hashes and Git status for all 22 tracked and nonignored LLM Gate files. The project remained unchanged.
- Standards and specification reviews. One stale guide sentence about Symbols controls was corrected; no code findings remained.

The T3 preview snapshot timed out twice, so browser acceptance used local Chromium. Native WebKit presentation and clipboard/folder transports were not exercised in this run. Retained landmarks and manual dragging can invalidate calculated routes; rounded relationship fallbacks and square Flow fallbacks can cross other nodes. These checks do not establish a performance budget or guarantee obstacle avoidance for those fallback paths.
