package analysis

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/tools/go/packages"
)

type cached struct {
	fingerprint, api string
}

// Engine retains fingerprints for one project. Requests are processed serially.
type Engine struct {
	root, config string
	complete     bool
	files        map[string]string
	cache        map[string]cached
}

func hash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func environment() []string {
	env := []string{}
	for _, variable := range os.Environ() {
		key := strings.SplitN(variable, "=", 2)[0]
		if key != "GOPROXY" && key != "GOSUMDB" && key != "GOTOOLCHAIN" &&
			key != "GOFLAGS" && key != "GOPACKAGESDRIVER" {
			env = append(env, variable)
		}
	}

	return append(env,
		"GOPROXY=off",
		"GOSUMDB=off",
		"GOTOOLCHAIN=local",
		"GOFLAGS=-mod=readonly",
		"GOPACKAGESDRIVER=off",
	)
}

// Analyze returns package replacements for the affected scope.
func (e *Engine) Analyze(ctx context.Context, root string) (batch Batch, err error) {
	start := time.Now()
	defer func() {
		if err != nil {
			*e = Engine{}
		} else {
			batch.Stats.DurationMS = time.Since(start).Milliseconds()
		}
	}()

	return e.analyze(ctx, root)
}

func (e *Engine) analyze(ctx context.Context, root string) (Batch, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return Batch{}, err
	}

	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return Batch{}, fmt.Errorf("resolve project: %w", err)
	}

	batch := Batch{
		Root:            root,
		Packages:        []Facts{},
		RemovedPackages: []string{},
		Diagnostics: []Diagnostic{{
			Message:  "Scope: active build configuration, non-test packages; direct type-resolved AST relationships. Dynamic target enumeration, closure bodies, alias/value-flow analysis, and deferred execution paths are not expanded. External local dependency source edits are outside incremental scope and require restarting the application.",
			Severity: "warning",
		}},
	}

	input, err := scanInputs(ctx, root)
	if err != nil {
		return batch, fmt.Errorf("fingerprint project: %w", err)
	}

	files, config := input.files, input.config
	keys := make([]string, 0, len(files))
	for f, h := range files {
		keys = append(keys, f)
		if e.files[f] != h {
			batch.Stats.ChangedFiles++
		}
	}
	for f := range e.files {
		if _, ok := files[f]; !ok {
			batch.Stats.ChangedFiles++
		}
	}
	sort.Strings(keys)
	var snapshot strings.Builder
	snapshot.WriteString(config)
	for _, f := range keys {
		snapshot.WriteString(f + files[f])
	}
	batch.Snapshot = hash([]byte(snapshot.String()))
	if e.complete && e.root == root && e.config == config && batch.Stats.ChangedFiles == 0 {
		batch.Stats.ReusedPackages = len(e.cache)
		return e.publish(ctx, input, batch)
	}

	cfg := &packages.Config{
		Context: ctx,
		Dir:     root,
		Env:     environment(),
		Mode: packages.NeedName | packages.NeedFiles |
			packages.NeedCompiledGoFiles | packages.NeedImports | packages.NeedModule,
	}
	metadata, err := packages.Load(cfg, "./...")
	if err != nil {
		return batch, fmt.Errorf("load package metadata: %w", err)
	}

	full := e.root != root || e.config != config
	batch.Full = full
	if e.root != root || e.cache == nil {
		e.cache = map[string]cached{}
	}

	fingerprints := map[string]string{}
	apis := map[string]string{}
	affected := map[string]bool{}
	present := map[string]bool{}
	for _, p := range metadata {
		present[p.PkgPath] = true
		var content, api strings.Builder
		packageFiles := append([]string{}, p.GoFiles...)
		sort.Strings(packageFiles)
		for _, f := range packageFiles {
			content.WriteString(f + files[f])
		}
		fingerprints[p.PkgPath] = hash([]byte(content.String()))
		if previous, ok := e.cache[p.PkgPath]; !full && ok && previous.fingerprint == fingerprints[p.PkgPath] {
			apis[p.PkgPath] = previous.api
			continue
		}
		for _, f := range packageFiles {
			data, readErr := input.readSource(f)
			if readErr != nil {
				return batch, readErr
			}
			fset := token.NewFileSet()
			tree, parseErr := parser.ParseFile(fset, f, data, parser.SkipObjectResolution)
			if parseErr != nil {
				api.Write(data)
				continue
			}
			for _, d := range tree.Decls {
				api.WriteString(fmt.Sprint(fset.Position(d.Pos())))
				if fn, ok := d.(*ast.FuncDecl); ok {
					fn.Body = nil
				}
				var out bytes.Buffer
				_ = format.Node(&out, token.NewFileSet(), d)
				api.Write(out.Bytes())
			}
		}
		apis[p.PkgPath] = hash([]byte(api.String()))
		if full || e.cache[p.PkgPath].fingerprint != fingerprints[p.PkgPath] {
			affected[p.PkgPath] = true
		}
	}

	invalid := map[string]bool{}
	for id, c := range e.cache {
		if !present[id] {
			batch.RemovedPackages = append(batch.RemovedPackages, id)
			invalid[id] = true
		}
		if affected[id] && c.api != apis[id] {
			invalid[id] = true
		}
	}
	for id := range affected {
		if _, ok := e.cache[id]; !ok {
			invalid[id] = true
		}
	}

	for changed := true; changed; {
		changed = false
		for _, p := range metadata {
			for imported := range p.Imports {
				if invalid[imported] && !invalid[p.PkgPath] {
					invalid[p.PkgPath] = true
					affected[p.PkgPath] = true
					changed = true
				}
			}
		}
	}

	patterns := []string{}
	for id := range affected {
		patterns = append(patterns, id)
	}
	sort.Strings(patterns)
	if len(patterns) > 0 {
		cfg.Mode = packages.NeedName | packages.NeedFiles |
			packages.NeedCompiledGoFiles | packages.NeedImports |
			packages.NeedTypes | packages.NeedSyntax |
			packages.NeedTypesInfo | packages.NeedTypesSizes
		sourceErrors := make(chan error, 1)
		cfg.ParseFile = func(fset *token.FileSet, filename string, src []byte) (*ast.File, error) {
			if src == nil {
				var err error
				src, err = readRegularFile(filename)
				if err != nil {
					select {
					case sourceErrors <- fmt.Errorf("source changed during analysis; retry analysis: %w", err):
					default:
					}
					return nil, err
				}
			}
			if expected, ok := input.files[filename]; ok && hash(src) != expected {
				err := fmt.Errorf("source %s changed during analysis; retry analysis", filename)
				select {
				case sourceErrors <- fmt.Errorf("source changed during analysis; retry analysis: %w", err):
				default:
				}
				return nil, err
			}
			return parser.ParseFile(fset, filename, src, parser.ParseComments|parser.AllErrors)
		}

		loaded, err := packages.Load(cfg, patterns...)
		select {
		case sourceErr := <-sourceErrors:
			return batch, sourceErr
		default:
		}
		if err != nil {
			return batch, fmt.Errorf("load affected packages: %w", err)
		}
		for _, p := range loaded {
			batch.Stats.AnalyzedPackages++
			if len(p.Errors) > 0 {
				for _, issue := range p.Errors {
					batch.Diagnostics = append(batch.Diagnostics, Diagnostic{
						Message:   issue.Error(),
						PackageID: p.PkgPath,
						Severity:  "error",
					})
				}
				if _, ok := e.cache[p.PkgPath]; ok {
					batch.RemovedPackages = append(batch.RemovedPackages, p.PkgPath)
				}
				delete(e.cache, p.PkgPath)
				continue
			}
			if p.Types == nil || p.TypesInfo == nil {
				batch.Diagnostics = append(batch.Diagnostics, Diagnostic{
					Message:   "package type information unavailable",
					PackageID: p.PkgPath,
					Severity:  "error",
				})
				if _, ok := e.cache[p.PkgPath]; ok {
					batch.RemovedPackages = append(batch.RemovedPackages, p.PkgPath)
				}
				delete(e.cache, p.PkgPath)
				continue
			}

			facts := extract(p)
			facts.SourceFingerprints = map[string]string{}
			for _, file := range facts.Files {
				fingerprint, ok := input.files[file]
				if !ok {
					return batch, fmt.Errorf("source set changed during analysis: unscanned file %s; retry analysis", file)
				}
				facts.SourceFingerprints[file] = fingerprint
			}
			for _, behavior := range facts.Behaviors {
				for _, node := range behavior.Nodes {
					if strings.HasPrefix(node.Label, "control flow not expanded:") || node.Label == "goto" {
						batch.Diagnostics = append(batch.Diagnostics, Diagnostic{
							Message:   "Some internal control flow is not expanded; the graph stops at unsupported operations.",
							PackageID: p.PkgPath,
							Severity:  "warning",
						})
						break
					}
				}
			}

			facts.Fingerprint = fingerprints[p.PkgPath]
			e.cache[p.PkgPath] = cached{fingerprints[p.PkgPath], apis[p.PkgPath]}
			batch.Packages = append(batch.Packages, facts)
		}
	}

	for _, id := range batch.RemovedPackages {
		if !present[id] {
			delete(e.cache, id)
		}
	}

	sort.Strings(batch.RemovedPackages)
	sort.Slice(batch.Packages, func(i, j int) bool { return batch.Packages[i].ID < batch.Packages[j].ID })
	batch.Stats.ReusedPackages = len(e.cache) - len(batch.Packages)

	return e.publish(ctx, input, batch)
}
