import test from "node:test";
import assert from "node:assert/strict";

import {
  __testOnlyBuildChineseStructuralFallback,
  __testOnlyDedupeRepeatedNarrativeLines,
  __testOnlyEnsureSeoGeoStructure,
  __testOnlyRepairChineseConsistencyDeterministically,
  __testOnlyRemoveNonReaderFacingArtifacts,
  __testOnlyNormalizeParenthesizedUrls,
  __testOnlySanitizeChineseResidualKanaLines,
  __testOnlySanitizeHistoricalDateArtifacts,
  __testOnlySanitizeJapaneseField,
  buildTrackedTakkenaiUrl,
  type GeneratedContent,
  validateFinalJapaneseChineseConsistency,
  validateChineseTranslationCompleteness,
  validateHistoricalDateUsage,
  validatePlatformCompliance,
} from "./claude";
import type { Platform } from "./topic-engine";

const BASE_URL = "https://takkenai.jp/tools/loan-calculator";

function makeContent(body: string, overrides: Partial<GeneratedContent> = {}): GeneratedContent {
  return {
    title: "テストタイトル",
    body,
    titleChinese: "测试标题",
    bodyChinese: "测试正文",
    hashtags: ["宅建"],
    imagePrompt: "青を基調にした不動産学習イメージ",
    takkenaiLink: BASE_URL,
    ...overrides,
  };
}

function runCompliance(
  platform: Platform,
  body: string,
  takkenaiUrl: string = buildTrackedTakkenaiUrl(BASE_URL, platform)
): string[] {
  const content = makeContent(body, { takkenaiLink: takkenaiUrl });
  return validatePlatformCompliance(content, platform, takkenaiUrl);
}

test("buildTrackedTakkenaiUrl adds platform UTM params", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "note");
  const parsed = new URL(tracked);
  assert.equal(parsed.origin, "https://takkenai.jp");
  assert.equal(parsed.pathname, "/tools/loan-calculator");
  assert.equal(parsed.searchParams.get("utm_source"), "note");
  assert.equal(parsed.searchParams.get("utm_medium"), "blog");
  assert.equal(parsed.searchParams.get("utm_campaign"), "daily_content");
});

test("passes when exactly one takkenai link exists and path matches", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "ameba");
  const body =
    "今日の要点を最後に確認します。\n本文で触れた補足資料はこちらです: https://takkenai.jp/tools/loan-calculator?utm_source=ameba&utm_medium=blog&utm_campaign=daily_content&ref=manual";
  const issues = runCompliance("ameba", body, tracked);
  assert.deepEqual(issues, []);
});

test("normalizes parenthesized URLs in body", () => {
  const raw = "補足ページ： （https://takkenai.jp/tools/loan-calculator）。";
  const normalized = __testOnlyNormalizeParenthesizedUrls(raw);
  assert.equal(normalized, "補足ページ： https://takkenai.jp/tools/loan-calculator。");
});

test("fails when body contains zero links", () => {
  const issues = runCompliance("note", "リンクなし本文です。");
  assert.ok(issues.some((issue) => issue.includes("本文中URL数が不正です")));
});

test("fails when body contains two links", () => {
  const body = [
    "補足1: https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
    "補足2: https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content&v=2",
  ].join("\n");
  const issues = runCompliance("note", body);
  assert.ok(
    issues.some(
      (issue) =>
        issue.includes("本文中URL数が不正です") ||
        issue.includes("takkenai.jp のURLは1件必須") ||
        issue.includes("複数")
    ),
    issues.join("\n")
  );
});

test("note standard mode allows takken link + one whitelisted related note link", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "note");
  const relatedNoteUrl = "https://note.com/acme_jp/n/abc123";
  const body = [
    "本文の補足資料はこちらです: https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
    "## 関連記事",
    `同じ論点を別の視点で整理した記事も参考になります: ${relatedNoteUrl}`,
  ].join("\n");
  const content = makeContent(body, {
    takkenaiLink: tracked,
    meta: {
      noteEntryMode: "standard",
      relatedNoteUrl,
    },
  });
  const issues = validatePlatformCompliance(content, "note", tracked, {
    platform: "note",
    noteEntryMode: "standard",
    relatedNoteUrl,
    relatedNoteAllowedAccounts: ["acme_jp"],
  });
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("note viral mode rejects additional note article link", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "note");
  const body = [
    "本文の補足資料はこちらです: https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
    "同じ論点の参考: https://note.com/acme_jp/n/abc123",
  ].join("\n");
  const content = makeContent(body, {
    takkenaiLink: tracked,
    meta: {
      noteEntryMode: "viral",
    },
  });
  const issues = validatePlatformCompliance(content, "note", tracked, {
    platform: "note",
    noteEntryMode: "viral",
  });
  assert.ok(
    issues.some((issue) => issue.includes("標準note互链モードでのみ許可")),
    issues.join("\n")
  );
});

test("does not overcount cta lines for neutral explanatory sentences", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "note");
  const body = [
    "## 仕組みの整理",
    "参考ページで使われる用語の定義を先に理解しておくと、読み違いを減らせます。",
    "関連ページの比較観点も本文内で解説します。",
    "本文補足: https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");
  const issues = runCompliance("note", body, tracked);
  assert.ok(
    !issues.some((issue) => issue.includes("CTA行が多すぎます")),
    issues.join("\n")
  );
});

test("fails on external domain", () => {
  const body = "参考リンク: https://example.com/abc";
  const issues = runCompliance("hatena", body);
  assert.ok(
    issues.some((issue) => issue.includes("許可されていない外部ドメイン")),
    issues.join("\n")
  );
});

test("fails on shortener URL", () => {
  const body = "補足: https://bit.ly/3abcxyz";
  const issues = runCompliance("ameba", body);
  assert.ok(issues.some((issue) => issue.includes("短縮URL")), issues.join("\n"));
});

test("fails on isolated URL line", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "note");
  const body = [
    "実務での条件分岐を整理しました。",
    "https://takkenai.jp/tools/loan-calculator?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");
  const issues = runCompliance("note", body, tracked);
  assert.ok(issues.some((issue) => issue.includes("孤立行")), issues.join("\n"));
});

test("fails when marketing push wording is too dense", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "ameba");
  const body = [
    "今すぐ、今すぐ、今すぐチェック。限定で必見の内容です。",
    `本文補足: ${tracked}`,
  ].join("\n");
  const issues = runCompliance("ameba", body, tracked);
  assert.ok(
    issues.some((issue) => issue.includes("広告訴求ワード密度")),
    issues.join("\n")
  );
});

test("fails when takkenai path mismatches even if domain is correct", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "hatena");
  const body =
    "補足: https://takkenai.jp/tools/wrong-path?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content";
  const issues = runCompliance("hatena", body, tracked);
  assert.ok(
    issues.some((issue) => issue.includes("URLパスが指定リンクと一致しません")),
    issues.join("\n")
  );
});

test("fails on platform banned phrase", () => {
  const tracked = buildTrackedTakkenaiUrl(BASE_URL, "ameba");
  const body = `今すぐやらないと損です。補足: ${tracked}`;
  const issues = runCompliance("ameba", body, tracked);
  assert.ok(
    issues.some((issue) => issue.includes("誘導禁止パターン")),
    issues.join("\n")
  );
});

test("fails when title contains historical year", () => {
  const content = makeContent("本文です。", {
    title: "2024年版 宅建税制の基本",
  });
  const issues = validateHistoricalDateUsage(content, "2026-02-20");
  assert.ok(
    issues.some((issue) => issue.includes("title に過去年")),
    issues.join("\n")
  );
});

test("fails when body historical year appears without citation context", () => {
  const content = makeContent("2024年にこの制度が厳しくなりました。");
  const issues = validateHistoricalDateUsage(content, "2026-02-20");
  assert.ok(
    issues.some((issue) => issue.includes("引用文脈がありません")),
    issues.join("\n")
  );
});

test("passes when body historical year appears with citation context", () => {
  const content = makeContent(
    "国土交通省の調査（2024年）によると、空室率は上昇傾向です。"
  );
  const issues = validateHistoricalDateUsage(content, "2026-02-20");
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("historical date sanitizer rewrites non-citation old year tokens to avoid hard-fail", () => {
  const content = makeContent(
    [
      "## 市場動向",
      "2025年に問い合わせ率が上がりました。",
      "参考: https://takkenai.jp/tools/loan/?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
    ].join("\n"),
    {
      title: "2025年版 宅建の要点",
      seoTitle: "2025年版 SEOタイトル",
      imagePrompt: "2025年の不動産実務イメージ",
    }
  );
  const sanitized = __testOnlySanitizeHistoricalDateArtifacts(
    content,
    "2026-02-20"
  );
  const issues = validateHistoricalDateUsage(sanitized, "2026-02-20");
  assert.equal(issues.length, 0, issues.join("\n"));
  assert.ok(!/2025/.test(sanitized.title));
  assert.ok(!/2025/.test(sanitized.body));
});

test("detects incomplete chinese translation when too short", () => {
  const jp =
    "## セクション1\n宅建学習の本文です。十分な長さの説明を入れています。\n\n## セクション2\nさらに詳しい解説を続けます。";
  const zh = "## 第一部分\n这是很短的翻译。";
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(issues.length > 0, "expected completeness issues");
});

test("passes chinese translation completeness for sufficiently long structured text", () => {
  const jp =
    "## セクション1\n宅建学習の本文です。十分な長さの説明を入れています。\n\n## セクション2\nさらに詳しい解説を続けます。";
  const zh =
    "## 第一部分\n这是完整翻译，包含足够长度的说明内容，能够对应原文结构并保持语义完整。\n\n## 第二部分\n这里继续详细说明，包含完整句号。";
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("does not flag chinese tail-truncation when last line is URL", () => {
  const jp = [
    "## セクション1",
    "宅建学習の本文です。十分な長さの説明を入れています。",
    "## セクション2",
    "さらに詳しい解説を続けます。",
    "補足: https://takkenai.jp/tools/loan-calculator?utm_source=ameba&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");
  const zh = [
    "## 第一部分",
    "这是完整翻译，包含足够长度的说明内容，能够对应原文结构并保持语义完整。",
    "## 第二部分",
    "这里继续详细说明，内容完整。",
    "补充: https://takkenai.jp/tools/loan-calculator?utm_source=ameba&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    !issues.some((issue) => issue.includes("末尾が途中で切れている可能性があります")),
    issues.join("\n")
  );
});

test("does not flag chinese tail-truncation for complete sentence without final punctuation", () => {
  const jp = [
    "## セクション1",
    "宅建学習の本文です。十分な長さの説明を入れています。",
    "## セクション2",
    "さらに詳しい解説を続けます。",
  ].join("\n");
  const zh = [
    "## 第一部分",
    "这是完整翻译，包含足够长度的说明内容，能够对应原文结构并保持语义完整。",
    "## 第二部分",
    "这里继续详细说明，内容完整且可直接用于复习",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    !issues.some((issue) => issue.includes("末尾が途中で切れている可能性があります")),
    issues.join("\n")
  );
});

test("flags chinese tail-truncation when sentence ends with dangling connector", () => {
  const jp = [
    "## セクション1",
    "宅建学習の本文です。十分な長さの説明を入れています。",
    "## セクション2",
    "さらに詳しい解説を続けます。",
  ].join("\n");
  const zh = [
    "## 第一部分",
    "这是完整翻译，包含足够长度的说明内容，能够对应原文结构并保持语义完整。",
    "## 第二部分",
    "这里继续详细说明，内容将",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    issues.some((issue) => issue.includes("末尾が途中で切れている可能性があります")),
    issues.join("\n")
  );
});

test("flags chinese translation when japanese headings leak into bodyChinese", () => {
  const jp = [
    "## 物件紹介投稿が読まれない理由",
    "本文です。",
    "## 実務での活用手順",
    "本文です。",
    "参考: https://takkenai.jp/tools/sns-generator/?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");
  const zh = [
    "## 物件紹介投稿が読まれない理由",
    "这是中文段落。",
    "## 実務での活用手順",
    "这是中文段落。",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    issues.some((issue) => issue.includes("日本語見出しが混入")),
    issues.join("\n")
  );
});

test("flags chinese translation when japanese narrative lines leak into bodyChinese", () => {
  const jp = [
    "## 第1章",
    "宅建学習の本文です。十分な長さの説明を入れています。",
    "## 第2章",
    "さらに詳しい解説を続けます。",
  ].join("\n");
  const zh = [
    "## 第一节",
    "这是中文段落，但下面混入了日文正文。",
    "不動産実務でエリア情報をまとめる際、複数のAIツールが存在します。",
    "## 第二节",
    "这段也混入日文：問題文の型を先に見抜くことが大切です。",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    issues.some((issue) => issue.includes("日本語本文が混入")),
    issues.join("\n")
  );
});

test("sanitize chinese residual kana lines rewrites japanese leak to chinese-safe text", () => {
  const mixed = [
    "## 実務での活用手順",
    "まず定義と結論を確認します。",
    "- 問題文の型を先に見抜く",
    "参考: https://takkenai.jp/tools/sns-generator/?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");

  const sanitized = __testOnlySanitizeChineseResidualKanaLines(mixed);
  const issues = validateChineseTranslationCompleteness(
    [
      "## 実務での活用手順",
      "本文です。十分な長さの説明を入れています。",
      "参考: https://takkenai.jp/tools/sns-generator/?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content",
    ].join("\n"),
    sanitized
  );

  assert.ok(!issues.some((issue) => issue.includes("日本語見出しが混入")), issues.join("\n"));
  assert.ok(!issues.some((issue) => issue.includes("日本語本文が混入")), issues.join("\n"));
});

test("flags chinese tail-truncation when sentence ends with unclosed quote", () => {
  const jp = [
    "## セクション1",
    "宅建学習の本文です。十分な長さの説明を入れています。",
    "## セクション2",
    "さらに詳しい解説を続けます。",
  ].join("\n");
  const zh = [
    "## 第一部分",
    "这是完整翻译，包含足够长度的说明内容。",
    "## 第二部分",
    "在房源现场调查中只需说\"用150字介绍这个房源的魅力",
  ].join("\n");
  const issues = validateChineseTranslationCompleteness(jp, zh);
  assert.ok(
    issues.some((issue) => issue.includes("末尾が途中で切れている可能性があります")),
    issues.join("\n")
  );
});

test("final japanese-chinese consistency passes when headings and structure are aligned", () => {
  const content = makeContent(
    [
      "## 商業賃料見積とは",
      "商業賃料見積とは、店舗や事務所の賃料を算出するための手順です。判断軸を揃えると精度が上がります。",
      "## 実務での使い方",
      "比較条件を固定し、事例と数値を並べてから最終判断すると運用しやすくなります。",
    ].join("\n"),
    {
      titleChinese: "商业租金估算指南",
      bodyChinese: [
        "## 什么是商业租金估算",
        "商业租金估算是计算店铺和办公室租金的流程。统一判断维度可以提高精度并减少偏差。",
        "## 实务中的使用方法",
        "先固定比较条件，再并列案例和数值，最后做判断，会更容易稳定落地。",
      ].join("\n"),
    }
  );

  const issues = validateFinalJapaneseChineseConsistency(content);
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("final japanese-chinese consistency fails when japanese tail heading is not translated", () => {
  const content = makeContent(
    [
      "## 商業賃料見積とは",
      "本文です。十分な長さを保つために詳細を加えます。",
      "## 実務での使い方",
      "本文です。運用時の確認順を具体的に説明します。",
      "## 商業賃料見積の選定ランキング（実務視点）",
      "本文です。比較軸を提示します。",
    ].join("\n"),
    {
      titleChinese: "商业租金估算指南",
      bodyChinese: [
        "## 什么是商业租金估算",
        "这是对应翻译正文，包含足够长度以便通过完整性检查。",
        "## 实务中的使用方法",
        "这里继续详细说明执行步骤和注意点，确保段落完整。",
      ].join("\n"),
    }
  );

  const issues = validateFinalJapaneseChineseConsistency(content);
  assert.ok(
    issues.some(
      (issue) =>
        issue.includes("見出し数") || issue.includes("見出し数が不足")
    ),
    issues.join("\n")
  );
});

test("deterministic chinese consistency repair aligns heading counts", () => {
  const content = makeContent(
    [
      "## 8種制限とは",
      "8種制限の定義と適用範囲を整理します。実務上の判断条件も合わせて確認します。",
      "## 8種規制とは",
      "8種規制の目的と対象区域を整理します。例外条件の扱いも確認します。",
      "## 実務での見分け方",
      "誰が売主か、どこに建てるかの2軸で切り分けると判断が安定します。",
      "参考: https://takkenai.jp/takken/knowledge/example/?utm_source=ameba&utm_medium=blog&utm_campaign=daily_content",
      "## FAQ",
      "Q: 実務で迷ったら？",
      "A: 結論→根拠→例外の順に確認します。",
      "## まとめ",
      "論点を混同しないことが失点回避に直結します。",
    ].join("\n"),
    {
      titleChinese: "8种限制与8种规范区分",
      bodyChinese: [
        "## 什么是8种限制",
        "先确认买卖主体，再判断保护规则是否适用。",
        "## 什么是8种规范",
        "先确认区域属性，再核对可开发条件。",
        "## 实务分辨方法",
        "用两条判断轴来切分问题。",
        "## 常见误区",
        "只看一个条件容易误判。",
        "## 操作步骤",
        "按结论、依据、例外顺序确认。",
        "## FAQ",
        "Q: 现场迷惑时怎么办？",
        "A: 回到定义与例外条件。",
        "## 总结",
        "避免混同可以减少失分。",
        "## 补充",
        "参考链接：https://takkenai.jp/takken/knowledge/example/?utm_source=ameba&utm_medium=blog&utm_campaign=daily_content",
      ].join("\n"),
    }
  );

  const repaired = __testOnlyRepairChineseConsistencyDeterministically(content);
  const issues = validateFinalJapaneseChineseConsistency(repaired);
  assert.equal(issues.length, 0, issues.join("\n"));
});

test("sanitize japanese field strips leaked json key fragments", () => {
  const raw = [
    "## 本文",
    "これは日本語の段落です。",
    "{ titleChinese: \"中文标题\", bodyChinese: \"中文正文\" }",
    "\"hashtags\": [\"宅建\"]",
    "これは残るべき日本語です。",
  ].join("\n");

  const cleaned = __testOnlySanitizeJapaneseField(raw);
  assert.ok(!cleaned.includes("titleChinese"), cleaned);
  assert.ok(!cleaned.includes("bodyChinese"), cleaned);
  assert.ok(!cleaned.includes("\"hashtags\""), cleaned);
  assert.ok(cleaned.includes("これは残るべき日本語です。"), cleaned);
});

test("sanitize japanese field removes heavy simplified-chinese leakage lines", () => {
  const raw = [
    "## 見出し",
    "这是用于测试的中文句子，会包含们这为从与产发务动等简体特征。",
    "この行は日本語として残るべきです。",
  ].join("\n");
  const cleaned = __testOnlySanitizeJapaneseField(raw);
  assert.ok(!cleaned.includes("这是用于测试的中文句子"), cleaned);
  assert.ok(cleaned.includes("この行は日本語として残るべきです。"), cleaned);
});

test("chinese structural fallback keeps heading/url parity and avoids japanese headings", () => {
  const jpTitle = "商業賃料見積ツール完全ガイド";
  const jpBody = [
    "## 商業賃料見積とは",
    "商業賃料見積とは、店舗・事務所・倉庫などの賃料を算出する実務手順です。",
    "### 初回物件購入前",
    "実務では比較条件を固定してから判断します。",
    "参考: https://takkenai.jp/tools/commercial-rent-estimate/?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content",
    "## まとめ",
    "要点を順番に確認しましょう。",
  ].join("\n");

  const fallback = __testOnlyBuildChineseStructuralFallback(jpTitle, jpBody, "");
  const issues = validateChineseTranslationCompleteness(jpBody, fallback.bodyChinese);
  assert.equal(issues.length, 0, issues.join("\n"));

  const zhHeadingLines = (fallback.bodyChinese.match(/^##+\s+.+$/gm) || []).join("\n");
  assert.ok(!/[ぁ-んァ-ン]/.test(zhHeadingLines), zhHeadingLines);
  assert.equal(
    (jpBody.match(/https?:\/\/[^\s)）]+/g) || []).length,
    (fallback.bodyChinese.match(/https?:\/\/[^\s)）]+/g) || []).length
  );
});

test("hatena fallback structure should not append fixed checklist template table", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q48/",
    "hatena"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body: "結論として、統計問題は傾向理解が重要です。",
    keyword: "2025年 問48",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });

  assert.ok(!output.includes("| 項目 | 確認ポイント |"), output);
  assert.ok(!output.includes("| 定義 | 用語の意味を一文で説明できる |"), output);
  assert.ok(!output.includes("| 実務 | 手順を順番に説明できる |"), output);
});

test("artifact cleaner removes seo-like template scenario blocks", () => {
  const rawBody = [
    "本文です。",
    "### 実務シナリオ（特殊ケース）",
    "- ケース1: 標準条件で判断する場合は、基本手順をそのまま適用",
    "- ケース2: 例外条件がある場合は、先に例外要件を確認してから計算",
    "- ケース3: 判断に迷う場合は、根拠条文・公式資料に立ち戻って確認",
    "## まとめ",
    "以上です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("### 実務シナリオ（特殊ケース）"), cleaned);
  assert.ok(!cleaned.includes("ケース1:"), cleaned);
  assert.ok(cleaned.includes("## まとめ"), cleaned);
});

test("artifact cleaner removes synthetic section headings", () => {
  const rawBody = [
    "本文です。",
    "## 実施フロー",
    "1. まず前提条件を確認します。",
    "2. 次に主要指標を揃えます。",
    "## まとめ",
    "本文です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("## 実施フロー"), cleaned);
  assert.ok(cleaned.includes("## まとめ"), cleaned);
  assert.ok(cleaned.includes("本文です。"), cleaned);
});

test("artifact cleaner removes non-reader guidance sentence", () => {
  const rawBody = [
    "本文です。",
    "FAQの確認時は、例外条件と数値条件を同時に見ることで見落としを防ぎやすくなります。",
    "Q: どこから確認しますか？",
    "A: まず現場データを整えます。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("確認時は、例外条件と数値条件"), cleaned);
  assert.ok(cleaned.includes("Q: どこから確認しますか？"), cleaned);
  assert.ok(cleaned.includes("A: まず現場データを整えます。"), cleaned);
});

test("artifact cleaner removes style-hint CTA lines", () => {
  const rawBody = [
    "本文です。",
    "本文で触れた論点の補足（読後の補助資料リンク）: https://takkenai.jp/takken/past-questions/2025-q46/?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
    "関連ツール・リソース（関連ツール・リソース節の補助リンク）: __TAKKENAI_ALLOWED_LINK__",
    "## まとめ",
    "以上です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("読後の補助資料リンク"), cleaned);
  assert.ok(!cleaned.includes("本文で触れた論点の補足"), cleaned);
  assert.ok(!cleaned.includes("関連ツール・リソース節の補助リンク"), cleaned);
});

test("artifact cleaner removes word-count and generic process template blocks", () => {
  const rawBody = [
    "本文です。",
    "【文字数】約940字",
    "## 実務での進め方",
    "- 先に前提条件を確認する",
    "- 次に判断基準を揃える",
    "## 注意点・よくあるミス",
    "- 先に結論だけ決めず、根拠と例外をセットで確認する",
    "最後にFAQの一つ。Q: どこを見ればよい？ A: 先に前提条件を確認。",
    "## まとめ",
    "以上です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("【文字数】"), cleaned);
  assert.ok(!cleaned.includes("## 実務での進め方"), cleaned);
  assert.ok(!cleaned.includes("## 注意点・よくあるミス"), cleaned);
  assert.ok(!cleaned.includes("最後にFAQの一つ。Q:"), cleaned);
  assert.ok(cleaned.includes("## まとめ"), cleaned);
});

test("artifact cleaner removes trend-analysis template sections and lines", () => {
  const rawBody = [
    "本文です。",
    "## 直近の動向と実務への影響",
    "市場動向は年度ごとに変化するため、最新の公表資料を確認して判断することが重要です。",
    "## 実務アクション",
    "- まず現行ルールを確認し、次に運用上の影響を洗い出す",
    "実務アクションでは、先に適用条件をそろえてから判断基準を比較すると、結論のぶれを抑えやすくなります。",
    "## まとめ",
    "以上です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("## 直近の動向と実務への影響"), cleaned);
  assert.ok(!cleaned.includes("## 実務アクション"), cleaned);
  assert.ok(!cleaned.includes("市場動向は年度ごとに変化するため"), cleaned);
  assert.ok(!cleaned.includes("先に適用条件をそろえてから判断基準を比較すると"), cleaned);
  assert.ok(cleaned.includes("## まとめ"), cleaned);
});

test("artifact cleaner prunes heading that becomes empty after template-line removal", () => {
  const rawBody = [
    "## なぜ基礎固め期に宅建重要論点の理解が不可欠なのか？",
    "なぜ基礎固め期に宅建重要論点の理解が不可欠なのか？では、先に適用条件をそろえてから判断基準を比較すると、結論のぶれを抑えやすくなります。",
    "## 本文",
    "読者向けの具体解説です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("不可欠なのか？"), cleaned);
  assert.ok(cleaned.includes("## 本文"), cleaned);
});

test("seo structure fallback should not inject legacy template phrases", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q47/",
    "ameba"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "ameba",
    body: "本文のみです。",
    keyword: "8種制限と8種規制",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  assert.ok(!output.includes("の実務ポイント"), output);
  assert.ok(!output.includes("つまずきやすいポイント"), output);
  assert.ok(!output.includes("要件を順番に確認すると、判断ミスを減らせます。"), output);
  assert.ok(!output.includes("試験頻出の例外と計算手順を先に整理しましょう。"), output);
});

test("dedupe keeps only one repeated narrative line and prefers URL variant", () => {
  const body = [
    "仕様と活用パターンは公式ページにまとまっているため、あわせて参照すると実務に転用しやすくなります。",
    "仕様と活用パターンは公式ページにまとまっているため、あわせて参照すると実務に転用しやすくなります。",
    "仕様と活用パターンは公式ページ（https://takkenai.jp/tools/chirashi-generator/?utm_source=hatena&utm_medium=blog&utm_campaign=daily_content）にまとまっているため、あわせて参照すると実務に転用しやすくなります。",
  ].join("\n");

  const deduped = __testOnlyDedupeRepeatedNarrativeLines(body);
  const phraseMatches = deduped.match(/仕様と活用パターンは公式ページ/g) || [];
  assert.equal(phraseMatches.length, 1, deduped);
  assert.ok(deduped.includes("https://takkenai.jp/tools/chirashi-generator/"), deduped);
});

test("artifact cleaner removes inline terminology-control notes", () => {
  const rawBody = [
    "本文です。",
    "本文では「2025年 問46」を主要用語として表記を統一し、同じ概念に複数の呼称を混在させないように整理します。",
    "## まとめ",
    "以上です。",
  ].join("\n");
  const cleaned = __testOnlyRemoveNonReaderFacingArtifacts(rawBody);
  assert.ok(!cleaned.includes("主要用語として表記を統一"), cleaned);
  assert.ok(!cleaned.includes("複数の呼称"), cleaned);
});

test("seo enhancement should not inject template case headings", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q48/",
    "note"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "note",
    body: "結論として、問48は傾向理解が重要です。",
    keyword: "2025年 問48",
    trackedTakkenaiUrl: tracked,
    aiActions: ["补充具体实务场景和特殊情况处理方法"],
  });
  assert.ok(!output.includes("### 実務シナリオ（特殊ケース）"), output);
  assert.ok(!output.includes("ケース1:"), output);
});

test("inserted CTA line should be reader-facing and without style hints", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q46/",
    "note"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "note",
    body: "結論として、問46は判断基準の理解が重要です。",
    keyword: "2025年 問46",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  assert.ok(output.includes("公式ページ"), output);
  assert.match(
    output,
    /https:\/\/takkenai\.jp\/takken\/past-questions\/2025-q46\/\?utm_source=note&utm_medium=blog&utm_campaign=daily_content/
  );
  assert.ok(!output.includes("読後の補助資料リンク"), output);
});

test("should inject link into existing reference line instead of appending duplicate CTA", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/chirashi-generator/",
    "hatena"
  );
  const body = [
    "## 注意点",
    "仕様と活用パターンは公式ページにまとまっているため、あわせて参照すると実務に転用しやすくなります。",
    "## まとめ",
    "終わり。",
  ].join("\n");

  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body,
    keyword: "チラシ文面生成",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });

  const phraseMatches = output.match(/仕様と活用パターンは公式ページ/g) || [];
  assert.equal(phraseMatches.length, 1, output);
  const urlMatches = output.match(/https:\/\/takkenai\.jp\/tools\/chirashi-generator\//g) || [];
  assert.equal(urlMatches.length, 1, output);
});

test("related tools section should be removed from reader body", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/sns-generator/",
    "hatena"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body: [
      "## 本文",
      "SNS投稿文生成の解説です。",
      "## 関連ツール・リソースの紹介",
      "これらのツールを複合的に活用することで、実務効率と理解が飛躍的に向上する。",
      `参考資料として公式ページを置いておきます: ${tracked}`,
      "## まとめ",
      "読者向けの結論です。",
    ].join("\n"),
    keyword: "SNS投稿文生成",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });

  assert.ok(!output.includes("## 関連ツール・リソース"), output);
  assert.ok(!output.includes("## 関連ツール・リソースの紹介"), output);
  assert.ok(!output.includes("飛躍的に向上"), output);
  assert.ok(output.includes("## まとめ"), output);
});

test("formulaic conclusion lead should be removed from body head", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/loan-calculator/",
    "note"
  );
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "note",
    body: "結論として、ローン計算を先に押さえると実務判断が安定します。\n\n本文です。",
    keyword: "ローン計算",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  assert.ok(!output.startsWith("結論として、"), output);
});

test("should not append duplicate FAQ when existing FAQ uses bold numbered format", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q48/",
    "hatena"
  );
  const body = [
    "## 解説",
    "本文です。",
    "## FAQ",
    "**Q1: 既存の質問ですか？**",
    "A1: はい。",
    "**Q2: 既存の質問2ですか？**",
    "A2: はい。",
  ].join("\n");
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body,
    keyword: "2025年 問48",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  const faqHeadings = output.match(/^##+\s*FAQ\s*$/gim) || [];
  assert.equal(faqHeadings.length, 1, output);
});

test("should collapse duplicated FAQ sections into one", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/takken/past-questions/2025-q46/",
    "note"
  );
  const body = [
    "## 本文",
    "内容です。",
    "## FAQ",
    "Q: 既存質問1",
    "A: 回答1",
    "## FAQ",
    "Q: 既存質問2",
    "A: 回答2",
    "## まとめ",
    "おわり。",
  ].join("\n");
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "note",
    body,
    keyword: "2025年 問46",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  const faqHeadings = output.match(/^##+\s*FAQ\s*$/gim) || [];
  assert.equal(faqHeadings.length, 1, output);
  assert.ok(output.includes("## まとめ"), output);
});

test("faq heading should not receive template fallback sentence", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/benkyou-keikaku/",
    "hatena"
  );
  const body = [
    "## 本文",
    "本文です。",
    "## FAQ",
    "短い回答。",
  ].join("\n");
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body,
    keyword: "学習計画作成",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  assert.ok(
    !output.includes("FAQの確認時は、例外条件と数値条件を同時に見ることで見落としを防ぎやすくなります。"),
    output
  );
});

test("faq meta guidance sentence should be removed from reader body", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/benkyou-keikaku/",
    "hatena"
  );
  const body = [
    "## FAQ",
    "FAQの確認時は、例外条件と数値条件を同時に見ることで見落としを防ぎやすくなります。",
    "Q: どこから始めますか？",
    "A: まず定義と頻出論点を押さえます。",
  ].join("\n");
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body,
    keyword: "学習計画作成",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  assert.ok(!output.includes("FAQの確認時は"), output);
  assert.ok(output.includes("Q: どこから始めますか？"), output);
});

test("faq narrative block should be normalized into Q/A pairs", () => {
  const tracked = buildTrackedTakkenaiUrl(
    "https://takkenai.jp/tools/benkyou-keikaku/",
    "hatena"
  );
  const body = [
    "## FAQ",
    "初心者でも基礎理解段階（1〜2ヶ月目）から活用を始めると、効率的に知識の定着が進みます。",
    "多くのツールは進捗遅延や突発業務などで計画変更が必要な場合、自動で見直し案を提示し、ユーザーの決定をサポートします。",
  ].join("\n");
  const output = __testOnlyEnsureSeoGeoStructure({
    platform: "hatena",
    body,
    keyword: "学習計画作成",
    trackedTakkenaiUrl: tracked,
    aiActions: [],
  });
  const qCount =
    (output.match(/^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gm) || [])
      .length;
  const aCount =
    (output.match(/^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gm) || [])
      .length;
  assert.ok(qCount >= 2, output);
  assert.ok(aCount >= 2, output);
  assert.ok(!output.includes("FAQの確認時は"), output);
});
