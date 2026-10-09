package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestProtocolEOF verifies bounded malformed requests and clean EOF shutdown.
func TestProtocolEOF(t *testing.T) {
	var out bytes.Buffer
	if err := serve(context.Background(), strings.NewReader("{bad}\n{\"version\":2,\"id\":\"x\",\"method\":\"analyze\"}\n"), &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatal(out.String())
	}
	for _, line := range lines {
		var r response
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatal(err)
		}
		if r.Error == "" || r.Result != nil {
			t.Fatal(r)
		}
	}
	if err := serve(context.Background(), strings.NewReader(strings.Repeat("a", maxRequestBytes+1)), &out); err == nil {
		t.Fatal("accepted oversized request")
	}
}
