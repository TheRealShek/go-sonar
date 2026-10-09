use std::collections::{HashSet, VecDeque};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    AnalysisBatch, Behavior, Direction, Error, GraphRequest, GraphSummary, GraphView,
    ProjectSummary, Relation, Result, Symbol, ViewNode,
};

const MAX_NODES: usize = 300;
const MAX_EDGES: usize = 1200;
const PAGE_SIZE: usize = 40;
const KINDS: &[&str] = &[
    "calls",
    "references",
    "reads",
    "writes",
    "constructs",
    "implements",
    "uses_type",
];

/// SQLite owns the canonical graph; only bounded query results live in Rust memory.
pub struct GraphStore {
    connection: Connection,
    root: String,
}

impl GraphStore {
    /// Open a project-specific cache. Its source snapshot is replaced transactionally.
    pub fn open(path: &Path, root: &Path) -> Result<Self> {
        Self::initialize(Connection::open(path)?, root)
    }

    /// Create an ephemeral index for tests and headless measurements.
    pub fn memory(root: &Path) -> Result<Self> {
        Self::initialize(Connection::open_in_memory()?, root)
    }

    fn initialize(connection: Connection, root: &Path) -> Result<Self> {
        connection.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192; PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS packages(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS sources(package_id TEXT NOT NULL, path TEXT NOT NULL,
               fingerprint TEXT NOT NULL, PRIMARY KEY(package_id,path));
             CREATE INDEX IF NOT EXISTS sources_path ON sources(path);
             CREATE TABLE IF NOT EXISTS symbols(id TEXT PRIMARY KEY, package_id TEXT NOT NULL,
               name TEXT NOT NULL, qualified_name TEXT NOT NULL, kind TEXT NOT NULL,
               local INTEGER NOT NULL, body TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS symbol_owners(package_id TEXT NOT NULL,
               symbol_id TEXT NOT NULL, PRIMARY KEY(package_id,symbol_id));
             CREATE INDEX IF NOT EXISTS owners_symbol ON symbol_owners(symbol_id);
             CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY, source TEXT NOT NULL,
               target TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS relations_source ON relations(source,kind,id);
             CREATE INDEX IF NOT EXISTS relations_target ON relations(target,kind,id);
             CREATE TABLE IF NOT EXISTS relation_owners(package_id TEXT NOT NULL,
               relation_id TEXT NOT NULL, PRIMARY KEY(package_id,relation_id));
             CREATE INDEX IF NOT EXISTS owners_relation ON relation_owners(relation_id);
             CREATE TABLE IF NOT EXISTS behaviors(symbol_id TEXT PRIMARY KEY,
               package_id TEXT NOT NULL, body TEXT NOT NULL);",
        )?;

        let root = root.to_string_lossy().into_owned();
        let existing: Option<String> = connection
            .query_row("SELECT value FROM metadata WHERE key='root'", [], |r| {
                r.get(0)
            })
            .optional()?;
        if existing.as_ref().is_some_and(|r| r != &root) {
            return Err(Error::Invalid("cache belongs to another project".into()));
        }

        connection.execute("INSERT OR IGNORE INTO metadata VALUES ('root',?1)", [&root])?;

        Ok(Self { connection, root })
    }

    /// Replace affected packages atomically and preserve shared external declarations.
    pub fn apply(&mut self, batch: &AnalysisBatch) -> Result<ProjectSummary> {
        if batch.root != self.root || batch.snapshot.is_empty() {
            return Err(Error::Invalid("analyzer root or snapshot mismatch".into()));
        }
        validate_batch(batch)?;

        let tx = self.connection.transaction()?;
        if batch.full {
            tx.execute_batch(
                "DELETE FROM symbol_owners;
                 DELETE FROM relation_owners;
                 DELETE FROM behaviors;
                 DELETE FROM sources;
                 DELETE FROM packages;
                 DELETE FROM symbols;
                 DELETE FROM relations;",
            )?;
        }

        for id in batch
            .removed_packages
            .iter()
            .map(String::as_str)
            .chain(batch.packages.iter().map(|p| p.id.as_str()))
        {
            tx.execute("DELETE FROM symbol_owners WHERE package_id=?1", [id])?;
            tx.execute("DELETE FROM relation_owners WHERE package_id=?1", [id])?;
            tx.execute("DELETE FROM behaviors WHERE package_id=?1", [id])?;
            tx.execute("DELETE FROM packages WHERE id=?1", [id])?;
            tx.execute("DELETE FROM sources WHERE package_id=?1", [id])?;
        }

        for package in &batch.packages {
            for (path, fingerprint) in &package.source_fingerprints {
                tx.execute(
                    "INSERT INTO sources VALUES (?1,?2,?3)",
                    params![package.id, path, fingerprint],
                )?;
            }

            tx.execute(
                "INSERT INTO packages VALUES (?1,?2)",
                params![package.id, package.fingerprint],
            )?;

            for symbol in &package.symbols {
                let local = Path::new(&symbol.source.file).starts_with(&self.root);
                // The declaring package supplies canonical docs and source. Consumers may
                // share a declaration, but must not overwrite it with export-data stubs.
                tx.execute(
                    "INSERT INTO symbols VALUES (?1,?2,?3,?4,?5,?6,?7)
                    ON CONFLICT(id) DO UPDATE SET package_id=excluded.package_id,
                      name=excluded.name, qualified_name=excluded.qualified_name,
                      kind=excluded.kind, local=excluded.local, body=excluded.body
                    WHERE excluded.package_id=?8 OR symbols.local=0",
                    params![
                        symbol.id,
                        symbol.package_id,
                        symbol.name,
                        symbol.qualified_name,
                        symbol.kind,
                        local,
                        serde_json::to_string(symbol)?,
                        package.id
                    ],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO symbol_owners VALUES (?1,?2)",
                    params![package.id, symbol.id],
                )?;
            }

            for relation in &package.edges {
                tx.execute(
                    "INSERT INTO relations VALUES (?1,?2,?3,?4,?5)
                    ON CONFLICT(id) DO UPDATE SET source=excluded.source,target=excluded.target,
                      kind=excluded.kind,body=excluded.body",
                    params![
                        relation.id,
                        relation.source,
                        relation.target,
                        relation.kind,
                        serde_json::to_string(relation)?
                    ],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO relation_owners VALUES (?1,?2)",
                    params![package.id, relation.id],
                )?;
            }

            for behavior in &package.behaviors {
                tx.execute(
                    "INSERT OR REPLACE INTO behaviors VALUES (?1,?2,?3)",
                    params![
                        behavior.symbol_id,
                        package.id,
                        serde_json::to_string(behavior)?
                    ],
                )?;
            }
        }

        tx.execute(
            "DELETE FROM symbols WHERE NOT EXISTS
            (SELECT 1 FROM symbol_owners WHERE symbol_id=symbols.id)",
            [],
        )?;
        tx.execute(
            "DELETE FROM relations WHERE NOT EXISTS
            (SELECT 1 FROM relation_owners WHERE relation_id=relations.id)",
            [],
        )?;

        let dangling: usize = tx.query_row(
            "SELECT COUNT(*) FROM relations r
            WHERE NOT EXISTS(SELECT 1 FROM symbols WHERE id=r.source)
               OR NOT EXISTS(SELECT 1 FROM symbols WHERE id=r.target)",
            [],
            read_count,
        )?;
        if dangling != 0 {
            return Err(Error::Invalid(format!(
                "analyzer supplied {dangling} dangling relationships"
            )));
        }

        tx.execute(
            "INSERT OR REPLACE INTO metadata VALUES ('snapshot',?1)",
            [&batch.snapshot],
        )?;
        tx.commit()?;

        let name = Path::new(&self.root).file_name().map_or_else(
            || self.root.clone(),
            |name| name.to_string_lossy().into_owned(),
        );
        let symbol_count = self.connection.query_row(
            "SELECT COUNT(*) FROM symbols WHERE local=1",
            [],
            read_count,
        )?;
        let relation_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM relations", [], read_count)?;

        Ok(ProjectSummary {
            root: self.root.clone(),
            name,
            snapshot: batch.snapshot.clone(),
            symbol_count,
            relation_count,
            stats: batch.stats.clone(),
            diagnostics: batch.diagnostics.clone(),
        })
    }

    /// Search project declarations with a finite result limit and literal substring matching.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Symbol>> {
        if query.len() > 512 {
            return Err(Error::Invalid("search exceeds 512 bytes".into()));
        }

        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");

        let mut statement = self.connection.prepare(
            "SELECT body FROM symbols WHERE local=1
            AND (name LIKE ?1 ESCAPE '\\' OR qualified_name LIKE ?1 ESCAPE '\\')
            ORDER BY CASE WHEN name=?2 THEN 0 ELSE 1 END, name, id LIMIT ?3",
        )?;
        let rows = statement
            .query_map(params![pattern, query, limit.clamp(1, 100) as i64], |r| {
                r.get::<_, String>(0)
            })?;

        rows.map(|row| {
            let body = row?;
            Ok(serde_json::from_str(&body)?)
        })
        .collect()
    }

    fn symbol(&self, id: &str) -> Result<Symbol> {
        let body: Option<String> = self
            .connection
            .query_row("SELECT body FROM symbols WHERE id=?1", [id], |r| r.get(0))
            .optional()?;
        let body = body.ok_or_else(|| Error::NotFound(id.into()))?;

        serde_json::from_str(&body).map_err(Into::into)
    }

    /// Expected source bytes for the published analysis, never the current disk state.
    pub(crate) fn source_fingerprint(&self, path: &str) -> Result<String> {
        self.connection
            .query_row(
                "SELECT fingerprint FROM sources WHERE path=?1 LIMIT 1",
                [path],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| {
                Error::Invalid(
                    "source is not in the published analysis; refresh the project".into(),
                )
            })
    }

    fn snapshot(&self) -> Result<String> {
        self.connection
            .query_row("SELECT value FROM metadata WHERE key='snapshot'", [], |r| {
                r.get(0)
            })
            .map_err(Into::into)
    }

    /// Query one adjacency window without hydrating undisclosed symbols.
    fn adjacent(
        &self,
        id: &str,
        direction: Direction,
        kinds: &[String],
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Relation>> {
        let condition = match direction {
            Direction::Incoming => "target=?1",
            Direction::Outgoing => "source=?1",
            Direction::Both => "(source=?1 OR target=?1)",
        };

        // Kinds were validated against fixed identifiers, never arbitrary SQL input.
        let filters = kinds
            .iter()
            .map(|k| format!("'{k}'"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT body FROM relations WHERE {condition} AND kind IN ({filters})
            ORDER BY CASE kind WHEN 'calls' THEN 0 WHEN 'writes' THEN 1 WHEN 'reads' THEN 2
                WHEN 'constructs' THEN 3 WHEN 'uses_type' THEN 4 ELSE 5 END,id LIMIT ?2 OFFSET ?3"
        );
        let mut stmt = self.connection.prepare(&sql)?;
        let rows = stmt.query_map(params![id, limit as i64, offset as i64], |r| {
            r.get::<_, String>(0)
        })?;

        rows.map(|row| {
            let body = row?;
            Ok(serde_json::from_str(&body)?)
        })
        .collect()
    }

    /// Disclose focus neighbors and only the further levels explicitly requested.
    pub fn graph(&self, request: &GraphRequest) -> Result<GraphView> {
        if request.expanded.len() > 64
            || request.internals.len() > 16
            || request.focus.len() > 2048
            || request.offsets.len() > 65
            || request.offsets.values().any(|offset| *offset > 1_000_000)
        {
            return Err(Error::Invalid(
                "expansion request exceeds its bounds".into(),
            ));
        }

        let kinds = &request.kinds;
        if kinds.len() > KINDS.len() || kinds.iter().any(|k| !KINDS.contains(&k.as_str())) {
            return Err(Error::Invalid("unknown relationship kind".into()));
        }

        let limit = request.limit.clamp(1, MAX_NODES);
        let mut view = GraphView {
            snapshot: self.snapshot()?,
            focus: request.focus.clone(),
            nodes: vec![self.symbol(&request.focus)?.into()],
            edges: vec![],
            summaries: vec![],
            truncated: false,
        };
        let expanded: HashSet<_> = request.expanded.iter().map(String::as_str).collect();

        // Explicitly opened focus behavior gets space before external fan-out.
        self.add_internals(request, limit, &mut view)?;
        let mut visited = HashSet::from([request.focus.clone()]);
        let mut edge_ids = HashSet::new();
        let mut queue = VecDeque::from([request.focus.clone()]);
        let mut processed = HashSet::new();
        let mut pages = std::collections::HashMap::new();

        while let Some(id) = queue.pop_front() {
            if !processed.insert(id.clone()) {
                continue;
            }

            let offset = request.offsets.get(&id).copied().unwrap_or(0);
            let adjacent = self.adjacent(&id, request.direction, kinds, PAGE_SIZE + 1, offset)?;
            pages.insert(id.clone(), (offset, adjacent.len() > PAGE_SIZE));

            for edge in adjacent.into_iter().take(PAGE_SIZE) {
                if edge_ids.contains(&edge.id) {
                    continue;
                }
                if view.edges.len() == MAX_EDGES {
                    view.truncated = true;
                    break;
                }

                let other = if edge.source == id {
                    &edge.target
                } else {
                    &edge.source
                };

                if !visited.contains(other) {
                    if view.nodes.len() == limit {
                        view.truncated = true;
                        continue;
                    }
                    view.nodes.push(self.symbol(other)?.into());
                    visited.insert(other.clone());
                }

                if expanded.contains(other.as_str()) {
                    queue.push_back(other.clone());
                }

                edge_ids.insert(edge.id.clone());
                view.edges.push(edge);
            }
        }

        self.add_internals(request, limit, &mut view)?;
        let visible_ids: HashSet<_> = view.nodes.iter().map(|n| n.id.as_str()).collect();

        for node in view.nodes.iter().filter(|n| n.parent_id.is_some()) {
            let Some(target) = node.related_symbol_id.as_deref() else {
                continue;
            };

            if !visible_ids.contains(target) {
                continue;
            }
            let Some(parent) = node.parent_id.as_deref() else {
                continue;
            };
            let Some(relation) = view
                .edges
                .iter()
                .find(|e| e.source == parent && e.target == target && e.kind == "calls")
            else {
                continue;
            };
            if view.edges.len() == MAX_EDGES {
                view.truncated = true;
                break;
            }

            let mut relation = relation.clone();
            relation.id = format!("{}/call-target", node.id);
            relation.source = node.id.clone();
            relation.label = "call target".into();
            relation.evidence = node.source.clone();
            view.edges.push(relation);
        }

        for node in view.nodes.iter().filter(|n| n.parent_id.is_none()) {
            let incoming = self.degree(&node.id, "target")?;
            let outgoing = self.degree(&node.id, "source")?;
            let total: usize = self.connection.query_row(
                "SELECT COUNT(*) FROM relations
                WHERE source=?1 OR target=?1",
                [&node.id],
                read_count,
            )?;
            let visible = view
                .edges
                .iter()
                .filter(|e| e.source == node.id || e.target == node.id)
                .filter(|e| edge_ids.contains(&e.id))
                .count();

            view.summaries.push(GraphSummary {
                node_id: node.id.clone(),
                incoming,
                outgoing,
                hidden: total.saturating_sub(visible),
                page_offset: pages.get(&node.id).map(|p| p.0),
                page_size: pages.get(&node.id).map(|_| PAGE_SIZE),
                has_more: pages.get(&node.id).map(|p| p.1),
            });
        }

        Ok(view)
    }

    fn degree(&self, id: &str, column: &str) -> Result<usize> {
        self.connection
            .query_row(
                &format!("SELECT COUNT(*) FROM relations WHERE {column}=?1"),
                [id],
                read_count,
            )
            .map_err(Into::into)
    }

    fn add_internals(
        &self,
        request: &GraphRequest,
        limit: usize,
        view: &mut GraphView,
    ) -> Result<()> {
        let mut opened: HashSet<_> = view
            .nodes
            .iter()
            .filter_map(|n| n.parent_id.clone())
            .collect();

        for id in &request.internals {
            if !opened.insert(id.clone()) {
                continue;
            }

            let Some(parent) = view
                .nodes
                .iter()
                .find(|n| n.id == *id && n.parent_id.is_none())
            else {
                continue;
            };
            let package_id = parent.package_id.clone();

            let body: Option<String> = self
                .connection
                .query_row("SELECT body FROM behaviors WHERE symbol_id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()?;
            let Some(body) = body else {
                continue;
            };

            let behavior: Behavior = serde_json::from_str(&body)?;
            let mut added = std::collections::HashMap::new();

            for node in behavior.nodes {
                if view.nodes.len() == limit {
                    view.truncated = true;
                    break;
                }

                added.insert(node.id.clone(), node.source.clone());
                view.nodes.push(ViewNode {
                    id: node.id,
                    name: node.label.clone(),
                    qualified_name: node.label,
                    kind: node.kind,
                    package_id: package_id.clone(),
                    source: node.source,
                    signature: String::new(),
                    documentation:
                        "Static source structure. This does not prove runtime path feasibility."
                            .into(),
                    parent_id: Some(id.clone()),
                    related_symbol_id: node.related_symbol_id,
                });
            }

            for edge in behavior.edges {
                if !added.contains_key(&edge.target) {
                    continue;
                }
                let Some(evidence) = added.get(&edge.source) else {
                    continue;
                };
                if view.edges.len() == MAX_EDGES {
                    view.truncated = true;
                    break;
                }

                view.edges.push(Relation {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    kind: edge.kind,
                    label: edge.label,
                    certainty: "resolved".into(),
                    evidence: evidence.clone(),
                });
            }
        }

        Ok(())
    }

    /// Conservative incoming candidates for a hypothetical selected change.
    pub fn impact(&self, symbol_id: &str, category: &str, limit: usize) -> Result<GraphView> {
        let kinds: &[&str] = match category {
            "signature" => &[
                "calls",
                "references",
                "uses_type",
                "constructs",
                "implements",
            ],
            "field" => &["reads", "writes", "uses_type", "constructs", "references"],
            "behavior" => &["calls", "reads", "references"],
            _ => return Err(Error::Invalid("unknown change category".into())),
        };

        let mut view = self.graph(&GraphRequest {
            focus: symbol_id.into(),
            expanded: vec![],
            internals: vec![],
            kinds: kinds.iter().map(|k| (*k).into()).collect(),
            limit,
            direction: Direction::Incoming,
            offsets: Default::default(),
        })?;

        for edge in &mut view.edges {
            edge.label = format!(
                "Potential {category} impact: {}. Check this source use; breakage is not proven.",
                edge.label
            );
            edge.certainty = "possible".into();
        }

        Ok(view)
    }
}

fn read_count(row: &rusqlite::Row<'_>) -> rusqlite::Result<usize> {
    usize::try_from(row.get::<_, i64>(0)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

/// Reject malformed source facts before they can become a persistent snapshot.
fn validate_batch(batch: &AnalysisBatch) -> Result<()> {
    for package in &batch.packages {
        let symbols: HashSet<_> = package.symbols.iter().map(|s| s.id.as_str()).collect();
        if symbols.len() != package.symbols.len() || symbols.contains("") {
            return Err(Error::Invalid("duplicate or empty symbol identity".into()));
        }

        for relation in &package.edges {
            if !KINDS.contains(&relation.kind.as_str())
                || !["resolved", "possible"].contains(&relation.certainty.as_str())
            {
                return Err(Error::Invalid(
                    "invalid relationship kind or certainty".into(),
                ));
            }
        }

        for behavior in &package.behaviors {
            if !symbols.contains(behavior.symbol_id.as_str()) {
                return Err(Error::Invalid("behavior has no declaring symbol".into()));
            }

            let nodes: HashSet<_> = behavior.nodes.iter().map(|n| n.id.as_str()).collect();
            if nodes.len() != behavior.nodes.len() || nodes.iter().any(|id| symbols.contains(id)) {
                return Err(Error::Invalid("duplicate behavior identity".into()));
            }

            let edges: HashSet<_> = behavior.edges.iter().map(|e| e.id.as_str()).collect();
            if edges.len() != behavior.edges.len()
                || behavior.edges.iter().any(|e| {
                    !nodes.contains(e.source.as_str())
                        || !nodes.contains(e.target.as_str())
                        || !["control", "data"].contains(&e.kind.as_str())
                })
            {
                return Err(Error::Invalid("invalid internal graph boundary".into()));
            }
        }
    }

    Ok(())
}
