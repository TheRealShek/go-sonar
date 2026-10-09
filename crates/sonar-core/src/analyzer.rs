use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Deserialize;

use crate::{AnalysisBatch, Error, Result};

const MAX_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;

/// A versioned helper response carrying either replacement facts or an error.
#[derive(Deserialize)]
struct Response {
    version: u32,
    id: String,
    result: Option<AnalysisBatch>,
    error: Option<String>,
}

/// One owned analyzer process with bounded messages and a response deadline.
pub struct AnalyzerClient {
    child: Child,
    stdin: ChildStdin,
    responses: Option<Receiver<Result<Response>>>,
    reader: Option<JoinHandle<()>>,
    sequence: u64,
}

impl AnalyzerClient {
    /// Start the trusted bundled helper, never an executable from the inspected project.
    pub fn start(executable: &Path) -> Result<Self> {
        let mut child = Command::new(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::Analyzer("missing stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Analyzer("missing stdout".into()))?;

        let (sender, responses) = mpsc::sync_channel(1);
        let reader = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);

            loop {
                let mut line = Vec::new();
                let read = reader
                    .by_ref()
                    .take(MAX_RESPONSE_BYTES + 1)
                    .read_until(b'\n', &mut line);

                let result = match read {
                    Ok(0) => Err(Error::Analyzer("helper closed its output".into())),
                    Ok(_) if line.len() as u64 > MAX_RESPONSE_BYTES => Err(Error::Analyzer(
                        "analysis response exceeds 64 MiB; reduce project scope".into(),
                    )),
                    Ok(_) => serde_json::from_slice(&line).map_err(Into::into),
                    Err(error) => Err(error.into()),
                };

                let failed = result.is_err();
                if sender.send(result).is_err() || failed {
                    break;
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            responses: Some(responses),
            reader: Some(reader),
            sequence: 0,
        })
    }

    /// Request package replacements. The caller discards this client after any failure.
    pub fn analyze(&mut self, root: &Path) -> Result<AnalysisBatch> {
        self.sequence += 1;
        let id = self.sequence.to_string();
        let request = serde_json::json!({
            "version": 1,
            "id": id,
            "method": "analyze",
            "root": root,
        });

        serde_json::to_writer(&mut self.stdin, &request)?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;

        let responses = self
            .responses
            .as_ref()
            .ok_or_else(|| Error::Analyzer("helper stopped".into()))?;
        let response = responses
            .recv_timeout(Duration::from_secs(120))
            .map_err(|e| Error::Analyzer(format!("helper did not respond: {e}")))??;

        if response.version != 1 || response.id != id {
            return Err(Error::Analyzer(
                "response protocol or request ID mismatch".into(),
            ));
        }
        if let Some(error) = response.error {
            return Err(Error::Analyzer(error));
        }

        response
            .result
            .ok_or_else(|| Error::Analyzer("response has no result".into()))
    }

    /// Process identity for measurements of the complete desktop process tree.
    pub fn process_id(&self) -> u32 {
        self.child.id()
    }
}

impl Drop for AnalyzerClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();

        // Disconnect before joining in case the reader is blocked on a full channel.
        self.responses.take();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}
