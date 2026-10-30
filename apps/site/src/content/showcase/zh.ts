import type { ShowcaseContent } from "../showcase-i18n";

export const ZH_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "阅读摘录：注意力与创造力",
    content:
      "信息越多，越需要为自己留出安静的空间。把零散的观察记下来，连接就会慢慢浮现。",
    quote: "学习不是积累答案，而是不断提出更好的问题。",
    tags: ["灵感", "阅读"],
    time: "21分钟前",
  },
  memo2: {
    title: "让记录成为思考的起点",
    content:
      "今天散步时想到：好的工具应该让人专注于自己的想法。打开就能写，想找的内容也能很快找到。\n• 保留清晰的主线\n• 给重要的灵感加上标签\n• 每周花一点时间回顾",
    tags: ["思考", "产品"],
    time: "1小时前",
  },
  presets: [
    {
      text: "在机场候机时随手理清了多端同步幂等协议 #架构 #灵感",
      title: "边缘毫秒同步方案设计",
      quote: "客户端优先本地落盘，联网后单调时间戳递增同步。",
      tag: "架构",
    },
    {
      text: "离线 PWA 模式断网随心记，连网秒级入库 #灵感",
      title: "离线优先使用体验",
      quote: "地铁与飞行途中无网环境下的心流完全不中断。",
      tag: "灵感",
    },
    {
      text: "配置完成 Telegram 随手记 Bot，直接发语音自动转文字入库 #生活",
      title: "碎片化灵感速记链路",
      quote: "随手语音发给专属 Bot，10 秒内自动汇总成结构化知识点。",
      tag: "生活",
    },
  ],
  ui: {
    statsRecords: "记录",
    statsTags: "标签",
    statsDays: "天",
    trend: "趋势",
    calendar: "日历",
    timeline: "时间线",
    archive: "归档",
    trash: "回收站",
    dailyReview: "每日回顾",
    randomWalk: "随机漫步",
    memory: "记忆",
    calendarView: "日程",
    projects: "待办",
    tagIndex: "标签索引",
    searchPlaceholder: "搜索记录...",
    composerPlaceholder: "此刻在想什么？记下来...",
    send: "发送",
    justNow: "刚刚",
    clearFilter: "✕ 全部",
    recordPrefix: "记录",
    months: ["6月", "7月", "8月", "9月"],
    tags: [
      { name: "产品", count: 22 },
      { name: "思考", count: 22 },
      { name: "灵感", count: 22 },
      { name: "生活", count: 21 },
      { name: "计划", count: 21 },
      { name: "阅读", count: 22 },
    ],
  },
};
