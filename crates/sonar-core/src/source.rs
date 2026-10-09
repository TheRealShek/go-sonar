use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::{Error, Result, SourceExcerpt, SourceSpan};
use sha2::{Digest, Sha256};

/// Read a bounded excerpt after resolving symlinks and checking project containment.
pub fn source_excerpt(root: &Path, source: &SourceSpan) -> Result<SourceExcerpt> {
    read_excerpt(root, source, None)
}

/// Reject edited files before displaying old coordinates as current evidence.
pub(crate) fn verified_source_excerpt(
    root: &Path,
    source: &SourceSpan,
    fingerprint: &str,
) -> Result<SourceExcerpt> {
    read_excerpt(root, source, Some(fingerprint))
}

fn read_excerpt(
    root: &Path,
    source: &SourceSpan,
    fingerprint: Option<&str>,
) -> Result<SourceExcerpt> {
    if source.file.is_empty() || source.line == 0 {
        return Err(Error::Invalid("declaration source is unavailable".into()));
    }
    let path = Path::new(&source.file).canonicalize()?;
    if !path.starts_with(root) {
        return Err(Error::Invalid(
            "source is outside the active project".into(),
        ));
    }
    // Inspect before opening so a named pipe cannot block this command.
    let metadata = std::fs::metadata(&path)?;
    if !metadata.is_file() || metadata.len() > 8 * 1024 * 1024 {
        return Err(Error::Invalid(
            "source must be a regular file no larger than 8 MiB".into(),
        ));
    }
    let file = File::open(&path)?;
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(Error::Invalid(
            "source grew beyond the 8 MiB read limit".into(),
        ));
    }
    if fingerprint.is_some_and(|expected| expected != format!("{:x}", Sha256::digest(&bytes))) {
        return Err(Error::Invalid(
            "source changed since analysis; refresh the project before opening evidence".into(),
        ));
    }
    let content =
        String::from_utf8(bytes).map_err(|_| Error::Invalid("source is not UTF-8 text".into()))?;
    let first_line = source.line.saturating_sub(3).max(1);
    let last_line = source
        .end_line
        .max(source.line)
        .saturating_add(3)
        .min(first_line.saturating_add(159));
    let mut text = String::new();
    for (index, line) in content.lines().enumerate() {
        let number = index as u32 + 1;
        if number > last_line {
            break;
        }
        if number < first_line {
            continue;
        }
        if text.len() + line.len() + 1 > 256 * 1024 {
            return Err(Error::Invalid("source excerpt exceeds 256 KiB".into()));
        }
        text.push_str(line);
        text.push('\n');
    }
    if text.is_empty() {
        return Err(Error::Invalid(
            "source coordinates are outside this file".into(),
        ));
    }
    Ok(SourceExcerpt {
        file: path.to_string_lossy().into_owned(),
        first_line,
        text,
    })
}
