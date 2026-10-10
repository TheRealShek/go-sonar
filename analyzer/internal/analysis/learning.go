package analysis

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// operation derives explanations from typed syntax, keeping unsupported flow explicit.
func (x *extractor) operation(kind string, n ast.Node) OperationFacts {
	d := OperationFacts{Role: kind, Expression: x.label(n)}
	evidence := n
	switch kind {
	case "entry":
		d.Expression = "entry"
		d.Explanation = "Start at the function entry. Follow a static source path."
		return d
	case "exit":
		d.Expression = "exit"
		d.Explanation = "Leave the function. Deferred and concurrent execution is not expanded."
		return d
	case "condition":
		d.Explanation = "This checks " + d.Expression + ". Choose a source-defined branch."
		if s, ok := n.(*ast.SwitchStmt); ok {
			evidence = s.Tag
			d.Expression = "switch"
			if s.Tag != nil {
				d.Expression += " " + x.label(s.Tag)
			}
			d.Explanation = "This selects a switch case. Case expressions are not expanded into execution paths."
			d.Limitation = "Case evaluation order and calls within case expressions are not expanded."
		}
	case "loop":
		switch s := n.(type) {
		case *ast.ForStmt:
			evidence = s.Cond
			d.Expression = "for"
			if s.Cond != nil {
				d.Expression += " " + x.label(s.Cond)
			}
		case *ast.RangeStmt:
			evidence = s.X
			d.Expression = "range " + x.label(s.X)
		}
		d.Explanation = "This loop offers its body and any source-defined exit. Loop repetitions stay bounded."
	case "call":
		if call, ok := n.(*ast.CallExpr); ok {
			d.Call = x.callBoundary(call)
			d.Explanation = "This invokes " + x.label(call.Fun) + " with the shown argument expressions."
			if _, ok := x.callee(call.Fun).(*types.TypeName); ok {
				d.Role = "conversion"
				d.Explanation = "This converts a value to " + x.label(call.Fun) + ". It is not a function invocation."
			}
			if d.Call == nil {
				d.Limitation = "No callable signature is available. Builtins and conversions have special language rules."
			} else if d.Call.Dispatch != "direct" {
				d.Limitation = "The callable contract is known; the concrete implementation is unresolved."
			}
		}
	case "return":
		d.Explanation = "This returns the source expressions: " + d.Expression + "."
		if s, ok := n.(*ast.ReturnStmt); ok && len(s.Results) == 0 {
			d.Explanation = "This returns the current named results. Their values are not inferred."
		}
	default:
		d.Explanation = "This performs " + d.Expression + "."
		switch n.(type) {
		case *ast.DeferStmt:
			d.Role = "defer"
			d.Explanation = "This registers a deferred call. Its execution path is not expanded."
			d.Limitation = "Deferred execution and its effects are not expanded."
		case *ast.GoStmt:
			d.Role = "goroutine"
			d.Explanation = "This starts a goroutine. Its concurrent execution path is not expanded."
			d.Limitation = "Concurrent ordering and effects are unknown."
		case *ast.TypeSwitchStmt, *ast.SelectStmt, *ast.LabeledStmt:
			d.Role = "unsupported"
			d.Explanation = "Analysis stops at this unsupported control region."
			d.Limitation = "The continuation is unknown; this is not a completed path."
			return d
		case *ast.BranchStmt:
			s := n.(*ast.BranchStmt)
			if s.Label != nil || s.Tok == token.GOTO || s.Tok == token.FALLTHROUGH {
				d.Role = "unsupported"
				d.Limitation = "This control transfer has no analyzed continuation."
			}
		}
	}
	if assignment, ok := n.(*ast.AssignStmt); ok {
		for _, lhs := range assignment.Lhs {
			if _, ok := lhs.(*ast.StarExpr); ok {
				d.Limitation = "A pointer target is updated. Aliasing and the affected value are not tracked."
			}
		}
		for _, rhs := range assignment.Rhs {
			if unary, ok := rhs.(*ast.UnaryExpr); ok && unary.Op == token.AND {
				d.Limitation = "An address is taken. Subsequent alias effects are not tracked."
			}
		}
	}
	if evidence != nil {
		d.Accesses = x.accesses(evidence)
	}
	if loop, ok := n.(*ast.RangeStmt); ok && kind == "loop" {
		d.Accesses = append(d.Accesses, x.rangeBindings(loop)...)
		for _, binding := range []ast.Expr{loop.Key, loop.Value} {
			if _, pointer := ast.Unparen(binding).(*ast.StarExpr); pointer {
				d.Limitation = "A range value is written through a pointer on each iteration. Aliasing and the affected value are not tracked."
			}
		}
	}
	return d
}

// callBoundary uses the instantiated callable type and the syntactic result destination.
func (x *extractor) callBoundary(call *ast.CallExpr) *CallBoundary {
	sig, ok := x.pkg.TypesInfo.TypeOf(call.Fun).(*types.Signature)
	if !ok {
		return nil
	}
	d := &CallBoundary{Signature: types.TypeString(sig, nil), Dispatch: "direct", Variadic: sig.Variadic(), Arguments: []Argument{}, Results: []CallResult{}}
	obj := x.callee(call.Fun)
	if _, ok := obj.(*types.Var); ok || obj == nil {
		d.Dispatch = "dynamic"
	}
	supplied := x.suppliedArguments(call)
	parameterOffset := 0
	callable := callableSyntax(call.Fun)
	if selector, ok := callable.(*ast.SelectorExpr); ok {
		if selection := x.pkg.TypesInfo.Selections[selector]; selection != nil {
			if selection.Kind() == types.MethodVal {
				d.Receiver = x.label(selector.X)
			}
			if selection.Kind() == types.MethodExpr && len(supplied) > 0 {
				d.Receiver = supplied[0].Expression
				supplied = supplied[1:]
				parameterOffset = 1
			}
			if _, ok := selection.Recv().Underlying().(*types.Interface); ok {
				d.Dispatch = "interface"
			}
		}
	}
	for i, argument := range supplied {
		position := i + parameterOffset
		if sig.Variadic() && position >= sig.Params().Len() {
			position = sig.Params().Len() - 1
		}
		if position < 0 || position >= sig.Params().Len() {
			continue
		}
		parameter := sig.Params().At(position)
		argument.Position = position + 1 - parameterOffset
		argument.Parameter = parameter.Name()
		if argument.Parameter == "" {
			argument.Parameter = fmt.Sprintf("parameter %d", argument.Position)
		}
		argument.Type = types.TypeString(parameter.Type(), nil)
		argument.Variadic = sig.Variadic() && position == sig.Params().Len()-1
		d.Arguments = append(d.Arguments, argument)
	}
	for i := 0; i < sig.Results().Len(); i++ {
		d.Results = append(d.Results, CallResult{Position: i + 1, Type: types.TypeString(sig.Results().At(i).Type(), nil), Destination: x.resultDestination(call, i, sig.Results().Len())})
	}
	return d
}

// suppliedArguments expands a sole tuple before separating a method-expression receiver.
func (x *extractor) suppliedArguments(call *ast.CallExpr) []Argument {
	var supplied []Argument
	for i, expression := range call.Args {
		label := x.label(expression)
		if len(call.Args) == 1 {
			if tuple, ok := x.pkg.TypesInfo.TypeOf(expression).(*types.Tuple); ok {
				for j := 0; j < tuple.Len(); j++ {
					supplied = append(supplied, Argument{Expression: fmt.Sprintf("%s, result %d", label, j+1)})
				}
				continue
			}
		}
		supplied = append(supplied, Argument{Expression: label, Spread: call.Ellipsis.IsValid() && i == len(call.Args)-1})
	}
	return supplied
}

// resultDestination records positional source mappings without inferring reaching values.
func (x *extractor) resultDestination(call *ast.CallExpr, position, count int) string {
	var expression ast.Expr = call
	parent := x.parents[expression]
	for {
		paren, ok := parent.(*ast.ParenExpr)
		if !ok {
			break
		}
		expression = paren
		parent = x.parents[paren]
	}
	switch statement := parent.(type) {
	case *ast.AssignStmt:
		if len(statement.Rhs) == 1 && position < len(statement.Lhs) {
			return x.label(statement.Lhs[position])
		}
		if count == 1 && len(statement.Rhs) == len(statement.Lhs) {
			for i, value := range statement.Rhs {
				if value == expression {
					return x.label(statement.Lhs[i])
				}
			}
		}
	case *ast.ValueSpec:
		if len(statement.Values) == 1 && position < len(statement.Names) {
			return statement.Names[position].Name
		}
		if count == 1 && len(statement.Values) == len(statement.Names) {
			for i, value := range statement.Values {
				if value == expression {
					return statement.Names[i].Name
				}
			}
		}
	case *ast.ExprStmt:
		return "discarded"
	case *ast.ReturnStmt:
		if len(statement.Results) == 1 {
			return fmt.Sprintf("caller return position %d", position+1)
		}
		if count == 1 {
			for i, value := range statement.Results {
				if value == expression {
					return fmt.Sprintf("caller return position %d", i+1)
				}
			}
		}
	}
	return "used by enclosing expression"
}

// accesses records object identities and syntax, without alias or reaching-value claims.
func (x *extractor) accesses(n ast.Node) []Access {
	var result []Access
	writes := map[*ast.Ident]string{}
	mutations := map[*ast.Ident]string{}
	mark := func(lhs ast.Expr, kind string) {
		mutation := "replace binding"
		if index, ok := lhs.(*ast.IndexExpr); ok {
			lhs = index.X
			mutation = "update indexed element; the container binding is retained"
		}
		if _, ok := lhs.(*ast.StarExpr); ok {
			return
		}
		var id *ast.Ident
		switch e := lhs.(type) {
		case *ast.Ident:
			id = e
		case *ast.SelectorExpr:
			id = e.Sel
		}
		if id != nil {
			writes[id] = kind
			mutations[id] = mutation
		}
	}
	ast.Inspect(n, func(node ast.Node) bool {
		switch s := node.(type) {
		case *ast.FuncLit:
			return false
		case *ast.AssignStmt:
			for _, lhs := range s.Lhs {
				kind := "write"
				if s.Tok != token.ASSIGN && s.Tok != token.DEFINE {
					kind = "read_write"
				}
				mark(lhs, kind)
			}
		case *ast.IncDecStmt:
			mark(s.X, "read_write")
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
		kind := "read"
		if def := x.pkg.TypesInfo.Defs[id]; def != nil {
			obj = def
			kind = "define"
		}
		variable, ok := obj.(*types.Var)
		if !ok {
			return true
		}
		if write := writes[id]; write != "" && kind != "define" {
			kind = write
		}
		symbol := x.symbol(variable, nil, "")
		identity := symbol
		if identity == "" {
			position := x.pkg.Fset.Position(variable.Pos())
			identity = fmt.Sprintf("%s/local/%s:%d:%d", x.pkg.PkgPath, position.Filename, position.Line, position.Column)
		}
		expression := ast.Node(id)
		if sel, ok := x.parents[id].(*ast.SelectorExpr); ok && sel.Sel == id {
			expression = sel
		}
		result = append(result, Access{ID: identity, Name: id.Name, Kind: kind, Expression: x.label(expression), Source: x.span(id), SymbolID: symbol, Mutation: mutations[id]})
		return true
	})
	return result
}

// rangeBindings records per-iteration assignments separately from range-expression and body reads.
func (x *extractor) rangeBindings(loop *ast.RangeStmt) []Access {
	var bindings []ast.Expr
	for _, expression := range []ast.Expr{loop.Key, loop.Value} {
		if expression == nil {
			continue
		}
		if id, ok := expression.(*ast.Ident); ok && id.Name == "_" {
			continue
		}
		bindings = append(bindings, expression)
	}
	accesses := x.accesses(&ast.AssignStmt{Lhs: bindings, Tok: loop.Tok})
	for i := range accesses {
		if accesses[i].Kind == "define" || accesses[i].Kind == "write" {
			accesses[i].Mutation = "assign range binding on each iteration; " + accesses[i].Mutation
		}
	}
	return accesses
}
