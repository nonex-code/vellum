//go:build desktop

package update

// Mode 标识当前构建形态，决定从发行版里挑选哪一类产物：
// 桌面壳（Wails）与服务器二进制是两份不同的资产。
const Mode = "desktop"
