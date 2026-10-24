package common

import (
	"os"
	"testing"
)

// IsRunningAsRoot is whether the effective uid is 0, and answers - rather than
// panics - under a uid the user database does not know: CI runs the build container
// as the runner's uid, which has no passwd entry there.
func TestIsRunningAsRoot(t *testing.T) {
	if got, want := IsRunningAsRoot(), os.Geteuid() == 0; got != want {
		t.Errorf("IsRunningAsRoot() = %v with euid %d", got, os.Geteuid())
	}
}
