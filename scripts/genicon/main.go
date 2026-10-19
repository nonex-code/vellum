// Command genicon builds the Wails desktop shell's app icon from the project
// logo at web/public/logo.png. It depends only on the Go standard library (no
// external image tools required) and writes the Wails-conventional source icon:
//
//	build/appicon.png   1024x1024 square, logo centered (Wails derives the
//	                     platform icons from this on `wails build`)
//
// Run from the repo root:  go run ./scripts/genicon
package main

import (
	"fmt"
	"image/png"
	"os"
	"path/filepath"

	"github.com/nonex-code/vellum/scripts/internal/icons"
)

func fail(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "genicon:", err)
		os.Exit(1)
	}
}

func writeFile(path string, data []byte) {
	fail(os.MkdirAll(filepath.Dir(path), 0o755))
	fail(os.WriteFile(path, data, 0o644))
	fmt.Printf("genicon: wrote %s (%d bytes)\n", path, len(data))
}

func main() {
	f, err := os.Open("web/public/logo.png")
	fail(err)
	defer f.Close()
	src, err := png.Decode(f)
	fail(err)

	// Wails 约定源图标为 1024x1024 方形，logo 居中、保留透明边距。
	const size = 1024
	appicon := icons.ContainSquare(src, size)
	writeFile("build/appicon.png", icons.PNGOf(appicon))
}
