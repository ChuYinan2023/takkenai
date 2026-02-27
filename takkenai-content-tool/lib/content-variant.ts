import type { Platform } from "./topic-engine";

export type ContentKey = "standard" | "note-viral";
export type GeneratedImageType = "cover" | "inline";

const DEFAULT_CONTENT_KEY: ContentKey = "standard";

export function isContentKey(value: unknown): value is ContentKey {
  return value === "standard" || value === "note-viral";
}

export function resolveContentKey(
  platform: Platform,
  raw: unknown
): ContentKey {
  if (platform !== "note") return DEFAULT_CONTENT_KEY;
  return raw === "note-viral" ? "note-viral" : DEFAULT_CONTENT_KEY;
}

export function getContentFileBase(
  date: string,
  platform: Platform,
  contentKey: ContentKey
): string {
  if (contentKey === "note-viral" && platform === "note") {
    return `${date}-note-viral`;
  }
  return `${date}-${platform}`;
}

export function getGeneratedContentFilename(
  date: string,
  platform: Platform,
  contentKey: ContentKey
): string {
  return `${getContentFileBase(date, platform, contentKey)}.json`;
}

export function getGeneratedImagePrefix(
  date: string,
  platform: Platform,
  imageType: GeneratedImageType,
  contentKey: ContentKey
): string {
  return `${getContentFileBase(date, platform, contentKey)}-${imageType}`;
}
