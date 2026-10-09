package analysis

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type inputs struct {
	root, config string
	files        map[string]string
}

func readRegularFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect input %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("input %s must be a regular file", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read input %s: %w", path, err)
	}
	return data, nil
}

func scanInputs(ctx context.Context, root string) (inputs, error) {
	result := inputs{root: root, files: map[string]string{}}
	result.config = runtime.Version() + "|" + runtime.GOOS + "|" + runtime.GOARCH
	for _, key := range []string{"GOOS", "GOARCH", "GOAMD64", "GOARM", "CGO_ENABLED", "CC", "CXX", "GOWORK", "GOROOT", "GOPATH", "GOMODCACHE", "GOEXPERIMENT"} {
		result.config += "|" + key + "=" + os.Getenv(key)
	}
	if workspace := os.Getenv("GOWORK"); workspace != "" && workspace != "off" {
		if !filepath.IsAbs(workspace) {
			return result, fmt.Errorf("GOWORK must be an absolute path or off")
		}
		data, err := readRegularFile(workspace)
		if err != nil {
			return result, err
		}
		result.config += workspace + hash(data)
		if data, err := readRegularFile(workspace + ".sum"); err == nil {
			result.config += workspace + ".sum" + hash(data)
		} else if !errors.Is(err, fs.ErrNotExist) {
			return result, err
		}
	}
	// Workspace configuration can be inherited from above the selected module.
	for directory := filepath.Dir(root); ; directory = filepath.Dir(directory) {
		for _, name := range []string{"go.work", "go.work.sum"} {
			path := filepath.Join(directory, name)
			data, err := readRegularFile(path)
			if err == nil {
				result.config += path + hash(data)
			} else if !errors.Is(err, fs.ErrNotExist) {
				return result, err
			}
		}
		if filepath.Dir(directory) == directory {
			break
		}
	}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() && path != root && (d.Name() == ".git" || d.Name() == "vendor" || d.Name() == "node_modules") {
			return filepath.SkipDir
		}
		if !d.IsDir() && (strings.HasSuffix(path, ".go") || d.Name() == "go.mod" || d.Name() == "go.sum" || d.Name() == "go.work" || d.Name() == "go.work.sum") {
			data, err := readRegularFile(path)
			if err != nil {
				return err
			}
			result.files[path] = hash(data)
			if !strings.HasSuffix(path, ".go") {
				result.config += path + result.files[path]
			}
		}
		return nil
	})
	return result, err
}

// Publication rechecks both file membership and content after loading, then commits
// cache metadata. A failed verification discards tentative cache changes entirely.
func (e *Engine) publish(ctx context.Context, input inputs, b Batch) (Batch, error) {
	current, err := scanInputs(ctx, input.root)
	if err != nil || current.config != input.config || !maps.Equal(current.files, input.files) {
		*e = Engine{}
		if err != nil {
			return Batch{}, fmt.Errorf("source/configuration changed during analysis; retry analysis: %w", err)
		}
		return Batch{}, fmt.Errorf("source/configuration changed during analysis; retry analysis")
	}
	e.root = input.root
	e.config = input.config
	e.files = input.files
	e.complete = true
	for _, diagnostic := range b.Diagnostics {
		if diagnostic.Severity == "error" {
			e.complete = false
		}
	}
	if !e.complete {
		b.Snapshot = "incomplete:" + b.Snapshot
	}
	return b, nil
}

func (input inputs) readSource(path string) ([]byte, error) {
	data, err := readRegularFile(path)
	if err != nil {
		return nil, fmt.Errorf("source changed during analysis; retry analysis: %w", err)
	}
	if expected, ok := input.files[path]; !ok || hash(data) != expected {
		return nil, fmt.Errorf("source %s changed during analysis; retry analysis", path)
	}
	return data, nil
}
