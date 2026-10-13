package gitrepo

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Repo 表示一个本地 git 工作区。
type Repo struct {
	Dir string
}

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("git %s: %v: %s",
			strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

// IsGitDir 判断目录是否为 git 仓库。
func IsGitDir(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil && st.IsDir()
}

// EnsureURL 克隆远端到 dir；已在则拉取。
func EnsureURL(url, dir string) (*Repo, error) {
	if IsGitDir(dir) {
		r := &Repo{Dir: dir}
		_, _ = run(dir, "pull", "--rebase")
		return r, nil
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return nil, err
	}
	if _, err := run("", "clone", url, dir); err != nil {
		return nil, err
	}
	return &Repo{Dir: dir}, nil
}

// EnsureLocal 使用本地目录；不存在则创建，非 git 仓库则初始化。
func EnsureLocal(dir string) (*Repo, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if !IsGitDir(dir) {
		if _, err := run(dir, "init"); err != nil {
			return nil, err
		}
		_, _ = run(dir, "symbolic-ref", "HEAD", "refs/heads/main")
		if _, err := run(dir, "add", "-A"); err == nil {
			_, _ = run(dir, "-c", "user.name=vellum", "-c", "user.email=vellum@local",
				"commit", "-m", "init vellum")
		}
	}
	return &Repo{Dir: dir}, nil
}

// SetRemote 设置 origin 地址（已存在则更新）。
func (r *Repo) SetRemote(url string) error {
	if r.Remote() != "" {
		_, err := run(r.Dir, "remote", "set-url", "origin", url)
		return err
	}
	_, err := run(r.Dir, "remote", "add", "origin", url)
	return err
}

// Pull 拉取远端（rebase）。
func (r *Repo) Pull() error {
	_, err := run(r.Dir, "pull", "--rebase")
	return err
}

// CommitAll 暂存全部改动并提交；无改动时静默返回。
func (r *Repo) CommitAll(msg string) error {
	if _, err := run(r.Dir, "add", "-A"); err != nil {
		return err
	}
	// 有差异时 diff --cached --quiet 返回非零。
	if _, err := run(r.Dir, "diff", "--cached", "--quiet"); err == nil {
		return nil
	}
	_, err := run(r.Dir, "-c", "user.name=vellum", "-c", "user.email=vellum@local",
		"commit", "-m", msg)
	return err
}

// Push 推送当前分支到 origin（首次自动设置 upstream）；未配置 origin 时不做任何事。
func (r *Repo) Push() error {
	if r.Remote() == "" {
		return nil
	}
	_, err := run(r.Dir, "push", "--set-upstream", "origin", "HEAD")
	return err
}

// Head 返回短 hash。
func (r *Repo) Head() string {
	out, _ := run(r.Dir, "rev-parse", "--short", "HEAD")
	return strings.TrimSpace(out)
}

// Remote 返回 origin 地址。
func (r *Repo) Remote() string {
	out, _ := run(r.Dir, "remote", "get-url", "origin")
	return strings.TrimSpace(out)
}