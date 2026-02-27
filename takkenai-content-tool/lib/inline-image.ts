import type { Platform } from "./topic-engine";

const GEMINI_BASE_URL = "https://api.openai-proxy.org/google/v1beta";
const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/chat/completions";

type ImageProvider = "closeai" | "openrouter";

export type ImageProviderPreference = "closeai" | "openrouter";

const MODEL_ALIASES: Record<string, string> = {
  "nano-banana-pro": "gemini-3-pro-image-preview",
  "nanobanana-pro": "gemini-3-pro-image-preview",
  "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
};
const BEST_MODEL = "gemini-3-pro-image-preview";
const MIN_IMAGE_FETCH_TIMEOUT_MS = 90_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

const IMAGE_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.COVER_IMAGE_MODEL_TIMEOUT_MS,
  120000
);
const IMAGE_FETCH_TIMEOUT = Math.max(IMAGE_FETCH_TIMEOUT_MS, MIN_IMAGE_FETCH_TIMEOUT_MS);

function extractErrorMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause =
      err.cause && typeof err.cause === "object" && err.cause !== null
        ? (err.cause as { message?: string }).message
        : undefined;
    return [err.message, cause].filter(Boolean).join(" | ");
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name?: string }).name === "AbortError"
    ) {
      throw new Error(`${label} timeout after ${timeoutMs}ms`);
    }
    throw new Error(`[${label}] fetch failed: ${extractErrorMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface InlineImageParams {
  title: string;
  body: string;
  platform: Platform;
  prompt: string;
  imageProviderPreference?: ImageProviderPreference;
  imageModel?: string;
}

export interface InlineImageResult {
  imageBuffer: Buffer;
  providerUsed: ImageProvider;
  modelUsed: string;
}

function getApiKeyForProvider(provider: ImageProvider): string {
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      throw new Error("OPENROUTER_API_KEY が設定されていません");
    }
    return key;
  }

  const key = process.env.CLOSEAI_API_KEY?.trim();
  if (!key) {
    throw new Error("CLOSEAI_API_KEY が設定されていません");
  }
  return key;
}

function getImageProviderCandidates(
  preference: ImageProviderPreference = "closeai"
): ImageProvider[] {
  if (preference === "closeai") {
    return ["closeai"];
  }
  if (preference === "openrouter") {
    return ["openrouter"];
  }
  return ["closeai"];
}

function getOpenRouterModelCandidates(
  model: string,
  strict = false
): string[] {
  const normalized = normalizeModelName(model);
  return [normalized];
}

function getConfiguredModelCandidates(): string[] {
  const csv = process.env.COVER_IMAGE_MODELS;
  if (csv && csv.trim()) {
    const fromCsv = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((model) => resolveInlineImageModel(model));
    const deduped = Array.from(new Set(fromCsv));
    return deduped.slice(0, 1);
  }

  const configured = [process.env.COVER_IMAGE_MODEL]
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .map((item) => resolveInlineImageModel(item));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < configured.length; i++) {
    const item = configured[i];
    if (!item || seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return deduped.slice(0, 1);
}

interface ModelSelection {
  candidates: string[];
  strict: boolean;
}

function getModelCandidates(imageModel?: string): ModelSelection {
  const explicit = imageModel ? imageModel.trim() : "";
  if (explicit) {
    return {
      candidates: [resolveInlineImageModel(explicit)],
      strict: true,
    };
  }

  const configured = getConfiguredModelCandidates();
  if (configured.length > 0) {
    const firstModel = configured[0];
    return {
      candidates: [firstModel],
      strict: true,
    };
  }

  const candidates = [BEST_MODEL];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return {
    candidates: deduped,
    strict: true,
  };
}

function extractImageBufferFromOpenRouter(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const parsed = data as {
    data?: unknown;
    image?: unknown;
    images?: Array<{ data?: string; url?: string; b64_json?: string }>;
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string; image?: string; image_url?: { url?: string }; b64_json?: string; data?: string }>;
        images?: Array<{ data?: string; url?: string; b64_json?: string }>;
      };
      image?: string;
      images?: Array<{ data?: string; url?: string; b64_json?: string }>;
    }>;
  };

  if (typeof parsed.image === "string") return parsed.image;

  if (Array.isArray(parsed.images)) {
    for (const img of parsed.images) {
      if (img?.data && typeof img.data === "string" && img.data.length > 300) return img.data;
      if (img?.b64_json && typeof img.b64_json === "string") return img.b64_json;
      if (img?.url && /^https?:\/\//.test(img.url)) return img.url;
    }
  }

  const choices = parsed.choices || [];
  for (const choice of choices) {
    if (choice.image && typeof choice.image === "string") return choice.image;
    if (Array.isArray(choice.images)) {
      for (const img of choice.images) {
        if (img?.data && typeof img.data === "string" && img.data.length > 300) return img.data;
        if (img?.b64_json && typeof img.b64_json === "string") return img.b64_json;
        if (img?.url && /^https?:\/\//.test(img.url)) return img.url;
      }
    }
    const message = choice.message;
    if (!message || typeof message !== "object") continue;
    const content = message.content;
    if (typeof content === "string") {
      const match =
        content.match(/!\[[^\]]*\]\(([^)\s]+)\)/) ||
        content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S+)?/);
      if (match?.[1]) return match[1];
      if (match?.[0]) return match[0];
      const inline = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      if (inline?.[1]) return inline[1];
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.image && typeof part.image === "string") return part.image;
        if (part.data && typeof part.data === "string" && part.data.length > 300) return part.data;
        if (part.b64_json && typeof part.b64_json === "string") return part.b64_json;
        const imageUrl = part.image_url?.url;
        if (typeof imageUrl === "string" && /^https?:\/\//.test(imageUrl)) return imageUrl;
      }
    }
  }

  return null;
}

async function resolveImageBufferFromOpenRouterResult(data: unknown): Promise<Buffer | null> {
  const imagePayload = extractImageBufferFromOpenRouter(data);
  if (!imagePayload) return null;
  if (/^https?:\/\//.test(imagePayload)) {
    const res = await fetchWithTimeout(
      imagePayload,
      {
        method: "GET",
      },
      IMAGE_FETCH_TIMEOUT,
      `inline-image-openrouter-image-url-${imagePayload.slice(0, 50)}`
    );
    if (!res.ok) {
      throw new Error(`OpenRouter image_url fetch failed (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (/^[A-Za-z0-9+/=]+$/.test(imagePayload) && imagePayload.length > 300) {
    return Buffer.from(imagePayload, "base64");
  }
  return null;
}

function normalizeModelName(model: string): string {
  const key = model.trim().toLowerCase();
  const normalized = MODEL_ALIASES[key] || model.trim();
  if (normalized !== BEST_MODEL) {
    throw new Error(
      `画像モデル制約: ${model} は未対応です。サポート対象: ${BEST_MODEL}`
    );
  }
  return normalized;
}

function normalizeInlineImageModelId(model: string): string {
  const normalized = normalizeModelName(model);
  return normalized.startsWith("google/") ? normalized.slice(7) : normalized;
}

function resolveInlineImageModel(rawModel?: string): string {
  const model = normalizeInlineImageModelId((rawModel || "").trim() || BEST_MODEL);
  if (model !== BEST_MODEL) {
    throw new Error(
      `画像モデル制約: ${rawModel || model} は未対応です。サポート対象: ${BEST_MODEL}`
    );
  }
  return model;
}

function compact(input: string, max = 900): string {
  const text = (input || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function buildPrompt(params: InlineImageParams): string {
  const articleTitle = compact(params.title, 120);
  const paragraph = compact(params.body, 520);
  const style =
    params.platform === "ameba"
      ? "friendly editorial illustration"
      : params.platform === "hatena"
      ? "clean informative illustration"
      : "professional blog illustration";

  return [
    "Create one inline image for a blog paragraph.",
    "Aspect ratio: 16:9, high clarity.",
    "No text, no letters, no logo, no watermark, no UI screenshot.",
    "The visual must match the paragraph topic and remain realistic/usable for article publishing.",
    `Style: ${style}`,
    `Article title context: ${articleTitle}`,
    `Paragraph context: ${paragraph}`,
    `Prompt focus: ${compact(params.prompt, 420)}`,
  ].join("\n");
}

function extractImageBuffer(data: unknown): Buffer | null {
  if (!data || typeof data !== "object") return null;
  const parsed = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string };
          inline_data?: { data?: string };
        }>;
      };
    }>;
  };

  const candidates = parsed.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      const base64Data = part.inlineData?.data || part.inline_data?.data;
      if (base64Data) {
        return Buffer.from(base64Data, "base64");
      }
    }
  }

  return null;
}

async function callImageApi(
  prompt: string,
  apiKey: string,
  model: string,
  imageProvider: ImageProvider = "closeai",
  strictModel = false
): Promise<InlineImageResult> {
  const resolvedModel = resolveInlineImageModel(model);

  if (imageProvider === "closeai") {
    const url = `${GEMINI_BASE_URL}/models/${resolvedModel}:generateContent`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: {
                aspectRatio: "16:9",
              },
            },
          }),
        },
        IMAGE_FETCH_TIMEOUT,
        `inline-image-closeai(${resolvedModel})`
      );
    } catch (err) {
      throw new Error(
        `Image API error [provider=closeai, model=${resolvedModel}] request failed: ${extractErrorMessage(err)}`
      );
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `Image API error [provider=closeai, model=${resolvedModel}] (${res.status}): ${errorText.slice(0, 400)}`
      );
    }

    const dataText = await res.text();
    if (!dataText || !dataText.trim()) {
      throw new Error(
        `Image API error [provider=closeai, model=${resolvedModel}]: empty response`
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(dataText) as unknown;
    } catch (err) {
      throw new Error(
        `Image API error [provider=closeai, model=${resolvedModel}]: invalid JSON response (${extractErrorMessage(err)}): ${dataText.slice(0, 200)}`
      );
    }
    const imageBuffer = extractImageBuffer(data);
    if (!imageBuffer) {
      throw new Error(`Gemini inline image did not return image payload (${resolvedModel})`);
    }

    return {
      imageBuffer,
      providerUsed: imageProvider,
      modelUsed: resolvedModel,
    };
  }

  const providerModel = getOpenRouterModelCandidates(resolvedModel, strictModel)[0] || BEST_MODEL;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      OPENROUTER_IMAGE_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: providerModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
        }),
      },
      IMAGE_FETCH_TIMEOUT,
      `inline-image-openrouter(${providerModel})`
    );
  } catch (err) {
    throw new Error(
      `Image API error [provider=openrouter, model=${resolvedModel}] request failed: ${extractErrorMessage(err)}`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Image API error [provider=openrouter, model=${providerModel}] (${res.status}): ${detail.slice(0, 400)}`
    );
  }

  const dataText = await res.text();
  if (!dataText || !dataText.trim()) {
    throw new Error(
      `Image API error [provider=openrouter, model=${providerModel}]: empty response`
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(dataText);
  } catch (err) {
    throw new Error(
      `Image API error [provider=openrouter, model=${providerModel}]: invalid JSON response (${extractErrorMessage(err)}): ${dataText.slice(0, 200)}`
    );
  }
  const imageBuffer = await resolveImageBufferFromOpenRouterResult(data);
  if (imageBuffer) {
    return {
      imageBuffer,
      providerUsed: imageProvider,
      modelUsed: providerModel,
    };
  }

  throw new Error(`Image API error [provider=openrouter, model=${providerModel}]: image payload missing`);

}

export async function generateInlineImage(
  params: InlineImageParams
): Promise<InlineImageResult> {
  const providerCandidates = getImageProviderCandidates(
    params.imageProviderPreference || "closeai"
  );
  const modelSelection = getModelCandidates(params.imageModel);
  const fullPrompt = buildPrompt(params);
  const compactPrompt = buildPrompt({
    ...params,
    body: compact(params.body, 280),
    prompt: compact(params.prompt, 240),
  });
  const models = modelSelection.candidates;

  console.log(
    `[inline-image] providers=${providerCandidates.join(",")} platform=${params.platform} models=${models.join(",")} strict=${
      modelSelection.strict
    } prompt=${fullPrompt.length} chars`
  );

  let lastError: unknown = null;
  const providers = providerCandidates;
  for (let p = 0; p < providers.length; p++) {
    const provider = providers[p];
    let apiKey: string;
    try {
      apiKey = getApiKeyForProvider(provider);
    } catch (err) {
      lastError = err;
      console.warn(`[inline-image] provider skipped: ${provider} (missing key)`);
      continue;
    }

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const prompt = i === 0 ? fullPrompt : compactPrompt;
      try {
        return await callImageApi(
          prompt,
          apiKey,
          model,
          provider,
          modelSelection.strict
        );
      } catch (err) {
        lastError = err;
        console.warn(
          `[inline-image] model failed: ${model} (provider=${provider})`
        );
        console.warn(err);
      }
    }
  }

  throw new Error(
    `[inline-image] all models failed. last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
