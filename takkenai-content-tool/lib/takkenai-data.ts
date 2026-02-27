import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------
export const TAKKENAI_BASE_URL = "https://takkenai.jp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 知識ポイント – 187 items covering 宅建 knowledge areas */
export interface KnowledgePoint {
  id: string;
  subject: KnowledgeSubject;
  title: string;
  slug: string;
  takkenaiUrl: string;
}

/** 宅建知識科目 */
export type KnowledgeSubject =
  | "宅建業法"
  | "法令上の制限"
  | "税・その他"
  | "その他";

/** ツール – 72 items for calculators and utilities on takkenai.jp */
export interface Tool {
  id: string;
  name: string;
  slug: string;
  category: ToolCategory;
  takkenaiUrl: string;
}

export type ToolCategory =
  | "finance"
  | "exam"
  | "market"
  | "compliance"
  | "marketing"
  | "sales"
  | "investment"
  | "customer"
  | "operations"
  | "management"
  | "other"
  | "commercial";

/** 過去問 – 1950 items spanning years 1989-2025 */
export interface PastQuestion {
  id: string;
  year: number;
  number: number;
  subject: string;
  takkenaiUrl: string;
}

/** Union type for any content asset */
export type ContentAsset =
  | { type: "knowledge-point"; data: KnowledgePoint }
  | { type: "tool"; data: Tool }
  | { type: "past-question"; data: PastQuestion };

// ---------------------------------------------------------------------------
// Data directory resolution
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");

function loadJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Cached data loaders (lazy singleton pattern)
// ---------------------------------------------------------------------------

let _knowledgePoints: KnowledgePoint[] | null = null;
let _tools: Tool[] | null = null;
let _pastQuestions: PastQuestion[] | null = null;

export function getKnowledgePoints(): KnowledgePoint[] {
  if (!_knowledgePoints) {
    _knowledgePoints = loadJson<KnowledgePoint[]>("knowledge-points.json");
  }
  return _knowledgePoints;
}

export function getTools(): Tool[] {
  if (!_tools) {
    _tools = loadJson<Tool[]>("tools.json");
  }
  return _tools;
}

export function getPastQuestions(): PastQuestion[] {
  if (!_pastQuestions) {
    _pastQuestions = loadJson<PastQuestion[]>("past-questions.json");
  }
  return _pastQuestions;
}

// ---------------------------------------------------------------------------
// Knowledge Point helpers
// ---------------------------------------------------------------------------

/** Get knowledge points filtered by subject */
export function getKnowledgePointsBySubject(
  subject: KnowledgeSubject
): KnowledgePoint[] {
  return getKnowledgePoints().filter((kp) => kp.subject === subject);
}

/** Get all unique knowledge subjects present in the data */
export function getKnowledgeSubjects(): KnowledgeSubject[] {
  const subjects = new Set(getKnowledgePoints().map((kp) => kp.subject));
  return Array.from(subjects);
}

/** Find a single knowledge point by id */
export function getKnowledgePointById(
  id: string
): KnowledgePoint | undefined {
  return getKnowledgePoints().find((kp) => kp.id === id);
}

/** Find knowledge points by slug partial match */
export function searchKnowledgePoints(query: string): KnowledgePoint[] {
  const lowerQuery = query.toLowerCase();
  return getKnowledgePoints().filter(
    (kp) =>
      kp.slug.toLowerCase().includes(lowerQuery) ||
      kp.title.toLowerCase().includes(lowerQuery) ||
      kp.id.toLowerCase().includes(lowerQuery)
  );
}

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

/** Get tools filtered by category */
export function getToolsByCategory(category: ToolCategory): Tool[] {
  return getTools().filter((t) => t.category === category);
}

/** Get all unique tool categories present in the data */
export function getToolCategories(): ToolCategory[] {
  const categories = new Set(getTools().map((t) => t.category));
  return Array.from(categories);
}

/** Find a single tool by id */
export function getToolById(id: string): Tool | undefined {
  return getTools().find((t) => t.id === id);
}

/** Find tools by name or slug partial match */
export function searchTools(query: string): Tool[] {
  const lowerQuery = query.toLowerCase();
  return getTools().filter(
    (t) =>
      t.slug.toLowerCase().includes(lowerQuery) ||
      t.name.toLowerCase().includes(lowerQuery) ||
      t.id.toLowerCase().includes(lowerQuery)
  );
}

// ---------------------------------------------------------------------------
// Past Question helpers
// ---------------------------------------------------------------------------

/** Get past questions filtered by year */
export function getPastQuestionsByYear(year: number): PastQuestion[] {
  return getPastQuestions().filter((pq) => pq.year === year);
}

/** Get all unique years present in the data */
export function getPastQuestionYears(): number[] {
  const years = new Set(getPastQuestions().map((pq) => pq.year));
  return Array.from(years).sort((a, b) => a - b);
}

/** Get past questions filtered by subject */
export function getPastQuestionsBySubject(subject: string): PastQuestion[] {
  return getPastQuestions().filter((pq) => pq.subject === subject);
}

/** Find a single past question by id */
export function getPastQuestionById(id: string): PastQuestion | undefined {
  return getPastQuestions().find((pq) => pq.id === id);
}

/** Get past questions for a specific year and question number range */
export function getPastQuestionsRange(
  year: number,
  fromNumber: number,
  toNumber: number
): PastQuestion[] {
  return getPastQuestions().filter(
    (pq) =>
      pq.year === year && pq.number >= fromNumber && pq.number <= toNumber
  );
}

/** Get recent past questions (last N years) */
export function getRecentPastQuestions(lastNYears: number = 5): PastQuestion[] {
  const currentYear = new Date().getFullYear();
  const cutoff = currentYear - lastNYears;
  return getPastQuestions().filter((pq) => pq.year >= cutoff);
}

// ---------------------------------------------------------------------------
// Cross-data helpers
// ---------------------------------------------------------------------------

/** Build a full takkenai.jp URL from a relative path */
export function buildFullUrl(relativePath: string): string {
  return `${TAKKENAI_BASE_URL}${relativePath}`;
}

/** Get a random content asset of a specified type */
export function getRandomAsset(
  type: "knowledge-point" | "tool" | "past-question",
  seed?: number
): ContentAsset {
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;

  switch (type) {
    case "knowledge-point": {
      const items = getKnowledgePoints();
      const index = Math.floor(rng() * items.length);
      return { type: "knowledge-point", data: items[index] };
    }
    case "tool": {
      const items = getTools();
      const index = Math.floor(rng() * items.length);
      return { type: "tool", data: items[index] };
    }
    case "past-question": {
      const items = getPastQuestions();
      const index = Math.floor(rng() * items.length);
      return { type: "past-question", data: items[index] };
    }
  }
}

/** Get all content assets as a flat array */
export function getAllAssets(): ContentAsset[] {
  const kps: ContentAsset[] = getKnowledgePoints().map((data) => ({
    type: "knowledge-point" as const,
    data,
  }));
  const tools: ContentAsset[] = getTools().map((data) => ({
    type: "tool" as const,
    data,
  }));
  const pqs: ContentAsset[] = getPastQuestions().map((data) => ({
    type: "past-question" as const,
    data,
  }));
  return [...kps, ...tools, ...pqs];
}

// ---------------------------------------------------------------------------
// Seeded PRNG (deterministic selection)
// ---------------------------------------------------------------------------

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces values in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a date string (YYYY-MM-DD) to a numeric seed.
 */
export function dateToSeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    const char = dateStr.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Force cache refresh (useful for testing / hot-reload)
// ---------------------------------------------------------------------------

export function clearDataCache(): void {
  _knowledgePoints = null;
  _tools = null;
  _pastQuestions = null;
}
