use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn main() -> std::io::Result<()> {
    tauri_build::build();

    // generate_context! reads frontend assets without exposing them in rustc's
    // dependency file. Give Cargo and compiler caches an explicit asset identity.
    let frontend = Path::new("../dist");
    println!("cargo:rerun-if-changed=../dist");

    let mut files = Vec::new();
    if frontend.is_dir() {
        collect(frontend, &mut files)?;
    }
    files.sort();

    let mut digest = Sha256::new();
    for file in files {
        digest.update(
            file.strip_prefix(frontend)
                .map_err(std::io::Error::other)?
                .to_string_lossy()
                .as_bytes(),
        );
        digest.update([0]);
        digest.update(std::fs::read(&file)?);
    }

    println!("cargo:rustc-check-cfg=cfg(sonar_frontend_digest, values(any()))");
    println!(
        "cargo:rustc-cfg=sonar_frontend_digest=\"{:x}\"",
        digest.finalize()
    );

    Ok(())
}

/// Enumerate the bounded built frontend, independent of directory traversal order.
fn collect(directory: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            collect(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}
