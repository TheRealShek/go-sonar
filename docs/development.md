# Development guide

Run commands from the repository root unless a command changes directory explicitly. See the [README](../README.md#run-locally) for toolchain and native library requirements.

## Development modes

```sh
npm ci
npm run desktop
```

The desktop uses the real analyzer. Its startup hook builds the Go sidecar before starting Vite. The sidecar filename includes the Rust host target so Tauri can locate it.

For frontend work with illustrative data:

```sh
npm run dev
```

The browser preview is labelled as sample data and does not load local Go projects. It is not a substitute for native analysis checks.

## Verify a change

```sh
npm run build:analyzer
npm test
npm run build
(cd analyzer && go test -race ./... && go vet ./...)
cargo test -p sonar-core
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
npm run format:check
```

Choose checks appropriate to the change. Frontend build and tests do not verify the native WebKit worker or analyzer transport. Use a native desktop check for changes to those boundaries. The historical [validation record](validation.md) is not a substitute for checking a new revision.

To build the release desktop without installer packaging:

```sh
npm run desktop:build -- --no-bundle
```

The build hook rebuilds the analyzer and frontend. Rust compiler caching is optional. If you use kache, configure `RUSTC_WRAPPER` for the build and check it with `kache doctor`. Keep the cache on the build tree's filesystem.

## Run benchmarks

Build optimized binaries first:

```sh
cargo build --release -p sonar-core --bin sonar-bench
npm run desktop:build -- --no-bundle
```

Then choose a workload:

```sh
python3 scripts/benchmark.py --iterations 30
python3 scripts/benchmark.py --generate-packages 50 --functions 30
python3 scripts/benchmark.py --desktop --iterations 10
python3 scripts/benchmark.py --desktop --background-commit --iterations 10
python3 scripts/benchmark.py --desktop --generate-packages 50 --iterations 10
```

Results go to the ignored `benchmark-results/` directory. Generated modules are temporary. The harness edits only generated fixtures for body and declaration change measurements; it does not edit a supplied project.

Headless timings include graph serialization and exclude layout and rendering. Foreground desktop timings include IPC, layout, React commit, and frame publication. `--background-commit` measures layout and DOM commit without awaiting frame presentation, which inactive workspaces may suspend. Compare results only when their timing boundaries match.

The Linux sampler records simultaneous process-tree proportional set size, including Go toolchain children and WebKit processes. Initial indexing uses a fresh analyzer and Rust index while retaining existing Go toolchain and OS file caches.

Read [Performance requirements](performance.md) before interpreting measurements. The existing smoke runs do not establish production repository performance or release budgets.
