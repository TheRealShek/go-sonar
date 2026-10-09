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
	requests := "{bad}\n{\"version\":2,\"id\":\"x\",\"method\":\"analyze\"}\n"
	if err := serve(context.Background(), strings.NewReader(requests), &out); err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatal(out.String())
	}
	for _, line := range lines {
		var reply response
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			t.Fatal(err)
		}
		if reply.Error == "" || reply.Result != nil {
			t.Fatal(reply)
		}
	}

	if err := serve(context.Background(), strings.NewReader(strings.Repeat("a", maxRequestBytes+1)), &out); err == nil {
		t.Fatal("accepted oversized request")
	}
}
