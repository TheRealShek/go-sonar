use rusqlite::{OptionalExtension, params};

use crate::{
    Behavior, BehaviorNode, Error, EvidenceItem, EvidenceResolution, EvidenceTarget, Relation,
    Result, SourceSpan, ViewNode,
};

use super::GraphStore;

impl GraphStore {
    /// Resolve a saved occurrence by meaning, without trusting pre-refresh coordinates or IDs.
    pub fn resolve_source(
        &self,
        target: &EvidenceTarget,
        snapshot: &str,
    ) -> Result<EvidenceResolution> {
        if self.snapshot()? != snapshot {
            return Err(Error::Invalid(
                "analysis changed while restoring source; refresh again".into(),
            ));
        }
        let mut matches: Vec<(EvidenceItem, SourceSpan)> = Vec::with_capacity(2);
        match target {
            EvidenceTarget::Declaration { symbol_id } => {
                validate_text(symbol_id, 2048)?;
                match self.symbol(symbol_id) {
                    Ok(symbol) => {
                        let span = symbol.source.clone();
                        matches.push((EvidenceItem::Node(Box::new(symbol.into())), span));
                    }
                    Err(Error::NotFound(_)) => {}
                    Err(error) => return Err(error),
                }
            }
            EvidenceTarget::Connection {
                source,
                target,
                relationship,
                expression,
            } => {
                for text in [source, target, relationship] {
                    validate_text(text, 2048)?;
                }
                validate_text(expression, 32768)?;
                let mut statement = self.connection.prepare(
                    "SELECT body FROM relations WHERE source=?1 AND target=?2 AND kind=?3
                     AND json_extract(body,'$.expression')=?4 ORDER BY id LIMIT 2",
                )?;
                let rows = statement
                    .query_map(params![source, target, relationship, expression], |row| {
                        row.get::<_, String>(0)
                    })?;
                for row in rows {
                    let relation: Relation = serde_json::from_str(&row?)?;
                    let span = relation.evidence.clone();
                    matches.push((EvidenceItem::Edge(Box::new(relation)), span));
                }
            }
            EvidenceTarget::Operation {
                function_id,
                operation_kind,
                expression,
                access,
                connection,
            } => {
                validate_text(function_id, 2048)?;
                validate_text(operation_kind, 128)?;
                validate_text(expression, 32768)?;
                if let Some(access) = access {
                    validate_text(&access.name, 2048)?;
                    validate_text(&access.kind, 128)?;
                    validate_text(&access.expression, 32768)?;
                }
                if let Some(connection) = connection {
                    validate_text(&connection.kind, 128)?;
                    if connection.label.len() > 32768 {
                        return Err(Error::Invalid("source identity is too large".into()));
                    }
                    for text in [
                        &connection.target_symbol_id,
                        &connection.target_kind,
                        &connection.target_expression,
                    ]
                    .into_iter()
                    .flatten()
                    {
                        validate_text(text, 32768)?;
                    }
                }
                let body: Option<String> = self
                    .connection
                    .query_row(
                        "SELECT body FROM behaviors WHERE symbol_id=?1",
                        [function_id],
                        |row| row.get(0),
                    )
                    .optional()?;
                if let Some(body) = body {
                    let behavior: Behavior = serde_json::from_str(&body)?;
                    let parent: ViewNode = self.symbol(function_id)?.into();
                    for node in &behavior.nodes {
                        if node.kind != *operation_kind || operation_expression(node) != expression
                        {
                            continue;
                        }
                        let spans: Vec<_> = if let Some(access) = access {
                            node.details
                                .as_ref()
                                .into_iter()
                                .flat_map(|details| &details.accesses)
                                .filter(|candidate| {
                                    candidate.name == access.name
                                        && candidate.kind == access.kind
                                        && candidate.expression == access.expression
                                })
                                .take(2)
                                .map(|candidate| candidate.source.clone())
                                .collect()
                        } else {
                            vec![node.source.clone()]
                        };
                        for span in spans {
                            if let Some(connection) = connection {
                                if let Some(target) = &connection.target_symbol_id {
                                    if connection.kind == "calls"
                                        && node.related_symbol_id.as_ref() == Some(target)
                                    {
                                        matches.push((
                                            EvidenceItem::Edge(Box::new(operation_relation(
                                                node,
                                                format!("{}/call-target", node.id),
                                                target,
                                                &connection.kind,
                                                &connection.label,
                                            ))),
                                            span,
                                        ));
                                    }
                                } else {
                                    for edge in &behavior.edges {
                                        if edge.source != node.id
                                            || edge.kind != connection.kind
                                            || edge.label != connection.label
                                        {
                                            continue;
                                        }
                                        let target = behavior
                                            .nodes
                                            .iter()
                                            .find(|target| target.id == edge.target);
                                        if target.is_some_and(|target| {
                                            Some(&target.kind) == connection.target_kind.as_ref()
                                                && Some(operation_expression(target))
                                                    == connection.target_expression.as_deref()
                                        }) {
                                            matches.push((
                                                EvidenceItem::Edge(Box::new(operation_relation(
                                                    node,
                                                    edge.id.clone(),
                                                    &edge.target,
                                                    &edge.kind,
                                                    &edge.label,
                                                ))),
                                                span.clone(),
                                            ));
                                        }
                                        if matches.len() >= 2 {
                                            break;
                                        }
                                    }
                                }
                            } else {
                                matches.push((
                                    EvidenceItem::Node(Box::new(super::learning::behavior_node(
                                        &parent, node,
                                    ))),
                                    span,
                                ));
                            }
                            if matches.len() >= 2 {
                                break;
                            }
                        }
                        if matches.len() >= 2 {
                            break;
                        }
                    }
                }
            }
        }
        let problem = match matches.len() {
            0 => Some("This occurrence changed or was removed. Select its current occurrence in the graph to reopen source.".into()),
            1 => None,
            _ => Some("Several current occurrences match this evidence. Select the intended occurrence in the graph to reopen source.".into()),
        };
        let (item, source) = if problem.is_none() {
            let (item, span) = matches.pop().ok_or(Error::State)?;
            (Some(item), Some(span))
        } else {
            (None, None)
        };
        Ok(EvidenceResolution {
            snapshot: snapshot.into(),
            item,
            source,
            problem,
        })
    }
}

/// Keep identity queries bounded even when received directly over IPC.
fn validate_text(text: &str, limit: usize) -> Result<()> {
    if text.is_empty() || text.len() > limit {
        return Err(Error::Invalid(
            "source identity is empty or too large".into(),
        ));
    }
    Ok(())
}

/// Match the same representation shown in operation details.
fn operation_expression(node: &BehaviorNode) -> &str {
    node.details
        .as_ref()
        .map(|details| details.expression.as_str())
        .filter(|expression| !expression.is_empty())
        .unwrap_or(&node.label)
}

/// Restore a single operation relationship; the graph will supply its presentation metadata.
fn operation_relation(
    node: &BehaviorNode,
    id: String,
    target: &str,
    kind: &str,
    label: &str,
) -> Relation {
    Relation {
        id,
        source: node.id.clone(),
        target: target.into(),
        kind: kind.into(),
        label: label.into(),
        certainty: "resolved".into(),
        evidence: node.source.clone(),
        expression: operation_expression(node).into(),
        sites: Vec::new(),
        site_count: 1,
        loop_back: false,
        hidden_target_id: None,
    }
}
