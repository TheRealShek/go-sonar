//! Offline graph indexing and bounded exploration for Go Sonar.

mod analyzer;
mod backend;
mod model;
mod source;
mod store;

pub use analyzer::AnalyzerClient;
pub use backend::Backend;
pub use model::*;
pub use source::source_excerpt;
pub use store::GraphStore;

/// Failures at the analysis, persistence, and exploration boundaries.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("index: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid analyzer data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("analyzer: {0}")]
    Analyzer(String),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("symbol not found: {0}")]
    NotFound(String),
    #[error("open a project first")]
    NoProject,
    #[error("analysis is already running; wait for it to finish")]
    Busy,
    #[error("internal state lock failed")]
    State,
}

/// A result carrying a Go Sonar analysis, index, or exploration error.
pub type Result<T> = std::result::Result<T, Error>;
