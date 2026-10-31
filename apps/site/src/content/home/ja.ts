import type { HomeContent } from "../copy";

export const JA_HOME: HomeContent = {
  heroEyebrow: "サーバー不要 · 全球エッジ直結 · 完全無料セルフホスト",
  heroTitleLine1: "サーバー不要、一生モノの所有権。",
  heroTitleLine2: "エッジネットワークで動く第二の脳。",
  heroSubtitle:
    "シンプルに、しかし深く。静かに、しかし妥協なく。Cloudflare Workers、D1、R2 を活用したナレッジベース。VPS 管理ゼロ、Memos API 互換、AI エージェントの長期記憶を手のひらに。",
  primaryCta: "デプロイガイドを読む",
  secondaryCta: "GitHub ソースコード",
  statMemos: "約250万件のメモ",
  statPhotos: "1万枚の写真 · 転送料0円",
  statServers: "24時間超低遅延",
  statUptime: "マルチリージョン冗長化",
  featuresBadge: "コア機能",
  featuresHeading: "FlareMoを選ぶ理由",
  featuresSubtitle:
    "煩雑なサーバー運用を手放し、純粋で堅牢なAIネイティブ知識管理を実現",
  features: [
    {
      title: "マルチリージョンでデータを守る",
      description:
        "メモはCloudflare D1およびR2ストレージにマルチリージョン冗長化で保存。ディスク障害や停電の心配は不要です。",
    },
    {
      title: "無料枠は正直な数字で",
      description:
        "無料枠で約250万件のメモと1万枚の写真を保存可能。R2は下り転送料金が無料のため、急な請求の心配もありません。",
    },
    {
      title: "オフライン対応 ＆ PWA",
      description:
        "インストール可能なPWA。通信圏外でもローカルに即時保存され、オンライン復帰時に安全に同期されます。",
    },
    {
      title: "AIネイティブな長期記憶",
      description:
        "/memory/mcp エンドポイントにより、ClaudeやCursorなどのAIがあなたの好みを長期記憶として自律的に読み書きできます。",
    },
    {
      title: "共有のためのチームスペース",
      description:
        "メモをチームに公開し、その下でコメントしたり @ で呼びかけたり。プロジェクト管理ではなく、共有のための場所です。Owner / Admin / Member の役割とプライベート・チーム・公開の3段階の可視性に対応し、メンバーの離脱時にはプライベートデータを確実に削除します。",
    },
    {
      title: "Memos互換で簡単移行",
      description:
        "Memos /api/v1 仕様と互換。既存のサードパーティアプリ（Moe Memos等）にそのまま接続でき、一括移行も簡単です。",
    },
    {
      title: "メモ・TODO・プロジェクト",
      description:
        "短いメモはさっと書き、長文は全画面キャンバスでじっくり。メモに日付を設定すると、中のTODOがタスクになり双方向に同期されます。「今日」「今後7日間」やプロジェクトボードで確認でき、期限当日の通知と任意の Web Push に対応します。",
    },
  ],
  comparisonBadge: "比較表",
  comparisonHeading: "3 つの自ホスト方式を並べて比較",
  comparisonSubtitle: "自宅NASや従来型VPSと比較して分かる、真のゼロ保守運用",
  comparisonRows: [
    {
      label: "データの保存場所",
      cloudflare: "Cloudflare エンタープライズ分散ストレージ",
      nas: "自宅内の単一またはRAIDハードディスク",
      vps: "単一クラウドベンダーの仮想ディスク",
    },
    {
      label: "ハードウェア障害リスク",
      cloudflare: "自動フェイルオーバー、故障ストレスゼロ",
      nas: "HDD故障や停電で全データ消失のリスク",
      vps: "ホスト障害や設定ミスによる消失リスク",
    },
    {
      label: "アクセス速度",
      cloudflare: "世界300以上のエッジCDNからミリ秒応答",
      nas: "自宅の上り回線依存、トンネル設定が必要",
      vps: "データセンターの物理距離に依存し遅延大",
    },
    {
      label: "日常のメンテナンス",
      cloudflare: "ゼロ：OS更新なし、Docker管理なし",
      nas: "OSアップデート、SMART監視が必要",
      vps: "セキュリティパッチ、デーモン監視が必要",
    },
    {
      label: "SSLと独自ドメイン",
      cloudflare: "自動HTTPS証明書発行＆自動更新",
      nas: "証明書取得やDDNS、ポート開放の手間",
      vps: "Nginx設定とLet's Encrypt保守が必要",
    },
    {
      label: "継続コスト",
      cloudflare: "0円（無料枠を永久に活用）",
      nas: "高額な初期ハードウェア代＋電気代",
      vps: "毎月のサーバー代と帯域費用の請求",
    },
  ],
  screenshotsHeading: "洗練されたUI、今すぐ体験",
  screenshotsSubtitle:
    "ライトモード、ダークモード、モバイル対応。すべての機能が本番利用可能です。",
  faqBadge: "チェックポイント",
  faqHeading: "よくある質問",
  faqItems: [
    {
      q: "無料枠で本当に足りるの？",
      a: "十分すぎます。5GBのD1データベース（約250万件のメモ）と10GBのR2ストレージ（約1万枚の写真）を無料で利用でき、毎日100件書いても68年間埋まりません。",
    },
    {
      q: "データは本当に安全？",
      a: "データはCloudflareの分散基盤で冗長化保管されます。さらに標準Memos形式でワンクリック完全バックアップも可能です。",
    },
    {
      q: "Memosから移行できる？",
      a: "はい。ZIPまたはJSONエクスポートファイルをアップロードするだけで、タグや作成日を保持したまま移行できます。",
    },
    {
      q: "既存のモバイルアプリは使える？",
      a: "Memos互換の/api/v1とPATを提供しているため、Moe Memos等の主要クライアントから直接利用可能です。",
    },
    {
      q: "個人利用とチーム利用の違いは？",
      a: "個人利用時は完全プライベートな日記として動作し、チームモードを有効化すると共有・権限分離ワークスペースへと拡張されます。",
    },
  ],
  ctaBadge: "今すぐ始める",
  ctaHeading: "知識の拠点を、自分のドメインに。",
  ctaSubtitle:
    "サーバー不要、クレジットカード不要。無料のCloudflareアカウントで5分でデプロイ。",
  ctaButton: "5分デプロイガイドを見る",
};
