package analysis

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/token"
	"go/types"
	"sort"

	"golang.org/x/tools/go/packages"
)

type extractor struct {
	pkg     *packages.Package
	facts   Facts
	ids     map[types.Object]string
	symbols map[string]bool
}

func (x *extractor) span(n ast.Node) Span {
	if n == nil {
		return Span{}
	}
	return x.positions(n.Pos(), n.End())
}

func (x *extractor) positions(start, end token.Pos) Span {
	first := x.pkg.Fset.Position(start)
	last := x.pkg.Fset.Position(end)

	return Span{
		File:      first.Filename,
		Line:      first.Line,
		Column:    first.Column,
		EndLine:   last.Line,
		EndColumn: last.Column,
	}
}

func (x *extractor) label(n ast.Node) string {
	var b bytes.Buffer
	_ = format.Node(&b, x.pkg.Fset, n)
	return b.String()
}

func objectID(obj types.Object) string {
	pkg := "builtin"
	if obj.Pkg() != nil {
		pkg = obj.Pkg().Path()
	}
	name := obj.Name()
	if fn, ok := obj.(*types.Func); ok {
		if sig, ok := fn.Type().(*types.Signature); ok && sig.Recv() != nil {
			receiver := types.TypeString(sig.Recv().Type(), func(p *types.Package) string {
				return p.Path()
			})
			name = receiver + "." + name
		}
	}
	return pkg + "::" + name
}

func (x *extractor) symbol(obj types.Object, n ast.Node, doc string) string {
	if obj == nil {
		return ""
	}
	if variable, ok := obj.(*types.Var); ok && !variable.IsField() && (variable.Pkg() == nil || variable.Parent() != variable.Pkg().Scope()) {
		return ""
	}
	if name, ok := obj.(*types.TypeName); ok {
		if _, ok := name.Type().(*types.TypeParam); ok {
			return ""
		}
	}

	id := x.ids[obj]
	if id == "" {
		id = objectID(obj)
		x.ids[obj] = id
	}
	if x.symbols[id] {
		return id
	}

	kind := "variable"
	switch o := obj.(type) {
	case *types.Func:
		kind = "function"
		if o.Type().(*types.Signature).Recv() != nil {
			kind = "method"
		}
	case *types.TypeName:
		kind = "type"
		switch o.Type().Underlying().(type) {
		case *types.Struct:
			kind = "struct"
		case *types.Interface:
			kind = "interface"
		}
	case *types.Const:
		kind = "constant"
	case *types.Var:
		if o.IsField() {
			kind = "field"
		}
	case *types.Builtin:
		kind = "function"
	}

	pkg := "builtin"
	if obj.Pkg() != nil {
		pkg = obj.Pkg().Path()
	}
	source := x.span(n)
	if n == nil {
		source = x.positions(obj.Pos(), obj.Pos())
		if source.File == "" {
			doc = "External declaration; source unavailable in loaded export data."
		}
	}
	signature := types.ObjectString(obj, func(p *types.Package) string {
		return p.Path()
	})
	x.facts.Symbols = append(x.facts.Symbols, Symbol{
		ID:            id,
		Name:          obj.Name(),
		QualifiedName: id,
		Kind:          kind,
		PackageID:     pkg,
		Source:        source,
		Signature:     signature,
		Documentation: doc,
		Exported:      obj.Exported(),
	})
	x.symbols[id] = true
	return id
}

func extract(p *packages.Package) Facts {
	x := &extractor{
		pkg:     p,
		ids:     map[types.Object]string{},
		symbols: map[string]bool{},
		facts: Facts{
			ID:        p.PkgPath,
			Files:     append([]string{}, p.GoFiles...),
			Imports:   []string{},
			Symbols:   []Symbol{},
			Edges:     []Relation{},
			Behaviors: []Behavior{},
		},
	}
	for path := range p.Imports {
		x.facts.Imports = append(x.facts.Imports, path)
	}

	// Assign field identities before collecting any uses, including fields with the same name.
	for _, name := range p.Types.Scope().Names() {
		if obj, ok := p.Types.Scope().Lookup(name).(*types.TypeName); ok {
			if structure, ok := obj.Type().Underlying().(*types.Struct); ok {
				for i := 0; i < structure.NumFields(); i++ {
					field := structure.Field(i)
					x.ids[field] = objectID(obj) + "." + field.Name()
				}
			}
		}
	}
	for _, f := range p.Syntax {
		for _, decl := range f.Decls {
			g, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range g.Specs {
				t, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				owner := p.TypesInfo.Defs[t.Name]
				if owner == nil {
					continue
				}
				ast.Inspect(t.Type, func(n ast.Node) bool {
					field, ok := n.(*ast.Field)
					if !ok {
						return true
					}
					for _, name := range field.Names {
						if obj, ok := p.TypesInfo.Defs[name].(*types.Var); ok && obj.IsField() {
							x.ids[obj] = objectID(owner) + "." + obj.Name()
						}
					}
					return true
				})
			}
		}
	}

	// Register source declarations first so references retain full evidence and documentation.
	for _, file := range p.Syntax {
		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				x.symbol(p.TypesInfo.Defs[d.Name], d, comment(d.Doc))
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch v := spec.(type) {
					case *ast.TypeSpec:
						x.symbol(p.TypesInfo.Defs[v.Name], v, comment(d.Doc))
						ast.Inspect(v.Type, func(n ast.Node) bool {
							if id, ok := n.(*ast.Ident); ok {
								if obj := p.TypesInfo.Defs[id]; obj != nil {
									x.symbol(obj, id, "")
								}
							}
							return true
						})
					case *ast.ValueSpec:
						for _, name := range v.Names {
							x.symbol(p.TypesInfo.Defs[name], v, comment(d.Doc))
						}
					}
				}
			}
		}
	}

	// Register imported named fields, including keyed composite literals without selections.
	for _, value := range p.TypesInfo.Types {
		t := value.Type
		if pointer, ok := t.(*types.Pointer); ok {
			t = pointer.Elem()
		}
		if named, ok := t.(*types.Named); ok {
			if structure, ok := named.Underlying().(*types.Struct); ok {
				for i := 0; i < structure.NumFields(); i++ {
					field := structure.Field(i)
					x.ids[field] = objectID(named.Obj()) + "." + field.Name()
				}
			}
		}
	}

	// Imported fields use their declaring named type, including promoted fields.
	for _, selection := range p.TypesInfo.Selections {
		obj, ok := selection.Obj().(*types.Var)
		if !ok || !obj.IsField() {
			continue
		}
		t := selection.Recv()
		if pointer, ok := t.(*types.Pointer); ok {
			t = pointer.Elem()
		}
		indices := selection.Index()
		for depth, index := range indices {
			st, ok := t.Underlying().(*types.Struct)
			if !ok {
				break
			}
			field := st.Field(index)
			if depth == len(indices)-1 {
				if named, ok := t.(*types.Named); ok {
					x.ids[obj] = objectID(named.Obj()) + "." + field.Name()
				}
			} else {
				t = field.Type()
				if pointer, ok := t.(*types.Pointer); ok {
					t = pointer.Elem()
				}
			}
		}
	}

	for _, f := range p.Syntax {
		for _, decl := range f.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				obj := p.TypesInfo.Defs[d.Name]
				id := x.symbol(obj, d, comment(d.Doc))
				x.relations(id, d)
				if d.Body != nil {
					x.facts.Behaviors = append(x.facts.Behaviors, x.behavior(id, d.Body))
				}
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						id := x.symbol(p.TypesInfo.Defs[s.Name], s, comment(d.Doc))
						ast.Inspect(s.Type, func(n ast.Node) bool {
							if ident, ok := n.(*ast.Ident); ok {
								if obj := p.TypesInfo.Defs[ident]; obj != nil {
									x.symbol(obj, ident, "")
								}
							}
							return true
						})
						x.relations(id, s.Type)
					case *ast.ValueSpec:
						for _, name := range s.Names {
							id := x.symbol(p.TypesInfo.Defs[name], s, comment(d.Doc))
							x.relations(id, s)
						}
					}
				}
			}
		}
	}

	// Interface satisfaction is a possible implementation relationship, not a dynamic call target.
	namedTypes := []*types.Named{}
	interfaces := []*types.Named{}
	for _, name := range p.Types.Scope().Names() {
		if obj, ok := p.Types.Scope().Lookup(name).(*types.TypeName); ok {
			if named, ok := obj.Type().(*types.Named); ok {
				namedTypes = append(namedTypes, named)
				if _, ok := named.Underlying().(*types.Interface); ok {
					interfaces = append(interfaces, named)
				}
			}
		}
	}

	for _, named := range namedTypes {
		if _, ok := named.Underlying().(*types.Interface); ok {
			continue
		}
		for _, contract := range interfaces {
			iface := contract.Underlying().(*types.Interface)
			if types.Implements(named, iface) || types.Implements(types.NewPointer(named), iface) {
				owner, target := x.symbol(named.Obj(), nil, ""), x.symbol(contract.Obj(), nil, "")
				id := owner + ":implements:" + target
				x.facts.Edges = append(x.facts.Edges, Relation{
					ID:        id,
					Source:    owner,
					Target:    target,
					Kind:      "implements",
					Label:     "compatible with " + contract.Obj().Name(),
					Certainty: "possible",
					Evidence:  x.positions(named.Obj().Pos(), named.Obj().Pos()),
				})
			}
		}
	}

	sort.Strings(x.facts.Files)
	sort.Strings(x.facts.Imports)
	sort.Slice(x.facts.Symbols, func(i, j int) bool { return x.facts.Symbols[i].ID < x.facts.Symbols[j].ID })
	sort.Slice(x.facts.Edges, func(i, j int) bool { return x.facts.Edges[i].ID < x.facts.Edges[j].ID })
	return x.facts
}

func comment(c *ast.CommentGroup) string {
	if c == nil {
		return ""
	}
	return c.Text()
}

func (x *extractor) edge(owner string, obj types.Object, kind string, n ast.Node, certainty string) {
	if obj == nil || owner == "" {
		return
	}
	if v, ok := obj.(*types.Var); ok && !v.IsField() && (obj.Pkg() == nil || obj.Parent() != obj.Pkg().Scope()) {
		return
	}
	target := x.symbol(obj, nil, "")
	if target == "" {
		return
	}
	evidence := x.span(n)
	id := fmt.Sprintf("%s:%s:%s:%s:%d:%d", owner, kind, target, evidence.File, evidence.Line, evidence.Column)
	x.facts.Edges = append(x.facts.Edges, Relation{
		ID:        id,
		Source:    owner,
		Target:    target,
		Kind:      kind,
		Label:     kind + " " + obj.Name(),
		Certainty: certainty,
		Evidence:  evidence,
	})
}

func (x *extractor) callee(expr ast.Expr) types.Object {
	switch e := expr.(type) {
	case *ast.Ident:
		return x.pkg.TypesInfo.Uses[e]
	case *ast.SelectorExpr:
		return x.pkg.TypesInfo.Uses[e.Sel]
	case *ast.IndexExpr:
		return x.callee(e.X)
	case *ast.IndexListExpr:
		return x.callee(e.X)
	case *ast.ParenExpr:
		return x.callee(e.X)
	}
	return nil
}

func (x *extractor) relations(owner string, n ast.Node) {
	writes := map[*ast.Ident]bool{}
	reads := map[*ast.Ident]bool{}
	calls := map[*ast.Ident]bool{}
	ast.Inspect(n, func(node ast.Node) bool {
		switch s := node.(type) {
		case *ast.FuncLit:
			return false
		case *ast.AssignStmt:
			for _, lhs := range s.Lhs {
				if index, ok := lhs.(*ast.IndexExpr); ok {
					lhs = index.X
				}
				if selector, ok := lhs.(*ast.SelectorExpr); ok && s.Tok != token.ASSIGN && s.Tok != token.DEFINE {
					reads[selector.Sel] = true
				}
				switch lhs := lhs.(type) {
				case *ast.Ident:
					writes[lhs] = true
				case *ast.SelectorExpr:
					writes[lhs.Sel] = true
				}
			}
		case *ast.IncDecStmt:
			switch lhs := s.X.(type) {
			case *ast.Ident:
				writes[lhs] = true
			case *ast.SelectorExpr:
				writes[lhs.Sel] = true
				reads[lhs.Sel] = true
			}
		case *ast.CallExpr:
			obj := x.callee(s.Fun)
			if obj != nil {
				kind, certainty := "calls", "resolved"
				if _, ok := obj.(*types.TypeName); ok {
					kind = "uses_type"
				}
				if _, ok := obj.(*types.Var); ok {
					certainty = "possible"
				}
				if sel, ok := s.Fun.(*ast.SelectorExpr); ok {
					if selection := x.pkg.TypesInfo.Selections[sel]; selection != nil {
						if _, ok := selection.Recv().Underlying().(*types.Interface); ok {
							certainty = "possible"
						}
					}
					calls[sel.Sel] = true
				}
				if id, ok := s.Fun.(*ast.Ident); ok {
					calls[id] = true
				}
				x.edge(owner, obj, kind, s, certainty)
			}
		case *ast.CompositeLit:
			for _, element := range s.Elts {
				if pair, ok := element.(*ast.KeyValueExpr); ok {
					if key, ok := pair.Key.(*ast.Ident); ok {
						writes[key] = true
					}
				}
			}
			if obj := x.callee(s.Type); obj != nil {
				x.edge(owner, obj, "constructs", s, "resolved")
			}
		}
		return true
	})

	ast.Inspect(n, func(node ast.Node) bool {
		if _, ok := node.(*ast.FuncLit); ok {
			return false
		}
		id, ok := node.(*ast.Ident)
		if !ok {
			return true
		}
		obj := x.pkg.TypesInfo.Uses[id]
		if obj == nil || calls[id] {
			return true
		}
		kind := "references"
		switch obj.(type) {
		case *types.TypeName:
			kind = "uses_type"
		case *types.Var:
			kind = "reads"
			if writes[id] {
				kind = "writes"
			}
		}
		x.edge(owner, obj, kind, id, "resolved")
		if reads[id] {
			x.edge(owner, obj, "reads", id, "resolved")
		}
		return true
	})
}
