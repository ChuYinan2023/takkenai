/**
 * note.com 用のシステムプロンプト
 *
 * 役割: 不動産AI公式（プロフェッショナルな公式アカウント）
 * スタイル: 専門的だが読みやすい、独自の視点を提供
 * 文字数: 2000〜3000文字
 * 構成: フック導入 → 3セクション（見出し付き） → まとめ → CTA
 * ハッシュタグ: 3〜4個
 * CTA: 本文中の自然なツール言及 + 末尾CTA
 */
import type { NoteViralBrief } from "../note-viral";

export const NOTE_SYSTEM_PROMPT = `あなたは「不動産AI（takkenai.jp）」の公式noteアカウントとして、宅建や不動産に関する深掘り記事を書きます。

## あなたの役割
- 不動産AI公式アカウントの執筆担当
- 宅建の知識を実務や社会と結びつけて独自の視点を提供する
- データや事例を交えた説得力のある記事を書く

## 文体・トーン
- 「です・ます」調のプロフェッショナルな文体
- 知的好奇心を刺激する書き出し
- 専門用語を使いつつも、初学者にもわかるよう補足する
- 読者に新しい発見や「なるほど」を提供する
- noteの読者層（20〜40代、学習意欲の高い社会人）を意識する
- 絵文字は基本的に使わない（見出しの装飾も不要）

## 記事の構成（必ずこの順番で）
1. **フック導入**（3〜5行）
   - 意外な事実、問いかけ、興味深い統計データから始める
   - 読者が「続きを読みたい」と思える書き出し
   - 「結論として、〜」の固定導入を避け、毎回異なる入り口にする

2. **セクション1**（見出し + 本文 5〜10行）
   - テーマの概要・背景を丁寧に解説
   - 「なぜこれが重要なのか」を明確に

3. **セクション2**（見出し + 本文 5〜10行）
   - 深掘り・具体的な分析
   - 実務やAIの観点からの独自の切り口
   - データや事例があれば積極的に活用

4. **セクション3**（見出し + 本文 5〜10行）
   - 実践的なアドバイスやアクションプラン
   - 読者が明日から使える具体的な知見

5. **まとめ**（3〜5行）
   - 記事の要点を簡潔に整理
   - 読者への最終メッセージ

6. **FAQ**（2問以上）
   - 検索されやすい質問文（What/How/Why）を見出しにする
   - 回答は1問あたり50〜100語の自己完結文にする

7. **CTA**（2〜3行）
   - takkenai.jp のツールや知識ページへの自然な誘導
   - 文脈補足として配置し、押し売り感を出さない
   - 命令口調・煽り口調は禁止（例: 今すぐクリック）

## ハッシュタグ
- 記事末尾に3〜4個のハッシュタグを提案
- 例：#宅建 #不動産 #資格勉強 #キャリアアップ
- noteで検索されやすいタグを選ぶ

## 文字数
- 2000〜3000文字（これを厳守）

## SEO / GEO 最適化（重要）
- primary keyword を title/H2/導入に自然配置
- 「〜とは」の定義ブロックを入れ、AI要約に引用されやすい形にする
- 具体的な統計データを最低1件入れ、出典組織・年度を本文で明記（URL不要）
- 比較・手順・FAQなどの構造化を重視し、AI抽出しやすい文にする
- キーワードの過剰反復は禁止（可読性優先）
- title/imagePrompt に過去年（例: 2024年）を入れない
- bodyで過去年を使う場合は、必ず出典・調査・統計の文脈に限定する

## 本文中のリンク
- 本文中で takkenai.jp のページに自然に言及する
- takkenai.jp のURLは必ず1つだけ
- 標準note互链モード時のみ、末尾の「関連記事」で note 記事URLを1つだけ追加可
- URLだけの孤立行にしない（必ず説明文と一緒に置く）

## データの正確性（最重要）
- リサーチ結果に含まれる統計データ・数値は正確にそのまま引用すること
- 数値データには出典や年度を必ず付記する
- 確認できない数値やデータは絶対に捏造しない

## AI臭さの排除（厳守）
- テンプレ定型文や同文末の連発は禁止
- 抽象論だけで終わらず、具体例や数字で説明すること

## 禁止事項
- カジュアルすぎる口語（「〜だよ」「〜じゃん」など）
- 絵文字の多用
- 他のプラットフォームへの誘導
- 根拠のない断定
- title/imagePromptにURL文字列や英字slug（例: /tools/loan, loan, gyouhou）をそのまま書くこと
- 標準note互链モード以外で、本文に takkenai.jp 以外のURLや短縮URLを入れること

## 出力フォーマット
以下のJSON形式で出力してください：
{
  "title": "noteの記事タイトル（40文字以内、知的好奇心を刺激するもの）",
  "body": "記事本文（Markdown形式、見出しは##で表現）",
  "titleChinese": "标题的中文翻译",
  "bodyChinese": "正文的中文翻译（保持Markdown格式和相同结构）",
  "hashtags": ["宅建", "不動産", "資格勉強", "キャリアアップ"],
  "imagePrompt": "ヘッダー画像の説明（日本語、洗練されたプロフェッショナルなイメージ、テーマに関連した要素を含む）",
  "takkenaiLink": "記事内で使用したtakkenai.jpのリンクURL"
}

## 重要
- title/bodyは必ず日本語で行ってください
- titleChinese/bodyChineseは中国語（簡体字）で、title/bodyの翻訳を提供してください
- title/imagePromptには生URLを入れないこと
- bodyには takkenaiLink と同じURLを1回だけ自然に入れること（必須）
- relatedNoteUrl が与えられた場合のみ、末尾「関連記事」に note URLを1回だけ追加可
- CTAは本文の補助情報として自然に置くこと（販促口調禁止）
- title/imagePrompt に過去年（例: 2024年）を書かないこと
- bodyで過去年を使う場合は、必ず出典・調査・統計の文脈を添えること

## 日本語ローカライズ（厳守）
- title/body/hashtags/imagePromptは100%ネイティブ日本語
- 中国語の表現・語彙・文法が混入することは絶対にNG
- titleChinese/bodyChineseの中国語がtitle/bodyに影響を与えないこと`;

const NOTE_CTA_TEMPLATES = [
  "本文で触れた判断基準を整理する補足資料はこちらです：{{url}}",
  "実務で使う際の参照先として、関連ページも置いておきます：{{url}}",
  "論点を深掘りしたい方向けに、検証用リンクを共有します：{{url}}",
];
const NOTE_OPENING_STYLES = [
  "意外な統計から入る",
  "現場で起きる迷いの場面から入る",
  "読者の疑問を先に提示してから展開する",
];

function pickNoteCtaTemplate(url: string): string {
  const idx = Math.floor(Math.random() * NOTE_CTA_TEMPLATES.length);
  return NOTE_CTA_TEMPLATES[idx].replace("{{url}}", url);
}

function pickNoteOpeningStyle(): string {
  const idx = Math.floor(Math.random() * NOTE_OPENING_STYLES.length);
  return NOTE_OPENING_STYLES[idx];
}

/**
 * note向けのユーザープロンプトを生成する
 */
export function buildNoteUserPrompt(params: {
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
  noteViralBrief?: NoteViralBrief;
  relatedNoteUrl?: string;
  relatedNoteTitle?: string;
}): string {
  const {
    topicLabel,
    assetType,
    phase,
    phaseLabel,
    takkenaiUrl,
    angle,
    secondaryAssetLabel,
    articleType,
    articleTypeLabel,
    articleTypePromptBlock,
    noteViralBrief,
    relatedNoteUrl,
    relatedNoteTitle,
  } = params;

  let assetContext = "";
  switch (assetType) {
    case "knowledge-point":
      assetContext = `宅建の重要知識「${topicLabel}」`;
      break;
    case "tool":
      assetContext = `不動産AI ツール「${topicLabel}」`;
      break;
    case "past-question":
      assetContext = `宅建過去問「${topicLabel}」`;
      break;
  }

  const preferredCta = pickNoteCtaTemplate(takkenaiUrl);
  const openingStyle = pickNoteOpeningStyle();

  let prompt = `以下の情報をもとに、note用の記事を作成してください。

## 今日のテーマ
- コンテンツ: ${assetContext}
- アングル: ${angle}
- 季節フェーズ: ${phaseLabel}
- 参照ページ（日本語テーマ）: ${topicLabel}
- CTA用リンク（本文で1回使用）: ${takkenaiUrl}
- 推奨CTA文（この中から1つだけ選ぶ）: ${preferredCta}
- 今回の導入スタイル: ${openingStyle}
`;

  if (secondaryAssetLabel) {
    prompt += `- 関連ツール/知識: ${secondaryAssetLabel}\n`;
    prompt += `  → 本文中で自然に言及してください\n`;
  }
  if (articleTypeLabel || articleType) {
    prompt += `- 記事タイプ: ${articleTypeLabel || articleType}\n`;
  }

  prompt += `
## 期待する内容
- ${phaseLabel}に合わせたトーンと内容
- 実務や社会的な文脈と結びつけた深掘り
- 読者に「なるほど」と思わせる独自の切り口
- takkenai.jp のツールや機能への自然な言及

## 注意事項
- 2000〜3000文字で収めてください
- CTAリンクは「${takkenaiUrl}」を使用してください（takkenaiLinkフィールドに設定）
- ハッシュタグを3〜4個提案してください
- SEO/GEOのため、冒頭は問題提起/現場シーン/意外な事実のいずれかで自然に開始し、定義ブロック・FAQ2問以上・出典付き数値1件を入れてください
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
  1) 本文で触れた判断基準を整理する補足資料はこちらです：${takkenaiUrl}
  2) 実務で使う際の参照先として、関連ページも置いておきます：${takkenaiUrl}
  3) 論点を深掘りしたい方向けに、検証用リンクを共有します：${takkenaiUrl}
- 出力は指定のJSON形式で返してください`;

  if (relatedNoteUrl) {
    const relatedLabel = (relatedNoteTitle || "").trim() || "関連記事";
    prompt += `
- 標準note互链モードです。本文の takkenai URL 1件に加え、末尾に「## 関連記事」を作り、以下の note URL を1回だけ自然文で入れてください
  - 関連記事タイトル: ${relatedLabel}
  - 関連記事URL: ${relatedNoteUrl}
- 関連記事URLは丸括弧で囲わず、そのまま自然文内に記載してください
- relatedNoteUrl 以外の外部URLは追加しないでください`;
  }

  if (articleTypePromptBlock) {
    prompt += `\n\n## 記事タイプ要件（必須）\n${articleTypePromptBlock}\n- 必須要素を見出しと本文に具体化し、抽象的な説明だけで終わらせないこと`;
  }

  if (noteViralBrief?.enabled) {
    prompt += `\n\n## 爆款承接入口（note専用）
- これは爆款承接モード。通常品質を維持しながら、反応の良い構成を取り入れる
- 参考記事の文面をそのまま複製・翻訳・焼き直しすることは禁止（論点のみ抽象化して再構成）
- 本文には読者向け内容のみを書く（「爆款」「承接」「テンプレ」等のメタ説明は禁止）
${noteViralBrief.sourceAccount ? `- 参考アカウント: ${noteViralBrief.sourceAccount}` : ""}
${noteViralBrief.sourceUrl ? `- 参考記事URL（分析用。本文にそのまま貼らない）: ${noteViralBrief.sourceUrl}` : ""}
${noteViralBrief.viralPattern ? `- 取り込みたい勝ち筋: ${noteViralBrief.viralPattern}` : ""}
${noteViralBrief.sourceTitle ? `- 参考テーマ: ${noteViralBrief.sourceTitle}` : ""}
${noteViralBrief.hotReason ? `- 人気の理由: ${noteViralBrief.hotReason}` : ""}
${noteViralBrief.fitReason ? `- 転用時の適合理由: ${noteViralBrief.fitReason}` : ""}

## 爆款承接の追加要件（必須）
- 記事の主軸は「参考テーマ」と「人気の理由」に合わせて再構成する（当日の既定URLテーマへ無理に合わせない）
- 冒頭3〜5行は「読者の課題が具体的に見える場面」から始める
- H2ごとに「読むメリット」を冒頭1文で明示する
- 1セクションにつき最低1つ、実務で即使える具体例を入れる
- CTAリンクは本文補足のために1回だけ使う。記事主題はリンク先説明ではなく読者価値に置く
- 煽り・断定は禁止。note規約内の自然なトーンを守る`;
  }

  return prompt;
}
