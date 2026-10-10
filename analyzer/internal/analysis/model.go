// Package analysis extracts source facts without executing project code.
package analysis

// Span locates a source declaration or expression using one-based coordinates.
type Span struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	EndLine   int    `json:"endLine"`
	EndColumn int    `json:"endColumn"`
}

// Symbol describes a type-resolved declaration.
type Symbol struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	QualifiedName string `json:"qualifiedName"`
	Kind          string `json:"kind"`
	PackageID     string `json:"packageId"`
	Source        Span   `json:"source"`
	Signature     string `json:"signature"`
	Documentation string `json:"documentation"`
	Exported      bool   `json:"exported"`
}

// Relation records a source-backed relationship between symbols.
type Relation struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	Target     string `json:"target"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Certainty  string `json:"certainty"`
	Evidence   Span   `json:"evidence"`
	Expression string `json:"expression"`
}

// Node describes one static operation or decision inside a function.
type Node struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Source Span   `json:"source"`

	RelatedSymbolID string         `json:"relatedSymbolId,omitempty"`
	Details         OperationFacts `json:"details"`
}

// Control connects behavior nodes through static control or data flow.
type Control struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
}

// Behavior contains the internal structure of one function.
type Behavior struct {
	SymbolID string    `json:"symbolId"`
	Nodes    []Node    `json:"nodes"`
	Edges    []Control `json:"edges"`
}

// Facts replaces the analysis facts of one package.
type Facts struct {
	SourceFingerprints map[string]string `json:"sourceFingerprints"`
	ID                 string            `json:"id"`
	Files              []string          `json:"files"`
	Fingerprint        string            `json:"fingerprint"`

	Imports   []string   `json:"imports"`
	Symbols   []Symbol   `json:"symbols"`
	Edges     []Relation `json:"edges"`
	Behaviors []Behavior `json:"behaviors"`
}

// Stats reports the work performed for one request.
type Stats struct {
	AnalyzedPackages int   `json:"analyzedPackages"`
	ReusedPackages   int   `json:"reusedPackages"`
	ChangedFiles     int   `json:"changedFiles"`
	DurationMS       int64 `json:"durationMs"`
}

// Diagnostic explains coverage limitations or invalid source.
type Diagnostic struct {
	Message   string `json:"message"`
	PackageID string `json:"packageId"`
	Severity  string `json:"severity"`
}

// Batch contains an atomic incremental analysis update.
type Batch struct {
	Full            bool     `json:"full"`
	Root            string   `json:"root"`
	Snapshot        string   `json:"snapshot"`
	Packages        []Facts  `json:"packages"`
	RemovedPackages []string `json:"removedPackages"`

	Stats       Stats        `json:"stats"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// OperationFacts explains source syntax without claiming value dependence.
type OperationFacts struct {
	Role        string        `json:"role"`
	Expression  string        `json:"expression"`
	Explanation string        `json:"explanation"`
	Limitation  string        `json:"limitation,omitempty"`
	Call        *CallBoundary `json:"call,omitempty"`
	Accesses    []Access      `json:"accesses,omitempty"`
}

// CallBoundary maps caller expressions to the type-resolved call signature.
type CallBoundary struct {
	Signature string       `json:"signature"`
	Receiver  string       `json:"receiver,omitempty"`
	Dispatch  string       `json:"dispatch"`
	Arguments []Argument   `json:"arguments"`
	Results   []CallResult `json:"results"`
	Variadic  bool         `json:"variadic"`
}

// Argument identifies a supplied parameter position, including variadic elements.
type Argument struct {
	Position   int    `json:"position"`
	Parameter  string `json:"parameter"`
	Type       string `json:"type"`
	Expression string `json:"expression"`
	Spread     bool   `json:"spread"`
	Variadic   bool   `json:"variadic"`
}

// CallResult identifies the destination of one returned position.
type CallResult struct {
	Position    int    `json:"position"`
	Type        string `json:"type"`
	Destination string `json:"destination"`
}

// Access is a source read, write, or definition with a shadow-safe object identity.
type Access struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Expression string `json:"expression"`
	Source     Span   `json:"source"`
	SymbolID   string `json:"symbolId,omitempty"`
	Mutation   string `json:"mutation,omitempty"`
}
