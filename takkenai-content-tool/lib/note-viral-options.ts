import {
  NOTE_VIRAL_COMPETITOR_ACCOUNTS,
  NOTE_VIRAL_PICKUP_PATTERNS,
  NOTE_VIRAL_PICKUP_URL,
} from "./note-viral-source-seeds";

export type NoteViralSourceType = "competitor" | "note-pickup" | "fallback";

export interface NoteViralOption {
  id: string;
  sourceType: NoteViralSourceType;
  sourceAccount: string;
  sourceUrl: string;
  title: string;
  hotReason: string;
  viralPattern: string;
  fitReason: string;
  collectedAt: string;
}

export interface NoteViralOptionsCache {
  date: string;
  updatedAt: string;
  source: "live" | "cache" | "fallback" | "mixed";
  options: NoteViralOption[];
}

export interface NoteViralOptionsResponse {
  date: string;
  updatedAt: string;
  source: "live" | "cache" | "fallback" | "mixed";
  options: NoteViralOption[];
}

export const NOTE_VIRAL_OPTION_LIMIT = 6;
export const NOTE_VIRAL_OPTIONS_LATEST_CACHE_FILE = "note-viral-options-latest.json";

export function getNoteViralOptionsDateCacheFile(date: string): string {
  return `${date}-note-viral-options.json`;
}

function sanitizeText(raw: unknown, maxLength: number): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeNoteUrl(raw: unknown): string {
  const candidate = sanitizeText(raw, 500);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname !== "note.com") return "";
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function buildOptionId(parts: string[], index: number): string {
  const normalized = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const fallback = `note-viral-${index + 1}`;
  return normalized ? `note-viral-${normalized}` : fallback;
}

export function normalizeNoteViralOption(
  raw: unknown,
  index: number,
  collectedAt: string
): NoteViralOption | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const sourceTypeRaw = sanitizeText(input.sourceType, 30).toLowerCase();
  const sourceType: NoteViralSourceType =
    sourceTypeRaw === "competitor" || sourceTypeRaw === "note-pickup"
      ? sourceTypeRaw
      : "fallback";
  const title = sanitizeText(input.title, 120);
  const hotReason = sanitizeText(input.hotReason, 180);
  const viralPattern = sanitizeText(input.viralPattern, 180);
  const fitReason = sanitizeText(input.fitReason, 180);
  const sourceAccount = sanitizeText(input.sourceAccount, 80);
  const sourceUrl = normalizeNoteUrl(input.sourceUrl);

  if (!title || !hotReason || !viralPattern || !fitReason) return null;

  const id = sanitizeText(input.id, 100) || buildOptionId([title, sourceAccount], index);
  return {
    id,
    sourceType,
    sourceAccount: sourceAccount || "note_research",
    sourceUrl: sourceUrl || NOTE_VIRAL_PICKUP_URL,
    title,
    hotReason,
    viralPattern,
    fitReason,
    collectedAt,
  };
}

export function dedupeNoteViralOptions(
  options: NoteViralOption[]
): NoteViralOption[] {
  const seen = new Set<string>();
  const out: NoteViralOption[] = [];
  for (const option of options) {
    const key = `${option.sourceUrl}|${option.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

export function buildFallbackNoteViralOptions(date: string): NoteViralOption[] {
  const collectedAt = new Date().toISOString();
  return Array.from({ length: NOTE_VIRAL_OPTION_LIMIT }).map((_, index) => {
    const account =
      NOTE_VIRAL_COMPETITOR_ACCOUNTS[index % NOTE_VIRAL_COMPETITOR_ACCOUNTS.length];
    const pattern =
      NOTE_VIRAL_PICKUP_PATTERNS[index % NOTE_VIRAL_PICKUP_PATTERNS.length];
    const sourceType: NoteViralSourceType = index % 2 === 0 ? "competitor" : "note-pickup";
    const title =
      sourceType === "competitor"
        ? `不動産実務で保存される解説構成 ${index + 1}`
        : `note人気構成を宅建テーマに転用する型 ${index + 1}`;
    const hotReason =
      sourceType === "competitor"
        ? "読者課題を先に示し、途中離脱を防ぐ段落設計が強い"
        : "冒頭の問いと結論の距離が短く、最後まで読み切られやすい";
    const fitReason =
      "takkenai のツール紹介を本文文脈に自然接続しやすく、単リンク運用に適合";
    return {
      id: buildOptionId([date, sourceType, String(index + 1)], index),
      sourceType,
      sourceAccount: account,
      sourceUrl: NOTE_VIRAL_PICKUP_URL,
      title,
      hotReason,
      viralPattern: pattern,
      fitReason,
      collectedAt,
    };
  });
}
