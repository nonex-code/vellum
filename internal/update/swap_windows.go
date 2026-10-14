//go:build windows

package update

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// swapExecutable 用新二进制替换当前可执行文件。
//
// Windows 上正在运行的 .exe 不能被删除或覆盖，但可以被改名。于是：
//  1. 当前 exe → exe.old（保留备份）
//  2. 新二进制 → exe
//
// 任一步失败都尽量回滚。返回的函数用于启动新版本进程。
func swapExecutable(exe, newBin string) (func() error, error) {
	old := exe + ".old"
	_ = os.Remove(old) // 清理上次更新的残留（此时旧进程应已退出）
	if err := os.Rename(exe, old); err != nil {
		return nil, fmt.Errorf("备份当前程序失败: %w", err)
	}
	if err := os.Rename(newBin, exe); err != nil {
		_ = os.Rename(old, exe) // 回滚
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

// CleanupOld 删除上次更新遗留的 .old 备份（在新进程启动时调用）。
func CleanupOld() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return
	}
	_ = os.Remove(exe + ".old")
}
