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
	ID        string `json:"id"`
	Source    string `json:"source"`
	Target    string `json:"target"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Certainty string `json:"certainty"`
	Evidence  Span   `json:"evidence"`
}

// Node describes one static operation or decision inside a function.
type Node struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Label           string `json:"label"`
	Source          Span   `json:"source"`
	RelatedSymbolID string `json:"relatedSymbolId,omitempty"`
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
	Imports            []string          `json:"imports"`
	Symbols            []Symbol          `json:"symbols"`
	Edges              []Relation        `json:"edges"`
	Behaviors          []Behavior        `json:"behaviors"`
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
	Full            bool         `json:"full"`
	Root            string       `json:"root"`
	Snapshot        string       `json:"snapshot"`
	Packages        []Facts      `json:"packages"`
	RemovedPackages []string     `json:"removedPackages"`
	Stats           Stats        `json:"stats"`
	Diagnostics     []Diagnostic `json:"diagnostics"`
}
