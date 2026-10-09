package analysis

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func write(t *testing.T, root, path, content string) {
	t.Helper()
	p := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

type testEngine struct {
	Engine
	facts map[string]Facts
}

func analyze(t *testing.T, e *testEngine, root string) Batch {
	t.Helper()
	b, err := e.Analyze(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if b.Full || e.facts == nil {
		e.facts = map[string]Facts{}
	}
	for _, id := range b.RemovedPackages {
		delete(e.facts, id)
	}
	for _, facts := range b.Packages {
		e.facts[facts.ID] = facts
	}
	return b
}
func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	write(t, root, "go.mod", "module example.test/project\n\ngo 1.25.0\n")
	write(t, root, "lib/lib.go", "package lib\ntype Item struct { Value int }\nfunc Change(v Item) Item { v.Value++; return v }\n")
	write(t, root, "app/app.go", "package app\nimport \"example.test/project/lib\"\nfunc Run(v lib.Item) int { if v.Value > 0 { return lib.Change(v).Value }; v.Value = 2; return v.Value }\n")
	return root
}

// TestRelationships checks type-resolved calls, fields, construction, and return branches.
func TestRelationships(t *testing.T) {
	root := fixture(t)
	write(t, root, "app/more.go", "package app\nimport \"example.test/project/lib\"\nfunc New() lib.Item { return lib.Item{Value:1} }\n")
	b := analyze(t, &testEngine{}, root)
	for _, diagnostic := range b.Diagnostics {
		if diagnostic.Severity == "error" {
			t.Fatal(b.Diagnostics)
		}
	}
	kinds := map[string]bool{}
	var branches, returns int
	for _, p := range b.Packages {
		for _, edge := range p.Edges {
			kinds[edge.Kind] = true
			if edge.Kind == "calls" && edge.Target != "example.test/project/lib::Change" {
				t.Fatalf("wrong target: %s", edge.Target)
			}
		}
		for _, behavior := range p.Behaviors {
			for _, n := range behavior.Nodes {
				if n.Kind == "return" {
					returns++
				}
				if n.Kind == "call" && n.RelatedSymbolID == "" {
					t.Fatal("call lacks symbol")
				}
			}
			for _, e := range behavior.Edges {
				if e.Label == "true" || e.Label == "false" {
					branches++
				}
			}
		}
	}
	for _, kind := range []string{"calls", "uses_type", "reads", "writes", "constructs"} {
		if !kinds[kind] {
			t.Errorf("missing %s", kind)
		}
	}
	if branches != 2 || returns < 4 {
		t.Fatalf("branches=%d returns=%d", branches, returns)
	}
}

// TestIncremental verifies package reuse, API invalidation, deletion, and clean equivalence.
func TestIncremental(t *testing.T) {
	root := fixture(t)
	e := &testEngine{}
	first := analyze(t, e, root)
	if !first.Full || first.Stats.AnalyzedPackages != 2 {
		t.Fatal(first)
	}
	unchanged := analyze(t, e, root)
	if unchanged.Full || unchanged.Stats.AnalyzedPackages != 0 || len(unchanged.Packages) != 0 || unchanged.Stats.ReusedPackages != 2 {
		t.Fatal(unchanged)
	}
	write(t, root, "lib/lib.go", "package lib\ntype Item struct { Value int }\nfunc Change(v Item) Item { v.Value += 2; return v }\n")
	body := analyze(t, e, root)
	if body.Full || body.Stats.AnalyzedPackages != 1 || body.Stats.ReusedPackages != 1 {
		t.Fatal(body)
	}
	checkClean(t, e, root)
	write(t, root, "lib/lib.go", "package lib\ntype Item struct { Value int; Extra string }\nfunc Change(v Item) Item { v.Value += 2; return v }\n")
	api := analyze(t, e, root)
	if api.Stats.AnalyzedPackages != 2 {
		t.Fatal(api)
	}
	checkClean(t, e, root)
	if err := os.RemoveAll(filepath.Join(root, "app")); err != nil {
		t.Fatal(err)
	}
	deleted := analyze(t, e, root)
	if !reflect.DeepEqual(deleted.RemovedPackages, []string{"example.test/project/app"}) {
		t.Fatal(deleted)
	}
	checkClean(t, e, root)
}
func checkClean(t *testing.T, e *testEngine, root string) {
	t.Helper()
	fresh := &testEngine{}
	analyze(t, fresh, root)
	for id, c := range fresh.facts {
		old, ok := e.facts[id]
		if !ok {
			t.Fatalf("missing %s", id)
		}
		a, _ := json.Marshal(old)
		b, _ := json.Marshal(c)
		if string(a) != string(b) {
			t.Fatalf("incremental facts differ for %s\n%s\n%s", id, a, b)
		}
	}
	if len(fresh.facts) != len(e.facts) {
		t.Fatal("cache count differs")
	}
}

// TestInvalidSource ensures invalid facts are removed and restored after repair.
func TestInvalidSource(t *testing.T) {
	root := fixture(t)
	e := &testEngine{}
	analyze(t, e, root)
	write(t, root, "app/app.go", "package app\nfunc Run( {\n")
	broken := analyze(t, e, root)
	if len(broken.Diagnostics) == 0 || len(broken.RemovedPackages) != 1 {
		t.Fatal(broken)
	}
	for _, p := range broken.Packages {
		if p.ID == "example.test/project/app" {
			t.Fatal("published invalid package")
		}
	}
	write(t, root, "app/app.go", "package app\nfunc Run() int { return 1 }\n")
	fixed := analyze(t, e, root)
	for _, diagnostic := range fixed.Diagnostics {
		if diagnostic.Severity == "error" {
			t.Fatal(fixed.Diagnostics)
		}
	}
	checkClean(t, e, root)
}

// TestStandardLibrary verifies export-data compatibility without loading dependency syntax.
func TestStandardLibrary(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.test/stdlib\n\ngo 1.26.0\n")
	write(t, root, "main.go", "package stdlib\nimport \"errors\"\nfunc Failure() error { return errors.New(\"failure\") }\n")
	batch := analyze(t, &testEngine{}, root)
	for _, diagnostic := range batch.Diagnostics {
		if diagnostic.Severity == "error" {
			t.Fatal(batch.Diagnostics)
		}
	}
	if len(batch.Packages) != 1 {
		t.Fatal(batch)
	}
	found := false
	for _, edge := range batch.Packages[0].Edges {
		if edge.Kind == "calls" && edge.Target == "errors::New" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing resolved standard-library call")
	}
}

// TestShortCircuitAndReturns checks conditional evaluation and early-return termination.
func TestShortCircuitAndReturns(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.test/branches\n\ngo 1.26.0\n")
	write(t, root, "main.go", "package branches\nfunc First() bool{return true}\nfunc Second() bool{return false}\nfunc Run() bool{if First() && Second(){return true};return false}\n")
	batch := analyze(t, &testEngine{}, root)
	var behavior Behavior
	for _, item := range batch.Packages[0].Behaviors {
		if item.SymbolID == "example.test/branches::Run" {
			behavior = item
		}
	}
	nodes := map[string]Node{}
	for _, node := range behavior.Nodes {
		nodes[node.ID] = node
	}
	shortCircuit := false
	for _, node := range behavior.Nodes {
		if node.Kind == "condition" && node.Label == "First()" {
			for _, edge := range behavior.Edges {
				if edge.Source == node.ID && edge.Label == "true" && nodes[edge.Target].Kind == "call" && nodes[edge.Target].RelatedSymbolID == "example.test/branches::Second" {
					shortCircuit = true
				}
			}
		}
	}
	if !shortCircuit {
		t.Fatal("missing conditional right-hand evaluation")
	}
	for _, edge := range behavior.Edges {
		if nodes[edge.Source].Kind == "return" && nodes[edge.Target].Kind != "exit" {
			t.Fatal("return continues into ordinary statements")
		}
	}
}

// TestConfigurationDeletion verifies obsolete packages are removed on broad configuration invalidation.
func TestConfigurationDeletion(t *testing.T) {
	root := fixture(t)
	e := &testEngine{}
	analyze(t, e, root)
	if err := os.RemoveAll(filepath.Join(root, "app")); err != nil {
		t.Fatal(err)
	}
	write(t, root, "go.mod", "module example.test/project\n\ngo 1.26.0\n")
	batch := analyze(t, e, root)
	if !reflect.DeepEqual(batch.RemovedPackages, []string{"example.test/project/app"}) {
		t.Fatal(batch)
	}
	checkClean(t, e, root)
}

// TestInterfaceMethodIdentity checks imported interface targets reuse their declaration IDs.
func TestInterfaceMethodIdentity(t *testing.T) {
	root := fixture(t)
	write(t, root, "lib/interface.go", "package lib\ntype Reader interface { Read() int }\ntype Other interface { Read() string }\n")
	write(t, root, "app/interface.go", "package app\nimport \"example.test/project/lib\"\nfunc Read(reader lib.Reader) int { return reader.Read() }\n")
	b := analyze(t, &testEngine{}, root)
	declared := map[string]bool{}
	for _, p := range b.Packages {
		if p.ID == "example.test/project/lib" {
			for _, s := range p.Symbols {
				if s.Name == "Read" {
					declared[s.ID] = true
				}
			}
		}
	}
	if len(declared) != 2 {
		t.Fatalf("interface methods collided: %v", declared)
	}
	found := false
	for _, p := range b.Packages {
		if p.ID == "example.test/project/app" {
			for _, e := range p.Edges {
				if e.Kind == "calls" && e.Label == "calls Read" {
					found = true
					if !declared[e.Target] {
						t.Fatalf("imported interface method ID %s differs from declaration", e.Target)
					}
					if e.Certainty != "possible" {
						t.Fatal("interface dispatch presented as concrete target")
					}
				}
			}
		}
	}
	if !found {
		t.Fatal("interface call missing")
	}
}

// TestSourceFingerprints verifies source hashes describe exactly the published source files.
func TestSourceFingerprints(t *testing.T) {
	root := fixture(t)
	b := analyze(t, &testEngine{}, root)
	for _, p := range b.Packages {
		if len(p.SourceFingerprints) != len(p.Files) {
			t.Fatal("source hash coverage differs from package files")
		}
		for _, file := range p.Files {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if p.SourceFingerprints[file] != hash(data) {
				t.Fatal("source fingerprint mismatch")
			}
		}
	}
}

// TestIndirectLocalCalls ensures function parameters never acquire shared global identities.
func TestIndirectLocalCalls(t *testing.T) {
	root := fixture(t)
	write(t, root, "app/indirect.go", "package app\nfunc A(fn func()) { fn() }\nfunc B(fn func()) { fn() }\nfunc Direct() {}\nfunc C() { Direct() }\n")
	b := analyze(t, &testEngine{}, root)
	var indirect, direct int
	for _, p := range b.Packages {
		for _, s := range p.Symbols {
			if s.Name == "fn" {
				t.Fatal("local function parameter became global symbol")
			}
		}
		for _, behavior := range p.Behaviors {
			for _, n := range behavior.Nodes {
				if n.Kind == "call" && n.Label == "fn()" {
					indirect++
					if n.RelatedSymbolID != "" {
						t.Fatal("indirect parameter call has fabricated target")
					}
				}
				if n.Kind == "call" && n.Label == "Direct()" {
					direct++
					if n.RelatedSymbolID != "example.test/project/app::Direct" {
						t.Fatal("direct function link lost")
					}
				}
			}
		}
	}
	if indirect != 2 || direct != 1 {
		t.Fatalf("calls: indirect=%d direct=%d", indirect, direct)
	}
}

// TestPublicationRejectsChangedInputs verifies edits, additions, deletions, and config changes force a full retry.
func TestPublicationRejectsChangedInputs(t *testing.T) {
	for _, change := range []string{"edit", "add", "delete", "config"} {
		t.Run(change, func(t *testing.T) {
			root := fixture(t)
			e := &Engine{}
			initial, err := e.Analyze(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			input, err := scanInputs(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			switch change {
			case "edit":
				write(t, root, "app/app.go", "package app\nfunc Different() {}\n")
			case "add":
				write(t, root, "app/extra.go", "package app\nfunc Extra() {}\n")
			case "delete":
				if err := os.Remove(filepath.Join(root, "app/app.go")); err != nil {
					t.Fatal(err)
				}
			case "config":
				write(t, root, "go.mod", "module example.test/project\n\ngo 1.26.0\n")
			}
			published, err := e.publish(context.Background(), input, initial)
			if err == nil || !strings.Contains(err.Error(), "retry analysis") {
				t.Fatalf("expected explicit retry error, got %v", err)
			}
			if published.Snapshot != "" || len(published.Packages) != 0 {
				t.Fatal("published mismatched snapshot")
			}
			retry, err := e.Analyze(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			if !retry.Full {
				t.Fatal("verification failure retained incremental cache")
			}
		})
	}
}

// TestSnapshotSourceReadRejectsTransientEdit verifies source readers reject bytes from another snapshot.
func TestSnapshotSourceReadRejectsTransientEdit(t *testing.T) {
	root := fixture(t)
	input, err := scanInputs(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	write(t, root, "app/app.go", "package app\nfunc Changed() {}\n")
	if _, err := input.readSource(filepath.Join(root, "app/app.go")); err == nil {
		t.Fatal("accepted changed source during analysis")
	}
}

// TestExplicitWorkspaceFingerprint tracks content and optional sums outside the selected root.
func TestExplicitWorkspaceFingerprint(t *testing.T) {
	root := fixture(t)
	outside := t.TempDir()
	workspace := filepath.Join(outside, "go.work")
	write(t, outside, "go.work", "go 1.26.0\n")
	t.Setenv("GOWORK", workspace)
	original, err := scanInputs(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	write(t, outside, "go.work", "go 1.26.0\n// changed workspace configuration\n")
	changed, err := scanInputs(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if original.config == changed.config {
		t.Fatal("explicit external workspace contents were not fingerprinted")
	}
	write(t, outside, "go.work.sum", "module.example v1.0.0 h1:example\n")
	withSum, err := scanInputs(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if withSum.config == changed.config {
		t.Fatal("explicit workspace sum contents were not fingerprinted")
	}
	if !reflect.DeepEqual(original.files, withSum.files) {
		t.Fatal("workspace configuration polluted selected source set")
	}
}
