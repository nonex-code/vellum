// 任务列表 / 详情 / 新建 / 看板 / 编辑抽屉。
// 通用词一律复用 common.ts，首页已有的词复用 home.ts，这里只登记本模块新增的文案。
export const issues: Record<string, string> = {
  // 任务详情
  已更新: 'Updated',
  已提交: 'Posted',
  内容不能为空: 'Content cannot be empty',
  已添加子任务: 'Subtask added',
  已上传附件: 'Attachment uploaded',
  任务不存在: 'Issue not found',
  标题已更新: 'Title updated',
  返回列表: 'Back to list',
  '删除这个任务？': 'Delete this issue?',
  '会连同其跟进与附件一起从仓库删除，且不可撤销。':
    'This removes the issue together with its follow-ups and attachments from the repository, and it cannot be undone.',
  点击编辑标题: 'Click to edit title',
  属于: 'Belongs to',
  '（无描述）': '(No description)',
  '还没有子任务。': 'No subtasks yet.',
  标记为未完成: 'Mark as not done',
  标记为已完成: 'Mark as done',
  '子任务标题，回车创建': 'Subtask title, press Enter to create',
  添加: 'Add',
  添加子任务: 'Add subtask',
  跟进: 'Follow-ups',
  '还没有跟进。': 'No follow-ups yet.',
  添加跟进: 'Add follow-up',
  '写一条跟进，可粘贴/选择图片…': 'Write a follow-up; you can paste or pick images…',
  提交跟进: 'Post follow-up',
  开始日期: 'Start date',
  截止日期: 'Due date',
  未设置: 'Not set',
  更新: 'Updated',
  创建: 'Create',

  // 任务列表
  编号: 'ID',
  '{count} 个任务': '{count} issues',
  搜索标题或正文: 'Search titles or bodies',
  全部状态: 'All statuses',
  全部优先级: 'All priorities',
  全部类型: 'All types',
  全部标签: 'All labels',
  全部里程碑: 'All milestones',
  按更新: 'Recently updated',
  按创建: 'Recently created',
  按优先级: 'By priority',
  按标题: 'By title',
  没有匹配的任务: 'No matching issues',
  还没有任务: 'No issues yet',
  创建第一个任务: 'Create your first issue',

  // 新建任务
  '已创建 {id}': 'Created {id}',
  新任务: 'Create',
  从模板开始: 'Start from a template',
  一句话描述这个任务: 'Describe this issue in one sentence',
  留空表示未指派: 'Leave empty to leave unassigned',
  选择或输入标签: 'Pick or type labels',
  父任务: 'Parent issue',
  '无（作为顶层任务）': 'None (top-level issue)',
  '描述（支持 Markdown）': 'Description (Markdown supported)',
  '背景、复现步骤、验收标准…': 'Context, steps to reproduce, acceptance criteria…',
  自定义字段: 'Custom fields',

  // 看板（'看板' 由 common.ts 提供）
  已创建任务: 'Issue created',
  '在「{name}」快速添加': 'Quick add to “{name}”',
  '任务标题，回车创建': 'Issue title, press Enter to create',
  拖任务到这里: 'Drag issues here',

  // 搜索
  全文检索: 'Full-text search',
  '搜索标题、正文、标签、编号与跟进内容': 'Search titles, bodies, labels, IDs and follow-ups',
  找到: 'Found',
  '条与「{query}」相关的结果': 'results matching “{query}”',
  '没有与「{query}」匹配的内容': 'Nothing matches “{query}”',
  换个关键词试试: 'Try a different keyword',
  输入关键词开始检索: 'Type a keyword to start searching',

  // 编辑抽屉
  '编辑 {id}': 'Edit {id}',
  '描述（Markdown）': 'Description (Markdown)',
}
