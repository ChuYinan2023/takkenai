const JAPANESE_CHAR_REGEX = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/;

type AssetType = "knowledge-point" | "tool" | "past-question";

const TOOL_SLUG_LABELS: Record<string, string> = {
  "chukai-tesuryo": "仲介手数料計算",
  "inshi-zei": "印紙税計算",
  "touroku-menkyozei": "登録免許税計算",
  "benkyou-keikaku": "学習計画作成",
  "goukaku-shindan": "合格診断",
  "nenshu-simulation": "年収シミュレーション",
  "kotei-shisanzei": "固定資産税計算",
  "kenpei-youseki": "建ぺい率・容積率計算",
  loan: "住宅ローン計算",
  shohiyo: "諸費用計算",
  satei: "査定シミュレーション",
  "jusetsu-checker": "重要事項説明チェック",
  "hourei-search": "法令検索",
  "chika-search": "地価検索",
  "sns-generator": "SNS投稿文生成",
  "video-generator": "動画企画生成",
  "shikin-keikaku": "資金計画",
  "buy-vs-rent": "購入と賃貸の比較",
  "toushi-roi": "投資収益率分析",
  "chinryo-souba": "賃料相場検索",
  "chirashi-generator": "チラシ文面生成",
  "catchcopy-generator": "キャッチコピー生成",
  "email-template": "メールテンプレート作成",
  "openhouse-generator": "オープンハウス案内生成",
  "area-guide": "エリアガイド作成",
  "market-report": "市場レポート作成",
  "testimonial-collector": "お客様の声収集",
  "meishi-generator": "名刺文面生成",
  "torihiki-timeline": "取引タイムライン作成",
  "shorui-checker": "書類チェック",
  "hikiwatashi-checklist": "引き渡しチェックリスト",
  "kotowari-taiou": "断り対応テンプレート",
  "faq-database": "FAQデータベース",
  "koshin-annai": "更新案内作成",
  "taikyo-seisan": "退去精算計算",
  "shikikin-henkan": "敷金返還計算",
  "jisseki-card": "実績カード作成",
  "gbp-post": "Googleビジネスプロフィール投稿",
  "bukken-hikaku": "物件比較",
  "kanrihi-analyzer": "管理費分析",
  "loan-shinsa": "ローン審査チェック",
  "dcf-analyzer": "DCF分析",
  "office-moving-cost": "オフィス移転費用計算",
  "tenant-proposal": "テナント提案書作成",
  "commercial-rent-estimate": "商業賃料見積",
  "leverage-calculator": "レバレッジ計算",
  "lease-comparison": "リース比較",
  "building-comparison": "建物比較",
  "cap-rate-map": "還元利回りマップ",
  "tenant-screening": "テナント審査",
  "rent-escalation": "賃料改定シミュレーション",
  "investment-risk": "投資リスク分析",
  "office-layout": "オフィスレイアウト設計",
  "rent-free-calculator": "フリーレント計算",
  "exit-strategy": "出口戦略設計",
  "sublease-calculator": "サブリース計算",
  "property-due-diligence": "物件デューデリジェンス",
  "depreciation-calculator": "減価償却計算",
  "inheritance-tax": "相続税試算",
  "gift-tax-simulator": "贈与税シミュレーション",
  "mortgage-refinance": "住宅ローン借り換え試算",
  "reform-cost": "リフォーム費用計算",
  "rent-guarantee": "家賃保証分析",
  "vacancy-solution": "空室対策提案",
  "property-center": "不動産センター",
  "content-marketing": "コンテンツマーケティング支援",
  "property-lp-generator": "不動産LP生成",
  "eki-souba": "駅別相場検索",
  "finance-center": "資金計画センター",
  "commercial-center": "商業不動産センター",
  "business-support-center": "ビジネス支援センター",
  "research-center": "リサーチセンター",
};

const KNOWLEDGE_SLUG_LABELS: Record<string, string> = {
  minpo: "民法総論",
  gyouhou: "宅建業法総論",
  hourei: "法令上の制限",
  zei: "税・その他",
  "gyouhou-cool2": "宅建業法の重要ポイント",
  "gyouhou-37j2": "37条書面",
  "gyouhou-houshuuk": "報酬額の制限",
  "minpo-hoshou2": "保証",
  "minpo-sahiki": "相殺",
  "minpo-dairi2": "代理",
  "minpo-kaijo2": "解除",
  "minpo-muken2": "無権代理",
  "minpo-sagi2": "詐欺",
  "minpo-inin2": "委任",
  "minpo-renho2": "連帯債務",
  "minpo-tuinin": "追認",
  "minpo-kyouyuu2": "共有",
  "minpo-sousai2": "相殺",
  "minpo-tieki2": "地役権",
  "minpo-fukan": "不可抗力",
  "minpo-tanpo2": "担保",
  "minpo-kakozei": "税金",
  "minpo-ukeoi2": "請負",
  "minpo-kakoken": "瑕疵担保",
  "minpo-kakohou": "時効",
  "minpo-kakotaku": "宅建実務",
  "minpo-chintai2": "賃貸借",
  "minpo-teitou2": "抵当権",
  "minpo-shakushaku2": "借地借家",
  "minpo-igon2": "遺言",
  "minpo-fuhou2": "不法行為",
  "minpo-futouhou2": "不当利得",
  "minpo-zeta": "制限行為能力",
  "minpo-souzoku2": "相続",
};

const TOKEN_LABELS: Record<string, string> = {
  chukai: "仲介",
  tesuryo: "手数料",
  inshi: "印紙",
  zei: "税",
  touroku: "登録",
  menkyozei: "免許税",
  benkyou: "学習",
  keikaku: "計画",
  goukaku: "合格",
  shindan: "診断",
  nenshu: "年収",
  kotei: "固定",
  shisanzei: "資産税",
  kenpei: "建ぺい率",
  youseki: "容積率",
  loan: "住宅ローン",
  shohiyo: "諸費用",
  satei: "査定",
  jusetsu: "重要事項説明",
  checker: "チェック",
  hourei: "法令",
  search: "検索",
  chika: "地価",
  sns: "SNS",
  video: "動画",
  shikin: "資金",
  buy: "購入",
  vs: "比較",
  rent: "賃貸",
  toushi: "投資",
  roi: "収益率",
  chinryo: "賃料",
  souba: "相場",
  chirashi: "チラシ",
  catchcopy: "キャッチコピー",
  email: "メール",
  template: "テンプレート",
  openhouse: "オープンハウス",
  area: "エリア",
  guide: "ガイド",
  market: "市場",
  report: "レポート",
  testimonial: "お客様の声",
  collector: "収集",
  meishi: "名刺",
  torihiki: "取引",
  timeline: "タイムライン",
  shorui: "書類",
  hikiwatashi: "引き渡し",
  checklist: "チェックリスト",
  kotowari: "断り",
  taiou: "対応",
  faq: "FAQ",
  database: "データベース",
  koshin: "更新",
  annai: "案内",
  taikyo: "退去",
  seisan: "精算",
  shikikin: "敷金",
  henkan: "返還",
  jisseki: "実績",
  card: "カード",
  gbp: "Googleビジネスプロフィール",
  bukken: "物件",
  hikaku: "比較",
  kanrihi: "管理費",
  analyzer: "分析",
  shinsa: "審査",
  dcf: "DCF",
  office: "オフィス",
  moving: "移転",
  cost: "費用",
  tenant: "テナント",
  proposal: "提案",
  commercial: "商業",
  estimate: "見積",
  leverage: "レバレッジ",
  lease: "リース",
  building: "建物",
  cap: "還元",
  rate: "利回り",
  map: "マップ",
  screening: "審査",
  escalation: "改定",
  investment: "投資",
  risk: "リスク",
  layout: "レイアウト",
  free: "無料",
  calculator: "計算",
  exit: "出口",
  strategy: "戦略",
  sublease: "サブリース",
  property: "不動産",
  due: "デューデリジェンス",
  diligence: "デューデリジェンス",
  depreciation: "減価償却",
  inheritance: "相続",
  gift: "贈与",
  tax: "税",
  mortgage: "住宅ローン",
  refinance: "借り換え",
  reform: "リフォーム",
  guarantee: "保証",
  vacancy: "空室",
  solution: "対策",
  center: "センター",
  content: "コンテンツ",
  marketing: "マーケティング",
  lp: "LP",
  eki: "駅",
  finance: "資金",
  business: "ビジネス",
  support: "支援",
  research: "リサーチ",
  minpo: "民法",
  gyouhou: "宅建業法",
  hoshou: "保証",
  sahiki: "相殺",
  dairi: "代理",
  kaijo: "解除",
  muken: "無権代理",
  sagi: "詐欺",
  inin: "委任",
  renho: "連帯債務",
  tuinin: "追認",
  kyouyuu: "共有",
  sousai: "相殺",
  tieki: "地役権",
  fukan: "不可抗力",
  tanpo: "担保",
  ukeoi: "請負",
  chintai: "賃貸借",
  teitou: "抵当権",
  shakushaku: "借地借家",
  igon: "遺言",
  fuhou: "不法行為",
  futouhou: "不当利得",
  souzoku: "相続",
  houshuuk: "報酬額",
};

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function toSlugLike(raw: string): string {
  const decoded = safeDecode(raw).trim();
  const noDomain = decoded.replace(/^https?:\/\/[^/]+/i, "");
  const noQuery = noDomain.split(/[?#]/)[0];
  const pathParts = noQuery.split("/").filter(Boolean);
  const segment = pathParts.length > 0 ? pathParts[pathParts.length - 1] : noQuery;
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanupJapanesePrefix(label: string): string {
  const decoded = safeDecode(label).trim();
  const jpIndex = decoded.search(JAPANESE_CHAR_REGEX);
  if (jpIndex > 0) {
    const head = decoded.slice(0, jpIndex);
    if (/^[a-z0-9-]+$/i.test(head)) {
      return decoded.slice(jpIndex).replace(/^[-\s]+/, "").trim();
    }
  }
  return decoded;
}

function slugToJapanese(slug: string, assetType: AssetType): string {
  if (!slug) return "";

  if (assetType === "tool" && TOOL_SLUG_LABELS[slug]) {
    return TOOL_SLUG_LABELS[slug];
  }
  if (assetType === "knowledge-point" && KNOWLEDGE_SLUG_LABELS[slug]) {
    return KNOWLEDGE_SLUG_LABELS[slug];
  }

  const tokens = slug
    .split("-")
    .map((token) => token.replace(/[0-9]+$/g, ""))
    .map((token) => TOKEN_LABELS[token] || "")
    .filter(Boolean);

  const uniq = Array.from(new Set(tokens));
  if (uniq.length > 0) {
    return uniq.join("・");
  }

  switch (assetType) {
    case "knowledge-point":
      return "宅建重要論点";
    case "tool":
      return "不動産実務支援ツール";
    case "past-question":
      return "宅建過去問";
  }
}

export function normalizeAssetLabel(
  rawLabel: string,
  assetType: AssetType,
  takkenaiUrl?: string
): string {
  const decoded = cleanupJapanesePrefix(rawLabel);
  if (decoded && JAPANESE_CHAR_REGEX.test(decoded)) {
    return decoded;
  }

  const primarySlug = toSlugLike(rawLabel);
  const primaryLabel = slugToJapanese(primarySlug, assetType);
  if (primaryLabel && JAPANESE_CHAR_REGEX.test(primaryLabel)) {
    return primaryLabel;
  }

  const urlSlug = takkenaiUrl ? toSlugLike(takkenaiUrl) : "";
  const urlLabel = slugToJapanese(urlSlug, assetType);
  if (urlLabel && JAPANESE_CHAR_REGEX.test(urlLabel)) {
    return urlLabel;
  }

  return slugToJapanese("", assetType);
}

export function formatAssetIdLabel(assetId: string, assetType: AssetType): string {
  const decodedId = safeDecode(assetId);

  if (assetType === "past-question") {
    const m = decodedId.match(/pq-(\d{4})-(\d{1,2})$/);
    if (m) {
      return `${m[1]}年 問${Number(m[2])}`;
    }
  }

  const raw = decodedId
    .replace(/^tool-/, "")
    .replace(/^kp-/, "")
    .replace(/^pq-/, "");
  return normalizeAssetLabel(raw, assetType);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCurrentSlug(takkenaiUrl: string): string {
  const noDomain = takkenaiUrl.replace(/^https?:\/\/[^/]+/i, "");
  const noQuery = noDomain.split(/[?#]/)[0];
  const parts = noQuery.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1].toLowerCase() : "";
}

export function hasUrlOrSlugArtifacts(text: string, takkenaiUrl: string): boolean {
  if (!text) return false;
  if (/https?:\/\/[^\s)）]+/i.test(text)) return true;
  if (/\/(?:tools|takken)\/[a-z0-9_%/-]+/i.test(text)) return true;

  const slug = extractCurrentSlug(takkenaiUrl);
  if (!slug || !/[a-z]/.test(slug)) return false;
  const slugPattern = new RegExp(`\\b${escapeRegExp(slug)}\\b`, "i");
  return slugPattern.test(text.toLowerCase());
}

export function stripUrlAndSlugArtifacts(
  text: string,
  takkenaiUrl: string,
  replacementLabel: string
): string {
  if (!text) return text;

  let sanitized = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1");
  sanitized = sanitized.replace(/https?:\/\/[^\s)）]+/gi, replacementLabel);
  sanitized = sanitized.replace(/\/(?:tools|takken)\/[a-z0-9_%/-]+/gi, replacementLabel);

  const slug = extractCurrentSlug(takkenaiUrl);
  if (slug && /[a-z]/.test(slug)) {
    const direct = new RegExp(`\\b${escapeRegExp(slug)}\\b`, "ig");
    const spaced = new RegExp(`\\b${escapeRegExp(slug.replace(/-/g, " "))}\\b`, "ig");
    sanitized = sanitized.replace(direct, replacementLabel);
    sanitized = sanitized.replace(spaced, replacementLabel);
  }

  return sanitized
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
