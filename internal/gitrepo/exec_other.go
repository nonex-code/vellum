//go:build !windows

package gitrepo

import "os/exec"

// hideWindow 在非 Windows 上没有对应语义：子进程本就继承父进程的控制台。
func hideWindow(cmd *exec.Cmd) {}
