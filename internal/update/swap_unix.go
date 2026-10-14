//go:build !windows

package update

import (
	"fmt"
	"os"
	"os/exec"
)

// swapExecutable 用新二进制替换当前可执行文件。
//
// POSIX 下 rename 覆盖是原子的：旧进程继续持有已 unlink 的旧 inode，
// 新进程从同名路径读到的是新文件，不存在替换到一半的窗口。
func swapExecutable(exe, newBin string) (func() error, error) {
	if err := os.Rename(newBin, exe); err != nil {
		return nil, fmt.Errorf("替换程序失败: %w", err)
	}
	return func() error {
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if wd, err := os.Getwd(); err == nil {
			cmd.Dir = wd
		}
		return cmd.Start()
	}, nil
}

// CleanupOld 在 POSIX 上无需清理（旧 inode 随进程退出自动回收）。
func CleanupOld() {}
