package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"go-sonar/analyzer/internal/analysis"
)

const maxRequestBytes = 1024 * 1024
const maxResponseBytes = 64 * 1024 * 1024

type request struct {
	Version int    `json:"version"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Root    string `json:"root"`
}

type response struct {
	Version int             `json:"version"`
	ID      string          `json:"id"`
	Result  *analysis.Batch `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scan := bufio.NewScanner(in)
	scan.Buffer(make([]byte, 4096), maxRequestBytes)
	engine := &analysis.Engine{}

	for scan.Scan() {
		incoming := request{}
		reply := response{Version: 1}
		err := json.Unmarshal(scan.Bytes(), &incoming)
		reply.ID = incoming.ID
		if err != nil {
			reply.Error = "invalid JSON request"
		} else if incoming.Version != 1 || incoming.Method != "analyze" || !filepath.IsAbs(incoming.Root) {
			reply.Error = "expected version 1 analyze request with root"
		} else {
			batch, err := engine.Analyze(ctx, incoming.Root)
			if err != nil {
				reply.Error = err.Error()
			} else {
				reply.Result = &batch
			}
		}

		data, err := json.Marshal(reply)
		if err != nil {
			return fmt.Errorf("encode response: %w", err)
		}
		if len(data)+1 > maxResponseBytes {
			engine = &analysis.Engine{}
			data, err = json.Marshal(response{
				Version: 1,
				ID:      reply.ID,
				Error:   "analysis response exceeds 64 MiB transport limit",
			})
			if err != nil {
				return fmt.Errorf("encode size error: %w", err)
			}
		}

		data = append(data, '\n')
		if _, err := out.Write(data); err != nil {
			return fmt.Errorf("write response: %w", err)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}

	if err := scan.Err(); err != nil {
		return fmt.Errorf("read request: %w", err)
	}
	return nil
}

func run(ctx context.Context) error {
	return serve(ctx, os.Stdin, os.Stdout)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx); err != nil {
		slog.Error("analyzer stopped", "error", err)
		os.Exit(1)
	}
}
