//go:build windows

package gitrepo

import (
	"os/exec"
	"syscall"
)

// hideWindow 阻止子进程新建控制台。
//
// 桌面版以 -H=windowsgui 构建，父进程没有控制台；Windows 会为每个控制台子系统
// 子进程（git.exe）临时分配一个，于是每次 git 调用都闪一个黑窗口。
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
