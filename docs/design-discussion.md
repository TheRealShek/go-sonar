# Design discussion

## Status

The user confirmed Q1, Q2, and Q3, added progressive disclosure, and approved the architecture with explicit performance requirements. The shared product direction and architecture are settled for the current documentation scope. No major question remains that requires another interview round.

This task covers documentation and design discussion. No application implementation is authorized.

## Confirmed decisions

- The primary interface is an interactive graph for understanding real code.
- Exploration starts at any symbol and continues in either direction across multiple levels.
- Progressive disclosure is required: initially show only the most relevant relationships, and let users choose which connections to expand.
- Connections need visible meanings and accessible source evidence.
- Function internals include conditions, returns, and data transformations.
- Function internals expand as collapsible subgraphs, visually grouped inside the selected function.
- Explanations are contextual, offline, and use no AI.
- The initial product uses static source analysis without running project code.
- Initial impact exploration starts with a selected symbol and a hypothetical change category.
- Go is the initial target language.
- Programming tutorials and teaching exercises are outside the current focus.
- Use Tauri + React Flow + a Rust application core + a Go analyzer.
- Use ELK.js initially through a replaceable layout boundary.
- Incremental analysis must reuse valid facts after edits and update affected consumers correctly.
- Only the visible graph is sent to the renderer, with expansion on demand.
- Benchmarks must cover indexing, expansion latency, and memory across Rust, Go, and WebView processes.

Rust owns application graph processing and cache management. Go supplies language-specific source analysis. The choice does not imply that all expensive work runs in Rust or that performance is guaranteed by the implementation language.

## Design tree

The root is understanding a codebase through a graph. The following branches show the settled product choices and the implementation planning that depends on them.

1. Graph as the primary interface, confirmed.
   - Symbols and meaningful relationships, confirmed intent.
   - Expansion through multiple levels, confirmed intent.
     - Progressive disclosure keeps the initial neighborhood small and further expansion explicit.
     - Grouping, relevance selection, and display limits must keep additional connections discoverable.
   - Internal behavior is explorable, confirmed intent.
     - Q1 resolved: visually grouped, collapsible function subgraphs.
     - Detailed layout, routing, and navigation follow this decision.
2. Offline, evidence-grounded explanations without AI, confirmed.
   - Source evidence and documented purpose, confirmed intent.
   - Q2 resolved: static source analysis for the initial product.
     - Runtime tracing is outside the initial scope and may be considered later.
3. Potential change impact, confirmed intent.
   - Every impact needs a reason and a relationship path, confirmed intent.
   - Q3 resolved: selected symbol and hypothetical change category.
     - Category-specific impact rules follow this decision.
     - Actual Git diff analysis is outside the initial scope and may be considered later.
4. Go codebases first, confirmed.
   - Go analysis supplies source facts and evidence.
   - Detailed relationship and behavior coverage follows the product requirements above.
5. Desktop architecture, approved.
   - Tauri provides the desktop shell; React Flow presents the bounded exploration.
   - Rust manages the index, graph processing, caches, and analyzer lifecycle.
   - ELK.js starts behind a replaceable layout boundary.
   - Source facts, exploration state, and layout geometry remain separate.
6. Performance requirements, approved.
   - Edits trigger dependency-aware incremental updates, not routine full repository reindexing.
   - Renderer input stays bounded to the visible graph.
   - Benchmarks measure complete indexing and expansion workloads and total process-tree memory.
   - Numerical budgets follow initial measurement and must be set before release acceptance.

## Resolved question round

The user accepted the recommendations and clarified the reasons below. Alternatives are retained only to explain the trade-offs.

### Q1. Collapsible function subgraphs

Decision: expand internal behavior as a collapsible function subgraph inside the existing exploration graph. Conditions, branches, transformations, and returns stay visually grouped inside the selected function.

Reason: grouping keeps the main graph readable while preserving connections between internal operations and surrounding symbols. An explicit focus action can provide more room without discarding the exploration.

Trade-off: the layout needs to handle nested detail and connections crossing a function boundary. A dedicated behavior view would provide more space but would make crossing between internal and external relationships less immediate.

### Q2. Static source analysis initially

Decision: analyze source without running project code in the initial product. Runtime tracing is outside the initial scope.

Reason: runtime tracing adds significant complexity and is unnecessary to prove that the core visual explorer is useful.

Trade-off: the graph can show source-defined paths and possible relationships but cannot claim that a scenario executed them. Opt-in execution would add observations at the cost of setup requirements, execution controls, and a second kind of evidence.

Runtime tracing may be considered later. Offline operation and avoiding project execution are separate constraints, and the initial product satisfies both.

### Q3. Hypothetical change categories initially

Decision: start an impact investigation with a selected symbol and a hypothetical change category, such as signature, field, or behavior.

Reason: the user can investigate relevant consumers and relationship paths before making edits or supplying a previous code state.

Trade-off: results describe potential effects of a category rather than an exact patch. Actual-edit comparison would connect impact to concrete work but requires a comparison baseline and rules for matching entities across versions.

Actual Git diff analysis may be considered later and is outside the initial scope.

## Deferred decisions

- Detailed subgraph layout, routing, and navigation can be resolved during implementation planning.
- Relevance selection, neighborhood limits, and group expansion follow the confirmed progressive-disclosure requirement. The requirement itself is settled.
- Category-specific impact rules can be defined against the confirmed hypothetical-change experience.
- Exact library versions, storage choices, packaging details, and incremental invalidation rules can be resolved against the approved architecture.
- Benchmark fixtures and numerical performance budgets must be defined and recorded before release acceptance. No measurements have been made yet.
- Detailed first-release analysis coverage remains implementation planning work. Internal behavior is a core requirement, not an optional runtime feature.
- Runtime tracing and Git comparison require separate future scope decisions if pursued.

## Decision record policy

The approved desktop and analysis boundaries are recorded in [ADR 0001](adr/0001-desktop-and-analysis-boundaries.md). Routine tuning and reversible library choices remain in the architecture and performance documents rather than generating additional ADRs.
