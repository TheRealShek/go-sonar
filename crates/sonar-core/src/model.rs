use serde::{Deserialize, Serialize};

/// One-based source coordinates reported by the Go analyzer.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpan {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

/// A source declaration, independent of rendering and layout.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub id: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub package_id: String,
    pub source: SourceSpan,
    pub signature: String,
    pub documentation: String,
    pub exported: bool,
}

/// A relationship and the source location that justifies it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub label: String,
    pub certainty: String,
    pub evidence: SourceSpan,
    #[serde(default)]
    pub expression: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sites: Vec<RelationSite>,
    #[serde(default)]
    pub site_count: usize,
    #[serde(default)]
    pub loop_back: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_target_id: Option<String>,
}

/// One source occurrence retained behind a summarized connection.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationSite {
    pub id: String,
    pub expression: String,
    pub evidence: SourceSpan,
    pub certainty: String,
}

/// A bounded evidence page; all remaining occurrences stay in the index.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationSites {
    pub snapshot: String,
    pub sites: Vec<RelationSite>,
    pub total: usize,
    pub offset: usize,
}

/// A statement or branch inside a function.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub source: SourceSpan,
    pub related_symbol_id: Option<String>,
    #[serde(default)]
    pub details: Option<OperationFacts>,
}

/// A static control or data connection, not a runtime trace.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BehaviorEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub label: String,
}

/// A collapsible function subgraph.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Behavior {
    pub symbol_id: String,
    pub nodes: Vec<BehaviorNode>,
    pub edges: Vec<BehaviorEdge>,
}

/// Replacement facts for a single package.
#[derive(Debug, Deserialize, Serialize)]
pub struct PackageFacts {
    pub id: String,
    pub files: Vec<String>,
    #[serde(rename = "sourceFingerprints", default)]
    pub source_fingerprints: std::collections::HashMap<String, String>,
    pub fingerprint: String,
    pub imports: Vec<String>,
    pub symbols: Vec<Symbol>,
    pub edges: Vec<Relation>,
    pub behaviors: Vec<Behavior>,
}

/// The work performed on this analysis request.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStats {
    pub analyzed_packages: usize,
    pub reused_packages: usize,
    pub changed_files: usize,
    pub duration_ms: u64,
}

/// Analysis coverage or source errors, visible to the developer.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub message: String,
    pub package_id: String,
    pub severity: String,
}

/// An atomic update; unchanged packages are deliberately absent.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisBatch {
    pub root: String,
    pub snapshot: String,
    pub full: bool,
    pub packages: Vec<PackageFacts>,
    pub removed_packages: Vec<String>,
    pub stats: AnalysisStats,
    pub diagnostics: Vec<Diagnostic>,
}

/// Repository summary without shipping its graph to the renderer.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub root: String,
    pub name: String,
    pub snapshot: String,
    pub symbol_count: usize,
    pub relation_count: usize,
    pub stats: AnalysisStats,
    pub diagnostics: Vec<Diagnostic>,
}

/// Canonical symbol fields plus optional containment metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewNode {
    pub id: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub package_id: String,
    pub source: SourceSpan,
    pub signature: String,
    pub documentation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_symbol_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<OperationFacts>,
}

impl From<Symbol> for ViewNode {
    fn from(symbol: Symbol) -> Self {
        Self {
            id: symbol.id,
            name: symbol.name,
            qualified_name: symbol.qualified_name,
            kind: symbol.kind,
            package_id: symbol.package_id,
            source: symbol.source,
            signature: symbol.signature,
            documentation: symbol.documentation,
            parent_id: None,
            related_symbol_id: None,
            details: None,
        }
    }
}

/// Counts for undisclosed relationships, without loading their endpoints.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSummary {
    pub node_id: String,
    pub incoming: usize,
    pub outgoing: usize,
    pub hidden: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(default)]
    pub distinct_symbols: usize,
    #[serde(default)]
    pub source_sites: usize,
    #[serde(default)]
    pub filtered: usize,
    #[serde(default)]
    pub collapsed: usize,
    #[serde(default)]
    pub paginated: usize,
    #[serde(default)]
    pub limited: usize,
    #[serde(default)]
    pub groups: Vec<NeighborGroup>,
    #[serde(default)]
    pub more_groups: usize,
}

/// A bounded source-backed view suitable for any renderer or layout engine.
#[derive(Debug, Serialize, Deserialize)]
pub struct GraphView {
    pub snapshot: String,
    pub focus: String,
    pub nodes: Vec<ViewNode>,
    pub edges: Vec<Relation>,
    pub summaries: Vec<GraphSummary>,
    pub truncated: bool,
    #[serde(default)]
    pub behaviors: Vec<BehaviorSummary>,
}

/// Direction filtering happens before neighbor hydration.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Incoming,
    Outgoing,
    #[default]
    Both,
}

/// Only explicitly expanded nodes disclose another level.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRequest {
    pub focus: String,
    pub expanded: Vec<String>,
    pub internals: Vec<String>,
    pub kinds: Vec<String>,
    pub limit: usize,
    #[serde(default)]
    pub direction: Direction,
    #[serde(default)]
    pub offsets: std::collections::HashMap<String, usize>,
    #[serde(default = "default_neighbor_limit")]
    pub neighbor_limit: usize,
    #[serde(default)]
    pub neighbor_kind: String,
    #[serde(default)]
    pub groups: std::collections::HashMap<String, NeighborFilter>,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub behavior_anchors: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub outcome_offsets: std::collections::HashMap<String, usize>,
}

fn default_neighbor_limit() -> usize {
    8
}

/// Explicit package and relationship disclosure for one adjacency seed.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighborFilter {
    pub package_id: String,
    pub kind: String,
    pub direction: String,
}

/// Counts are source sites and distinct neighboring symbols, never ambiguous edges.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighborGroup {
    pub package_id: String,
    pub kind: String,
    pub direction: String,
    pub sites: usize,
    pub symbols: usize,
    pub visible: usize,
    pub filtered: bool,
}

/// Source-derived operation facts, shared with the Go analyzer and renderer.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationFacts {
    pub role: String,
    pub expression: String,
    pub explanation: String,
    #[serde(default)]
    pub limitation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call: Option<CallBoundary>,
    #[serde(default)]
    pub accesses: Vec<Access>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<Region>,
    #[serde(default)]
    pub join: bool,
}

/// Type-resolved arguments and syntactic result destinations, not value dependence.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallBoundary {
    pub signature: String,
    #[serde(default)]
    pub receiver: String,
    pub dispatch: String,
    pub arguments: Vec<Argument>,
    pub results: Vec<CallResult>,
    pub variadic: bool,
}

/// A supplied parameter position, including variadic arguments and tuple expansion.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Argument {
    pub position: usize,
    pub parameter: String,
    pub r#type: String,
    pub expression: String,
    pub spread: bool,
    #[serde(default)]
    pub variadic: bool,
}

/// The caller destination of one returned position.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CallResult {
    pub position: usize,
    pub r#type: String,
    pub destination: String,
}

/// A shadow-safe local binding or canonical field access.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub expression: String,
    pub source: SourceSpan,
    #[serde(default)]
    pub symbol_id: String,
    #[serde(default)]
    pub mutation: String,
}

/// A collapsed straight-line control region or a hidden continuation boundary.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub first_node_id: String,
    pub node_count: usize,
    pub calls: usize,
    pub operations: usize,
}

/// A bounded return inventory plus explicit disclosure and analysis limits.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorSummary {
    pub symbol_id: String,
    pub entry_id: Option<String>,
    pub total_nodes: usize,
    pub hidden_nodes: usize,
    pub returns: Vec<ViewNode>,
    pub return_count: usize,
    pub return_offset: usize,
    pub incomplete: bool,
}

/// A source excerpt restricted to the active project.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceExcerpt {
    pub file: String,
    pub first_line: u32,
    pub text: String,
}

/// A paged declaration browser for library packages and symbol categories.
#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolPage {
    pub symbols: Vec<Symbol>,
    pub total: usize,
    pub offset: usize,
}

/// Suggested executable entries and bounded package names, without automatic loading.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub entrypoints: Vec<Symbol>,
    pub packages: Vec<String>,
    pub package_count: usize,
}
