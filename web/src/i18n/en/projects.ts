// 项目集管理页（Projects.tsx）。
// 「新建项目」「项目名称」「请输入项目名称」「项目已创建」「简介（可选）」
// 以及新建项目提示的两段已在 chrome 中翻译；「已完成」「创建」在 home；
// 「任务」「项目集」「取消」「保存」「重命名」在 common —— 此处均不重复定义。
export const projects: Record<string, string> = {
  '转为项目集': 'Convert to a portfolio',
  '合并回单项目': 'Merge back into a single project',
  '已转为项目集，原任务已归入「默认项目」':
    'Converted to a portfolio; the existing issues moved into "Default project".',
  '已合并回单项目': 'Merged back into a single project',
  '当前仓库是单项目模式：根目录的': 'This repository is in single-project mode: the root',
  '即全部任务。': 'folder holds every issue.',
  '项目集按「项目集 → 项目 → 任务」三层组织，转换后现有任务会整体迁入':
    ' A portfolio is organised in three levels (portfolio → project → issue); after converting, existing issues move wholesale into',
  '，之后可在同一仓库里并行推进多个项目，各项目独立编号。':
    ', so you can then run several projects in the same repository, each with its own numbering.',
  '一个仓库即一个项目集：任务存放在': 'One repository is one portfolio: issues live in the project folders under',
  '下的各项目里，各自独立编号、互不干扰。': 'with independent numbering, one project never getting in another’s way.',
  '项目数': 'Projects',
  ' · {n} 个已归档': ' · {n} archived',
  '总任务数': 'Total issues',
  '还没有项目，点击右上角新建': 'No projects yet — use New project in the top-right corner',
  '已归档': 'Archived',
  '归档': 'Archive',
  '取消归档': 'Unarchive',
  '保留归档': 'Keep archived',
  '当前': 'Current',
  '切换': 'Switch',
  '取消归档该项目？': 'Unarchive this project?',
  '项目将重新出现在项目列表中。': 'It shows up in the project list again.',
  '归档「{name}」？': 'Archive “{name}”?',
  '已归档「{name}」': 'Archived “{name}”',
  '已取消归档「{name}」': 'Unarchived “{name}”',
  '重命名「{name}」': 'Rename “{name}”',
  '不能归档当前活动项目，请先切换到其他项目。':
    'The active project cannot be archived — switch to another project first.',
  '归档后从项目列表隐藏，任务数据保留，可随时取消归档。':
    'Archiving hides the project from the list but keeps its issue data; you can unarchive it at any time.',
  '暂无简介': 'No description yet',
  '项目信息已更新': 'Project details updated',
  '例如：客户官网改版': 'e.g. Client website redesign',
  '一句话说明这个项目在做什么': 'One line on what this project is about',
  '跨项目动态': 'Cross-project activity',
  '查看全部任务': 'View all issues',
  '进入项目': 'Open project',
}
