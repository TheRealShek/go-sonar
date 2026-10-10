# Exploration experience

The goal is to help a developer explain real code accurately while keeping their place in the graph. This is code comprehension within the offline static-analysis product, not a programming tutorial.

Earlier recommendations came from a screenshot and source inspection, not an interactive usability study. Several recommended controls now exist in the working source. Their presence does not establish that the usability goals below have passed. See the [user guide](user-guide.md) for instructions.

## Current controls and intended outcomes

### Keep labels readable

Center the initial view on the focus, preserve the viewport during expansion, and let the user request an overview explicitly. A large fan-out should not force every label to become unreadable.

The current frontend has focus centering, explicit fitting, viewport-preserving expansion, and history restoration. Validate their behavior on a real module with a tall dependency graph before treating readability as solved.

### Identify declarations and source sites

Identity cards expose signatures, packages, and locations outside the zoomed canvas. Pinning keeps details available. Edge inspection presents the caller's expression and source site, and grouped connections retain individual occurrences.

A callee signature identifies the target; the caller expression explains what creates the connection. Type-resolved signatures may differ from declaration spelling. For external declarations, use local call-site evidence when source is outside the project.

### Start with a question

Question controls offer outgoing calls, incoming callers, and internal behavior. Initial function views use a small calls neighborhood; fields and types use different relationship defaults. Package and declaration browsing supports libraries without an entry function.

Group summaries and hidden counts need to explain filters, collapse, pagination, and limits. Test that users can discover less prominent relationships rather than interpreting the first view as complete.

### Follow bounded behavior

Function behavior uses region summaries, reveal actions, marked boundaries, and static path navigation. Branch choices remain visible. Return selection highlights possible control routes, while call navigation retains the originating occurrence and supports returning to the caller.

These controls must not imply feasible inputs, observed execution, or complete unrolling of loops and recursion. Unsupported continuation must remain visible at the operation where analysis stops.

### Explain values and state changes

Structured operation facts provide explanations, argument/parameter mappings, returned-position destinations, field accesses, and local binding occurrences. Mutation inspection connects an operation to known readers and writers.

Mappings must remain distinguishable from proven value dependence. Passing an argument does not establish its effect on a result. Local occurrences do not establish reaching definitions across all paths. Updating a map entry differs from replacing the map field.

### Support inspection without a pointer

The current inspector includes keyboard-selectable nodes and connections, and Escape dismisses details and selection. Test that users can reach the same evidence and actions using the keyboard. A source audit does not establish complete accessibility.

## Proposed comprehension checks

Ask a developer unfamiliar with `fixtures/sample` to use the native app to:

- Explain why a cache hit in `Service.Get` skips `Repository.Lookup`.
- Identify the lookup-error return and whether that route reaches the cache write.
- Find the route that normalizes a record and updates the cache.
- Enter `Normalize` and return to the exact original caller occurrence.
- Explain what the interface call establishes and which implementation remains unknown.
- Inspect the cache mutation and its known field relationships.

Record answer correctness, where the user loses context, and whether static possibilities are mistaken for execution. Record task time as a secondary measure. A successful result includes an accurate explanation of what remains unknown.

## Additional fixtures

Use a real module with a long entry function and high fan-out. Include repeated calls to one helper, nested branches, early returns, loops, recursion, interface calls, shared dependencies, unsupported control flow, and behavior larger than the visible node budget.

Check that:

- Initial labels remain readable and expansion preserves context.
- Hover, pinning, selection, and keyboard inspection identify the exact declaration.
- Repeated sites share a connection but remain individually inspectable.
- Group counts and hidden relationships remain discoverable.
- Region expansion preserves coherent entry-to-return context.
- Call return navigation distinguishes separate occurrences of the same helper.
- Loops, recursion, and repeated navigation stay bounded.
- Hidden or unsupported regions never appear as completed execution.

For call mappings, include shadowing, reassignment, multiple results, discarded results, variadic arguments, and unsupported aliasing. Verify mappings against source and avoid treating them as complete value-flow proofs.

## Remaining validation and deeper work

Run comprehension and keyboard checks on the current controls before adding more navigation features. Use the results to choose readability and relevance improvements.

Deeper local value tracking, alias handling, dynamic targets, and complete concurrent or deferred execution need additional analysis. Preserve explicit limits while extending coverage. These are further requirements to evaluate, not completed capabilities.
