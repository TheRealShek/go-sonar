//go:build unix

package analysis

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// TestSpecialInputsRejectPromptly verifies FIFOs and symlinks to FIFOs never block fingerprinting.
func TestSpecialInputsRejectPromptly(t *testing.T) {
	for _, name := range []string{"blocked.go", "go.mod", "go.sum", "go.work", "go.work.sum", "linked.go"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			fifo := filepath.Join(root, name)
			if name == "linked.go" {
				fifo = filepath.Join(t.TempDir(), "fifo")
			}
			if err := syscall.Mkfifo(fifo, 0600); err != nil {
				t.Fatal(err)
			}
			if name == "linked.go" {
				if err := os.Symlink(fifo, filepath.Join(root, name)); err != nil {
					t.Fatal(err)
				}
			}
			done := make(chan error, 1)
			go func() { _, err := (&Engine{}).Analyze(context.Background(), root); done <- err }()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("accepted nonregular analysis input")
				}
			case <-time.After(time.Second):
				// Unblock a broken reader before reporting the regression, avoiding leaked test goroutines.
				fd, err := syscall.Open(fifo, syscall.O_WRONLY|syscall.O_NONBLOCK, 0)
				if err == nil {
					_ = os.Remove(fifo)
					_ = syscall.Close(fd)
				}
				<-done
				t.Fatal("nonregular input blocked analysis")
			}
		})
	}
}
