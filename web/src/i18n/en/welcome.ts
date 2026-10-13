// 欢迎 / 新建工作台 / 关联仓库引导。
export const welcome: Record<string, string> = {
  '单人任务台': 'personal task board',
  '把任务写进你自己的 git 仓库。': 'Write your tasks into your own git repository.',
  '没有账号、没有数据库。每个任务就是一组 Markdown 文件，随时可以 git clone、检索、迁移。':
    'No accounts, no database. Every issue is just a set of Markdown files you can clone, search, and migrate at any time.',
  '新建工作台': 'New workspace',
  '连接已有仓库': 'Connect existing repository',
  '已创建，但推送到远程失败：{err}': 'Created, but the push to remote failed: {err}',
  '工作台已就绪': 'Your workspace is ready',
  '返回': 'Back',
  '先在本地建一个 git 仓库并立即开始；需要备份或换设备时，再关联远程仓库即可。':
    'Create a local git repository and start right away; attach a remote later whenever you need backup or a device switch.',
  '我的工作台': 'My workspace',
  '请输入名称': 'Enter a name',
  '存放目录': 'Storage directory',
  '留空则自动创建在数据目录下': 'Leave empty to create it under the data directory automatically',
  '一个仓库就是一个项目集，按「项目集 → 项目 → 任务」三层组织；单项目仓库之后也能在「项目集」页一键转为项目集':
    'One repository is one portfolio, organized as Portfolio → Project → Issue; a single-project repository can also be converted to a portfolio with one click on the Portfolio page.',
  '高级：远程备份 / ID 前缀': 'Advanced: remote backup / ID prefix',
  '远程仓库（可选）': 'Remote repository (optional)',
  '填入一个空仓库地址，本地提交会同步过去':
    'Enter an empty repository URL and local commits will be synced there',
  'ID 前缀': 'ID prefix',
  '任务的编号前缀，如 WB-0001': 'Issue number prefix, e.g. WB-0001',
  '创建工作台': 'Create workspace',
  '已连接': 'Connected',
  '接入一个已经装着 Vellum 数据的 git 仓库。':
    'Connect to an existing git repository that already holds Vellum data.',
  '从远程克隆': 'Clone from remote',
  '打开本地目录': 'Open local directory',
  '远程仓库地址': 'Remote repository URL',
  '会克隆到本地数据目录，并保持可同步。':
    'It will be cloned into the local data directory and kept ready to sync.',
  '指向一个已存在的目录；若还不是 git 仓库，会自动初始化。':
    'Points to an existing directory; if it is not a git repository yet, one will be initialized automatically.',
  '克隆并连接': 'Clone & connect',
  '例如 D:/vellum-data': 'e.g. D:/vellum-data',
}
