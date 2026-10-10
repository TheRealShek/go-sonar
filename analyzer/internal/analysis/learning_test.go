package analysis

import (
	"strings"
	"testing"
)

// TestCallBoundaryMappings verifies instantiated parameters, variadics, receivers, and returned positions.
func TestCallBoundaryMappings(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.test/mappings\n\ngo 1.26.0\n")
	write(t, root, "main.go", `package mappings
 type Contract interface { Method(int) int }
 type Box struct{}
 func (*Box) Method(value int) int { return value }
 func Pair(value int) (int, error) { return value, nil }
 func Sum(values ...int) int { return 0 }
 func Fixed(value int, rest ...int) int { return value }
 func BoxPair(box *Box, value int) (*Box, int) { return box, value }
 func Identity[T any](value T) T { return value }
 func Use(c Contract, box *Box, value int) int {
  value, err := Pair(value)
  _ = err
  value, _ = Pair(value)
  Pair(value)
  values := []int{value, 2}
  value = Sum(values...)
  value = Sum(value, 2, 3)
  value = Identity(value)
  value = c.Method(value)
  value = (c.Method)(value)
  value = (*Box).Method(BoxPair(box, value))
  value = Fixed(value)
  value = (Identity(value))
  value = (*Box).Method(box, value)
  value, err = Identity(value), nil
  { value := Identity(value); _ = value }
  ptr := &value
  *ptr = value+1
  return value
 }
 func Returns(value int) (int, int) { return 0, (Identity(value)) }
`)
	b := analyze(t, &testEngine{}, root)
	for _, d := range b.Diagnostics {
		if d.Severity == "error" {
			t.Fatal(d)
		}
	}
	calls := map[string][]CallBoundary{}
	bindings := map[string]bool{}
	var aliasBoundary bool
	for _, p := range b.Packages {
		for _, behavior := range p.Behaviors {
			if !strings.HasSuffix(behavior.SymbolID, "::Use") && !strings.HasSuffix(behavior.SymbolID, "::Returns") {
				continue
			}
			for _, node := range behavior.Nodes {
				if node.Details.Call != nil {
					calls[node.Details.Expression] = append(calls[node.Details.Expression], *node.Details.Call)
				}
				for _, access := range node.Details.Accesses {
					if access.Name == "value" && strings.HasSuffix(behavior.SymbolID, "::Use") {
						bindings[access.ID] = true
					}
				}
				if strings.Contains(node.Details.Limitation, "Aliasing") || strings.Contains(node.Details.Limitation, "alias effects") {
					aliasBoundary = true
				}
			}
		}
	}
	pair := calls["Pair(value)"]
	if len(pair) != 3 {
		t.Fatalf("pair calls: %#v", pair)
	}
	var assigned, discarded bool
	for _, call := range pair {
		if len(call.Results) != 2 || len(call.Arguments) != 1 || call.Arguments[0].Parameter != "value" {
			t.Fatal(call)
		}
		if call.Results[0].Destination == "value" && call.Results[1].Destination == "_" {
			assigned = true
		}
		if call.Results[0].Destination == "discarded" && call.Results[1].Destination == "discarded" {
			discarded = true
		}
	}
	if !assigned || !discarded {
		t.Fatal("missing assigned or discarded result mappings")
	}
	spread := calls["Sum(values...)"][0]
	if !spread.Variadic || len(spread.Arguments) != 1 || !spread.Arguments[0].Spread || !spread.Arguments[0].Variadic {
		t.Fatal(spread)
	}
	ordinary := calls["Sum(value, 2, 3)"][0]
	if len(ordinary.Arguments) != 3 {
		t.Fatal(ordinary)
	}
	for _, arg := range ordinary.Arguments {
		if arg.Position != 1 || arg.Parameter != "values" {
			t.Fatal(arg)
		}
	}
	contract := calls["c.Method(value)"][0]
	if contract.Dispatch != "interface" || contract.Receiver != "c" {
		t.Fatal(contract)
	}
	parenthesized := calls["(c.Method)(value)"][0]
	if parenthesized.Dispatch != "interface" || parenthesized.Receiver != "c" {
		t.Fatal(parenthesized)
	}
	tuple := calls["(*Box).Method(BoxPair(box, value))"][0]
	if tuple.Receiver != "BoxPair(box, value), result 1" || len(tuple.Arguments) != 1 || tuple.Arguments[0].Expression != "BoxPair(box, value), result 2" {
		t.Fatal(tuple)
	}
	fixed := calls["Fixed(value)"][0]
	if !fixed.Variadic || fixed.Arguments[0].Variadic {
		t.Fatal(fixed)
	}
	var returnPosition, parenthesizedAssignment bool
	for _, call := range calls["Identity(value)"] {
		returnPosition = returnPosition || call.Results[0].Destination == "caller return position 2"
		parenthesizedAssignment = parenthesizedAssignment || call.Results[0].Destination == "value"
	}
	if !returnPosition || !parenthesizedAssignment {
		t.Fatal("missing positional or parenthesized results", calls["Identity(value)"])
	}
	for _, pkg := range b.Packages {
		for _, edge := range pkg.Edges {
			if edge.Expression == "(c.Method)(value)" && edge.Certainty != "possible" {
				t.Fatal("interface relation guessed", edge)
			}
		}
	}
	method := calls["(*Box).Method(box, value)"][0]
	if method.Receiver != "box" || len(method.Arguments) != 1 || method.Arguments[0].Expression != "value" {
		t.Fatal(method)
	}
	for _, generic := range calls["Identity(value)"] {
		if generic.Arguments[0].Type != "int" || generic.Results[0].Type != "int" {
			t.Fatal(generic)
		}
	}
	if len(bindings) != 2 || !aliasBoundary {
		t.Fatalf("bindings=%v alias=%v", bindings, aliasBoundary)
	}
}

// TestOperationEvidence distinguishes element mutations and unsupported continuations from complete flow.
func TestOperationEvidence(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.test/operations\n\ngo 1.26.0\n")
	write(t, root, "main.go", `package operations
 type Service struct { Cache map[string]int }
 func (s *Service) Use(ch chan int) int {
  s.Cache["key"] = 2
  defer println(s.Cache["key"])
  select { case value := <-ch: return value; default: return 0 }
 }
`)
	b := analyze(t, &testEngine{}, root)
	var mutation, deferred, unsupported bool
	for _, p := range b.Packages {
		for _, behavior := range p.Behaviors {
			for _, node := range behavior.Nodes {
				for _, access := range node.Details.Accesses {
					if access.Name == "Cache" && access.Kind == "write" && strings.Contains(access.Mutation, "indexed element") {
						mutation = true
					}
				}
				if node.Details.Role == "defer" && node.Details.Limitation != "" {
					deferred = true
				}
				if node.Details.Role == "unsupported" {
					unsupported = true
					for _, edge := range behavior.Edges {
						if edge.Source == node.ID {
							t.Fatal("invented unsupported continuation", edge)
						}
					}
				}
			}
		}
	}
	if !mutation || !deferred || !unsupported {
		t.Fatalf("mutation=%v deferred=%v unsupported=%v", mutation, deferred, unsupported)
	}
}
