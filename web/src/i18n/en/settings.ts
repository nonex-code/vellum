// 设置与配置中心。
export const settings: Record<string, string> = {
  // ---- pages/Settings.tsx ----
  当前项目: 'Current project',
  项目集设置: 'Portfolio settings',
  项目设置: 'Project settings',
  配置已保存: 'Configuration saved',
  '跟仓库走的纯文本配置 · workbench.yaml':
    'Plain-text config that ships with the repository · workbench.yaml',
  '仅覆盖当前项目的纯文本配置 · projects/<id>/workbench.yaml':
    'Plain-text config overriding only this project · projects/<id>/workbench.yaml',
  基本: 'General',
  状态与标签: 'Statuses & Labels',
  里程碑与字段: 'Milestones & Fields',
  模板: 'Templates',
  'YAML 源码': 'YAML Source',
  关于: 'About',

  // ---- components/UpdatePanel.tsx ----
  版本信息: 'Version Info',
  当前版本: 'Current version',
  构建形态: 'Build',
  更新源: 'Update source',
  可自更新: 'Self-update supported',
  桌面版: 'Desktop',
  服务器版: 'Server',
  是: 'Yes',
  否: 'No',
  当前构建未启用自更新: 'Self-update is disabled in this build',
  '启动时设置了 WB_UPDATE=false，或该构建未包含更新接口。':
    'WB_UPDATE=false was set at startup, or this build does not include the update endpoint.',
  检查更新: 'Check for updates',
  更新结果: 'Update Result',
  最新版本: 'Latest version',
  状态: 'Status',
  有新版本可用: 'New version available',
  已是最新版本: 'Already up to date',
  发布时间: 'Published at',
  安装包: 'Package',
  更新说明: 'Release notes',
  '立即更新？': 'Update now?',
  '将下载新版本、校验后原子替换当前程序并自动重启。':
    'The new version will be downloaded, verified, atomically swapped in, and the app will restart automatically.',
  更新并重启: 'Update & restart',
  '正在重启到 {version}…': 'Restarting to {version}…',

  // ---- components/SettingsShared.ts ----
  '{name}：有 {count} 项 ID 为空': '{name}: {count} IDs are empty',
  '{name}：ID「{id}」重复 {count} 次': '{name}: ID "{id}" is duplicated {count} times',
  字段: 'Fields',

  // ---- components/SettingsCommon.tsx ----
  上移: 'Move up',
  下移: 'Move down',
  保存配置: 'Save configuration',

  // ---- components/SettingsBasicTab.tsx ----
  拖拽卡片按状态整理: 'Drag cards to organize by status',
  '按里程碑/时间线排期': 'Schedule by milestone / timeline',
  '仓库内 Markdown 文档库': 'Markdown doc library in the repository',
  '详情/筛选/新建出现里程碑': 'Milestones appear in details / filters / new',
  '跟进里上传图片/文件': 'Upload images / files in follow-ups',
  任务列表按父子层级展示: 'Show the issue list by parent-child hierarchy',
  全文检索任务: 'Full-text search for issues',
  仅正文清单: 'Checklist in body only',
  独立子任务: 'Independent subtasks',
  '清单 + 子任务': 'Checklist + subtasks',
  已转为多项目模式: 'Converted to multi-project mode',
  已转为单项目模式: 'Converted to single-project mode',
  工作台信息: 'Workspace Info',
  项目信息: 'Project Info',
  项目简介: 'Project description',
  我的项目: 'My project',
  '一句话说明这个项目（可选）': 'One line on what this project is about (optional)',
  界面语言: 'Interface language',
  '仓库默认语言；本机用顶栏「中/EN」切换会覆盖它，且不影响任何数据。':
    'Repository default language; the top-bar 中/EN switch overrides it on this machine and never touches your data.',
  '例如 WB': 'e.g. WB',
  默认视图: 'Default view',
  模块开关: 'Module Toggles',
  '单 / 多项目模式转换': 'Single / Multi-project Mode Conversion',
  '当前模式：': 'Current mode:',
  '多项目（项目集）': 'Multi-project (portfolio)',
  '。模式转换由后端直接改写仓库结构，不经过上面的表单保存。':
    '. Mode conversion rewrites the repository structure directly on the backend, without going through the form save above.',
  '转为多项目模式？': 'Convert to multi-project mode?',
  '会把仓库根现有的任务与文档迁移到 projects/ 下的一个项目里，之后可用项目集管理多个项目。':
    'Migrates the existing issues and docs in the repository root into a project under projects/; you can then manage multiple projects with a portfolio.',
  转换: 'Convert',
  转为多项目: 'Convert to multi-project',
  '转为单项目模式？': 'Convert to single-project mode?',
  '会把当前项目的数据合并回仓库根，取消 projects/ 分隔。':
    'Merges the current project data back into the repository root and drops the projects/ separation.',
  转为单项目: 'Convert to single-project',
  'Webhook、自定义字段等进阶项': 'Advanced items such as webhooks and custom fields',
  '如需配置事件回调 webhook（url / events）等未在此表单的字段，请到「YAML 源码」标签直接编辑仓库内的 workbench.yaml。':
    'To configure fields not covered by this form, such as the event-callback webhook (url / events), go to the "YAML Source" tab and edit the repository workbench.yaml directly.',
  '表单保存会以当前生效配置为基线，写回所选作用域的 workbench.yaml':
    'Form save writes the current effective configuration as the baseline back to the selected scope\u2019s workbench.yaml',

  // ---- components/SettingsDefsTab.tsx ----
  '待办 todo': 'To do (todo)',
  '进行中 active': 'In progress (active)',
  '已完成 done': 'Done (done)',
  'category 决定看板/甘特的分组：todo / active / done；wip 限制在制品数量（留空不限）':
    'category decides the board/gantt grouping: todo / active / done; wip limits the work-in-progress count (blank = unlimited)',
  新增状态: 'Add status',
  新增标签: 'Add label',
  新增优先级: 'Add priority',
  新增类型: 'Add type',
  'ID 必须唯一且非空': 'IDs must be unique and non-empty',

  // ---- components/SettingsFieldsTab.tsx ----
  '文本 text': 'Text',
  '数字 number': 'Number',
  '日期 date': 'Date',
  '单选 select': 'Single select',
  'start / end 为甘特图的时间区间（可选，格式 YYYY-MM-DD）；order 控制排序':
    'start / end are the gantt time range (optional, format YYYY-MM-DD); order controls sorting',
  新增里程碑: 'Add milestone',
  顺序: 'Order',
  开始: 'Start',
  结束: 'End',
  'type = select 时可填写「选项」（回车分隔）':
    'When type = select you can fill in "options" (separated by Enter)',
  '选项，回车添加': 'Options, press Enter to add',
  新增字段: 'Add field',
  '里程碑/字段为空时不会写入 yaml': 'Empty milestones/fields are not written to the yaml',

  // ---- components/SettingsTemplatesTab.tsx ----
  '模板用于「新建任务」快速填充：标题 / 正文 / 类型 / 优先级 / 标签':
    'Templates quickly pre-fill "New issue": title / body / type / priority / labels',
  新建模板: 'New template',
  新增模板: 'Add template',
  模板名称: 'Template name',
  默认标题: 'Default title',
  '模板正文（支持 Markdown）': 'Template body (Markdown supported)',
  '模板为空时不会写入 yaml': 'Empty templates are not written to the yaml',

  // ---- components/SettingsYamlTab.tsx ----
  已保存并生效: 'Saved and applied',
  文件路径: 'File path',
  当前为内置默认: 'Currently using the built-in defaults',
  '该作用域还没有 workbench.yaml 文件；保存后会把下面的内容写入仓库。':
    'This scope has no workbench.yaml yet; saving writes the content below into the repository.',
  '直接编辑仓库内的纯文本配置。保存时后端做 YAML 校验，非法会报错且不写入；成功后全局配置即时生效。':
    'Edit the plain-text configuration in the repository directly. On save the backend validates the YAML and reports an error without writing if it is invalid; on success the global configuration takes effect immediately.',
}
