# Product intent

## Purpose

Go Sonar helps a developer understand an unfamiliar Go codebase by exploring its connections and behavior visually. The primary user is a developer working locally, initially Abhishek.

A user should be able to start at any symbol and answer questions about its role, its relationships, its internal behavior, and the potential effects of changing it. Exploration must work for libraries and symbols that have no known connection to a main function.

The graph is the primary interface. Most relationship questions should be answerable through node labels, meaningful edges, branch labels, grouped details, and contextual explanations. Opening source is a way to verify or deepen understanding, not a required step for every connection.

## Confirmed intent

- Target Go codebases first.
- Operate offline and provide explanations without AI.
- Let the user select functions, structs, and other symbols as starting points.
- Show where a symbol is used, what calls it, what it calls, and relevant data relationships.
- Let the user choose which relationship categories appear.
- Support expansion in either direction through multiple levels.
- Use progressive disclosure: initially show only the most relevant relationships and let the user choose further expansion.
- Make the reason for each connection understandable in the graph.
- Support exploring conditions, return paths, and data transformations inside functions.
- Keep those internals visually grouped in collapsible function subgraphs within the exploration graph.
- Use static source analysis for the initial product, without running the project.
- Explain the current exploration in context and link to actual source evidence.
- Help users investigate potential change impact while communicating uncertainty.
- Start impact exploration with a selected symbol and a hypothetical change category.
- Update analysis incrementally after edits without treating an ordinary one-file change as a full repository reindex.
- Send only the visible graph to the renderer and expand further relationships on demand.
- Verify indexing, expansion latency, and total application memory through repeatable benchmarks.

Programming tutorials and teaching exercises are outside the current product intent. Language explanations may clarify a specific connection or behavior when the user needs that context.

The approved architecture uses Tauri, React Flow, a Rust application core, and a Go analyzer. ELK.js is the initial, replaceable layout engine. Component boundaries are specified in [Architecture](architecture.md).

## Questions the explorer should answer

- Who calls this method, and where?
- Which operations does this function delegate to other code?
- Where is this struct constructed and how are its fields used?
- Which data influences this result or changes this state?
- Which condition chooses between these paths?
- What can this function return, and what leads to each return?
- How does this input become the returned value?
- Why are these two entities connected?
- Which consumers or contracts should I inspect before changing this symbol?
- What does the available evidence leave unresolved?

## Visual understanding of relationships

The visible graph needs to distinguish the kinds of connection that matter to the current question. A generic line between two nodes is insufficient when the evidence identifies a more specific relationship.

Examples include calls, references, construction, field reads and writes, interface satisfaction, argument passing, returned values, and possible dynamic call targets. This is a vocabulary of useful relationships, not a claim that the first release will analyze every category completely.

Direction and labels should communicate the relationship without requiring source inspection. For example, a field read should show which operation consumes the field, while a field write should show which operation changes it.

When several source sites establish the same connection, the graph should summarize them and let the user inspect the individual sites. A summary must preserve the relationship's meaning and reveal what it hides.

Resolved source relationships and possible relationships must remain distinguishable. A known callee does not prove that the call executes for every input. A compatible interface implementation does not prove that a particular invocation uses it.

## Visual understanding of internal behavior

A function must be explorable beyond its signature and external calls. Its behavior should reveal relevant operations, their order, the conditions governing them, their results, and changes to state.

At an appropriate level of detail, a user should be able to follow:

- Inputs and relevant state into operations.
- Conditions into labelled branch choices.
- Calls into their arguments and returned results.
- Transformations into derived values or modified state.
- Error checks into continuation or return paths.
- Paths into returned values and side effects.

Behavior detail needs to remain connected to the surrounding codebase. A call inside a function should let the user explore its target. A field access should lead to the field and its other uses. An input or result should connect to the relevant caller or consumer when evidence is available.

Control connections and data connections have different meanings and must be visually distinguishable. A later operation is not necessarily a consumer of the previous operation's result.

Loops, recursion, early returns, and deferred work must not appear as an invented single linear sequence. Represent repeated or conditional behavior explicitly and show analysis limits where behavior cannot be resolved.

Internal expansion opens a collapsible function subgraph inside the existing exploration graph. Conditions, branches, transformations, and returns remain visually grouped inside the selected function, so internal detail does not become an ungrouped collection of nodes across the main graph.

An explicit focus action can give the function more room while preserving the surrounding exploration. Collapse hides the internal detail and retains the function's relevant external relationships. Detailed placement and routing remain implementation design work.

The initial product derives behavior from static source analysis. It does not run the project or provide runtime tracing. Source-defined branches and transformations must not imply concrete values, guaranteed path feasibility, or observed execution where the evidence does not establish them.

## Exploration across multiple levels

Progressive disclosure is a core requirement. The initial graph displays a small, relevant neighborhood around the selected symbol rather than all available relationships or a complete transitive graph. Relevance relates to the selected symbol, the current question, and the visible relationship categories; exact selection rules and display limits remain design details.

Additional levels appear through explicit user expansion of selected connections or groups. Expanding one branch must not automatically unfold every connected branch. Function subgraphs start collapsed, and users choose when to reveal internal behavior.

Symbols with many connections need grouped summaries and a way to reveal more without displaying every neighbor at once. The graph should indicate additional connections and report counts when available, while distinguishing known counts from incomplete analysis. Disclosure controls must keep less immediately relevant connections discoverable.

Expansion should preserve the user's current investigation. Users need to follow a connected item, open another branch, return to earlier context, and reduce detail when the view becomes crowded.

Multiple branches may meet at the same entity. The explorer should reveal that shared relationship rather than imply several independent copies. Cycles should remain recognizable without endless expansion.

The graph should reveal when filters, collapsed groups, display limits, or analysis scope hide connections. A small visible neighborhood must not imply that the selected entity has no other relationships.

Controls for relationship categories are display controls. Hiding calls or data connections does not change the source or remove those dependencies.

The visible graph is a bounded projection of the analyzed codebase. The renderer receives the nodes and edges needed for the current display, rather than a complete repository graph that it hides locally. Counts and group summaries keep additional connections discoverable. Source facts remain independent of layout and renderer formats.

## Freshness and responsiveness

Editing a Go file updates the affected analysis instead of triggering a full repository reindex by default. If the edit changes a shared type, signature, or other dependency, relevant consumers also need an update. Incremental analysis preserves correctness across the affected scope and reuses facts that remain valid.

An exploration should make its freshness clear while updates are in progress or source errors prevent complete analysis. It must not combine old and new facts into a misleading current graph.

Indexing time, expansion latency, and total application memory are release criteria. Measurements include the Rust core, Go analysis, and WebView processes, including relevant child processes. The [performance requirements](performance.md) describe the benchmark scenarios and measurement rules; numerical targets are not yet set and no results are claimed.

## Contextual explanations and evidence

Explanations follow the selected node, edge, or path. They should clarify what the graph shows, why a relationship exists, and what the evidence supports.

The explorer may explain operations and relationships derived from source. It may attribute documented purpose to comments or project documents. It must leave undocumented design intent unknown and keep documented claims distinguishable from verified code facts.

Source links should identify the relevant declaration, expression, branch, or operation. Evidence for a whole path may involve several locations and should not be reduced to an unrelated file link.

Explanations must not depend on a remote service or a local AI model.

## Potential change impact

Change impact is a question about the consequences of a particular change. It must account for the kind of change rather than treating every reachable entity as equally affected.

Examples include callers of a changed signature, consumers of a changed field, contracts involving a method, and behavior that depends on a changed result or side effect.

An impact connection should explain the reason and the path to the affected candidate. Direct relationships, further potential effects, and unresolved effects need distinct treatment.

The graph can guide inspection without proving that all listed code breaks or that all unlisted code is safe. Build configuration, missing dependencies, dynamic behavior, and incomplete analysis limit the conclusion.

The initial experience starts when a user selects a symbol and a hypothetical change category, such as signature, field, or behavior. It identifies the relevant consumers and relationship paths without requiring source edits or a previous code state.

Actual Git diff analysis can be considered later. It is outside the initial scope and is not a committed extension.

## Acceptance scenarios

These scenarios describe intended behavior, not completed functionality or executed tests.

### Start at a struct

A user selects a struct in a library that has no main function. The graph initially shows a small set of relevant construction sites, methods, and usages, with clear relationship labels and indications of additional connections. The user expands a field's uses without restarting exploration.

### Explore a symbol with many connections

A user selects a function with hundreds of callers. The first view stays readable through a bounded neighborhood and grouped summaries, with additional callers discoverable. The user expands one group and follows one caller to another level without automatically expanding all other callers or their dependencies.

The selected function's internals remain collapsed until the user opens them. Collapsing an expanded branch reduces detail while preserving the rest of the investigation. The graph never presents the visible subset as the complete set of relationships.

### Understand an early return

A user selects a function with a cache lookup, a cache-hit return, a repository call, an error return, and a cache write. Expanding its function subgraph makes the branch choices, distinct returns, and cache mutation understandable without opening the source file. Those details remain visually grouped inside the function.

The user can still open the source evidence for any branch or operation, follow the repository call into another symbol, and collapse the internal detail without losing external connections. The graph does not imply that every invocation calls the repository or require running the project to explain this behavior.

### Follow a transformation across functions

A user follows an input through a conversion, a call, and a returned result. The graph distinguishes value transformations from execution order and keeps the relevant caller visible or recoverable.

Where the analysis cannot follow an alias or dynamic operation, the graph shows the boundary instead of drawing a guessed connection as fact.

### Investigate an interface call

A user expands an interface method call. The explorer distinguishes the referenced method from possible concrete targets and explains the evidence for each candidate. It does not equate interface satisfaction with observed execution.

### Explore a cycle and a shared dependency

Two expanded branches reach the same helper, and one branch includes recursion. The graph makes the shared helper and cycle recognizable, allows continued exploration, and avoids indefinite duplication.

### Investigate a change

A user selects a method or field and chooses a hypothetical change category without editing source or supplying a Git comparison baseline. Each potential impact has an inspectable reason and connection path. Results distinguish direct consumers from further possible effects and show relevant coverage limits.

### Work with incomplete information

A project has unavailable dependencies or code excluded by its active build configuration. The explorer states the covered scope and unresolved relationships. An empty result is distinguishable from a complete finding of no relationships.

### Update one file

A user edits a function body. The explorer updates affected facts and source evidence while reusing unaffected analysis and preserving the user's exploration. Benchmark diagnostics show which scopes were recomputed, rather than merely claiming that the update was incremental.

When the user instead changes a shared signature or type, consumers receive the relevant update. An unrelated package is not reindexed unless its analysis depends on the change. Invalid source produces a visible incomplete or stale state rather than mixed facts.

### Keep renderer data bounded

A user explores one symbol in a large indexed project. The renderer receives the current visible nodes, edges, and summaries. It does not receive the full repository graph with most nodes hidden. Expanding one branch adds only the requested detail, and collapsing it releases unnecessary renderer state while retaining navigation context.

### Measure the whole application

A benchmark indexes a project, expands functions and relationships, then closes the project. It records indexing time, expansion latency through a rendered result, and memory across the Rust, Go, and WebView process tree. Results distinguish indexing peaks from steady exploration and check whether repeated exploration leaves memory growing.

## Current boundaries

The project has no implementation yet. The desktop stack and analysis responsibilities are approved. Storage libraries, exact versions, detailed analysis coverage, incremental invalidation rules, layout tuning, and numerical performance budgets remain implementation planning details.

Automatic refactoring, editing source through the graph, and support for additional languages are not current requirements. Runtime tracing and actual Git diff analysis are outside the initial scope; they may be considered later without being committed extensions.
