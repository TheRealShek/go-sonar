use std::{fs, path::PathBuf};

use sonar_core::{
    Backend, Direction, EvidenceAccess, EvidenceConnection, EvidenceItem, EvidenceTarget,
    GraphRequest,
};

const ORIGINAL: &str = "package evidence\nfunc Normalize(value int) int { return value + 1 }\nfunc Get(input int) int {\n value := Normalize(input)\n return value\n}\n";

fn module() -> (tempfile::TempDir, PathBuf, Backend) {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let helper = repository.join("src-tauri/binaries/go-sonar-analyzer-x86_64-unknown-linux-gnu");
    assert!(
        helper.is_file(),
        "build the analyzer before evidence acceptance tests"
    );
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("module");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("go.mod"), "module evidence\n\ngo 1.26.0\n").unwrap();
    fs::write(root.join("evidence.go"), ORIGINAL).unwrap();
    let backend = Backend::new(helper, temporary.path().join("cache"));
    backend.open(&root).unwrap();
    (temporary, root, backend)
}

fn view(backend: &Backend) -> sonar_core::GraphView {
    let get = backend.search("Get", 10).unwrap().remove(0);
    backend
        .graph(&GraphRequest {
            focus: get.id.clone(),
            internals: vec![get.id],
            kinds: vec!["calls".into()],
            direction: Direction::Outgoing,
            limit: 80,
            neighbor_limit: 8,
            ..Default::default()
        })
        .unwrap()
}

#[test]
fn refreshed_declaration_uses_new_coordinates_and_rejects_obsolete_snapshot() {
    let (_temporary, root, backend) = module();
    let get = backend.search("Get", 10).unwrap().remove(0);
    let old = backend.refresh().unwrap();
    fs::write(root.join("evidence.go"), format!("// moved\n\n{ORIGINAL}")).unwrap();
    assert!(backend.source(&get.source).is_err());
    let fresh = backend.refresh().unwrap();
    let target = EvidenceTarget::Declaration { symbol_id: get.id };
    assert!(backend.resolve_source(&target, &old.snapshot).is_err());
    let resolved = backend.resolve_source(&target, &fresh.snapshot).unwrap();
    let source = resolved.source.unwrap();
    assert_eq!(source.line, get.source.line + 2);
    assert!(matches!(resolved.item, Some(EvidenceItem::Node(_))));
    assert!(backend.source(&source).unwrap().text.contains("func Get"));
}

#[test]
fn operation_and_binding_occurrence_survive_renumbering_without_falling_back_to_focus() {
    let (_temporary, root, backend) = module();
    let before = view(&backend);
    let returned = before
        .nodes
        .iter()
        .find(|node| node.kind == "return" && node.parent_id.as_ref() == Some(&before.focus))
        .unwrap();
    let access = returned
        .details
        .as_ref()
        .unwrap()
        .accesses
        .iter()
        .find(|access| access.name == "value" && access.kind == "read")
        .unwrap();
    let target = EvidenceTarget::Operation {
        function_id: before.focus.clone(),
        operation_kind: returned.kind.clone(),
        expression: returned.details.as_ref().unwrap().expression.clone(),
        access: Some(EvidenceAccess {
            name: access.name.clone(),
            kind: access.kind.clone(),
            expression: access.expression.clone(),
        }),
        connection: None,
    };
    let call = before
        .nodes
        .iter()
        .find(|node| {
            node.name == "Normalize(input)" && node.parent_id.as_ref() == Some(&before.focus)
        })
        .unwrap();
    let call_target = EvidenceTarget::Operation {
        function_id: before.focus.clone(),
        operation_kind: call.kind.clone(),
        expression: call.details.as_ref().unwrap().expression.clone(),
        access: None,
        connection: None,
    };
    let edited = ORIGINAL.replace("\n return value", "\n _ = Normalize(0)\n return value");
    fs::write(root.join("evidence.go"), format!("// moved\n{edited}")).unwrap();
    let fresh = backend.refresh().unwrap();
    let resolved = backend.resolve_source(&target, &fresh.snapshot).unwrap();
    let Some(EvidenceItem::Node(node)) = resolved.item else {
        panic!("restore the operation, not the declaration");
    };
    let recovered_call = backend
        .resolve_source(&call_target, &fresh.snapshot)
        .unwrap();
    let Some(EvidenceItem::Node(recovered_call)) = recovered_call.item else {
        panic!("restore the call operation");
    };
    assert_ne!(recovered_call.id, call.id);
    assert_eq!(recovered_call.name, call.name);
    assert_eq!(node.parent_id.as_ref(), Some(&before.focus));
    assert_eq!(
        resolved.source.as_ref().unwrap().line,
        access.source.line + 2
    );
    assert_eq!(
        resolved.source.as_ref().unwrap().column,
        access.source.column
    );
    assert!(
        backend
            .source(&resolved.source.unwrap())
            .unwrap()
            .text
            .contains("return value")
    );
}

#[test]
fn grouped_connection_reacquires_the_chosen_expression_and_refuses_ambiguous_or_removed_sites() {
    let (_temporary, root, backend) = module();
    let before = view(&backend);
    let relation = before
        .edges
        .iter()
        .find(|edge| edge.source == before.focus && edge.kind == "calls")
        .unwrap();
    let target = EvidenceTarget::Connection {
        source: relation.source.clone(),
        target: relation.target.clone(),
        relationship: relation.kind.clone(),
        expression: relation.expression.clone(),
    };
    let edited = ORIGINAL.replace(" value :=", " _ = Normalize(1)\n value :=");
    fs::write(root.join("evidence.go"), format!("// moved\n{edited}")).unwrap();
    let fresh = backend.refresh().unwrap();
    let resolved = backend.resolve_source(&target, &fresh.snapshot).unwrap();
    assert!(matches!(resolved.item, Some(EvidenceItem::Edge(_))));
    assert_eq!(resolved.source.unwrap().line, relation.evidence.line + 2);

    fs::write(
        root.join("evidence.go"),
        ORIGINAL.replace(" value :=", " _ = Normalize(input)\n value :="),
    )
    .unwrap();
    let duplicate = backend.refresh().unwrap();
    let ambiguous = backend
        .resolve_source(&target, &duplicate.snapshot)
        .unwrap();
    assert!(ambiguous.item.is_none());
    assert!(ambiguous.source.is_none());
    assert!(
        ambiguous
            .problem
            .unwrap()
            .contains("Several current occurrences")
    );

    fs::write(
        root.join("evidence.go"),
        ORIGINAL.replace("Normalize(input)", "input"),
    )
    .unwrap();
    let removed = backend.refresh().unwrap();
    let missing = backend.resolve_source(&target, &removed.snapshot).unwrap();
    assert!(missing.item.is_none());
    assert!(missing.source.is_none());
    assert!(missing.problem.unwrap().contains("changed or was removed"));
}

#[test]
fn operation_connections_restore_fresh_endpoints_and_ambiguous_operations_require_a_choice() {
    let (_temporary, root, backend) = module();
    let before = view(&backend);
    let call = before
        .nodes
        .iter()
        .find(|node| {
            node.name == "Normalize(input)" && node.parent_id.as_ref() == Some(&before.focus)
        })
        .unwrap();
    let control = before
        .edges
        .iter()
        .find(|edge| edge.source == call.id && edge.kind == "control")
        .unwrap();
    let destination = before
        .nodes
        .iter()
        .find(|node| node.id == control.target)
        .unwrap();
    // Deserialize the frontend wire format as well as exercising the native lookup.
    let target: EvidenceTarget = serde_json::from_value(serde_json::json!({
        "kind": "operation", "functionId": before.focus, "operationKind": call.kind,
        "expression": call.details.as_ref().unwrap().expression,
        "connection": { "kind": control.kind, "label": control.label,
            "targetKind": destination.kind, "targetExpression": destination.details.as_ref().unwrap().expression }
    })).unwrap();
    fs::write(
        root.join("evidence.go"),
        ORIGINAL.replace("\n return value", "\n _ = Normalize(0)\n return value"),
    )
    .unwrap();
    let fresh = backend.refresh().unwrap();
    let restored = backend.resolve_source(&target, &fresh.snapshot).unwrap();
    let Some(EvidenceItem::Edge(edge)) = restored.item else {
        panic!("restore the behavior connection");
    };
    assert_ne!(edge.source, control.source);
    assert_ne!(edge.target, control.target);
    assert_eq!(edge.kind, "control");
    assert_eq!(restored.source.unwrap().line, call.source.line);

    let call_target = EvidenceTarget::Operation {
        function_id: before.focus,
        operation_kind: call.kind.clone(),
        expression: call.details.as_ref().unwrap().expression.clone(),
        access: None,
        connection: Some(EvidenceConnection {
            kind: "calls".into(),
            label: "call target".into(),
            target_symbol_id: call.related_symbol_id.clone(),
            target_kind: None,
            target_expression: None,
        }),
    };
    let direct = backend
        .resolve_source(&call_target, &fresh.snapshot)
        .unwrap();
    let Some(EvidenceItem::Edge(direct)) = direct.item else {
        panic!("restore the call target connection");
    };
    assert_eq!(direct.source, edge.source);
    assert_eq!(Some(direct.target), call.related_symbol_id);

    fs::write(
        root.join("evidence.go"),
        ORIGINAL.replace("\n return value", "\n _ = Normalize(input)\n return value"),
    )
    .unwrap();
    let duplicate = backend.refresh().unwrap();
    let ambiguous = backend
        .resolve_source(&call_target, &duplicate.snapshot)
        .unwrap();
    assert!(ambiguous.item.is_none());
    assert!(ambiguous.source.is_none());
    assert!(
        ambiguous
            .problem
            .unwrap()
            .contains("Several current occurrences")
    );
}
