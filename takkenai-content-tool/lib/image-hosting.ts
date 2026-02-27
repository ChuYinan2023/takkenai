import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export type ImageHostingProvider = "r2" | "uguu" | "catbox" | "telegra-ph";
type ImageHostingProviderOrAuto = ImageHostingProvider | "auto";

export interface UploadMarkdownCoverImageInput {
  sourcePath: string;
  date?: string;
  platform?: string;
  provider?: ImageHostingProviderOrAuto;
}

export interface UploadMarkdownCoverImageResult {
  url: string;
  objectKey: string;
  provider: ImageHostingProvider;
  contentType: string;
  sizeBytes: number;
}

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  keyPrefix: string;
};

export interface ImageHostingStatus {
  r2Configured: boolean;
  r2PublicBaseReachable: boolean;
  r2MissingEnv: string[];
  activeProvider: ImageHostingProvider;
  fallbackProviderAvailable: boolean;
}

const DEFAULT_R2_KEY_PREFIX = "takken-markdown";
const URL_CHECK_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 15000;
const LITTERBOX_RETENTION = "72h";
const REQUIRED_R2_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

function normalizePublicBaseUrl(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function getMissingR2EnvVars(): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_R2_ENV) {
    const value = (process.env[key] || "").trim();
    if (!value) missing.push(key);
  }
  return missing;
}

function parseR2Config(): R2Config | null {
  const missing = getMissingR2EnvVars();
  if (missing.length > 0) {
    return null;
  }

  const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = (process.env.R2_BUCKET || "").trim();
  const publicBaseUrl = normalizePublicBaseUrl(
    process.env.R2_PUBLIC_BASE_URL || ""
  );
  const keyPrefix = (process.env.R2_KEY_PREFIX || DEFAULT_R2_KEY_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!publicBaseUrl) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    keyPrefix: keyPrefix || DEFAULT_R2_KEY_PREFIX,
  };
}

function requireR2Config(): R2Config {
  const cfg = parseR2Config();
  if (cfg) return cfg;
  throw new Error(
    "Cloudflare R2 未配置完整，请设置 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL"
  );
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function toDateFolder(now: Date): { y: string; m: string; d: string } {
  return {
    y: String(now.getFullYear()),
    m: String(now.getMonth() + 1).padStart(2, "0"),
    d: String(now.getDate()).padStart(2, "0"),
  };
}

function formatTimestamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

function sanitizeSegment(value: string, fallback: string): string {
  const raw = (value || "").trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || fallback;
}

function buildObjectKey(
  cfg: R2Config,
  now: Date,
  input: UploadMarkdownCoverImageInput
): string {
  const { y, m, d } = toDateFolder(now);
  const ext = path.extname(input.sourcePath).toLowerCase() || ".png";
  const datePart =
    (input.date || "").trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ||
    `${y}-${m}-${d}`;
  const platformPart = sanitizeSegment(input.platform || "", "manual");
  const stamp = formatTimestamp(now);
  const rand = crypto.randomBytes(3).toString("hex");
  const fileName = `${datePart}-${platformPart}-${stamp}-${rand}${ext}`;
  return `${cfg.keyPrefix}/${y}/${m}/${d}/${fileName}`;
}

function buildPublicUrl(publicBaseUrl: string, objectKey: string): string {
  const encodedKey = objectKey
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${normalizePublicBaseUrl(publicBaseUrl)}/${encodedKey}`;
}

async function checkUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (head.ok) return true;

    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Range: "bytes=0-0",
      },
    });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrlResponding(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (head.status > 0 && head.status < 500) return true;

    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Range: "bytes=0-0",
      },
    });
    return get.status > 0 && get.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function isR2Configured(): boolean {
  return parseR2Config() !== null;
}

export async function getImageHostingStatus(): Promise<ImageHostingStatus> {
  const cfg = parseR2Config();
  if (!cfg) {
    const catboxAvailable = await checkUrlResponding("https://catbox.moe")
      .then((ok) => ok)
      .catch(() => false);
    const uguuAvailable = await checkUrlResponding("https://uguu.se/upload.php")
      .then((ok) => ok)
      .catch(() => false);
    const fallbackProviderAvailable = await checkUrlResponding("https://telegra.ph")
      .then((ok) => ok)
      .catch(() => false);
    return {
      r2Configured: false,
      r2PublicBaseReachable: false,
      r2MissingEnv: getMissingR2EnvVars(),
      activeProvider: "catbox",
      fallbackProviderAvailable: catboxAvailable || fallbackProviderAvailable || uguuAvailable,
    };
  }

  const probeUrl = `${cfg.publicBaseUrl}/_health-${Date.now()}.txt`;
  const reachable = await checkUrlResponding(probeUrl).catch(() => false);
  return {
    r2Configured: true,
    r2PublicBaseReachable: reachable,
    r2MissingEnv: [],
    activeProvider: "r2",
    fallbackProviderAvailable: true,
  };
}

async function uploadToR2(
  input: UploadMarkdownCoverImageInput
): Promise<UploadMarkdownCoverImageResult> {
  const sourcePath = (input.sourcePath || "").trim();
  const cfg = requireR2Config();
  const fileBuffer = fs.readFileSync(sourcePath);
  const contentType = guessMimeType(sourcePath);
  const now = new Date();
  const objectKey = buildObjectKey(cfg, now, input);

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: fileBuffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const publicUrl = buildPublicUrl(cfg.publicBaseUrl, objectKey);
  const reachable = await checkUrlReachable(publicUrl);
  if (!reachable) {
    throw new Error(`R2 公网链接不可访问: ${publicUrl}`);
  }

  return {
    url: publicUrl,
    objectKey,
    provider: "r2",
    contentType,
    sizeBytes: fileBuffer.length,
  };
}

async function uploadToTelegraph(
  input: UploadMarkdownCoverImageInput
): Promise<UploadMarkdownCoverImageResult> {
  const sourcePath = (input.sourcePath || "").trim();
  const fileBuffer = fs.readFileSync(sourcePath);
  const contentType = guessMimeType(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const datePart =
    (input.date || "").trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ||
    new Date().toISOString().slice(0, 10);
  const platformPart = sanitizeSegment(input.platform || "", "manual");
  const uploadName = `${datePart}-${platformPart}-${Date.now()}${ext}`;

  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: contentType }), uploadName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://telegra.ph/upload", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Telegra 上传网络失败: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Telegra 上传失败(${response.status}): ${text || "unknown"}`);
  }

  const parsed = (await response.json()) as Array<{ src?: string }> | { error?: string };
  if (!Array.isArray(parsed)) {
    throw new Error(`Telegra 上传失败: ${(parsed as { error?: string }).error || "invalid response"}`);
  }
  const src = (parsed[0]?.src || "").trim();
  if (!src || !src.startsWith("/")) {
    throw new Error("Telegra 上传失败: 返回链接无效");
  }

  const publicUrl = new URL(src, "https://telegra.ph").toString();
  const reachable = await checkUrlReachable(publicUrl);
  if (!reachable) {
    throw new Error(`Telegra 公网链接不可访问: ${publicUrl}`);
  }

  return {
    url: publicUrl,
    objectKey: src.replace(/^\/+/, ""),
    provider: "telegra-ph",
    contentType,
    sizeBytes: fileBuffer.length,
  };
}

async function uploadToCatbox(
  input: UploadMarkdownCoverImageInput
): Promise<UploadMarkdownCoverImageResult> {
  const sourcePath = (input.sourcePath || "").trim();
  const fileBuffer = fs.readFileSync(sourcePath);
  const contentType = guessMimeType(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const datePart =
    (input.date || "").trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ||
    new Date().toISOString().slice(0, 10);
  const platformPart = sanitizeSegment(input.platform || "", "manual");
  const uploadName = `${datePart}-${platformPart}-${Date.now()}${ext}`;

  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([fileBuffer], { type: contentType }),
    uploadName
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Catbox 上传网络失败: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
  const text = (await response.text().catch(() => "")).trim();
  if (!response.ok) {
    throw new Error(`Catbox 上传失败(${response.status}): ${text || "unknown"}`);
  }
  if (!/^https?:\/\//i.test(text)) {
    throw new Error(`Catbox 上传失败: ${text || "invalid response"}`);
  }

  const publicUrl = text;
  const reachable = await checkUrlReachable(publicUrl);
  if (!reachable) {
    throw new Error(`Catbox 公网链接不可访问: ${publicUrl}`);
  }

  let objectKey = publicUrl;
  try {
    objectKey = new URL(publicUrl).pathname.replace(/^\/+/, "");
  } catch {
    // keep raw url as object key fallback
  }

  return {
    url: publicUrl,
    objectKey,
    provider: "catbox",
    contentType,
    sizeBytes: fileBuffer.length,
  };
}

async function uploadToLitterboxTempUrl(
  input: UploadMarkdownCoverImageInput
): Promise<string> {
  const sourcePath = (input.sourcePath || "").trim();
  const fileBuffer = fs.readFileSync(sourcePath);
  const contentType = guessMimeType(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const datePart =
    (input.date || "").trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ||
    new Date().toISOString().slice(0, 10);
  const platformPart = sanitizeSegment(input.platform || "", "manual");
  const uploadName = `${datePart}-${platformPart}-${Date.now()}${ext}`;

  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", LITTERBOX_RETENTION);
  form.append(
    "fileToUpload",
    new Blob([fileBuffer], { type: contentType }),
    uploadName
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Litterbox 临时上传失败: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
  const text = (await response.text().catch(() => "")).trim();
  if (!response.ok) {
    throw new Error(`Litterbox 临时上传失败(${response.status}): ${text || "unknown"}`);
  }
  if (!/^https?:\/\/litter\.catbox\.moe\/\S+/i.test(text)) {
    throw new Error(`Litterbox 临时上传返回无效: ${text || "invalid response"}`);
  }
  return text;
}

async function uploadToCatboxByRemoteUrl(sourceUrl: string): Promise<string> {
  const form = new FormData();
  form.append("reqtype", "urlupload");
  form.append("url", sourceUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Catbox URL转存失败: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  const text = (await response.text().catch(() => "")).trim();
  if (!response.ok) {
    throw new Error(`Catbox URL转存失败(${response.status}): ${text || "unknown"}`);
  }
  if (!/^https?:\/\/files\.catbox\.moe\/\S+/i.test(text)) {
    throw new Error(`Catbox URL转存返回无效: ${text || "invalid response"}`);
  }
  return text;
}

async function uploadToUguu(
  input: UploadMarkdownCoverImageInput
): Promise<UploadMarkdownCoverImageResult> {
  const sourcePath = (input.sourcePath || "").trim();
  const fileBuffer = fs.readFileSync(sourcePath);
  const contentType = guessMimeType(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const datePart =
    (input.date || "").trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ||
    new Date().toISOString().slice(0, 10);
  const platformPart = sanitizeSegment(input.platform || "", "manual");
  const uploadName = `${datePart}-${platformPart}-${Date.now()}${ext}`;

  const form = new FormData();
  form.append("files[]", new Blob([fileBuffer], { type: contentType }), uploadName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://uguu.se/upload.php", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Uguu 上传网络失败: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
  const text = (await response.text().catch(() => "")).trim();
  if (!response.ok) {
    throw new Error(`Uguu 上传失败(${response.status}): ${text || "unknown"}`);
  }

  let json: { success?: boolean; files?: Array<{ url?: string; filename?: string }>; error?: string } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const publicUrl = (json?.files?.[0]?.url || "").trim();
  if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
    throw new Error(`Uguu 上传失败: ${json?.error || text || "invalid response"}`);
  }

  const reachable = await checkUrlReachable(publicUrl);
  if (!reachable) {
    throw new Error(`Uguu 公网链接不可访问: ${publicUrl}`);
  }

  let objectKey = json?.files?.[0]?.filename || publicUrl;
  try {
    objectKey = new URL(publicUrl).pathname.replace(/^\/+/, "") || objectKey;
  } catch {
    // keep fallback object key
  }

  return {
    url: publicUrl,
    objectKey,
    provider: "uguu",
    contentType,
    sizeBytes: fileBuffer.length,
  };
}

export async function uploadMarkdownCoverImage(
  input: UploadMarkdownCoverImageInput
): Promise<UploadMarkdownCoverImageResult> {
  const sourcePath = (input.sourcePath || "").trim();
  if (!sourcePath) {
    throw new Error("sourcePath is required");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`封面图文件不存在: ${sourcePath}`);
  }
  const autoProvider: ImageHostingProvider = isR2Configured() ? "r2" : "catbox";
  const provider = !input.provider || input.provider === "auto"
    ? autoProvider
    : input.provider;

  if (provider === "r2") {
    const errors: string[] = [];
    try {
      return await uploadToR2(input);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      // R2 configured but temporarily unavailable: fallback to public host.
      const catbox = await uploadToCatbox(input).catch((err) => {
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      });
      if (catbox) return catbox;
      const telegraph = await uploadToTelegraph(input).catch((err) => {
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      });
      if (telegraph) return telegraph;
      const uguu = await uploadToUguu(input).catch((err) => {
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      });
      if (uguu) return uguu;
      throw new Error(`图片上传失败（r2 -> catbox -> telegra-ph -> uguu）: ${errors.join(" | ")}`);
    }
  }
  if (provider === "uguu") {
    // Deprecated compatibility branch: keep explicit uguu selectable but never auto-pick it.
    const uguu = await uploadToUguu(input).catch(() => null);
    if (uguu) return uguu;
    const catbox = await uploadToCatbox(input).catch(() => null);
    if (catbox) return catbox;
    return uploadToTelegraph(input);
  }
  if (provider === "catbox") {
    const errors: string[] = [];
    const catboxDirect = await uploadToCatbox(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (catboxDirect) return catboxDirect;

    const stagedToCatbox = await (async () => {
      try {
        const tempUrl = await uploadToLitterboxTempUrl(input);
        const catboxUrl = await uploadToCatboxByRemoteUrl(tempUrl);
        const reachable = await checkUrlReachable(catboxUrl);
        if (!reachable) {
          throw new Error(`Catbox 转存后公网不可访问: ${catboxUrl}`);
        }
        let objectKey = catboxUrl;
        try {
          objectKey = new URL(catboxUrl).pathname.replace(/^\/+/, "");
        } catch {
          // Keep URL as fallback object key.
        }
        const sourcePath = (input.sourcePath || "").trim();
        const sizeBytes = fs.existsSync(sourcePath)
          ? fs.statSync(sourcePath).size
          : 0;
        return {
          url: catboxUrl,
          objectKey,
          provider: "catbox" as const,
          contentType: guessMimeType(sourcePath),
          sizeBytes,
        };
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return null;
      }
    })();
    if (stagedToCatbox) return stagedToCatbox;

    const telegraph = await uploadToTelegraph(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (telegraph) return telegraph;
    const uguu = await uploadToUguu(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (uguu) return uguu;
    throw new Error(`图片上传失败（catbox -> telegra-ph -> uguu）: ${errors.join(" | ")}`);
  }
  if (provider === "telegra-ph") {
    const errors: string[] = [];
    const telegraph = await uploadToTelegraph(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (telegraph) return telegraph;
    const catbox = await uploadToCatbox(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (catbox) return catbox;
    const uguu = await uploadToUguu(input).catch((err) => {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (uguu) return uguu;
    throw new Error(`图片上传失败（telegra-ph -> catbox -> uguu）: ${errors.join(" | ")}`);
  }
  throw new Error(`unsupported provider: ${provider}`);
}
