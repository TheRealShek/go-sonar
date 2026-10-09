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
- [Implementation validation](docs/validation.md) records checks, review fixes, and measured performance and memory.

## Run locally

Requirements: Rust, Go 1.26 or newer, Node 22.12 or newer, and the Tauri Linux libraries. On Arch, install `webkit2gtk-4.1`, `gtk3`, `base-devel`, and `librsvg`. Go project dependencies must already be available in the local module cache or vendor directory. Dependency installation for developing Go Sonar can use the network; inspecting a project does not.

```sh
npm ci
npm run desktop
```

Enter an absolute directory containing `go.mod`. To try the included Go module, open the `fixtures/sample` directory inside your checkout using its absolute path and search for `Get`. Select a node to expand neighbors or open its behavior. Select an edge to see the expression and source location behind the connection. Refresh after editing source.

`npm run dev` opens a browser preview with explicitly labelled illustrative data. The native desktop uses the real Go analyzer and has no sample fallback.

## Implemented slice

The graph supports symbol search, incoming and outgoing exploration, relationship toggles, neighbor pagination, multiple expansions, shared nodes and cycles, grouped function internals, history, source evidence, and potential change-impact candidates. An empty relationship selection shows no external connections. The UI requests at most 80 nodes; Rust enforces a maximum of 300 nodes and 1,200 edges per view. Explicit function internals get space before external neighbors consume the view limit.

Rust owns a transactional SQLite index and bounded graph queries. The persistent Go helper retains file and declaration fingerprints, rather than a second full graph. A body edit refreshes its package; declaration or source-location changes can invalidate consumers. A full snapshot clears obsolete cached packages after restart. ELK runs in a locally bundled worker behind an independent layout contract.

This is an initial implementation. Refresh is manual; automatic file watching, workspace-root loading, navigation to an external editor, and broader Go build-configuration controls remain future work. The analyzer covers active non-test packages. It presents direct type-resolved relationships and static control structure, including conditions, loops, operations, calls, and returns. It does not yet perform SSA, value/alias tracking, concrete dynamic dispatch enumeration, or complete deferred/concurrent execution analysis. Assignments show transformations as source expressions; detailed value-dependence edges are not implemented. Unsupported internal control flow is marked and stops expansion at that operation.

Explanations use declaration documentation, signatures, relationship labels, and source evidence. Missing design intent stays unknown. Impact results are direct incoming candidates for inspection, not a proof of breakage. See [implementation notes](docs/implementation-notes.md) for scope and validation.

## Verify and measure

```sh
npm run build:analyzer
npm test
npm run build
(cd analyzer && go test -race ./... && go vet ./...)
cargo test -p sonar-core
cargo clippy --workspace --all-targets -- -D warnings
```

The Rust conventions recommend [kache](https://github.com/kunobi-ninja/kache). Configure it with per-command `RUSTC_WRAPPER` or your existing Cargo wrapper and run `kache doctor`. Keep its cache on the same filesystem as the build tree. It is a build tool, not an application dependency.

Build optimized binaries before measurements:

```sh
cargo build --release -p sonar-core --bin sonar-bench
npm run desktop:build -- --no-bundle
python3 scripts/benchmark.py --iterations 30
python3 scripts/benchmark.py --generate-packages 50 --functions 30
python3 scripts/benchmark.py --desktop --iterations 10
python3 scripts/benchmark.py --desktop --background-commit --iterations 10
python3 scripts/benchmark.py --desktop --generate-packages 50 --iterations 10
```

Results go to `benchmark-results/`. The sampler records simultaneous Linux process-tree PSS, including transient Go toolchain children and native WebKit processes. Headless timings include graph serialization, but exclude layout and rendering. Foreground desktop timings include IPC, layout, React commit, and frame publication. `--background-commit` records layout and DOM commit while keeping windows on an inactive workspace; it explicitly excludes frame presentation. Generated modules are temporary; only those fixtures are edited to measure body and declaration changes. No benchmark edits a supplied project.

The first analysis uses a fresh analyzer and Rust cache; the existing Go toolchain cache and OS file cache are retained. Benchmarks do not yet establish release performance budgets or performance on large production repositories.
