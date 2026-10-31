import type { HomeContent } from "../copy";

export const KO_HOME: HomeContent = {
  heroEyebrow: "서버리스 · 100ms 미만 글로벌 엣지 · 평생 무료 셀프 호스팅",
  heroTitleLine1: "서버 제로, 영구 소유.",
  heroTitleLine2: "엣지 네트워크에서 작동하는 두 번째 뇌.",
  heroSubtitle:
    "심플하게, 얕지 않게. 조용하게, 과하지 않게. Cloudflare Workers, D1, R2 기반의 지식 관리 시스템. VPS 유지보수 없이, Memos API 생태계와 AI 에이전트 MCP 장기 기억을 영구 소유하세요.",
  primaryCta: "배포 가이드 읽기",
  secondaryCta: "GitHub 소스코드",
  statMemos: "약 250만 건의 메모",
  statPhotos: "1만 장 사진 · 트래픽 0원",
  statServers: "24/7 글로벌 초저지연",
  statUptime: "멀티 리전 다중화",
  featuresBadge: "핵심 기능",
  featuresHeading: "왜 FlareMo인가",
  featuresSubtitle:
    "복잡한 서버 유지보수에서 벗어나 순수하고 강력한 AI 네이티브 지식 관리를 경험하세요",
  features: [
    {
      title: "기본값이 내구성",
      description:
        "메모는 Cloudflare D1과 R2에 멀티 리전으로 안전하게 저장됩니다. 디스크 고장이나 정전 걱정 없이 데이터를 보호하세요.",
    },
    {
      title: "투명한 무료 제공량",
      description:
        "무료 플랜만으로 약 250만 건의 메모와 1만 장의 사진을 보관할 수 있습니다. R2는 다운로드 트래픽 비용이 무료입니다.",
    },
    {
      title: "오프라인 퍼스트 & PWA",
      description:
        "설치 가능한 PWA. 비행기나 지하철에서도 원활하게 작성하세요. 작성된 메모는 로컬에 보관 후 온라인 복구 시 자동 제출됩니다.",
    },
    {
      title: "AI 네이티브 장기 기억",
      description:
        "/memory/mcp 엔드포인트를 통해 Claude, Cursor 등의 AI 에이전트가 사용자의 영구 기억과 개인 맥락을 안전하게 읽고 씁니다.",
    },
    {
      title: "공유를 위한 팀 공간",
      description:
        "메모를 팀에 게시하고, 그 아래에 댓글을 달고, @로 서로를 불러 보세요. 프로젝트 관리가 아닌 공유를 위한 공간입니다. 소유자, 관리자, 멤버 역할과 3단계 공개 범위(비공개, 팀, 전체 공개)를 지원하며, 멤버가 떠날 때 비공개 데이터는 안전하게 삭제됩니다.",
    },
    {
      title: "완벽한 Memos 호환성",
      description:
        "Memos /api/v1 사양 및 OpenAPI 완벽 호환. Moe Memos 등 기존 모바일 앱과 즉시 연동되며 클릭 한 번으로 가져오기/내보내기 가능합니다.",
    },
    {
      title: "메모, 할 일, 프로젝트",
      description:
        "짧은 메모는 가볍게, 긴 글은 전체 화면 캔버스에서 작성하세요. 메모에 날짜를 지정하면 그 안의 할 일이 작업이 되어 양방향으로 동기화됩니다. 오늘, 다음 7일 또는 프로젝트 보드로 확인하고, 마감 당일 알림과 선택적 Web Push를 받을 수 있습니다.",
    },
  ],
  comparisonBadge: "한눈에 보는 비교",
  comparisonHeading: "셀프 호스팅 세 가지 방식 비교",
  comparisonSubtitle: "홈 NAS 및 전통적인 VPS 호스팅과의 비교 분석",
  comparisonRows: [
    {
      label: "데이터 저장 위치",
      cloudflare: "Cloudflare 글로벌 멀티 리전 스토리지",
      nas: "집 안의 단일 또는 RAID 하드디스크",
      vps: "단일 클라우드 데이터센터의 가상 디스크",
    },
    {
      label: "하드웨어 장애 위험",
      cloudflare: "자동 장애 조치로 하드웨어 위험 0%",
      nas: "디스크 배드섹터나 정전 시 전량 손실 위험",
      vps: "하이퍼바이저 장애나 설정 실수로 손실 위험",
    },
    {
      label: "글로벌 접근 속도",
      cloudflare: "전 세계 300+ 엣지 노드에서 밀리초 응답",
      nas: "가정용 인터넷 업로드 속도 및 터널 의존",
      vps: "원격 단일 서버 위치에 종속되어 높은 지연시간",
    },
    {
      label: "일상 유지보수",
      cloudflare: "제로 : OS 패치 및 Docker 관리 불필요",
      nas: "OS 정기 업데이트 및 디스크 SMART 감시 필요",
      vps: "보안 패치, 커널 업그레이드, 방화벽 관리 필요",
    },
    {
      label: "SSL 및 도메인",
      cloudflare: "자동 HTTPS 발급 및 커스텀 도메인 무료 연결",
      nas: "인증서 수동 갱신 및 복잡한 DDNS 설정",
      vps: "Nginx 설정 및 Let's Encrypt 주기적 갱신",
    },
    {
      label: "지속 비용",
      cloudflare: "월 0원 (넉넉한 무료 티어 활용)",
      nas: "수십~수백만 원의 초기 기기값 + 전기요금",
      vps: "매월 반복 청구되는 호스팅 요금과 트래픽비",
    },
  ],
  screenshotsHeading: "단정하고 유려한 디자인",
  screenshotsSubtitle:
    "라이트 모드, 다크 모드, 모바일 반응형 완벽 대응. 모든 기능이 백엔드와 연동되어 작동합니다.",
  faqBadge: "알아두면 좋은 점",
  faqHeading: "자주 묻는 질문",
  faqItems: [
    {
      q: "무료 플랜으로 정말 충분한가요?",
      a: "차고 넘칩니다. 5GB의 D1 데이터베이스(약 250만 개 메모)와 10GB의 R2 스토리지(약 1만 장 사진)가 무료로 제공되며, 매일 100개씩 적어도 68년이 걸립니다.",
    },
    {
      q: "데이터가 정말 안전한가요?",
      a: "Cloudflare의 글로벌 분산 인프라에 안전하게 다중 복제됩니다. 또한 언제든 표준 Memos 패키지로 전체 오프라인 백업이 가능합니다.",
    },
    {
      q: "Memos에서 가져올 수 있나요?",
      a: "네, 내보낸 ZIP이나 JSON 파일을 업로드하면 날짜, 태그, 본문 손실 없이 한 번에 가져올 수 있습니다.",
    },
    {
      q: "기존 모바일 앱과 연동되나요?",
      a: "네, FlareMo는 Memos /api/v1과 PAT 인증을 지원하여 Moe Memos 등 인기 있는 서드파티 앱에서 바로 연결할 수 있습니다.",
    },
    {
      q: "개인용과 팀용의 차이는 무엇인가요?",
      a: "혼자 사용할 때는 조용한 1인용 비밀 노트로 작동하며, 팀 모드를 켜면 초대 링크를 통해 동료를 추가하고 팀원끼리 노트를 공유할 수 있습니다.",
    },
  ],
  ctaBadge: "시작하기",
  ctaHeading: "5분 만에 배포, 영원히 당신의 것.",
  ctaSubtitle:
    "서버도, 신용카드도 필요 없습니다. 무료 Cloudflare 계정으로 5분 만에 배포하세요.",
  ctaButton: "5분 배포 가이드 확인하기",
};
