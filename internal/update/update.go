// Package update 实现基于 GitHub Releases 的自更新：
// 检查最新发行版、下载当前平台产物、校验 SHA256、原子替换可执行文件并重启。
//
// 说明：本项目是 Go 静态编译的单文件程序（前端还通过 go:embed 编进二进制），
// 因此这里做的是「自替换 + 重启」而非不重启的热打补丁——换前端同样需要换整个二进制。
// 替换采用同目录 rename（POSIX 原子；Windows 上正在运行的 .exe 不能删改但可以改名），
// 并保留 .old 备份供下次启动清理/回滚。
package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// defaultRepo 是发行版所在的 GitHub 仓库（owner/name）。
const defaultRepo = "nonex-code/vellum"

// defaultAPIBase 是 GitHub API 根地址；可用 WB_UPDATE_API 覆盖（测试或 GitHub 企业版）。
const defaultAPIBase = "https://api.github.com"

// Info 是一次版本检查的结果，直接序列化给前端。
type Info struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	Available   bool   `json:"available"`
	Notes       string `json:"notes,omitempty"`
	URL         string `json:"url,omitempty"`
	Asset       string `json:"asset,omitempty"`
	Size        int64  `json:"size,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`

	// 以下为内部字段，不对外序列化。
	assetURL    string
	checksumURL string
}

// Updater 查询并应用某个 GitHub 仓库的最新发行版。
type Updater struct {
	repo    string
	apiBase string
	client  *http.Client
	token   string
}

// New 构造 Updater；repo 为空时使用内置默认仓库。
// token 依次从 WB_UPDATE_TOKEN / GITHUB_TOKEN / GH_TOKEN 读取，用于私有仓库或提高限额。
func New(repo string) *Updater {
	if strings.TrimSpace(repo) == "" {
		repo = defaultRepo
	}
	return &Updater{
		repo:    strings.Trim(strings.TrimSpace(repo), "/"),
		apiBase: strings.TrimRight(firstEnv("WB_UPDATE_API"), "/"),
		client:  &http.Client{Timeout: 60 * time.Second},
		token:   firstEnv("WB_UPDATE_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"),
	}
}

// Repo 返回当前配置的 owner/name。
func (u *Updater) Repo() string { return u.repo }

type release struct {
	TagName     string  `json:"tag_name"`
	Body        string  `json:"body"`
	HTMLURL     string  `json:"html_url"`
	PublishedAt string  `json:"published_at"`
	Prerelease  bool    `json:"prerelease"`
	Assets      []asset `json:"assets"`
}

type asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Check 查询最新发行版，并与 current 比较。
func (u *Updater) Check(current string) (*Info, error) {
	rel, err := u.latestRelease()
	if err != nil {
		return nil, err
	}
	info := &Info{
		Current:     current,
		Latest:      rel.TagName,
		Notes:       rel.Body,
		URL:         rel.HTMLURL,
		PublishedAt: rel.PublishedAt,
	}
	a := u.pickAsset(rel)
	if a != nil {
		info.Asset = a.Name
		info.Size = a.Size
		info.assetURL = a.BrowserDownloadURL
	}
	if c := findAsset(rel.Assets, "checksums.txt"); c != nil {
		info.checksumURL = c.BrowserDownloadURL
	}
	info.Available = a != nil && newer(rel.TagName, current)
	return info, nil
}

// Apply 下载并替换当前可执行文件，返回一个「启动新版本」的函数。
// 调用方应先把 HTTP 响应写回，再调用返回的函数并退出当前进程。
func (u *Updater) Apply(info *Info) (func() error, error) {
	if info == nil || info.assetURL == "" {
		return nil, errors.New("没有适用于当前平台的更新包")
	}
	if info.checksumURL == "" {
		return nil, errors.New("该发行版缺少 checksums.txt，拒绝更新")
	}

	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return nil, err
	}
	dir := filepath.Dir(exe)

	sums, err := u.fetchChecksums(info.checksumURL)
	if err != nil {
		return nil, err
	}
	want, ok := sums[info.Asset]
	if !ok {
		return nil, fmt.Errorf("checksums.txt 中缺少 %s，拒绝更新", info.Asset)
	}

	// 归档与解压后的二进制都放在可执行文件同目录：rename 必须跨同一文件系统才原子。
	archive := filepath.Join(dir, fmt.Sprintf(".vellum-update-%d.tmp", os.Getpid()))
	defer os.Remove(archive)
	got, err := u.download(info.assetURL, archive)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(want, got) {
		return nil, fmt.Errorf("校验失败：期望 %s，实际 %s", want, got)
	}

	newBin := filepath.Join(dir, fmt.Sprintf(".vellum-new-%d.tmp", os.Getpid()))
	if runtime.GOOS == "windows" {
		newBin += ".exe"
	}
	if err := extractBinary(archive, info.Asset, newBin); err != nil {
		_ = os.Remove(newBin)
		return nil, err
	}
	if err := os.Chmod(newBin, 0o755); err != nil {
		_ = os.Remove(newBin)
		return nil, err
	}

	return swapExecutable(exe, newBin)
}

// latestRelease 拉取 /releases/latest（不含预发行版）。
func (u *Updater) latestRelease() (*release, error) {
	base := u.apiBase
	if base == "" {
		base = defaultAPIBase
	}
	url := base + "/repos/" + u.repo + "/releases/latest"
	resp, err := u.get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, errors.New("未找到发行版：仓库不存在或尚未发布任何 Release")
	default:
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("查询发行版失败: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var r release
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (u *Updater) pickAsset(rel *release) *asset {
	want := assetName(rel.TagName, Mode, runtime.GOOS, runtime.GOARCH)
	if a := findAsset(rel.Assets, want); a != nil {
		return a
	}
	// 命名规则若变动，退化为在同类产物里挑一个最匹配的。
	prefix := "vellum-" + rel.TagName + "-"
	var best *asset
	for i := range rel.Assets {
		a := &rel.Assets[i]
		n := a.Name
		if !strings.HasPrefix(n, prefix) || strings.HasSuffix(n, ".txt") {
			continue
		}
		isDesktop := strings.Contains(n, "-desktop-")
		if (Mode == "desktop") != isDesktop {
			continue
		}
		if Mode == "web" && (!strings.Contains(n, runtime.GOOS) || !strings.Contains(n, runtime.GOARCH)) {
			continue
		}
		if !strings.HasSuffix(n, ".zip") && !strings.HasSuffix(n, ".tar.gz") {
			continue
		}
		if best == nil {
			best = a
		}
	}
	return best
}

func (u *Updater) fetchChecksums(url string) (map[string]string, error) {
	resp, err := u.get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载 checksums.txt 失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		out[name] = fields[0]
	}
	if len(out) == 0 {
		return nil, errors.New("checksums.txt 内容为空")
	}
	return out, nil
}

// download 把 url 下载到 dst，同时返回内容的 SHA256（十六进制）。
func (u *Updater) download(url, dst string) (string, error) {
	resp, err := u.get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}
	f, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(f, h), resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (u *Updater) get(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "vellum-updater/"+Mode)
	if u.token != "" {
		req.Header.Set("Authorization", "Bearer "+u.token)
	}
	return u.client.Do(req)
}

// assetName 依据 release.yml 的产物命名规则推导当前平台应下载的资产名。
// tag 形如 v1.2.3：
//   - web：vellum-<tag>-<goos>-<goarch>.zip（windows）/ .tar.gz（其它）
//   - desktop：vellum-<tag>-desktop-windows-amd64.zip
func assetName(tag, mode, goos, goarch string) string {
	if mode == "desktop" {
		return fmt.Sprintf("vellum-%s-desktop-windows-amd64.zip", tag)
	}
	ext := ".tar.gz"
	if goos == "windows" {
		ext = ".zip"
	}
	return fmt.Sprintf("vellum-%s-%s-%s%s", tag, goos, goarch, ext)
}

func findAsset(as []asset, name string) *asset {
	for i := range as {
		if as[i].Name == name {
			return &as[i]
		}
	}
	return nil
}

// extractBinary 从 zip / tar.gz 中取出体积最大的普通文件（发行包内只有一个二进制）。
func extractBinary(archive, name, dst string) error {
	if strings.HasSuffix(name, ".zip") {
		return extractZip(archive, dst)
	}
	return extractTarGz(archive, dst)
}

func extractZip(path, dst string) error {
	r, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer r.Close()
	var best *zip.File
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if best == nil || f.UncompressedSize64 > best.UncompressedSize64 {
			best = f
		}
	}
	if best == nil {
		return errors.New("压缩包为空")
	}
	rc, err := best.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func extractTarGz(path, dst string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var bestName string
	var bestSize int64
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag != tar.TypeReg || hdr.Size <= bestSize {
			continue
		}
		bestName, bestSize = hdr.Name, hdr.Size
		// 重新定位到该条目：tar 只能顺序读，这里直接把当前条目写入临时目标再比较大小。
		if err := writeAll(dst, tr); err != nil {
			return err
		}
	}
	if bestName == "" {
		return errors.New("压缩包为空")
	}
	return nil
}

func writeAll(dst string, r io.Reader) error {
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// newer 判断 latest 是否比 current 更新；"dev" / 空值一律视为需要更新。
func newer(latest, current string) bool {
	c := strings.TrimSpace(current)
	if c == "" || c == "dev" {
		return true
	}
	return compareVersions(latest, c) > 0
}

// compareVersions 比较两个版本号（可带前导 v 与 -prerelease），返回 -1/0/1。
func compareVersions(a, b string) int {
	na, pa := splitVersion(a)
	nb, pb := splitVersion(b)
	for i := 0; i < 3; i++ {
		if na[i] != nb[i] {
			if na[i] < nb[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case pa == "" && pb == "":
		return 0
	case pa == "": // a 是正式版，b 是预发行版
		return 1
	case pb == "":
		return -1
	case pa == pb:
		return 0
	case pa < pb:
		return -1
	default:
		return 1
	}
}

func splitVersion(v string) ([3]int, string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	pre := ""
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		pre = v[i+1:]
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	var n [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n[i], _ = strconv.Atoi(parts[i])
	}
	return n, pre
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}
