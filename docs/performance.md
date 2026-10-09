# Performance requirements

## Status

Incremental analysis, bounded rendering, and benchmarks covering indexing, expansion latency, and total application memory are approved requirements. This document defines work to verify; no benchmark has been executed and no performance result is claimed.

Numerical latency, memory, and payload budgets are not yet selected. Set and record them against representative workloads before accepting a release. Choosing Rust does not substitute for measurement.

## Incremental analysis

An ordinary edit to one Go file must not trigger a full repository reindex by default. Reuse valid analysis and update the affected scope, including relevant consumers when a shared declaration changes.

Measure body-only edits separately from signature, type, field, and package-dependency changes. Changes to module, workspace, or build configuration may invalidate a broader scope and should report why.

Record which files or packages were analyzed, which facts were reused, and the invalidation reason. A fast update alone does not prove that the implementation avoided a full reindex.

Verify correctness by comparing the resulting facts with a clean analysis of the same final source state. The comparison is a test oracle, not an instruction to run a full reindex for every product edit. Check deletion and rename, removed relationships, changed source locations, invalid source, and superseded work as well as additions.

## Bounded graph rendering

The Rust core sends only the current visible graph to React Flow. Expansion requests retrieve additional detail on demand. Sending the full repository graph with hidden flags is not an acceptable implementation of this requirement.

Record the nodes, edges, source-detail bytes, and total payload bytes sent for each expansion. Preserve additional relationships through counts or summaries without hydrating their full data into the renderer.

Test the same bounded exploration against indexes of increasing size. Renderer data should track the displayed scope rather than grow simply because the underlying repository contains more symbols.

Test expanding and collapsing function internals, shared dependencies, cycles, filters, viewport changes, and repeated navigation. A collapsed or off-screen connection must retain a meaningful representation when needed, without restoring its hidden subtree.

Separate current display data from bounded layout metadata and saved exploration history. Each has an explicit size policy; none is a place to keep another unbounded copy of the index.

## Benchmark workloads

Use repeatable Go fixtures representing a small project, a medium multi-package project, and a large dependency graph. Include high fan-out, nested function behavior, shared dependencies, interface calls, and cycles. Record fixture revisions, file and symbol counts, dependency state, and build configuration.

For each workload, measure:

- Cold indexing with an empty application index and a prepared offline Go toolchain and dependency cache.
- Warm project opening with reusable analysis.
- A function-body edit and an unrelated package that should remain reusable.
- A shared declaration edit that affects consumers.
- Symbol search, first expansion, further expansion, and function-internal expansion.
- Repeated expand/collapse and navigation, followed by project close.
- Rapid edits and expansion requests that supersede pending work.

Use normal optimized application builds for acceptance measurements. Debug builds are useful for diagnostics but must not be mixed with production measurements. Benchmarks exercise Go Sonar; they do not require running the analyzed application's behavior.

## Time measurements

Record initial indexing time through a usable published snapshot. For incremental analysis, measure from change detection through publication of consistent updated facts. Report stage times so Go loading, extraction, Rust ingestion, and query processing can be distinguished.

Measure expansion from the user's request through a visible rendered result, including the Rust query, transport, layout, and frontend update. Backend response time alone is not the expansion latency the user experiences.

Repeat runs and record the sample count, median, and tail latency with the chosen calculation method. Distinguish cold and warm runs. Make first-response time and complete-result time explicit when results arrive progressively.

## Memory measurements

Measure the application process tree, including the Rust core, Go analyzer, WebView processes, workers, and relevant child tools active during indexing. Report component measurements and whole-application totals.

On Linux, use proportional set size where available to account for shared memory without double-counting it through summed resident set sizes. Retain per-process resident sizes as diagnostics. Report the metric, sampling interval, included processes, and any unavailable data; GPU memory is a separate measurement when available.

Capture startup, indexing peak, idle after indexing, active exploration, repeated navigation, and project close. Sample total memory over time rather than adding each process's peak from different times. Include enough sampling detail to identify missed short-lived processes or peaks.

Check that caches, renderer state, and pending work stay bounded during repeated use. Explain retained memory and cache policies rather than assuming all memory must return immediately to its startup value.

## Benchmark record and acceptance

Each record includes application revision, build mode, operating system, WebView and toolchain versions, CPU, GPU, RAM, fixture identity, analysis scope, cache state, repetition count, and raw measurements. On the initial target machine, record Wayland and Hyprland conditions relevant to the run.

Record the agreed budgets and the comparison against them. Functional acceptance also requires correct incremental results, bounded renderer data, and a layout adapter independent of the canonical graph model.

No architecture component gets an assumed performance pass. A slow Go analyzer, expensive layout, growing frontend state, or excess Rust allocations are all application performance issues. Use the measured cause to guide changes, including replacement of ELK when warranted.
