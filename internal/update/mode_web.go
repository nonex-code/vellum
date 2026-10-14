//go:build !desktop

package update

// Mode 标识当前构建形态，决定从发行版里挑选哪一类产物：
// web 模式使用按 GOOS/GOARCH 命名的服务器二进制。
const Mode = "web"
