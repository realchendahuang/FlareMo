import type { ShowcaseContent } from "../showcase-i18n";

export const KO_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "독서 발췌: 집중력과 창의성",
    content:
      "정보가 많아질수록 고요한 사색 공간이 절실해집니다. 흩어진 생각을 적어두면 자연스레 연결 고리가 형성됩니다.",
    quote: "배움은 정답을 모으는 것이 아니라 더 나은 질문을 던지는 과정이다.",
    tags: ["영감", "독서"],
    time: "21분 전",
  },
  memo2: {
    title: "기록을 사유의 출발점으로",
    content:
      "산책 중 떠오른 생각: 훌륭한 도구는 생각과 기록 사이의 마찰을 없애줍니다. 켜자마자 바로 적고, 필요한 것을 즉시 찾는다.\n• 명확한 메인 라인 유지\n• 핵심 영감에 태그 부여\n• 매주 짧은 회고 루틴",
    tags: ["생각", "프로덕트"],
    time: "1시간 전",
  },
  presets: [
    {
      text: "공항 대기 중 엣지 동기화 멱등성 프로토콜 설계 완료 #아키텍처 #영감",
      title: "엣지 밀리초 동기화 설계",
      quote:
        "로컬 SQLite 우선 저장, 네트워크 재연결 시 단조 타임스탬프 동기화.",
      tag: "아키텍처",
    },
    {
      text: "비행기나 지하철에서도 흐름 끊김 없는 오프라인 PWA 경험 #영감",
      title: "오프라인 우선 모바일 경험",
      quote: "인터넷 없는 환경에서도 언제든 마음껏 메모.",
      tag: "영감",
    },
    {
      text: "텔레그램 음성 메모 봇 연동 완료. 음성 녹음 시 자동 텍스트화 입고 #일상",
      title: "음성 즉시 메모 파이프라인",
      quote: "음성을 전송하면 수 초 내에 구조화된 지식 카드로 변환.",
      tag: "일상",
    },
  ],
  ui: {
    statsRecords: "기록",
    statsTags: "태그",
    statsDays: "일",
    trend: "트렌드",
    calendar: "캘린더",
    timeline: "타임라인",
    archive: "보관함",
    trash: "휴지통",
    dailyReview: "일일 회고",
    randomWalk: "랜덤 워크",
    memory: "기억",
    calendarView: "일정",
    projects: "할 일",
    tagIndex: "태그 색인",
    searchPlaceholder: "기록 검색...",
    composerPlaceholder: "지금 어떤 생각을 하고 계신가요?...",
    send: "게시",
    justNow: "방금",
    clearFilter: "✕ 전체",
    recordPrefix: "기록",
    months: ["6월", "7월", "8월", "9월"],
    tags: [
      { name: "프로덕트", count: 22 },
      { name: "생각", count: 22 },
      { name: "영감", count: 22 },
      { name: "일상", count: 21 },
      { name: "계획", count: 21 },
      { name: "독서", count: 22 },
    ],
  },
};
