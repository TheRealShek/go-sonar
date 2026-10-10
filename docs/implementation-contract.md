# Implementation contract

This reference describes the current analyzer transport and desktop queries. It is for maintainers; the [user guide](user-guide.md) explains the controls. The source definitions remain authoritative when extending fields.

## Analyzer transport

The persistent executable in `analyzer/cmd/go-sonar-analyzer` reads one JSON request per line from stdin and writes one response per line to stdout. Logs go to stderr. EOF stops the helper cleanly. Requests are bounded at 1 MiB and responses at 64 MiB.

```json
{ "version": 1, "id": "request-id", "method": "analyze", "root": "/absolute/project/path" }
```

A successful response contains `version`, the matching `id`, and `result`. A failed response contains `error` instead of `result`. Protocol field names use camelCase. Collection fields use arrays rather than null.

An analysis result contains `root`, `snapshot`, `full`, `packages`, `removedPackages`, `stats`, and `diagnostics`. Package entries replace that package's facts; they are not necessarily the complete index. A full batch resets stored package scope after a new session or configuration change.

Each package contains its identity, file list, source fingerprints, package fingerprint, imports, symbols, relations, and behaviors. `sourceFingerprints` maps source paths to SHA-256 fingerprints. Statistics report analyzed packages, reused packages, changed files, and duration. Diagnostics have a message, package identity, and warning or error severity.

The analyzer publishes one consistent source/configuration snapshot. Syntax or type failures must not republish stale affected facts as complete current analysis.

## Source facts

[Analyzer models](../analyzer/internal/analysis/model.go) define the transport facts. [Rust models](../crates/sonar-core/src/model.rs) define index and query types, and [frontend protocol types](../src/shared/protocol.ts) define the presentation contract.

| Fact              | Required meaning                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Symbol            | Stable identity, name, qualified name, kind, package, source span, signature, documentation, and export status |
| Source span       | Absolute path and one-based start/end line and column coordinates                                              |
| Relation          | Source and target symbol IDs, kind, label, certainty, expression, and evidence                                 |
| Behavior          | Enclosing symbol ID plus internal nodes and control/data edges                                                 |
| Operation details | Structured role, expression, explanation, limits, and available call or access facts                           |

Relation kinds are `calls`, `references`, `reads`, `writes`, `constructs`, `implements`, and `uses_type`. Certainty is `resolved` or `possible`. A spelling match cannot manufacture a type-resolved target.

Behavior nodes include entry, condition, operation, return, exit, loop, and call roles. Call details record dispatch as direct, interface, or dynamic, with a signature, optional receiver, argument mappings, returned positions, and variadic information. Access facts identify available local or field occurrences and mutation details.

Behavior describes static structure. Resolved control edges do not prove execution or path feasibility. Source mappings do not establish complete value dependence.

## Desktop commands

The command handlers are in [main.rs](../src-tauri/src/main.rs); the frontend adapter is in [backend.ts](../src/backend.ts).

| Command                 | Input and result                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `open_project`          | Takes `root`; returns project identity, snapshot, counts, statistics, and diagnostics.                      |
| `refresh_project`       | Refreshes the active project and returns its summary.                                                       |
| `search_symbols`        | Takes `query` and `limit`; returns bounded matching symbols. The UI requests 40.                            |
| `browse_symbols`        | Takes `kind`, `package`, and `offset`; returns a declaration page and total.                                |
| `discover_project`      | Returns bounded executable entries, package suggestions, and package count.                                 |
| `graph_view`            | Takes a graph request; returns a bounded projection for one snapshot.                                       |
| `relation_sites`        | Takes source/target IDs, relationship kind, and offset; returns a source-site page with snapshot and total. |
| `source_excerpt`        | Takes a source span; returns file, first line, and bounded text after containment and freshness checks.     |
| `impact_view`           | Takes symbol ID, category, and limit; returns direct incoming candidates for inspection.                    |
| `choose_project_folder` | Opens native folder selection and returns a path or no selection. It does not analyze the directory.        |

Declaration and source-site pages contain at most 40 entries. Return-statement pages contain at most 30 entries. Discovery suggestions are bounded; the package count can exceed the suggestion list.

## Graph requests and responses

A request requires `focus`, `expanded`, `internals`, `kinds`, and `limit`. Optional controls include `direction`, `offsets`, `neighborLimit`, `groups`, `regions`, `behaviorAnchors`, and `outcomeOffsets`.

Focus, expansions, and internals use symbol IDs. Direction is incoming, outgoing, or both; the backend default is both. Filters apply before neighbors are hydrated. `neighborLimit` defaults to eight and is capped at 40. Offsets page grouped endpoint/kind connections, not individual source sites. Group filters specify package, kind, and direction. Region and anchor controls choose bounded internal detail; outcome offsets page returns.

A view contains `snapshot`, `focus`, `nodes`, `edges`, `summaries`, `truncated`, and behavior summaries. Nodes can include parent and related-symbol IDs and operation details. View edges can include grouped sites, total site count, loop-back information, and hidden-target identities. Summaries explain known relationships and omissions through counts and page information.

The UI uses an 80-node budget. Rust caps views at 300 nodes, 1,200 edges, 64 expansion seeds, and 16 open function groups. Internals share the node budget. Cycles and shared symbols reuse IDs. All returned edge endpoints and parent groups must exist in the view.

Impact categories are signature, field, and behavior. Results frame incoming source uses as potential effects, not proven breakage.

## Frontend and layout boundaries

The desktop uses real analysis. Browser preview may use labelled illustrative data and must not silently replace failed native analysis with a sample.

The frontend preserves interaction state separately from source facts. Superseded requests cannot overwrite a newer view. Flow navigation is bounded to 120 steps and 16 call frames.

ELK runs in a locally bundled worker behind an independent layout contract. Input contains bounded topology, dimensions, groups, and placement metadata; output is geometry. Analyzer facts, persisted records, and Tauri query contracts contain no ELK or React Flow objects.
