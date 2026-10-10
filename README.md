# Go Sonar

Go Sonar is an offline desktop app for exploring Go code. Start at a function, method, type, or field, then use the graph to see its relationships and inspect the source behind each connection.

Use it to answer questions such as:

- Who calls this function, and what does it call?
- Which branch leads to this return?
- Where is this field read or changed?
- Which direct consumers should I inspect before changing this symbol?

Go Sonar analyzes source without running your application or tests. Explanations come from source facts and declaration comments, with no AI or remote service. The Go toolchain can invoke compilation tools while loading packages.

This is an early implementation. Refresh is manual, and analysis covers active non-test packages in one Go module. Static paths describe possible source structure, not observed execution or proof that a path can occur. See the [analysis limits](docs/user-guide.md#understand-the-analysis-limits) before interpreting a result.

## Run locally

You need Rust and Cargo, Go 1.26 or newer, Node.js 22.12 or newer, and npm. The Linux desktop also needs Tauri's native libraries. On Arch Linux, the required packages include `webkit2gtk-4.1`, `gtk3`, `base-devel`, and `librsvg`.

From the checkout root:

```sh
npm ci
npm run desktop
```

The desktop command builds the Go analyzer and starts the native app. Installing Go Sonar's development dependencies may require the network. Project analysis disables dependency and toolchain downloads, so prepare the inspected project's dependencies locally first.

1. Enter an absolute path to a directory containing `go.mod`, or use **Choose folder**.
2. Open the project.
3. Search for a declaration, choose an executable entry point, or browse packages and declaration kinds.
4. Select a result to start exploring.

For a first example, open the absolute path to `fixtures/sample` in this checkout and search for `Get`. The [user guide](docs/user-guide.md#try-the-sample-module) walks through its cache lookup, repository call, error return, and cache write.

`npm run dev` starts a browser preview with labelled illustrative data. Use the native desktop to analyze your own project.

## Documentation

Start with the [user guide](docs/user-guide.md) for everyday use and troubleshooting. Use the [development guide](docs/development.md) to build, check, and benchmark the app.

| Document                                                     | What it explains                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [Analysis scope](docs/implementation-notes.md)               | Supported analysis, refresh behavior, and known limits                            |
| [Product intent](docs/product-intent.md)                     | Goals and acceptance scenarios, including unfinished requirements                 |
| [Exploration experience](docs/learning-experience.md)        | Readability and navigation goals, current controls, and proposed usability checks |
| [Glossary](CONTEXT.md)                                       | Terms used by the graph and documentation                                         |
| [Architecture](docs/architecture.md)                         | Component responsibilities and data boundaries                                    |
| [Implementation contract](docs/implementation-contract.md)   | Analyzer transport and desktop query contracts                                    |
| [Design decisions](docs/design-discussion.md)                | Reasons for the main product choices                                              |
| [Performance requirements](docs/performance.md)              | Measurement rules and remaining release criteria                                  |
| [Validation record](docs/validation.md)                      | Historical checks and benchmark results                                           |
| [ADR 0001](docs/adr/0001-desktop-and-analysis-boundaries.md) | Desktop and analysis boundary decision                                            |
