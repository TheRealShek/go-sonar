# Product intent

Go Sonar helps developers understand unfamiliar Go code through a visual graph of declarations, relationships, and function behavior. Users can start at any symbol, including declarations in libraries with no `main` function.

This document defines the product goals and acceptance scenarios. It includes requirements that remain unfinished. For current behavior, read the [user guide](user-guide.md) and [analysis scope](implementation-notes.md).

## Core requirements

The graph is the primary interface. Labels, meaningful connections, grouped internals, and contextual explanations should answer most relationship questions. Source evidence lets users verify a claim or inspect more detail.

- Support Go codebases first and work offline without AI explanations.
- Start at any declaration and explore incoming and outgoing relationships across multiple levels.
- Show a small initial neighborhood, with explicit expansion and discoverable hidden detail.
- Let users select relationship categories and inspect the reason for each connection.
- Group conditions, operations, calls, transformations, and returns inside collapsible function subgraphs.
- Derive initial behavior from static analysis without running project code.
- Explain known facts and expose unresolved or unsupported analysis.
- Investigate potential impact from a selected symbol and hypothetical change category.
- Refresh affected facts incrementally while reusing valid analysis and updating consumers when necessary.
- Keep renderer data bounded to the requested graph.
- Measure indexing, expansion latency, and memory across the whole application.

Programming tutorials and teaching exercises are outside the product focus. A language explanation can clarify a specific relationship or behavior.

## Questions to answer

A developer should be able to identify who calls a method, where those calls occur, and which work the method delegates. For types and fields, the graph should reveal construction sites and known uses. Within functions, it should explain branch choices, error checks, return expressions, and state changes.

Value-related questions need explicit evidence. The intended experience includes following transformations and connections between inputs, operations, and results. Current argument/result mappings and source expressions are only part of that goal; they do not provide complete value or alias analysis.

Before changing a declaration, the user should be able to identify relevant consumers and contracts to inspect, understand why each candidate appears, and see what the analysis leaves unresolved.

## Meaning and evidence

Connections need specific meanings. Useful categories include calls, references, construction, field reads and writes, interface satisfaction, type use, argument passing, and returned values. This vocabulary does not claim complete coverage of every category.

Direction and labels must explain the connection. Repeated source sites can share one displayed connection, provided users can inspect individual occurrences. Source-resolved facts and possible relationships must remain distinguishable.

A known callee does not prove execution for every input. Interface satisfaction does not prove the concrete target of an invocation. A control connection does not establish that one operation consumes the previous operation's result.

Explanations use source facts and documented purpose. Comments must remain distinguishable from verified behavior, and missing author intent stays unknown. Explanations require neither remote services nor local AI models.

## Exploration and readability

Expansion reveals one chosen branch or region rather than every reachable declaration. Multiple branches can remain open, share a helper, and show cycles without duplicating identities indefinitely.

Function internals start collapsed and remain grouped when opened. Users need to follow a call, return to its exact occurrence, inspect another branch, and collapse detail without losing their place. Loops, recursion, early returns, deferred work, and unsupported continuations must not look like one guaranteed linear execution.

Filters, collapsed groups, pagination, view limits, and incomplete analysis must explain omissions. A small graph must not imply that no other relationships exist. Layout can change geometry without changing source meaning.

## Freshness and performance

Ordinary body edits should reuse unaffected analysis. Changes to shared declarations, source positions, or configuration may require broader updates. Results must remain consistent with one snapshot and expose incomplete coverage after source errors.

Only the requested projection crosses into the renderer. Counts and summaries retain discoverability without transferring the full index. Indexing time, request-to-render latency, and total process-tree memory are release criteria. Numerical budgets remain unset; existing [smoke measurements](validation.md) do not establish them.

## Acceptance scenarios

These scenarios define outcomes to verify. They are not a record of completed tests.

### Start in a library

Select a struct without navigating from `main`. Inspect relevant construction, method, and type uses, then expand a field's reads and writes without restarting the investigation.

### Explore high fan-out

Start at a function with hundreds of callers. Keep the initial view readable, reveal another package or page explicitly, and follow one caller without unfolding every other branch. Hidden counts explain the displayed subset.

### Understand an early return

In the sample `Service.Get`, identify the cache-hit return, repository lookup, error return, normalization, and cache mutation. Explain which branches skip the lookup or write. Verify any operation through source evidence without running the project.

### Follow values across calls

Follow an input through a transformation, call, and result while retaining caller context. Distinguish execution order, source mappings, and established value dependence. Show a boundary where aliases or dynamic operations prevent further conclusions.

### Inspect an interface call

Distinguish the referenced interface method from any possible concrete implementations. Explain the evidence for candidates without equating compatibility with execution. Concrete target enumeration remains unfinished in the current app.

### Explore cycles and shared helpers

Expand two branches that reach one helper and a path containing recursion. Preserve shared identity and recognize the cycle without endless duplication.

### Investigate a change

Choose a symbol and hypothetical signature, field, or behavior change. Each candidate has a reason and evidence. Direct consumers, further potential effects, and unknown effects remain distinct. Current impact queries cover direct incoming candidates only.

### Handle incomplete coverage

Open a project with missing dependencies or excluded build configurations. Diagnostics explain the covered scope. An empty result remains distinguishable from a complete finding of no relationships.

### Refresh an edit

Edit a body and refresh. Update affected facts and evidence while reusing unrelated packages. Change a shared declaration and update relevant consumers. Invalid source must not mix stale affected facts into a fresh complete snapshot.

### Keep views bounded

Explore the same bounded neighborhood in increasingly large indexes. Payload size follows requested detail rather than repository size. Expansion and collapse preserve navigation without retaining hidden subtrees in the renderer.

### Measure the application

Measure indexing, exploration, repeated navigation, and project close across Rust, Go, toolchain children, and WebView processes. Distinguish backend timings, DOM commit, and displayed frames. Check retained memory and report measurement limits.

## Current boundaries

A working desktop implementation exists. It uses Rust-owned SQLite storage, incremental package updates, bounded graph queries, grouped source sites, internal regions, and static flow navigation. Refresh remains manual, and analysis covers active non-test packages in a single module.

Workspace roots, broader build controls, complete value flow, dynamic dispatch enumeration, automatic watching, and external editor navigation remain unfinished. Production workload validation and numerical release budgets are also pending.

Automatic refactoring, editing source through the graph, additional languages, runtime tracing, and Git diff comparison are outside the current scope. Future consideration does not commit the project to those extensions.
