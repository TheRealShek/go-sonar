package analysis

import (
	"fmt"
	"go/ast"
	"go/token"
)

type flow struct {
	x    *extractor
	b    Behavior
	exit string
}

func (f *flow) node(kind, label string, n ast.Node) string {
	id := fmt.Sprintf("%s/behavior/%d", f.b.SymbolID, len(f.b.Nodes))
	f.b.Nodes = append(f.b.Nodes, Node{ID: id, Kind: kind, Label: label, Source: f.x.span(n)})
	return id
}
func (f *flow) link(a, b, label string) {
	if a == "" || b == "" {
		return
	}
	f.b.Edges = append(f.b.Edges, Control{fmt.Sprintf("%s/edge/%d", f.b.SymbolID, len(f.b.Edges)), a, b, "control", label})
}
func (x *extractor) behavior(id string, body *ast.BlockStmt) Behavior {
	f := &flow{x: x, b: Behavior{SymbolID: id, Nodes: []Node{}, Edges: []Control{}}}
	entry := f.node("entry", "entry", body)
	f.exit = f.node("exit", "exit", body)
	first := f.block(body.List, f.exit, "", "")
	f.link(entry, first, "")
	return f.b
}
func (f *flow) block(stmts []ast.Stmt, next, breakTo, continueTo string) string {
	for i := len(stmts) - 1; i >= 0; i-- {
		next = f.statement(stmts[i], next, breakTo, continueTo)
	}
	return next
}
func (f *flow) expression(n ast.Node, next string) string {
	if n == nil {
		return next
	}
	if _, ok := n.(*ast.FuncLit); ok {
		return next
	}
	if binary, ok := n.(*ast.BinaryExpr); ok && (binary.Op == token.LAND || binary.Op == token.LOR) {
		condition := f.node("condition", f.x.label(binary.X), binary.X)
		right := f.expression(binary.Y, next)
		if binary.Op == token.LAND {
			f.link(condition, right, "true")
			f.link(condition, next, "false")
		} else {
			f.link(condition, next, "true")
			f.link(condition, right, "false")
		}
		return f.expression(binary.X, condition)
	}
	if call, ok := n.(*ast.CallExpr); ok {
		id := f.node("call", f.x.label(call), call)
		if obj := f.x.callee(call.Fun); obj != nil {
			f.b.Nodes[len(f.b.Nodes)-1].RelatedSymbolID = f.x.symbol(obj, nil, "")
		}
		f.link(id, next, "")
		first := id
		for i := len(call.Args) - 1; i >= 0; i-- {
			first = f.expression(call.Args[i], first)
		}
		return f.expression(call.Fun, first)
	}
	children := []ast.Expr{}
	ast.Inspect(n, func(child ast.Node) bool {
		if child == nil {
			return false
		}
		if child == n {
			return true
		}
		if expr, ok := child.(ast.Expr); ok {
			children = append(children, expr)
			return false
		}
		return true
	})
	for i := len(children) - 1; i >= 0; i-- {
		next = f.expression(children[i], next)
	}
	return next
}
func (f *flow) statement(stmt ast.Stmt, next, breakTo, continueTo string) string {
	switch s := stmt.(type) {
	case *ast.BlockStmt:
		return f.block(s.List, next, breakTo, continueTo)
	case *ast.IfStmt:
		id := f.node("condition", f.x.label(s.Cond), s.Cond)
		f.link(id, f.block(s.Body.List, next, breakTo, continueTo), "true")
		other := next
		if s.Else != nil {
			other = f.statement(s.Else, next, breakTo, continueTo)
		}
		f.link(id, other, "false")
		first := f.expression(s.Cond, id)
		if s.Init != nil {
			first = f.statement(s.Init, first, breakTo, continueTo)
		}
		return first
	case *ast.ReturnStmt:
		id := f.node("return", f.x.label(s), s)
		f.link(id, f.exit, "return")
		return f.expression(s, id)
	case *ast.ForStmt:
		label := "for"
		if s.Cond != nil {
			label = f.x.label(s.Cond)
		}
		id := f.node("loop", label, s)
		condition := id
		if s.Cond != nil {
			condition = f.expression(s.Cond, id)
		}
		post := condition
		if s.Post != nil {
			post = f.statement(s.Post, condition, next, condition)
		}
		f.link(id, f.block(s.Body.List, post, next, post), "iterate")
		if s.Cond != nil {
			f.link(id, next, "false")
		}
		first := condition
		if s.Init != nil {
			first = f.statement(s.Init, first, breakTo, continueTo)
		}
		return first
	case *ast.RangeStmt:
		id := f.node("loop", f.x.label(s.Key)+" range "+f.x.label(s.X), s)
		f.link(id, f.block(s.Body.List, id, next, id), "next item")
		f.link(id, next, "done")
		return f.expression(s.X, id)
	case *ast.SwitchStmt:
		id := f.node("condition", "switch", s)
		hasDefault := false
		fallTo := next
		for i := len(s.Body.List) - 1; i >= 0; i-- {
			c := s.Body.List[i].(*ast.CaseClause)
			label := "default"
			if len(c.List) > 0 {
				label = "case "
				for j, e := range c.List {
					if j > 0 {
						label += ", "
					}
					label += f.x.label(e)
				}
			} else {
				hasDefault = true
			}
			body := c.Body
			target := next
			if len(body) > 0 {
				if br, ok := body[len(body)-1].(*ast.BranchStmt); ok && br.Tok == token.FALLTHROUGH {
					body = body[:len(body)-1]
					target = fallTo
				}
			}
			first := f.block(body, target, next, continueTo)
			f.link(id, first, label)
			fallTo = first
		}
		if !hasDefault {
			f.link(id, next, "no match")
		}
		first := id
		if s.Tag != nil {
			first = f.expression(s.Tag, id)
		}
		if s.Init != nil {
			first = f.statement(s.Init, first, breakTo, continueTo)
		}
		return first
	case *ast.BranchStmt:
		id := f.node("operation", f.x.label(s), s)
		target := ""
		if s.Label == nil {
			if s.Tok == token.BREAK {
				target = breakTo
			}
			if s.Tok == token.CONTINUE {
				target = continueTo
			}
		}
		f.link(id, target, s.Tok.String())
		return id
	case *ast.DeferStmt:
		id := f.node("operation", "register deferred call: "+f.x.label(s.Call), s)
		f.link(id, next, "")
		first := id
		for i := len(s.Call.Args) - 1; i >= 0; i-- {
			first = f.expression(s.Call.Args[i], first)
		}
		return first
	case *ast.GoStmt:
		id := f.node("operation", "start goroutine: "+f.x.label(s.Call), s)
		f.link(id, next, "")
		first := id
		for i := len(s.Call.Args) - 1; i >= 0; i-- {
			first = f.expression(s.Call.Args[i], first)
		}
		return first
	case *ast.TypeSwitchStmt, *ast.SelectStmt, *ast.LabeledStmt:
		id := f.node("operation", "control flow not expanded: "+f.x.label(s), s)
		return id
	}
	id := f.node("operation", f.x.label(stmt), stmt)
	f.link(id, next, "")
	return f.expression(stmt, id)
}
