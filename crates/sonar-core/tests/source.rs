use sonar_core::{SourceSpan, source_excerpt};
use std::fs;

fn span(path: &std::path::Path, line: u32, end_line: u32) -> SourceSpan {
    SourceSpan {
        file: path.to_string_lossy().into(),
        line,
        column: 1,
        end_line,
        end_column: 2,
    }
}

#[test]
fn source_reads_are_contained_and_ranges_are_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let file = root.join("main.go");
    fs::write(
        &file,
        (1..=400).map(|n| format!("line {n}\n")).collect::<String>(),
    )
    .unwrap();
    let excerpt = source_excerpt(&root, &span(&file, 10, 12)).unwrap();
    assert_eq!(excerpt.first_line, 7);
    assert!(excerpt.text.contains("line 10\n"));
    let bounded = source_excerpt(&root, &span(&file, 10, u32::MAX)).unwrap();
    assert!(bounded.text.lines().count() <= 160);
    assert!(source_excerpt(&root, &span(&file, 0, 1)).is_err());
    assert!(source_excerpt(&root, &span(&file, 1000, 1001)).is_err());
    let outside = tempfile::NamedTempFile::new().unwrap();
    assert!(source_excerpt(&root, &span(outside.path(), 1, 2)).is_err());
    let directory = span(&root, 1, 1);
    assert!(source_excerpt(&root, &directory).is_err());
}

#[cfg(unix)]
#[test]
fn source_symlinks_cannot_escape_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "secret\n").unwrap();
    let link = root.join("outside.go");
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    assert!(source_excerpt(&root, &span(&link, 1, 1)).is_err());
    let real = root.join("inside.go");
    fs::write(&real, "package inside\n").unwrap();
    let inside = root.join("alias.go");
    std::os::unix::fs::symlink(&real, &inside).unwrap();
    assert_eq!(
        source_excerpt(&root, &span(&inside, 1, 1)).unwrap().file,
        real.to_string_lossy()
    );
}

#[test]
fn source_excerpts_reject_oversized_files_and_lines() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let large = root.join("large.go");
    let file = fs::File::create(&large).unwrap();
    file.set_len(8 * 1024 * 1024 + 1).unwrap();
    assert!(source_excerpt(&root, &span(&large, 1, 1)).is_err());
    let line = root.join("line.go");
    fs::write(&line, "x".repeat(256 * 1024 + 1)).unwrap();
    assert!(source_excerpt(&root, &span(&line, 1, 1)).is_err());
}
