// 日历。
// 「日历」「全部日历」由 common 提供，此处不重复定义。
export const calendar: Record<string, string> = {
  '月': 'Month',
  '列表': 'List',
  '开始': 'Start',
  '截止': 'Due',
  '今天': 'Today',
  '刷新': 'Refresh',
  '还有 {n} 项': '+{n} more',
  '项目：{name}': 'Project: {name}',
  '共 {n} 个日程': '{n} events',
  '另有 {n} 个任务未设置日期': '{n} issues have no dates',
  '本月没有带日期的任务。': 'No dated issues this month.',
  '日历暂无内容': 'Nothing on the calendar yet',
  '当前有 {n} 个任务但都没有设置日期：在任务详情里填写「开始日期 / 截止日期」后，这里就会显示。':
    'There are {n} issues but none has a date yet. Set a start / due date in the issue detail and they show up here.',
  '还没有任务：创建任务并设置「开始日期 / 截止日期」后，日历会显示在这里。':
    'No issues yet: create one and set a start / due date, and the calendar fills in.',
}
