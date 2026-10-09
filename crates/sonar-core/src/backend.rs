use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};

use crate::{
    AnalyzerClient, Error, GraphRequest, GraphStore, GraphView, ProjectSummary, Result,
    SourceExcerpt, SourceSpan, Symbol,
};

/// Desktop state with serialized analysis and short-lived index locks.
pub struct Backend {
    executable: PathBuf,
    cache_dir: PathBuf,
    analyzer: Mutex<Option<AnalyzerClient>>,
    store: Mutex<Option<GraphStore>>,
    root: Mutex<Option<PathBuf>>,
    analyzing: AtomicBool,
}

struct AnalysisGuard<'a>(&'a AtomicBool);
impl Drop for AnalysisGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl Backend {
    /// Create dormant state. Analysis begins only when the user opens a project.
    pub fn new(executable: PathBuf, cache_dir: PathBuf) -> Self {
        Self {
            executable,
            cache_dir,
            analyzer: Mutex::new(None),
            store: Mutex::new(None),
            root: Mutex::new(None),
            analyzing: AtomicBool::new(false),
        }
    }

    /// Analyze a canonical project root and publish its index only after a successful transaction.
    pub fn open(&self, root: &Path) -> Result<ProjectSummary> {
        if self
            .analyzing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(Error::Busy);
        }
        let _guard = AnalysisGuard(&self.analyzing);
        let root = root.canonicalize()?;
        if !root.is_dir() || !root.join("go.mod").is_file() {
            return Err(Error::Invalid(
                "choose a directory containing go.mod".into(),
            ));
        }
        let mut analyzer = self.analyzer.lock().map_err(|_| Error::State)?;
        if analyzer.is_none() {
            *analyzer = Some(AnalyzerClient::start(&self.executable)?);
        }
        let batch = match analyzer.as_mut().ok_or(Error::State)?.analyze(&root) {
            Ok(batch) => batch,
            Err(error) => {
                *analyzer = None;
                return Err(error);
            }
        };
        // Serialize database publication with graph reads. Different SQLite
        // connections must not let a multi-query view straddle this commit.
        let mut store = self.store.lock().map_err(|_| Error::State)?;
        let prepared = (|| {
            fs::create_dir_all(&self.cache_dir)?;
            let key = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
            let mut index =
                GraphStore::open(&self.cache_dir.join(format!("v1-{key}.sqlite")), &root)?;
            let summary = index.apply(&batch)?;
            Ok::<_, Error>((index, summary))
        })();
        let (index, summary) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                // The helper already advanced its fingerprint cache. Restart it so a
                // retry resends facts that were not successfully persisted.
                *analyzer = None;
                return Err(error);
            }
        };
        // Store and root share one publication order, matching source queries below.
        let mut active_root = self.root.lock().map_err(|_| Error::State)?;
        *store = Some(index);
        *active_root = Some(root);
        Ok(summary)
    }

    /// Refresh source fingerprints; unchanged packages produce no replacement facts.
    pub fn refresh(&self) -> Result<ProjectSummary> {
        let root = self
            .root
            .lock()
            .map_err(|_| Error::State)?
            .clone()
            .ok_or(Error::NoProject)?;
        self.open(&root)
    }

    /// Search only the active project's source declarations.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Symbol>> {
        self.store
            .lock()
            .map_err(|_| Error::State)?
            .as_ref()
            .ok_or(Error::NoProject)?
            .search(query, limit)
    }

    /// Return a bounded graph, without holding a lock during Go analysis.
    pub fn graph(&self, request: &GraphRequest) -> Result<GraphView> {
        self.store
            .lock()
            .map_err(|_| Error::State)?
            .as_ref()
            .ok_or(Error::NoProject)?
            .graph(request)
    }

    /// Return conservative candidate effects of a selected hypothetical change.
    pub fn impact(&self, symbol_id: &str, category: &str, limit: usize) -> Result<GraphView> {
        self.store
            .lock()
            .map_err(|_| Error::State)?
            .as_ref()
            .ok_or(Error::NoProject)?
            .impact(symbol_id, category, limit)
    }

    /// Read source under the same project publication lock as graph queries.
    pub fn source(&self, source: &SourceSpan) -> Result<SourceExcerpt> {
        if source.file.is_empty() || source.line == 0 {
            return Err(Error::Invalid(
                "declaration source is unavailable in this module".into(),
            ));
        }
        let store = self.store.lock().map_err(|_| Error::State)?;
        let fingerprint = store
            .as_ref()
            .ok_or(Error::NoProject)?
            .source_fingerprint(&source.file)?;
        let root = self.root.lock().map_err(|_| Error::State)?;
        crate::source::verified_source_excerpt(
            root.as_deref().ok_or(Error::NoProject)?,
            source,
            &fingerprint,
        )
    }
}
