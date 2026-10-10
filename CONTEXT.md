# Glossary

These terms describe Go Sonar's product and graph model. A definition describes meaning, not a promise of complete implementation. See [analysis scope](docs/implementation-notes.md) for current coverage.

## Code and evidence

| Term                   | Meaning                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codebase               | The source and supporting project material being explored. The current app opens one Go module.                                                                         |
| Symbol                 | A named declaration, such as a function, method, struct, interface, field, variable, constant, type, or package. Exploration can start here without a path from `main`. |
| Relationship           | A connection with a specific meaning, such as a call, read, write, construction, or type use. Prefer the specific kind over the generic word "dependency".              |
| Source site            | One source occurrence supporting a relationship. Several sites can share one displayed connection.                                                                      |
| Source evidence        | The location and expression supporting a relationship or explanation. The inspector checks that the file still matches the analyzed snapshot.                           |
| Contextual explanation | A description of the selected entity, connection, or operation derived from available facts. It does not invent undocumented author intent.                             |
| Analysis scope         | The source, build environment, and available dependencies covered by analysis. Excluded or unresolved code limits conclusions.                                          |
| Analysis snapshot      | A consistent set of facts for one source state and scope. Facts from different states must not appear as one current result.                                            |
| Incremental analysis   | Updating affected facts after a change while reusing valid facts elsewhere. Shared declarations and changed source positions can invalidate consumers.                  |
| Offline operation      | Analysis and explanations require no remote service or AI model. Dependencies must already be available locally.                                                        |

## Exploration

| Term                   | Meaning                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                   | A displayed symbol, internal operation, condition, return, region, or boundary.                                                                                   |
| Exploration graph      | The nodes and relationships the user chooses to explore. Expansion reveals additional detail instead of loading the whole repository into the renderer.           |
| Focus                  | The starting entity for the current view. Selection and focus can differ.                                                                                         |
| Expansion              | Revealing another neighborhood or more internal detail. Several branches can remain open together.                                                                |
| Progressive disclosure | Starting with a bounded neighborhood, then revealing more through explicit actions while indicating hidden detail.                                                |
| Relationship view      | Exploration of how a symbol connects to other declarations.                                                                                                       |
| Behavior view          | Exploration of a function's static operations, branches, calls, mutations, and returns.                                                                           |
| Function subgraph      | A collapsible group containing a function's internal nodes while preserving its surrounding connections.                                                          |
| Region                 | A summary of internal operations that can be revealed on demand.                                                                                                  |
| Boundary               | A visible point where detail is hidden or analysis cannot establish a continuation. Inspect its explanation to distinguish the cases.                             |
| Visible graph          | The bounded nodes, edges, and summaries returned for the current exploration. It is not the full index and is not limited to items currently inside the viewport. |
| Layout                 | Node positions, group bounds, and connection paths. Geometry does not change the meaning of a relationship.                                                       |

## Behavior and changes

| Term                         | Meaning                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control path                 | Operations connected by source-defined execution order and branch choices. A static path does not prove feasible inputs or observed execution.        |
| Data transformation          | An operation that derives, changes, combines, or selects a value. Current source expressions and mappings do not establish complete value dependence. |
| Call boundary                | The signature, receiver, arguments, returned positions, and dispatch kind known at a call site.                                                       |
| Potential impact             | A source-based reason to inspect code before a change. A listed candidate is not proven broken, and an unlisted entity is not proven safe.            |
| Hypothetical change category | The kind of change being investigated, such as a signature, field, or behavior change, without making an edit or supplying a previous version.        |

Use "potential impact" rather than "blast radius" when the evidence only identifies candidates for inspection.
