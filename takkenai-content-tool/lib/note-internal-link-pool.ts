import fs from "fs";
import path from "path";

export type NoteContentKey = "standard" | "note-viral";

export interface NoteInternalLinkItem {
  url: string;
  canonicalUrl: string;
  account: string;
  title: string;
  date: string;
  platform: "note";
  contentKey: NoteContentKey;
  publishedAt: string;
}

export interface NoteInternalLinkPool {
  version: string;
  updatedAt: string;
  allowedAccounts: string[];
  items: NoteInternalLinkItem[];
}

export interface RegisterPublishedNoteUrlInput {
  url: string;
  title?: string;
  date: string;
  publishedAt?: string;
  contentKey?: NoteContentKey;
}

export interface PickRelatedNoteLinkInput {
  date: string;
  currentContentKey?: NoteContentKey;
  currentTitle?: string;
  currentTakkenaiUrl?: string;
  generatedDir?: string;
  excludeUrls?: string[];
  cooldownDays?: number;
}

export interface PickRelatedNoteLinkResult {
  url: string;
  title: string;
  account: string;
  allowedAccounts: string[];
}

const NOTE_URL_REGEX = /^\/([a-zA-Z0-9_]+)\/n\/([a-zA-Z0-9]+)\/?$/;
const DEFAULT_POOL: NoteInternalLinkPool = {
  version: "v1",
  updatedAt: new Date(0).toISOString(),
  allowedAccounts: [],
  items: [],
};
const DEFAULT_POOL_FILE = path.join(
  process.cwd(),
  "data",
  "note-internal-links.json"
);

function toBool(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(normalized);
}

export function isNoteInternalLinksEnabled(): boolean {
  const raw = process.env.NOTE_INTERNAL_LINKS_ENABLED;
  if (!raw) return true;
  return toBool(raw);
}

function resolvePoolFilePath(): string {
  const fromEnv = (process.env.NOTE_INTERNAL_LINK_POOL_FILE || "").trim();
  if (!fromEnv) return DEFAULT_POOL_FILE;
  return path.isAbsolute(fromEnv)
    ? fromEnv
    : path.join(process.cwd(), fromEnv);
}

function normalizeAccount(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function uniqAccounts(accounts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const normalized = normalizeAccount(account);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeDate(date: string): string {
  const text = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTitle(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function normalizeNoteArticleUrl(rawUrl: string): string {
  const input = String(rawUrl || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "note.com") return "";
    const pathMatch = parsed.pathname.match(NOTE_URL_REGEX);
    if (!pathMatch) return "";
    const account = normalizeAccount(pathMatch[1]);
    const articleId = pathMatch[2].toLowerCase();
    if (!account || !articleId) return "";
    return `https://note.com/${account}/n/${articleId}`;
  } catch {
    return "";
  }
}

export function isValidNoteArticleUrl(rawUrl: string): boolean {
  return normalizeNoteArticleUrl(rawUrl).length > 0;
}

export function extractNoteAccount(rawUrl: string): string {
  const normalized = normalizeNoteArticleUrl(rawUrl);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const match = parsed.pathname.match(NOTE_URL_REGEX);
    if (!match) return "";
    return normalizeAccount(match[1]);
  } catch {
    return "";
  }
}

export function isNoteUrlAllowedByAccounts(
  rawUrl: string,
  allowedAccounts: string[]
): boolean {
  const normalized = normalizeNoteArticleUrl(rawUrl);
  if (!normalized) return false;
  const account = extractNoteAccount(normalized);
  if (!account) return false;
  const allowSet = new Set(uniqAccounts(allowedAccounts));
  return allowSet.size === 0 || allowSet.has(account);
}

function hydratePool(raw: unknown): NoteInternalLinkPool {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_POOL };
  const source = raw as Partial<NoteInternalLinkPool>;
  const allowedAccounts = uniqAccounts(
    Array.isArray(source.allowedAccounts) ? source.allowedAccounts : []
  );
  const itemsSource = Array.isArray(source.items) ? source.items : [];
  const deduped = new Map<string, NoteInternalLinkItem>();
  for (const itemRaw of itemsSource) {
    if (!itemRaw || typeof itemRaw !== "object") continue;
    const item = itemRaw as Partial<NoteInternalLinkItem>;
    const url = normalizeNoteArticleUrl(String(item.url || ""));
    if (!url) continue;
    const canonicalUrl = normalizeNoteArticleUrl(
      String(item.canonicalUrl || item.url || "")
    );
    const account = extractNoteAccount(url);
    const date = normalizeDate(String(item.date || ""));
    const publishedAt = String(item.publishedAt || "").trim() || new Date(0).toISOString();
    const contentKey: NoteContentKey =
      item.contentKey === "note-viral" ? "note-viral" : "standard";
    deduped.set(canonicalUrl, {
      url,
      canonicalUrl,
      account,
      title: normalizeTitle(String(item.title || "")),
      date,
      platform: "note",
      contentKey,
      publishedAt,
    });
  }
  const items = Array.from(deduped.values()).sort(
    (a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)
  );
  return {
    version: String(source.version || "v1"),
    updatedAt: String(source.updatedAt || new Date().toISOString()),
    allowedAccounts,
    items,
  };
}

function readPool(): NoteInternalLinkPool {
  const filePath = resolvePoolFilePath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_POOL };
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return hydratePool(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_POOL };
  }
}

function writePool(pool: NoteInternalLinkPool): void {
  const filePath = resolvePoolFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, `${JSON.stringify(pool, null, 2)}\n`, "utf-8");
}

export function getNoteInternalLinkPoolStatus(): {
  enabled: boolean;
  count: number;
  allowedAccounts: string[];
} {
  const pool = readPool();
  return {
    enabled: isNoteInternalLinksEnabled(),
    count: pool.items.length,
    allowedAccounts: pool.allowedAccounts,
  };
}

export function registerPublishedNoteUrl(input: RegisterPublishedNoteUrlInput): {
  pool: NoteInternalLinkPool;
  item: NoteInternalLinkItem;
} {
  const date = normalizeDate(input.date);
  if (!date) {
    throw new Error("公開日の形式が不正です（YYYY-MM-DD）");
  }

  const normalizedUrl = normalizeNoteArticleUrl(input.url);
  if (!normalizedUrl) {
    throw new Error("publishedUrl は note.com の記事URLのみ登録できます");
  }
  const account = extractNoteAccount(normalizedUrl);
  if (!account) {
    throw new Error("note URL からアカウントを特定できませんでした");
  }

  const pool = readPool();
  const contentKey: NoteContentKey =
    input.contentKey === "note-viral" ? "note-viral" : "standard";

  if (pool.allowedAccounts.length === 0) {
    pool.allowedAccounts = [account];
  } else if (!pool.allowedAccounts.includes(account)) {
    throw new Error(
      `noteアカウントが白名单外です: ${account}（許可: ${pool.allowedAccounts.join(", ")}）`
    );
  }

  const canonicalUrl = normalizeNoteArticleUrl(normalizedUrl);
  const item: NoteInternalLinkItem = {
    url: normalizedUrl,
    canonicalUrl,
    account,
    title: normalizeTitle(input.title || ""),
    date,
    platform: "note",
    contentKey,
    publishedAt: String(input.publishedAt || new Date().toISOString()),
  };

  const index = pool.items.findIndex((entry) => entry.canonicalUrl === canonicalUrl);
  if (index >= 0) {
    pool.items[index] = item;
  } else {
    pool.items.push(item);
  }
  pool.items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  pool.updatedAt = new Date().toISOString();
  writePool(pool);

  return { pool, item };
}

function hashText(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function dayDiff(fromIso: string, toDate: string): number {
  const from = new Date(fromIso);
  const to = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 9999;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function tokenize(input: string): Set<string> {
  const source = String(input || "").toLowerCase();
  const tokens = source.match(/[a-z0-9]{3,}|[\u3040-\u30ff]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  return new Set(tokens);
}

function keywordOverlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  a.forEach((token) => {
    if (b.has(token)) hit += 1;
  });
  return hit;
}

function dateToString(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function collectRecentUsedRelatedNoteUrls(
  referenceDate: string,
  generatedDir: string,
  cooldownDays: number
): Set<string> {
  const used = new Set<string>();
  const base = new Date(`${referenceDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return used;

  for (let i = 1; i <= cooldownDays; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const dateStr = dateToString(d);
    const filePath = path.join(generatedDir, `${dateStr}-note.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { meta?: { relatedNoteUrl?: string } };
      const related = normalizeNoteArticleUrl(parsed?.meta?.relatedNoteUrl || "");
      if (related) used.add(related);
    } catch {
      // ignore broken history files
    }
  }

  return used;
}

export function pickRelatedNoteLink(
  input: PickRelatedNoteLinkInput
): PickRelatedNoteLinkResult | null {
  if (!isNoteInternalLinksEnabled()) return null;
  if (input.currentContentKey === "note-viral") return null;

  const date = normalizeDate(input.date);
  if (!date) return null;

  const pool = readPool();
  if (pool.items.length === 0) return null;

  const exclude = new Set<string>();
  for (const raw of input.excludeUrls || []) {
    const normalized = normalizeNoteArticleUrl(raw);
    if (normalized) exclude.add(normalized);
  }
  const cooldownDays = Math.max(1, Math.min(30, input.cooldownDays || 7));
  if (input.generatedDir && fs.existsSync(input.generatedDir)) {
    const recent = collectRecentUsedRelatedNoteUrls(
      date,
      input.generatedDir,
      cooldownDays
    );
    recent.forEach((url) => exclude.add(url));
  }

  const titleTokens = tokenize(input.currentTitle || "");
  const takkenTokens = tokenize(input.currentTakkenaiUrl || "");

  const candidates = pool.items.filter((item) => {
    if (item.contentKey !== "standard") return false;
    if (item.date === date) return false;
    if (exclude.has(item.canonicalUrl)) return false;
    if (
      pool.allowedAccounts.length > 0 &&
      !pool.allowedAccounts.includes(item.account)
    ) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map((item) => {
    const ageDays = dayDiff(item.publishedAt, date);
    const recencyScore = Math.max(0, 45 - Math.min(ageDays, 45));
    const titleScore = keywordOverlapScore(titleTokens, tokenize(item.title || ""));
    const takkenScore = keywordOverlapScore(
      takkenTokens,
      tokenize(`${item.title} ${item.url}`)
    );
    const score = recencyScore + titleScore * 8 + takkenScore * 5;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score || a.item.canonicalUrl.localeCompare(b.item.canonicalUrl));

  const topN = Math.min(3, scored.length);
  const seed = hashText(
    `${date}:${input.currentTitle || ""}:${input.currentTakkenaiUrl || ""}`
  );
  const picked = scored[seed % topN].item;

  return {
    url: picked.url,
    title: picked.title,
    account: picked.account,
    allowedAccounts: pool.allowedAccounts,
  };
}
