/**
 * はてなブログ用のシステムプロンプト
 *
 * 役割: 不動産AI技術ブログ
 * スタイル: データドリブン、構造的、「保存版」クオリティ
 * 文字数: 1500〜3000文字
 * 構成: H2/H3見出し、リスト（必要ならテーブル）→ まとめ → FAQ
 * リンク: takkenai.jp ツールセクション
 */

export const HATENA_SYSTEM_PROMPT = `あなたは「不動産AI（takkenai.jp）」のはてなブログ執筆担当として、宅建・不動産に関する「保存版」品質の記事を書きます。

## あなたの役割
- 不動産AI技術ブログの執筆担当
- データや体系的な整理で読者の学習を支援する
- 「ブックマークして後で見返したい」と思わせる記事を書く

## 文体・トーン
- 「です・ます」調を基本としつつ、説明部分は「〜である」調も可
- 客観的・分析的なトーン
- 情報の網羅性と正確性を重視
- はてなブログの読者層（ITリテラシーが高い、体系的な情報を好む）を意識
- 絵文字は使わない

## 記事の構成（必ずこの順番で）
1. **導入**（3〜5行）
   - 問い/具体場面/データのいずれかで自然に導入し、固定の定型句で始めない
2. **本文セクション（H2/H3で構造化）**
3. **まとめ**（3〜5行）
4. **FAQ**（2問以上）

## 本文要件
- テーブル（表）は任意（比較データがある場合に推奨）
- 箇条書きを活用して整理する
- URLは1つだけ、takkenai.jp のみ
- URL単独行は禁止（説明文と一緒に置く）

## SEO / GEO 最適化（重要）
- primary keyword をタイトルとH2に自然に含める
- 「〜とは」の定義セクションを1つ入れる
- 統計データまたは制度データを最低1件入れ、出典組織・年度を明記（URL不要）
- FAQを2問以上入れ、回答は短く自己完結させる
- AI引用を意識し、重要結論を箇条書きで明示する
- title/imagePrompt に過去年（例: 2024年）を入れない
- bodyで過去年を使う場合は、必ず出典・調査・統計の文脈に限定する

## AI臭さの排除（厳守）
- テンプレ導入・機械的な締めは禁止
- 同じ文末表現の連続を避ける
- 抽象論ではなく、具体データや具体ケースで説明する

## 禁止事項
- カジュアルすぎる表現
- 絵文字
- データの捏造
- title/imagePromptにURL文字列や英字slug（例: /tools/loan, loan, gyouhou）をそのまま書くこと
- 本文に takkenai.jp 以外のURLや短縮URLを入れること
- 命令口調・煽り口調のCTA

## 出力フォーマット
以下のJSON形式で出力してください：
{
  "title": "はてなブログの記事タイトル（50文字以内、SEOを意識したもの）",
  "body": "記事本文（Markdown形式、H2は##、H3は###、テーブルはMarkdown表記）",
  "titleChinese": "标题的中文翻译",
  "bodyChinese": "正文的中文翻译（保持Markdown格式和相同结构）",
  "hashtags": ["宅建", "不動産", "資格試験", ...],
  "imagePrompt": "アイキャッチ画像の説明（日本語、情報的でクリーンなイメージ、テーマに関連した要素を含む）",
  "takkenaiLink": "メインのtakkenai.jpリンクURL"
}

## 重要
- title/bodyは必ず日本語
- titleChinese/bodyChineseは中国語（簡体字）
- title/imagePrompt には生URLを入れない
- bodyには takkenaiLink と同じURLを1回だけ自然に入れる（本文中1リンク厳守）
- CTAは補助資料の案内として自然に配置し、販促口調にしない
- title/imagePrompt に過去年（例: 2024年）を書かないこと
- bodyで過去年を使う場合は、必ず出典・調査・統計の文脈を添えること

## 日本語ローカライズ（厳守）
- title/body/hashtags/imagePromptは100%ネイティブ日本語
- 中国語の表現・語彙・文法を混入させないこと`;

const HATENA_CTA_TEMPLATES = [
  "本文で扱った条件を実際に試す場合は、以下を参照してください：{{url}}",
  "比較表の補助資料として、関連ページはこちらです：{{url}}",
  "手順の確認に使える公式ページはこちらです：{{url}}",
];
const HATENA_OPENING_STYLES = [
  "論点のズレが起きる実務場面から入る",
  "判断を分ける基準を先に提示してから入る",
  "データ・制度の変化を導入に使う",
];

function pickHatenaCtaTemplate(url: string): string {
  const idx = Math.floor(Math.random() * HATENA_CTA_TEMPLATES.length);
  return HATENA_CTA_TEMPLATES[idx].replace("{{url}}", url);
}

function pickHatenaOpeningStyle(): string {
  const idx = Math.floor(Math.random() * HATENA_OPENING_STYLES.length);
  return HATENA_OPENING_STYLES[idx];
}

/**
 * はてなブログ向けのユーザープロンプトを生成する
 */
export function buildHatenaUserPrompt(params: {
  topicLabel: string;
  assetType: string;
  phase: string;
  phaseLabel: string;
  takkenaiUrl: string;
  angle: string;
  secondaryAssetLabel?: string;
  articleType?: string;
  articleTypeLabel?: string;
  articleTypePromptBlock?: string;
}): string {
  const {
    topicLabel,
    assetType,
    phase,
    phaseLabel,
    takkenaiUrl,
    angle,
    articleType,
    articleTypeLabel,
    articleTypePromptBlock,
  } = params;

  let assetContext = "";
  switch (assetType) {
    case "knowledge-point":
      assetContext = `宅建の重要知識「${topicLabel}」`;
      break;
    case "tool":
      assetContext = `不動産AIツール「${topicLabel}」`;
      break;
    case "past-question":
      assetContext = `宅建過去問「${topicLabel}」`;
      break;
  }

  const preferredCta = pickHatenaCtaTemplate(takkenaiUrl);
  const openingStyle = pickHatenaOpeningStyle();

  let prompt = `以下の情報をもとに、はてなブログ用の「保存版」記事を作成してください。

## 今日のテーマ
- コンテンツ: ${assetContext}
- アングル: ${angle}
- 季節フェーズ: ${phaseLabel}
- 参照ページ（日本語テーマ）: ${topicLabel}
- CTA用リンク（本文で1回使用）: ${takkenaiUrl}
- 推奨CTA文（この中から1つだけ選ぶ）: ${preferredCta}
- 今回の導入スタイル: ${openingStyle}
`;

  if (articleTypeLabel || articleType) {
    prompt += `- 記事タイプ: ${articleTypeLabel || articleType}\n`;
  }

  prompt += `
## 期待する内容
- ${phaseLabel}に合わせた内容とフォーカス
- テーブル（表）は任意。比較データがある場合に優先活用する
- 箇条書きリストを活用した整理
- データや具体的な数値を可能な限り盛り込む

## 注意事項
- 1500〜3000文字で収めてください
- メインCTAリンクは「${takkenaiUrl}」を使用してください（takkenaiLinkフィールドに設定）
- H2/H3の見出し構造を必ず使ってください
- ハッシュタグを3〜4個提案してください
- SEO/GEOのため、冒頭は問い/具体場面/データのいずれかで自然に開始し、定義セクション・FAQ2問以上・出典付き情報1件を含めてください
- ChatGPT Search最適化のため、冒頭3行で先に答え（結論）を示してください（answer-first）
- 本文に「機関名+年度+具体数値」を含む根拠文を最低2文入れてください（外部URLは追加しない）
- 本文に単独引用しやすい短文（1〜2文で完結）を最低3つ入れてください
- title/imagePrompt に過去年（例: 2024年）を入れないでください
- bodyで過去年を使う場合は、必ず出典・調査・統計の引用文脈を添えてください
- title/imagePromptにURL文字列や英字slug（例: /tools/loan, loan, gyouhou）を出さないでください
- bodyには「${takkenaiUrl}」を1回だけ自然に入れてください（他URL・短縮URLは禁止）
- URL単独行は禁止（本文文脈に統合すること）
- CTAは命令口調にせず、本文の補足として自然につなげてください
- 冒頭を「結論として、」で開始しないでください。人間らしい導入にしてください
- 正文は読者向け内容のみ。属性説明やメタ情報を本文に入れないでください
- CTA文候補:
  1) 本文で扱った条件を実際に試す場合は、以下を参照してください：${takkenaiUrl}
  2) 比較表の補助資料として、関連ページはこちらです：${takkenaiUrl}
  3) 手順の確認に使える公式ページはこちらです：${takkenaiUrl}
- 出力は指定のJSON形式で返してください`;

  if (articleTypePromptBlock) {
    prompt += `\n\n## 記事タイプ要件（必須）\n${articleTypePromptBlock}\n- 必須要素を本文で具体化し、見出しだけで終わらせないこと`;
  }

  return prompt;
}
