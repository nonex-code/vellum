import { theme as antdTheme, type ThemeConfig } from 'antd'

// 现代设计令牌：冷调中性画布 + 明快蓝主色 + 轻投影 + 更大圆角。
// 视觉语言由 index.css 的 CSS 变量驱动；这里同步 antd 组件令牌，保证一致。
// 详见 https://ant.design/docs/react/customize-theme

const fontSans =
  "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
const fontMono = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Consolas, monospace"

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2F6BFF',
    colorInfo: '#2F6BFF',
    colorError: '#E5484D',
    colorSuccess: '#2EA66B',
    colorWarning: '#E5A000',
    colorTextBase: '#1A1D23',
    colorTextSecondary: '#5A606B',
    colorTextTertiary: '#8A909C',
    colorBorder: '#E4E7EC',
    colorBorderSecondary: '#EEF0F3',
    colorBgLayout: '#F6F7F9',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    borderRadius: 8,
    borderRadiusLG: 10,
    fontFamily: fontSans,
    fontFamilyCode: fontMono,
    fontSize: 14,
    lineHeight: 1.6,
    controlHeight: 36,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 58,
      headerPadding: '0 24px',
      bodyBg: '#F6F7F9',
    },
    Table: {
      headerBg: 'transparent',
      headerColor: '#5A606B',
      borderColor: '#E4E7EC',
      headerSplitColor: 'transparent',
      rowHoverBg: '#F4F6F9',
      cellPaddingBlockMD: 14,
      headerBorderRadius: 0,
    },
    Card: { borderRadiusLG: 10, headerFontSize: 13, headerBg: 'transparent' },
    Button: { borderRadius: 8, primaryShadow: 'none', defaultShadow: 'none' },
    Tag: { borderRadiusSM: 5 },
    Descriptions: { labelBg: 'transparent' },
    Modal: { borderRadiusLG: 12 },
    Select: { borderRadius: 8 },
    Input: { borderRadius: 8 },
  },
}

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#5B8CFF',
    colorInfo: '#5B8CFF',
    colorError: '#FF6166',
    colorSuccess: '#3FBE7E',
    colorWarning: '#F0B429',
    colorTextBase: '#E6E8EC',
    colorTextSecondary: '#A6ADB8',
    colorTextTertiary: '#6E757F',
    colorBorder: '#262B33',
    colorBorderSecondary: '#1E222A',
    colorBgLayout: '#0E1014',
    colorBgContainer: '#16191F',
    colorBgElevated: '#1B1F27',
    borderRadius: 8,
    borderRadiusLG: 10,
    fontFamily: fontSans,
    fontFamilyCode: fontMono,
    fontSize: 14,
    lineHeight: 1.6,
    controlHeight: 36,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#16191F',
      headerHeight: 58,
      headerPadding: '0 24px',
      bodyBg: '#0E1014',
    },
    Table: {
      headerBg: 'transparent',
      headerColor: '#A6ADB8',
      borderColor: '#262B33',
      headerSplitColor: 'transparent',
      rowHoverBg: '#1E222A',
      cellPaddingBlockMD: 14,
    },
    Card: { borderRadiusLG: 10, headerFontSize: 13, headerBg: 'transparent' },
    Button: { borderRadius: 8, primaryShadow: 'none', defaultShadow: 'none' },
    Tag: { borderRadiusSM: 5 },
    Descriptions: { labelBg: 'transparent' },
    Modal: { borderRadiusLG: 12 },
    Select: { borderRadius: 8 },
    Input: { borderRadius: 8 },
  },
}

export function makeTheme(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? darkTheme : lightTheme
}
