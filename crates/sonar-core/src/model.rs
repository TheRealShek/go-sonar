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
}

impl From<Symbol> for ViewNode {
    fn from(s: Symbol) -> Self {
        Self {
            id: s.id,
            name: s.name,
            qualified_name: s.qualified_name,
            kind: s.kind,
            package_id: s.package_id,
            source: s.source,
            signature: s.signature,
            documentation: s.documentation,
            parent_id: None,
            related_symbol_id: None,
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
#[derive(Debug, Deserialize, Serialize)]
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
}

/// A source excerpt restricted to the active project.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceExcerpt {
    pub file: String,
    pub first_line: u32,
    pub text: String,
}
