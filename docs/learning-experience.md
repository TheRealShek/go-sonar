# Exploration experience

The goal is to help a developer explain real code accurately while keeping their place in the graph. This is code comprehension within the offline static-analysis product, not a programming tutorial.

The [approved UI specification](ui-design.md) defines the three main screens and supersedes earlier presentation proposals. The primary task is understanding a function's flow and its connections, then entering a callee without losing the caller.

## Approved presentation

The function header shows its Go signature and package. Default nodes show one name, with a small origin tag only for non-project calls. Explanations and exact source expressions appear in hover and selection. Language kinds and signatures stay distinct from Go Sonar descriptions and grouped source.

The three detail levels add descriptions, then source ranges and type facts. Expanded regions use brackets; collapsed regions retain analyzed counts. Rounded orthogonal routes, labeled branch edges, defer registration markers, and distinct return-site pills preserve source meaning while reducing repeated labels and controls.

The three prototype screens passed render and interaction checks. They are not a learner study or native-app verification. Implementation must preserve bounded navigation, source freshness checks, keyboard access, and explicit unknown targets. The tasks below define the comprehension checks for that implementation.

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
