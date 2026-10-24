package common

import "os"

// IsRunningAsRoot reports whether the process has root privileges: effective uid 0.
// It asks the kernel, not the user database: under a uid with no passwd entry (a
// container run as the host user, as CI does) user.Current() fails and returns nil.
func IsRunningAsRoot() bool {
	return os.Geteuid() == 0
}
