import type { Platform } from "./topic-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedImage {
  /** Base64-encoded image data */
  base64Data: string;
  /** MIME type of the image */
  mimeType: string;
  /** Platform this image was generated for */
  platform: Platform;
  /** The prompt used to generate this image */
  prompt: string;
}

export interface PlatformImageConfig {
  /** Image size for the API (e.g. "1536x1024") */
  size: string;
  /** Style guidance for the image generation prompt */
  styleGuidance: string;
}

// ---------------------------------------------------------------------------
// Platform-specific image configuration
// ---------------------------------------------------------------------------

const PLATFORM_IMAGE_CONFIG: Record<Platform, PlatformImageConfig> = {
  ameba: {
    size: "1792x1024",
    styleGuidance:
      "アメブロのブログヘッダー画像。明るくポップなアニメ・イラスト風。" +
      "記事タイトルを大きく目立つ日本語テキストとして画像内に配置する。" +
      "暖色系（オレンジ、イエロー、ピンク）をベースに、" +
      "宅建・不動産学習に関連するアイコンやキャラクターイラストを添える。" +
      "親しみやすく、スマホで見ても目を引くデザイン。" +
      "サブタイトルやキーポイントも小さめのテキストで入れる。",
  },
  note: {
    size: "1792x1024",
    styleGuidance:
      "noteの記事ヘッダー画像。洗練されたプロフェッショナルなデザイン。" +
      "記事タイトルを大きな日本語テキストとして画像の中心に配置する。" +
      "落ち着いたブルーやネイビー系の配色。" +
      "サブタイトルや要点を小さめテキストで添える。" +
      "不動産やAIに関連するアイコン、建物のシルエット、グラフ要素を背景に。" +
      "知的で信頼感のあるデザイン。",
  },
  hatena: {
    size: "1792x1024",
    styleGuidance:
      "はてなブログのアイキャッチ画像。情報的で構造化されたインフォグラフィック風。" +
      "記事タイトルを大きな日本語テキストとして配置する。" +
      "キーポイントを箇条書きや番号付きで画像内にレイアウトする。" +
      "ブルーとホワイトを基調に、アクセントカラーでハイライト。" +
      "データ可視化要素（テーブル風、フローチャート風）を背景に。" +
      "「保存版」「完全ガイド」感のある体系的なデザイン。",
  },
};

// ---------------------------------------------------------------------------
// GPT-4o Image Generation via CloseAI proxy (OpenAI Images API)
// ---------------------------------------------------------------------------

const CLOSEAI_IMAGES_URL = "https://api.openai-proxy.org/v1/images/generations";
const IMAGE_MODEL = "dall-e-3";

function getApiKey(): string {
  const apiKey = process.env.CLOSEAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CLOSEAI_API_KEY が設定されていません。.env.local で設定してください。"
    );
  }
  return apiKey;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive image prompt for DALL-E 3 that includes the full
 * article text. The user found that giving DALL-E the entire article produces
 * much better, more contextually accurate cover images.
 */
function buildImagePrompt(
  articleTitle: string,
  contentDescription: string,
  platform: Platform,
  articleBody?: string
): string {
  const config = PLATFORM_IMAGE_CONFIG[platform];

  // If we have the full article body, use the user's proven approach:
  // just give DALL-E the full article and ask for a cover image. Keep it simple.
  if (articleBody) {
    return `以下のブログ記事の封面画像を1枚作成してください。記事タイトルを画像に大きく表示してください。

${articleTitle}

${articleBody}`;
  }

  // Fallback: no article body available, use short description
  return `ブログ記事のヘッダー画像を作成してください。

【メインタイトルテキスト（画像内に大きく表示）】
${articleTitle}

【デザインスタイル】
${config.styleGuidance}

【テーマ・内容】
${contentDescription}

【重要な注意事項】
- メインタイトルの日本語テキストは大きく、読みやすく、デザインの中心要素として配置すること
- テキストは正確に表示すること（文字化けや誤字は絶対にNG）
- 全体的にプロフェッショナルなブログヘッダーとして完成度の高いデザインにすること
- 画像全体が一つの完成されたデザインとして統一感があること`;
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/**
 * Generate an image for a specific platform using GPT-4o via CloseAI proxy.
 */
export async function generateImage(
  prompt: string,
  platform: Platform,
  articleTitle?: string,
  articleBody?: string
): Promise<GeneratedImage> {
  const apiKey = getApiKey();
  const config = PLATFORM_IMAGE_CONFIG[platform];

  const fullPrompt = buildImagePrompt(
    articleTitle || "宅建・不動産AI",
    prompt,
    platform,
    articleBody
  );

  console.log(`[image-gen] Using ${articleBody ? "FULL ARTICLE" : "SHORT DESC"} mode, prompt length: ${fullPrompt.length} chars`);

  const response = await fetch(CLOSEAI_IMAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      n: 1,
      size: config.size,
      quality: "hd",
      style: "vivid",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errMsg =
      (errorData as { error?: { message?: string } })?.error?.message ||
      `Image API error: ${response.status}`;
    throw new Error(errMsg);
  }

  const data = await response.json();
  const imageData = data?.data?.[0];

  if (!imageData?.b64_json) {
    throw new Error("画像データが返されませんでした");
  }

  return {
    base64Data: imageData.b64_json,
    mimeType: "image/png",
    platform,
    prompt: fullPrompt,
  };
}

/**
 * Generate images for all 3 platforms in parallel.
 */
export async function generateAllPlatformImages(
  prompt: string,
  articleTitle?: string
): Promise<Record<Platform, GeneratedImage>> {
  const [ameba, note, hatena] = await Promise.all([
    generateImage(prompt, "ameba", articleTitle),
    generateImage(prompt, "note", articleTitle),
    generateImage(prompt, "hatena", articleTitle),
  ]);

  return { ameba, note, hatena };
}

/**
 * Save a generated image to the filesystem.
 */
export async function saveImage(
  image: GeneratedImage,
  outputPath: string
): Promise<string> {
  const fs = await import("fs");
  const pathMod = await import("path");

  const ext = ".png";
  const fullPath = outputPath + ext;

  const dir = pathMod.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = Buffer.from(image.base64Data, "base64");
  fs.writeFileSync(fullPath, buffer);

  return fullPath;
}

/**
 * Get the platform image configuration.
 */
export function getPlatformImageConfig(
  platform: Platform
): PlatformImageConfig {
  return PLATFORM_IMAGE_CONFIG[platform];
}

/**
 * Convert a generated image to a data URL for use in HTML/React.
 */
export function toDataUrl(image: GeneratedImage): string {
  return `data:${image.mimeType};base64,${image.base64Data}`;
}
