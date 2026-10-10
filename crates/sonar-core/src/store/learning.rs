use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::params;

use crate::{
    Behavior, BehaviorNode, BehaviorSummary, Direction, Error, GraphRequest, GraphSummary,
    GraphView, NeighborGroup, OperationFacts, Region, Relation, RelationSite, RelationSites,
    Result, ViewNode,
};

use super::{GraphStore, KINDS, MAX_EDGES, read_count, read_count_at};

const SITE_PAGE: usize = 40;
const OUTCOME_PAGE: usize = 30;
const BEHAVIOR_BUDGET: usize = 36;

impl GraphStore {
    /// Browse canonical local declarations with exact package/category filtering.
    pub fn browse(&self, kind: &str, package: &str, offset: usize) -> Result<crate::SymbolPage> {
        if offset > 1_000_000
            || package.len() > 2048
            || ![
                "",
                "function",
                "method",
                "struct",
                "interface",
                "type",
                "field",
                "variable",
                "constant",
            ]
            .contains(&kind)
        {
            return Err(Error::Invalid("invalid declaration browser request".into()));
        }
        let total = self.connection.query_row("SELECT COUNT(*) FROM symbols WHERE local=1 AND (?1='' OR kind=?1) AND (?2='' OR package_id=?2)", params![kind,package], read_count)?;
        let mut statement = self.connection.prepare("SELECT body FROM symbols WHERE local=1 AND (?1='' OR kind=?1) AND (?2='' OR package_id=?2) ORDER BY name,id LIMIT 40 OFFSET ?3")?;
        let symbols = statement
            .query_map(params![kind, package, offset as i64], |r| {
                r.get::<_, String>(0)
            })?
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect::<Result<Vec<_>>>()?;
        Ok(crate::SymbolPage {
            symbols,
            total,
            offset,
        })
    }

    /// Suggest discovered executable entries while keeping library packages browsable.
    pub fn discovery(&self) -> Result<crate::Discovery> {
        let mut statement = self.connection.prepare("SELECT body FROM symbols WHERE local=1 AND name='main' AND kind='function' ORDER BY package_id LIMIT 20")?;
        let entrypoints = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect::<Result<Vec<_>>>()?;
        let package_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM packages", [], read_count)?;
        let mut statement = self
            .connection
            .prepare("SELECT id FROM packages ORDER BY id LIMIT 200")?;
        let packages = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(crate::Discovery {
            entrypoints,
            packages,
            package_count,
        })
    }

    /// Read another evidence page without sending undisclosed graph endpoints.
    pub fn relation_sites(
        &self,
        source: &str,
        target: &str,
        kind: &str,
        offset: usize,
    ) -> Result<RelationSites> {
        if source.len() > 2048
            || target.len() > 2048
            || !KINDS.contains(&kind)
            || offset > 1_000_000
        {
            return Err(Error::Invalid("invalid evidence page".into()));
        }
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM relations WHERE source=?1 AND target=?2 AND kind=?3",
            params![source, target, kind],
            read_count,
        )?;
        let mut statement = self.connection.prepare(
            "SELECT body FROM relations WHERE source=?1 AND target=?2 AND kind=?3 ORDER BY json_extract(body,'$.evidence.file'),json_extract(body,'$.evidence.line'),json_extract(body,'$.evidence.column'),id LIMIT ?4 OFFSET ?5"
        )?;
        let rows = statement.query_map(
            params![source, target, kind, SITE_PAGE as i64, offset as i64],
            |r| r.get::<_, String>(0),
        )?;
        let mut sites = Vec::new();
        for row in rows {
            let r: Relation = serde_json::from_str(&row?)?;
            sites.push(RelationSite {
                id: r.id,
                expression: r.expression,
                evidence: r.evidence,
                certainty: r.certainty,
            });
        }
        Ok(RelationSites {
            snapshot: self.snapshot()?,
            sites,
            total,
            offset,
        })
    }

    /// Explain every omission with source-site counts, using aggregate queries only.
    pub(super) fn learning_summary(
        &self,
        node: &ViewNode,
        request: &GraphRequest,
        view: &GraphView,
        edge_ids: &HashSet<String>,
        page: Option<(usize, bool, usize)>,
        page_size: usize,
    ) -> Result<GraphSummary> {
        let mut statement = self.connection.prepare(
            "SELECT s.package_id,r.kind,CASE WHEN r.source=?1 AND r.target=?1 AND ?2='incoming' THEN 'incoming' WHEN r.source=?1 THEN 'outgoing' ELSE 'incoming' END,
             COUNT(*),COUNT(DISTINCT s.id),MAX(s.local)
             FROM relations r JOIN symbols s ON s.id=CASE WHEN r.source=?1 THEN r.target ELSE r.source END
             WHERE r.source=?1 OR r.target=?1 GROUP BY 1,2,3 ORDER BY 6 DESC,1,2,3"
        )?;
        let direction = match request.direction {
            Direction::Incoming => "incoming",
            Direction::Outgoing => "outgoing",
            Direction::Both => "both",
        };
        let rows = statement.query_map([node.id.as_str(), direction], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                read_count_at(r, 3)?,
                read_count_at(r, 4)?,
            ))
        })?;
        let mut summary = GraphSummary {
            node_id: node.id.clone(),
            incoming: 0,
            outgoing: 0,
            hidden: 0,
            page_offset: page.map(|p| p.0),
            page_size: page.map(|_| page_size),
            has_more: page.map(|p| p.1),
            distinct_symbols: 0,
            source_sites: 0,
            filtered: 0,
            collapsed: 0,
            paginated: 0,
            limited: 0,
            groups: vec![],
            more_groups: 0,
        };
        for row in rows {
            let (package_id, kind, direction, sites, symbols) = row?;
            let direction_allowed = matches!(request.direction, Direction::Both)
                || (direction == "incoming" && matches!(request.direction, Direction::Incoming))
                || (direction == "outgoing" && matches!(request.direction, Direction::Outgoing));
            let filtered = !direction_allowed || !request.kinds.contains(&kind);
            let visible = view
                .edges
                .iter()
                .filter(|e| {
                    edge_ids.contains(&e.id)
                        && e.kind == kind
                        && if direction == "outgoing" {
                            e.source == node.id
                        } else {
                            e.target == node.id
                        }
                })
                .filter(|e| {
                    view.nodes.iter().any(|n| {
                        n.package_id == package_id
                            && n.id
                                == if direction == "outgoing" {
                                    e.target.as_str()
                                } else {
                                    e.source.as_str()
                                }
                    })
                })
                .map(|e| e.site_count.max(1))
                .sum::<usize>();
            if direction == "incoming" {
                summary.incoming += sites;
            } else {
                summary.outgoing += sites;
            }
            let hidden = sites.saturating_sub(visible);
            summary.hidden += hidden;
            if filtered {
                summary.filtered += hidden;
            } else if page.is_none() {
                summary.collapsed += hidden;
            } else {
                let group_selected = request.groups.get(&node.id).is_none_or(|g| {
                    (g.package_id.is_empty() || g.package_id == package_id)
                        && (g.kind.is_empty() || g.kind == kind)
                        && (g.direction.is_empty() || g.direction == direction)
                });
                if !group_selected {
                    summary.collapsed += hidden;
                } else {
                    summary.paginated += hidden;
                }
            }
            if summary.groups.len() < 40 {
                summary.groups.push(NeighborGroup {
                    package_id,
                    kind,
                    direction,
                    sites,
                    symbols,
                    visible,
                    filtered,
                });
            } else {
                summary.more_groups += 1;
            }
        }
        if let Some((_, _, page_sites)) = page {
            let visible = view
                .edges
                .iter()
                .filter(|e| {
                    edge_ids.contains(&e.id) && (e.source == node.id || e.target == node.id)
                })
                .map(|e| e.site_count.max(1))
                .sum::<usize>();
            summary.limited = page_sites.saturating_sub(visible).min(summary.paginated);
            summary.paginated -= summary.limited;
        }
        let (distinct,incoming,outgoing,total) = self.connection.query_row(
            "SELECT COUNT(DISTINCT CASE WHEN source=?1 THEN target ELSE source END),COALESCE(SUM(target=?1),0),COALESCE(SUM(source=?1),0),COUNT(*) FROM relations WHERE source=?1 OR target=?1",
            [&node.id], |row| Ok((read_count_at(row,0)?,read_count_at(row,1)?,read_count_at(row,2)?,read_count_at(row,3)?))
        )?;
        summary.distinct_symbols = distinct;
        summary.incoming = incoming;
        summary.outgoing = outgoing;
        summary.source_sites = total;
        Ok(summary)
    }

    /// Compress only linear control regions. Hidden continuations are explicit frontier nodes.
    pub(super) fn project_behavior(
        &self,
        parent: &ViewNode,
        behavior: Option<&Behavior>,
        request: &GraphRequest,
        limit: usize,
        view: &mut GraphView,
    ) -> Result<()> {
        let Some(behavior) = behavior else {
            view.behaviors.push(BehaviorSummary {
                symbol_id: parent.id.clone(),
                entry_id: None,
                total_nodes: 0,
                hidden_nodes: 0,
                returns: vec![],
                return_count: 0,
                return_offset: 0,
                incomplete: true,
            });
            return Ok(());
        };
        let mut nodes: HashMap<String, ViewNode> = behavior
            .nodes
            .iter()
            .map(|n| (n.id.clone(), behavior_node(parent, n)))
            .collect();
        let mut outgoing: HashMap<String, Vec<&crate::BehaviorEdge>> = HashMap::new();
        let mut incoming: HashMap<String, usize> = HashMap::new();
        for edge in behavior.edges.iter().filter(|e| e.kind == "control") {
            outgoing.entry(edge.source.clone()).or_default().push(edge);
            *incoming.entry(edge.target.clone()).or_default() += 1;
        }
        for (id, count) in &incoming {
            if *count > 1
                && let Some(details) = nodes.get_mut(id).and_then(|n| n.details.as_mut())
            {
                details.join = true;
            }
        }
        let mut projection: HashMap<String, String> =
            nodes.keys().map(|id| (id.clone(), id.clone())).collect();
        let mut region_members: HashMap<String, Vec<String>> = HashMap::new();
        if behavior.nodes.len() > 24 {
            let mut claimed = HashSet::new();
            let mut ordered: Vec<_> = behavior.nodes.iter().collect();
            ordered.sort_by_key(|n| (n.source.line, n.source.column, n.id.as_str()));
            for start in ordered {
                if claimed.contains(&start.id) || !linear(start) {
                    continue;
                }
                let mut chain = vec![start.id.clone()];
                let mut current = start.id.as_str();
                while chain.len() < 8 {
                    let Some(edges) = outgoing.get(current).filter(|edges| edges.len() == 1) else {
                        break;
                    };
                    let next = edges[0].target.as_str();
                    let Some(next_node) = behavior.nodes.iter().find(|n| n.id == next) else {
                        break;
                    };
                    if !linear(next_node)
                        || incoming.get(next).copied().unwrap_or(0) != 1
                        || claimed.contains(next)
                        || chain.iter().any(|n| n == next)
                    {
                        break;
                    }
                    chain.push(next.to_owned());
                    current = next;
                }
                if chain.len() < 3 {
                    continue;
                }
                let region_id = format!("{}/region", start.id);
                let calls = chain.iter().filter(|id| nodes[*id].kind == "call").count();
                let mut node = nodes[&start.id].clone();
                node.id = region_id.clone();
                node.kind = "region".into();
                node.name = format!("{} operations · {calls} calls", chain.len());
                node.related_symbol_id = None;
                node.details = Some(OperationFacts { role: "region".into(), expression: start.label.clone(),
                    explanation: "A straight-line source region. Reveal its operations to inspect or follow them.".into(),
                    region: Some(Region { first_node_id: start.id.clone(), node_count: chain.len(), calls, operations: chain.len()-calls }),
                    ..Default::default() });
                let expanded = if let Some(anchor) = request.behavior_anchors.get(&parent.id) {
                    chain.contains(anchor)
                } else {
                    request
                        .regions
                        .iter()
                        .rev()
                        .find(|id| id.starts_with(&format!("{}/behavior/", parent.id)))
                        .is_some_and(|id| id == &region_id)
                };
                for id in &chain {
                    claimed.insert(id.clone());
                    if !expanded {
                        projection.insert(id.clone(), region_id.clone());
                    }
                }
                region_members.insert(region_id.clone(), chain);
                if !expanded {
                    nodes.insert(region_id, node);
                }
            }
        }
        let entry = behavior
            .nodes
            .iter()
            .find(|n| n.kind == "entry")
            .map(|n| n.id.clone());
        let anchor = request
            .behavior_anchors
            .get(&parent.id)
            .filter(|id| nodes.contains_key(*id));
        let mut queue = VecDeque::new();
        if let Some(anchor) = anchor {
            queue.push_back(
                projection
                    .get(anchor)
                    .cloned()
                    .unwrap_or_else(|| anchor.clone()),
            );
        }
        if let Some(entry) = &entry {
            queue.push_back(entry.clone());
        }
        let mut edges = Vec::new();
        let mut seen_edges = HashSet::new();
        for edge in &behavior.edges {
            let source = projection[&edge.source].clone();
            let target = projection[&edge.target].clone();
            if source == target {
                continue;
            }
            if !seen_edges.insert((
                source.clone(),
                target.clone(),
                edge.kind.clone(),
                edge.label.clone(),
            )) {
                continue;
            }
            let evidence = nodes[&edge.source].source.clone();
            edges.push(Relation {
                id: edge.id.clone(),
                source,
                target,
                kind: edge.kind.clone(),
                label: edge.label.clone(),
                certainty: "resolved".into(),
                evidence,
                expression: nodes[&edge.source].name.clone(),
                sites: vec![],
                site_count: 1,
                loop_back: false,
                hidden_target_id: None,
            });
        }
        if let (Some(entry), Some(anchor)) = (&entry, anchor) {
            let target = projection.get(anchor).unwrap_or(anchor);
            let mut search = VecDeque::from([entry.clone()]);
            let mut previous = HashMap::from([(entry.clone(), String::new())]);
            while let Some(id) = search.pop_front() {
                if id == *target {
                    break;
                }
                for edge in edges
                    .iter()
                    .filter(|e| e.kind == "control" && e.source == id)
                {
                    if !previous.contains_key(&edge.target) {
                        previous.insert(edge.target.clone(), id.clone());
                        search.push_back(edge.target.clone());
                    }
                }
            }
            let mut route = vec![target.clone()];
            while let Some(id) = route
                .last()
                .and_then(|id| previous.get(id))
                .filter(|id| !id.is_empty())
            {
                route.push(id.clone());
            }
            route.reverse();
            queue = std::iter::once(target.clone())
                .chain(route)
                .chain(queue)
                .collect();
        }
        let capacity = limit.saturating_sub(view.nodes.len()).min(BEHAVIOR_BUDGET);
        let mut shown = HashSet::new();
        let budget = capacity.saturating_sub(1);
        while let Some(id) = queue.pop_front() {
            if shown.len() >= budget {
                break;
            }
            if !shown.insert(id.clone()) {
                continue;
            }
            for edge in edges
                .iter()
                .filter(|e| e.kind == "control" && e.source == id)
            {
                queue.push_back(edge.target.clone());
            }
        }
        // Never advertise a partial entry-to-return graph as a completed execution.
        let visible_original = behavior
            .nodes
            .iter()
            .filter(|n| shown.contains(&projection[&n.id]) && projection[&n.id] == n.id)
            .count();
        let hidden_nodes = behavior.nodes.len().saturating_sub(visible_original);
        let frontier: Vec<_> = edges
            .iter()
            .filter(|e| shown.contains(&e.source) && !shown.contains(&e.target))
            .collect();
        let boundary_id = format!("{}/hidden-continuation", parent.id);
        let has_boundary = !frontier.is_empty() && capacity > 0;
        if has_boundary {
            let next = frontier[0].target.clone();
            let first = region_members
                .get(&next)
                .and_then(|m| m.first())
                .cloned()
                .unwrap_or(next.clone());
            let mut boundary = nodes[&next].clone();
            boundary.id = boundary_id.clone();
            boundary.name = format!("{} hidden continuations", frontier.len());
            boundary.kind = "boundary".into();
            boundary.related_symbol_id = None;
            boundary.details = Some(OperationFacts { role: "boundary".into(), expression: String::new(),
                explanation: "The visible budget ends here. Reveal a continuation; analysis has not reached an exit on this path.".into(),
                limitation: "Some regions are outside this view.".into(),
                region: Some(Region { first_node_id: first, node_count: hidden_nodes, calls: 0, operations: 0 }), ..Default::default() });
            view.nodes.push(boundary);
            view.truncated = true;
        }
        // Keep entry first and stable source ordering for keyboard navigation.
        let mut shown_nodes: Vec<_> = shown
            .iter()
            .filter_map(|id| nodes.get(id).cloned())
            .collect();
        shown_nodes.sort_by_key(|n| {
            (
                n.kind != "entry",
                n.source.line,
                n.source.column,
                n.id.clone(),
            )
        });
        view.nodes.extend(shown_nodes);
        for mut edge in edges {
            if !shown.contains(&edge.source) {
                continue;
            }
            if !shown.contains(&edge.target) {
                if !has_boundary {
                    continue;
                }
                let next = edge.target.clone();
                edge.target = boundary_id.clone();
                edge.label = format!("{} · hidden: {}", edge.label, nodes[&next].name);
                // The exact hidden destination remains inspectable without hydrating its body.
                edge.hidden_target_id = Some(
                    region_members
                        .get(&next)
                        .and_then(|members| members.first())
                        .cloned()
                        .unwrap_or(next),
                );
            }
            edge.loop_back = nodes.get(&edge.target).is_some_and(|n| n.kind == "loop")
                && nodes
                    .get(&edge.source)
                    .is_some_and(|n| n.source.line >= nodes[&edge.target].source.line);
            if view.edges.len() >= MAX_EDGES {
                view.truncated = true;
                break;
            }
            view.edges.push(edge);
        }
        let mut returns: Vec<_> = behavior
            .nodes
            .iter()
            .filter(|n| n.kind == "return")
            .collect();
        returns.sort_by_key(|n| (n.source.line, n.source.column));
        let return_count = returns.len();
        let return_offset = request
            .outcome_offsets
            .get(&parent.id)
            .copied()
            .unwrap_or(0);
        let returns = returns
            .into_iter()
            .skip(return_offset)
            .take(OUTCOME_PAGE)
            .map(|n| behavior_node(parent, n))
            .collect();
        view.behaviors.push(BehaviorSummary {
            symbol_id: parent.id.clone(),
            entry_id: entry,
            total_nodes: behavior.nodes.len(),
            hidden_nodes,
            returns,
            return_count,
            return_offset,
            incomplete: behavior
                .nodes
                .iter()
                .any(|n| n.details.as_ref().is_some_and(|d| d.role == "unsupported")),
        });
        Ok(())
    }
}

/// Retain the expression and source facts separately from declaration identity.
fn behavior_node(parent: &ViewNode, node: &BehaviorNode) -> ViewNode {
    ViewNode {
        id: node.id.clone(),
        name: node.label.clone(),
        qualified_name: parent.qualified_name.clone(),
        kind: node.kind.clone(),
        package_id: parent.package_id.clone(),
        source: node.source.clone(),
        signature: String::new(),
        documentation: node
            .details
            .as_ref()
            .map(|d| d.explanation.clone())
            .unwrap_or_else(|| "Static source structure; runtime feasibility is unknown.".into()),
        parent_id: Some(parent.id.clone()),
        related_symbol_id: node.related_symbol_id.clone(),
        details: node.details.clone(),
    }
}

/// Calls and ordinary operations can share a summary only along one control continuation.
fn linear(node: &BehaviorNode) -> bool {
    ["call", "operation"].contains(&node.kind.as_str())
        && node
            .details
            .as_ref()
            .is_none_or(|d| d.limitation.is_empty())
}
