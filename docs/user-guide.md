# User guide

Go Sonar helps you inspect Go declarations, their relationships, and the static control structure inside functions. You can start anywhere in a module, including a library with no `main` function.

For installation and startup, see [Run locally](../README.md#run-locally).

## Open a project

Enter the absolute path to a directory containing `go.mod` and open it. **Choose folder** fills the path; you still need to open the selected directory. **Recent projects** lets you reuse a previously opened path.

Select an individual module, rather than a workspace root containing only `go.work`. Dependencies and the required Go toolchain must already be available locally. Analysis will report missing dependencies instead of downloading them.

After loading, review the coverage summary and diagnostics. A graph with results can still have incomplete coverage.

## Choose a starting point

Search by a declaration name, such as `Get`, or use **Browse packages and declarations** to narrow results by package and kind. Executable modules can offer discovered `main` functions as starting points. Libraries can start at a type, method, field, or any other indexed declaration.

The initial relationship choices depend on the symbol. Functions start with outgoing calls, fields with incoming reads and writes, and types with incoming construction and type-related uses. The initial neighbor budget is eight connections. Existing exploration preferences can carry over when you refocus.

## Explore relationships

Choose a question to set the view:

- **Calls** shows outgoing call relationships.
- **Callers** shows incoming call relationships.
- **Flow** opens the function's behavior overview without starting or restarting a walkthrough.

Fields offer **Readers** and **Writers**. Types offer **Construction**, **Methods**, and **Uses**. Methods shows method declarations that use the type, including receivers and signatures. Relationship preferences are remembered separately for functions, fields, types, and values during the session.

You can also set incoming, outgoing, or both directions and toggle relationship categories. A filter changes the view, not the source or index. Clearing all categories hides external relationships.

Select a symbol and use **Expand neighbors** to reveal another level. **Collapse neighbors** reduces detail. **Focus symbol** makes it the starting point for a new exploration. Shared symbols and cycles reuse the same identity rather than expanding forever.

Connections with the same endpoints and relationship kind summarize repeated source sites. Inspect the connection to see its expressions and locations. A neighbor page counts these grouped connections, not individual call occurrences or necessarily distinct symbols.

Use package and relationship groups to narrow one symbol's neighbors. The action names the direction, relationship, and package; other expansion seeds keep their filters. Remove its filter chip above the graph, or use **Show all packages** in the inspector, to restore the global filters. **Previous neighbors** and **Next neighbors** reveal other pages. Counts distinguish connections hidden by filters, collapse, pagination, and view limits. Hidden counts are not proof of missing code, and a small visible graph is not the full set of known relationships.

## Keep your place

Expansion preserves the viewport. Following flow preserves zoom and pans only when the next operation leaves the comfortable visible area. Enable **Keep current step centered** for automatic centering at your chosen zoom. Use **Center focus** to return to the focused declaration and **Show selected node** to locate the current selection. Fit the graph explicitly when you want an overview; a large overview may shrink labels.

**Back** and **Forward** restore earlier exploration context, including selection and viewport. The context line distinguishes the explored declaration, followed operation, returned call, and current inspection. **Return to current step** selects the followed operation again.

Selection updates an open inspector. Use **Inspect** to open a closed inspector and **Close inspector** to reclaim its space. Selecting or stepping through nodes keeps it closed. Connection summaries, reset actions, and pagination are available above the graph without opening the inspector. Hover over a node for its identity card, or pin the details to keep them open. The card shows the signature, package, and source location when available. Type-resolved signatures can differ from the declaration's spelling.

## Follow a function

Select a function or method and choose **Open behavior** to reveal internal operations inside its function group. **Start walkthrough** starts at the analyzed entry. **Pause walkthrough** keeps your progress, **Resume walkthrough** continues it, and **Restart walkthrough** explicitly returns to the entry. **Stop following** discards the path without closing the graph. Selecting Flow again preserves progress. Selecting a relationship question pauses the walkthrough; Resume reopens it at the saved operation. The current operation and available successors appear in the flow controls.

At a condition, choose the labelled branch. The chosen conditions remain visible. At a supported loop, use **Follow body** or **Follow exit**. **Step backward** revisits the prior step.

Long functions use collapsed regions and explicit boundaries. **Reveal region** or **Reveal next region** opens more detail. If a boundary is unsupported, inspect its limitation rather than assuming a continuation. The view has a shared node budget, so refocusing or collapsing other detail can free room.

Following a branch does not prove that any real input satisfies all chosen conditions. The app does not execute the function. Flow navigation stops at 120 steps to keep loops bounded.

### Inspect returns

Open behavior, then use **What can this return?** to select a return statement. The graph highlights control connections that may reach it. **Previous returns** and **More returns** page through long lists; **Show alternatives** clears the selected outcome.

Outcome highlighting visits loops once. It does not enumerate every path or prove route feasibility. Read the return expression and any unsupported boundaries before drawing a conclusion.

### Enter a call

Select a direct call operation and use **Enter this call**. The breadcrumb retains the originating expression and source line. **Return to caller** restores that call occurrence and its context.

Interface and dynamic calls do not offer a proven concrete implementation to enter. Inspect their declared signature and dispatch limit instead. Recursive navigation is bounded to 16 call frames.

### Inspect values and mutations

Call details show the receiver, argument expressions mapped to parameters, and returned positions mapped to destinations where analysis supplies them. An assignment such as `record = store.Normalize(record)` maps the argument and destination; it does not prove how the callee uses the value.

Operation details can show field accesses, mutations, and local binding occurrences. **Inspect known readers and writers** opens the field's broader relationships. **Inspect this local binding** shows available occurrences for the binding. These facts do not establish complete alias tracking or value dependence across functions.

## Inspect source evidence

Select a node or connection, then choose **Open source evidence**. For a grouped connection, select an individual source site; use **Previous sites** and **More sites** to inspect additional occurrences.

The source inspector reads bounded excerpts inside the selected module. It rejects a file that changed since the analyzed snapshot. Refresh before retrying an excerpt after an edit.

External declarations may have signatures and package information without readable declaration source. Inspect a local call site when the declaration is outside the project. Opening an external editor is not implemented.

## Investigate a hypothetical change

Select a declaration and open **Investigate a hypothetical change**. Choose **Signature**, **Field**, or **Behavior / result** to see direct incoming candidates worth inspecting.

The result uses existing source relationships. It does not simulate an edit, prove breakage, or find every transitive effect. Refocus a candidate to continue ordinary exploration. Choose **Normal exploration** to leave the impact view.

## Refresh after edits

Save source changes, then choose **Refresh**. There is no automatic file watcher. A body edit usually updates its package; a declaration or source-location change can also update consumers. The summary reports analyzed and reused packages.

Syntax and type errors can make the snapshot incomplete and remove affected stale facts. Fix the errors and refresh again. If a dependency outside the selected module changes locally, restart the app so the analyzer reloads it.

## Keyboard inspection

Use Tab to reach the controls and **Inspect the graph with the keyboard** to select a visible operation, symbol, or connection. The inspector exposes the corresponding actions and evidence. Escape dismisses identity details and the inspection selection. Use **Close inspector** to close the panel.

Keyboard controls exist in the current source. Full keyboard usability remains a proposed acceptance check, not a completed accessibility audit.

## Try the sample module

Open `fixtures/sample` using its absolute path and search for the `Service.Get` method.

1. Inspect outgoing calls. `Repository.Lookup` is an interface call; its contract does not identify the runtime implementation.
2. Open behavior or follow flow. The cache-hit branch returns the cached record before the repository lookup.
3. Follow the cache-miss branch. A lookup error reaches an error return before normalization or the cache write.
4. Follow the continuation after the error check. It calls `store.Normalize`, writes the record into the cache, and reaches the final return.
5. Select the direct normalization call, enter it, and return to the original caller.
6. Select the cache mutation and inspect its source evidence and known field accesses.

This exercise explains source structure. It does not run the sample or test concrete inputs.

## Understand the analysis limits

Current analysis covers active non-test packages in one Go module using the current build environment. There are no UI controls for build tags, test-package inclusion, or workspace-root loading.

The analyzer provides type-resolved relationships and static operations. It does not provide complete dynamic dispatch targets, SSA-based value flow, alias analysis, closure-body exploration, or complete deferred and concurrent execution paths. Unsupported control flow appears as a marked stopping point.

Comments provide documented purpose. Missing author intent remains unknown. An empty result can mean no known matches, filtered results, unavailable code, or incomplete analysis. Check the diagnostics and hidden counts before treating absence as a finding.

## Troubleshooting

| Symptom                                   | What to check                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Project does not open                     | Use an absolute directory path containing `go.mod`, not a file or a workspace-only root.     |
| Dependencies or toolchain are missing     | Prepare them locally with your normal Go setup, then retry. Analysis does not download them. |
| Desktop build fails on Linux              | Check the Rust, Go, and Node versions and the native library requirements in the README.     |
| Graph looks unexpectedly empty            | Check the search, direction, relationship filters, package group, and coverage diagnostics.  |
| Some neighbors or operations are absent   | Check hidden counts, neighbor pages, collapsed regions, and the node limit.                  |
| Source evidence reports changed content   | Save the file and refresh the project before reopening the excerpt.                          |
| External declaration source cannot open   | Select a connection and inspect its local source site.                                       |
| Changes do not appear                     | Refresh manually. Restart after edits to local dependencies outside the selected module.     |
| Browser preview ignores your project path | The browser preview uses illustrative data. Start the native desktop for real analysis.      |
