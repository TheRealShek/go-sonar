# Codebase exploration

Go Sonar helps developers understand a codebase through a visual graph of code relationships and internal behavior. The graph connects explanations to inspectable source evidence.

## Language

**Codebase**:
The source and supporting project material that a user explores together. The initial focus is Go projects.

**Symbol**:
A named code entity, such as a function, method, struct, interface, field, variable, constant, or package. A symbol can be a starting point for exploration without a path from the program's entry point.

**Node**:
A visible entity in the exploration graph. A node can represent a symbol, an internal operation, a condition, a return, or a collapsed group.

**Relationship**:
A connection between entities with a specific meaning, such as calling a function, reading a field, or producing a value. A relationship includes evidence explaining why the entities are connected.
_Avoid_: Dependency, when the particular relationship is known.

**Exploration graph**:
The visible collection of nodes and relationships that a user has chosen to explore. It grows or contracts through user actions rather than requiring the entire codebase to appear at once.

**Focus**:
The entity or question currently receiving the user's attention. Inspecting or expanding a connection does not require discarding the surrounding exploration.

**Expansion**:
Revealing additional relationships or internal detail for a selected entity. Users can expand several branches and continue through multiple levels.

**Progressive disclosure**:
Showing a small, relevant set of relationships first and revealing additional connections or internal detail through explicit user expansion. The graph indicates that more connections are available without displaying them all at once.

**Relationship view**:
The level of exploration concerned with how a symbol connects to other code entities. It includes incoming and outgoing connections and their meanings.

**Behavior view**:
The level of exploration concerned with what happens inside a function. It includes conditions, control paths, returns, data transformations, and their connections to other symbols.

**Function subgraph**:
A collapsible part of the exploration graph that visually groups a function's conditions, branches, operations, transformations, and returns inside that function. Expanding it preserves connections to the surrounding code while keeping internal detail contained.

**Control path**:
A sequence of operations connected by branch choices and execution order. A path represented from source is not a claim that every branch combination can occur for real inputs.

**Data transformation**:
An operation that derives, changes, combines, or selects a value. Exploration connects relevant inputs to the operation and its results or affected state.

**Source evidence**:
The source locations and expressions that support a displayed relationship or explanation. Source evidence is accessible from the graph without being the user's mandatory starting point.

**Contextual explanation**:
A concise account of the entity, connection, or path currently being explored, grounded in available evidence. Explanations do not invent an author's undocumented intent.

**Potential impact**:
A reasoned connection between a proposed or actual change and code that may need inspection. A connected entity is not automatically broken or behaviorally affected.
_Avoid_: Blast radius, when it implies every reachable entity will break.

**Hypothetical change category**:
The kind of change a user wants to investigate for a selected symbol, such as a signature, field, or behavior change. It describes the investigation without requiring actual edits or a previous code version.

**Analysis scope**:
The code, build configuration, and available evidence covered by an exploration. Missing code, excluded configurations, and unresolved relationships limit what the graph can conclude.

**Analysis snapshot**:
A consistent set of code facts for a particular source state and analysis scope. Results from different source states must not appear together as one current account of the code.

**Incremental analysis**:
Updating facts affected by a source change while reusing valid facts elsewhere in the codebase. The affected scope can include consumers beyond the edited file when their relationships or meaning change.

**Visible graph**:
The nodes and relationships currently selected for display through focus, filters, expansion, and the viewport. Collapsed or undisclosed detail remains discoverable without becoming part of the full visible graph.

**Layout**:
The positions, group boundaries, and connection paths used to present a graph. Changing a layout must not change the meaning or evidence of the underlying relationships.

**Offline operation**:
Using Go Sonar without remote services or required network access. Explanations use no AI, including local models.
