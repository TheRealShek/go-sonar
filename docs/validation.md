# Implementation validation

These checks cover the first working slice on 2026-10-09. They do not establish release performance budgets or complete Go analysis coverage. See [implementation notes](implementation-notes.md) for the supported scope.

## Checks

| Check | Result |
| --- | --- |
| Go analyzer tests with the race detector | Passed |
| Go vet and formatting | Passed |
| Rust core integration tests | Passed, 14 tests, including the real Go helper |
| Rust workspace Clippy with warnings denied | Passed |
| Rust formatting | Passed |
| Frontend tests | Passed, 22 tests |
| TypeScript and production frontend build | Passed |
| Frontend formatting | Passed |
| Native Linux release build without installer packaging | Passed |
| npm dependency audit | Passed, no reported vulnerabilities |
| Native analysis, expansion, behavior, refocus, and collapse | Passed in background commit mode |
| Foreground frame timing | Incomplete, inactive workspace suspended WebKit animation frames |

All native test windows used workspace 5 without switching the user's workspace. Background commit mode exercises the real Tauri IPC, analyzer, index, ELK worker, and React DOM commit. Its reports explicitly exclude frame presentation. The normal application and foreground benchmark still await actual animation frames.

## Performance measurements

The machine used Arch Linux, an Intel Core i7-12650H, approximately 15.2 GiB RAM, Wayland, and WebKitGTK 2.52.6. Measurements used optimized binaries, a fresh analyzer session, and a fresh Rust index. Existing Go toolchain and OS caches remained available. These are individual smoke runs, not repeated production workload measurements.

The generated module contained 52 packages and 1,605 symbols. Its imports form a chain so a leaf declaration change deliberately affects every package. Forty headless queries measured Rust traversal and JSON serialization together.

| Headless operation | Measurement |
| --- | --- |
| Initial index | 649.46 ms |
| Unchanged refresh | 7.22 ms, zero packages analyzed, 52 reused |
| Leaf function body edit | 42.40 ms, one package analyzed, 51 reused |
| Leaf declaration edit | 379.61 ms, 52 packages analyzed |
| Initial neighborhood | Median 0.263 ms, p95 0.296 ms, 4 nodes |
| Expanded neighborhood | Median 1.657 ms, p95 1.715 ms, 38 nodes |
| Expanded graph with internals | Median 1.693 ms, p95 1.769 ms, 42 nodes |

Native background measurements include IPC, layout, and DOM commit. They exclude viewport fitting and displayed frames. The included sample used six exploration cycles; the generated module used twelve. The first view includes worker startup and is separate from repeated expansions.

| Native background operation | Included sample | Generated module |
| --- | --- | --- |
| Initial view | 184 ms | 84 ms |
| Expansion median / p95 | 15.5 / 33 ms | 31 / 71 ms |
| Function internals median / p95 | 38.5 / 71 ms | 20 / 36 ms |
| Largest view observed | 24 nodes | 36 nodes |
| Largest graph payload observed | 27,551 bytes | 28,621 bytes |

The sampler measures simultaneous process-tree proportional set size, or PSS, every 25 ms. It includes transient Go compiler processes and WebKit descendants. It can miss short peaks. The headless run recorded one unavailable transient process sample; both final desktop runs recorded none.

| Workload | Peak total PSS |
| --- | --- |
| Generated module, headless | 114.85 MiB |
| Included sample, native background | 543.91 MiB |
| Generated module, native background | 662.19 MiB |

At the generated desktop peak, the main Tauri and GTK process used 103.88 MiB, the Go helper 53.60 MiB, the WebKit web process 461.32 MiB, and its network process 43.39 MiB. Rust ownership and bounded payloads do not by themselves make the whole desktop small. WebView memory needs further measurement and tuning before claiming a low memory footprint.

Raw local results are in ignored files under `benchmark-results/`: `generated-core.json`, `sample-desktop-final.json`, and `generated-desktop-final.json`. The commands in [README](../README.md) regenerate workloads and measurements without editing a supplied project.

## Standards

The review found one hard violation: the analyzer could block while reading a FIFO named as a Go input. Regular-file checks now reject these inputs before reading, with a regression test. A separate design judgement flagged the application's mixed UI and benchmark responsibilities. Benchmark orchestration now lives in `useNativeBenchmark.ts`; further UI decomposition can follow actual feature growth.

Standards findings: one hard finding fixed, one design judgement partly addressed.

## Spec

The review found three incorrect behaviors. Analysis could publish facts from source that changed after fingerprinting. The source inspector could use old coordinates against newly edited text. Local function parameters could acquire invented package-level target identities.

The analyzer now checks parser inputs and verifies the input set before publication. Rust verifies the published source fingerprint before showing an excerpt. Indirect local calls retain no invented target. Regression checks passed for all three fixes.

The review also identified partial roadmap requirements. Automatic file watching, detailed value flow, broader internal control semantics, transitive impact, and production performance budgets remain outside this initial slice. The implementation notes record those limits.

Spec findings: three correctness findings fixed; the listed roadmap requirements remain partial.
