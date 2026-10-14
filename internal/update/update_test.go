package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.2.3", "v1.2.3", 0},
		{"v1.2.4", "v1.2.3", 1},
		{"v1.3.0", "v1.2.9", 1},
		{"v2.0.0", "v1.9.9", 1},
		{"1.0.0", "v1.0.1", -1},
		{"v1.0.0", "v1.0.0-rc1", 1}, // 正式版 > 预发行版
		{"v1.0.0-rc1", "v1.0.0", -1},
		{"v1.0.0-rc2", "v1.0.0-rc1", 1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestNewer(t *testing.T) {
	if !newer("v1.0.0", "dev") || !newer("v1.0.0", "") {
		t.Fatal("dev/empty should always be considered outdated")
	}
	if newer("v1.0.0", "v1.0.0") {
		t.Fatal("same version is not newer")
	}
	if !newer("v1.0.1", "v1.0.0") {
		t.Fatal("higher patch should be newer")
	}
}

func TestAssetName(t *testing.T) {
	cases := []struct {
		tag, mode, goos, goarch, want string
	}{
		{"v1.2.3", "web", "windows", "amd64", "vellum-v1.2.3-windows-amd64.zip"},
		{"v1.2.3", "web", "linux", "amd64", "vellum-v1.2.3-linux-amd64.tar.gz"},
		{"v1.2.3", "web", "darwin", "arm64", "vellum-v1.2.3-darwin-arm64.tar.gz"},
		{"v1.2.3", "desktop", "windows", "amd64", "vellum-v1.2.3-desktop-windows-amd64.zip"},
	}
	for _, c := range cases {
		if got := assetName(c.tag, c.mode, c.goos, c.goarch); got != c.want {
			t.Errorf("assetName(%q,%q,%q,%q)=%q want %q", c.tag, c.mode, c.goos, c.goarch, got, c.want)
		}
	}
}

func TestFetchChecksums(t *testing.T) {
	body := "abc123  vellum-v1.0.0-linux-amd64.tar.gz\n" +
		"def456 *vellum-v1.0.0-windows-amd64.zip\n" +
		"\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	u := &Updater{client: srv.Client()}
	sums, err := u.fetchChecksums(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if sums["vellum-v1.0.0-linux-amd64.tar.gz"] != "abc123" {
		t.Errorf("linux sum = %q", sums["vellum-v1.0.0-linux-amd64.tar.gz"])
	}
	// sha256sum 的二进制模式会在文件名前加 *；解析时应剥掉。
	if sums["vellum-v1.0.0-windows-amd64.zip"] != "def456" {
		t.Errorf("windows sum = %q", sums["vellum-v1.0.0-windows-amd64.zip"])
	}
}

func TestExtractZipPicksLargest(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "a.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	writeZip(t, zw, "small.txt", "hi")
	writeZip(t, zw, "app", "the-real-binary-content")
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()

	dst := filepath.Join(dir, "out")
	if err := extractBinary(archive, "a.zip", dst); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "the-real-binary-content" {
		t.Fatalf("got %q", data)
	}
}

func TestExtractTarGzPicksLargest(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "a.tar.gz")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	writeTar(t, tw, "small.txt", "hi")
	writeTar(t, tw, "app", "the-real-binary-content")
	tw.Close()
	gz.Close()
	f.Close()

	dst := filepath.Join(dir, "out")
	if err := extractBinary(archive, "a.tar.gz", dst); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "the-real-binary-content" {
		t.Fatalf("got %q", data)
	}
}

// TestSwapExecutable 验证原子替换的文件语义（不真正重启进程）：
// 替换后当前路径内容是新二进制；Windows 下额外保留 .old 备份。
func TestSwapExecutable(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "app")
	newBin := filepath.Join(dir, "app.new")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newBin, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}

	restart, err := swapExecutable(exe, newBin)
	if err != nil {
		t.Fatal(err)
	}
	if restart == nil {
		t.Fatal("restart func is nil")
	}

	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("exe content = %q, want new", got)
	}

	if runtime.GOOS == "windows" {
		old, err := os.ReadFile(exe + ".old")
		if err != nil || string(old) != "old" {
			t.Fatalf("windows backup = %q (err %v), want old", old, err)
		}
	}
}

// TestCheckFlow 用假 GitHub API 验证 Check 的资产挑选与版本比较。
func TestCheckFlow(t *testing.T) {
	asset := assetName("v9.9.9", Mode, runtime.GOOS, runtime.GOARCH)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/o/r/releases/latest":
			fmt.Fprintf(w, `{"tag_name":"v9.9.9","body":"notes","html_url":"u","published_at":"2026-01-01T00:00:00Z",
				"assets":[
					{"name":%q,"browser_download_url":%q,"size":10},
					{"name":"checksums.txt","browser_download_url":%q,"size":5}
				]}`, asset, srvURL(r)+"/asset", srvURL(r)+"/sums")
		case "/asset":
			fmt.Fprint(w, "binary")
		case "/sums":
			fmt.Fprintf(w, "deadbeef  %s\n", asset)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	u := New("o/r")
	u.apiBase = srv.URL
	u.client = srv.Client()

	info, err := u.Check("v1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.Latest != "v9.9.9" || info.Asset != asset {
		t.Fatalf("unexpected info: %+v", info)
	}
	if info.assetURL == "" || info.checksumURL == "" {
		t.Fatalf("asset/checksum url not resolved: %+v", info)
	}

	info2, err := u.Check("v9.9.9")
	if err != nil {
		t.Fatal(err)
	}
	if info2.Available {
		t.Fatal("same version should not be available")
	}
}

func srvURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func writeZip(t *testing.T, zw *zip.Writer, name, content string) {
	t.Helper()
	w, err := zw.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
}

func writeTar(t *testing.T, tw *tar.Writer, name, content string) {
	t.Helper()
	hdr := &tar.Header{Name: name, Mode: 0o755, Size: int64(len(content)), Typeflag: tar.TypeReg}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
}
