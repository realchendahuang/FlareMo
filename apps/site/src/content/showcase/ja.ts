import type { ShowcaseContent } from "../showcase-i18n";

export const JA_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "読書メモ：集中力と創造性",
    content:
      "情報が溢れる時代だからこそ、静かに思考をまとめる空間が必要。断片的な観察を書き留めておけば、やがて繋がりが見えてくる。",
    quote: "学習とは答えを蓄積することではなく、より良い問いを立て続けること。",
    tags: ["ひらめき", "読書"],
    time: "21分前",
  },
  memo2: {
    title: "記録を思考の起点にする",
    content:
      "散歩中のひらめき：優れたツールは書くことへの摩擦を極限まで減らしてくれる。開けばすぐ書け、探したいものが一瞬で見つかる。\n• 明確な主軸を保つ\n• 重要なインサイトにタグ付け\n• 週末の振り返り習慣",
    tags: ["思考", "プロダクト"],
    time: "1時間前",
  },
  presets: [
    {
      text: "空港の待ち時間にエッジ同期プロトコルの冪等性を整理 #アーキテクチャ #ひらめき",
      title: "ミリ秒エッジ同期設計",
      quote: "ローカル先行書き込み、再接続時にタイムスタンプ昇順で安全に同期。",
      tag: "アーキテクチャ",
    },
    {
      text: "オフラインPWAなら機内や地下鉄でも思考の中断ゼロ #ひらめき",
      title: "オフラインファースト体験",
      quote: "オフラインでも手元で即座に保存され、通信回復時に自動整合。",
      tag: "ひらめき",
    },
    {
      text: "Telegramボット連携完了。音声入力から自動文字起こしでナレッジ化 #日常",
      title: "瞬時インスピレーション記録",
      quote: "思いついた音声を送信するだけで、自動で構造化メモとして蓄積。",
      tag: "日常",
    },
  ],
  ui: {
    statsRecords: "記録",
    statsTags: "タグ",
    statsDays: "日",
    trend: "傾向",
    calendar: "カレンダー",
    timeline: "タイムライン",
    archive: "アーカイブ",
    trash: "ゴミ箱",
    dailyReview: "振り返り",
    randomWalk: "散歩",
    memory: "記憶",
    calendarView: "予定",
    projects: "TODO",
    tagIndex: "タグ一覧",
    searchPlaceholder: "記録を検索...",
    composerPlaceholder: "今何を考えていますか？書き留めよう...",
    send: "送信",
    justNow: "たった今",
    clearFilter: "✕ すべて",
    recordPrefix: "記録",
    months: ["6月", "7月", "8月", "9月"],
    tags: [
      { name: "プロダクト", count: 22 },
      { name: "思考", count: 22 },
      { name: "ひらめき", count: 22 },
      { name: "日常", count: 21 },
      { name: "計画", count: 21 },
      { name: "読書", count: 22 },
    ],
  },
};
