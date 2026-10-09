# Desktop graph UI with separate Go analysis

Go Sonar needs a graph-centered desktop workspace, accurate Go analysis, and measured control of latency and memory. Use Tauri and React Flow for presentation, a Rust core for indexed graph processing, and a local Go analyzer to reuse Go's language semantics; this reduces custom UI and compiler work while retaining a mixed-language process boundary that must be measured. Keep ELK.js behind a replaceable layout contract and keep the source graph independent of renderer and layout formats.
