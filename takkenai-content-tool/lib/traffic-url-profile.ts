import fs from "fs";
import path from "path";
import { dateToSeed, seededRandom } from "./takkenai-data";
import { normalizeAssetLabel } from "./topic-label";

export type TrafficUrlGroup = "tool" | "takken";
export type TrafficUrlTier = "high" | "explore" | "cooldown";
export type TrafficPlatform = "ameba" | "note" | "hatena";

export interface TrafficUrlProfileItem {
  path: string;
  labelJa: string;
  group: TrafficUrlGroup;
  tier: TrafficUrlTier;
  weight: number;
  sourceScore: number;
  bounceRate?: number;
}

export interface TrafficUrlProfileStrategy {
  highShare: number;
  exploreShare: number;
}

export interface TrafficUrlProfile {
  version: string;
  generatedAt: string;
  strategy: TrafficUrlProfileStrategy;
  items: TrafficUrlProfileItem[];
}

export interface PickTrafficUrlInput {
  profile: TrafficUrlProfile;
  date: string;
  platform: TrafficPlatform;
  group: TrafficUrlGroup;
  preferredTier: TrafficUrlTier;
  excludeCanonicalPaths?: Set<string>;
  seedSalt?: number;
  attempt?: number;
}

const DEFAULT_PROFILE_FILE = path.join(
  process.cwd(),
  "data",
  "traffic-url-profile.json"
);
const DEFAULT_STRATEGY: TrafficUrlProfileStrategy = {
  highShare: 0.7,
  exploreShare: 0.3,
};

let cachedProfile: TrafficUrlProfile | null = null;
let cachedMtimeMs = 0;

function coerceNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function coerceTier(value: unknown): TrafficUrlTier {
  if (value === "high" || value === "explore" || value === "cooldown") {
    return value;
  }
  return "explore";
}

function coerceGroup(value: unknown, pathValue: string): TrafficUrlGroup {
  if (value === "tool" || value === "takken") return value;
  return pathValue.startsWith("/tools/") ? "tool" : "takken";
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeLabel(pathValue: string, group: TrafficUrlGroup, raw?: unknown): string {
  const explicit = String(raw || "").trim();
  if (explicit) return explicit;
  const assetType = group === "tool" ? "tool" : "knowledge-point";
  return normalizeAssetLabel(pathValue, assetType, buildTakkenaiUrlFromPath(pathValue));
}

function normalizeItem(raw: unknown): TrafficUrlProfileItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TrafficUrlProfileItem>;
  const canonicalPath = canonicalizeTakkenaiPath(item.path || "");
  if (!canonicalPath) return null;
  const group = coerceGroup(item.group, canonicalPath);
  const tier = coerceTier(item.tier);
  return {
    path: canonicalPath,
    labelJa: normalizeLabel(canonicalPath, group, item.labelJa),
    group,
    tier,
    weight: Math.max(1, Math.trunc(coerceNumber(item.weight, 1))),
    sourceScore: Math.max(0, coerceNumber(item.sourceScore, 0)),
    bounceRate:
      item.bounceRate === undefined
        ? undefined
        : Math.max(0, coerceNumber(item.bounceRate, 0)),
  };
}

function normalizeProfile(raw: unknown): TrafficUrlProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<TrafficUrlProfile>;
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  const deduped = new Map<string, TrafficUrlProfileItem>();
  for (let i = 0; i < sourceItems.length; i++) {
    const normalized = normalizeItem(sourceItems[i]);
    if (!normalized) continue;
    deduped.set(normalized.path, normalized);
  }

  const items = Array.from(deduped.values());
  if (items.length === 0) return null;

  const strategySource = (input.strategy || {}) as Partial<TrafficUrlProfileStrategy>;
  const strategy: TrafficUrlProfileStrategy = {
    highShare: clampRatio(
      coerceNumber(strategySource.highShare, DEFAULT_STRATEGY.highShare),
      DEFAULT_STRATEGY.highShare
    ),
    exploreShare: clampRatio(
      coerceNumber(strategySource.exploreShare, DEFAULT_STRATEGY.exploreShare),
      DEFAULT_STRATEGY.exploreShare
    ),
  };

  return {
    version: String(input.version || "v1"),
    generatedAt: String(input.generatedAt || new Date().toISOString()),
    strategy,
    items,
  };
}

function pickWeightedItem<T extends { weight: number }>(
  items: T[],
  rng: () => number
): T | null {
  if (items.length === 0) return null;
  const totalWeight = items.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
  if (totalWeight <= 0) return items[0];

  let roll = rng() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    const weight = Math.max(1, items[i].weight);
    roll -= weight;
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function buildRngSeed(input: {
  date: string;
  platform: TrafficPlatform;
  group: TrafficUrlGroup;
  tier: TrafficUrlTier;
  seedSalt?: number;
  attempt?: number;
}): number {
  const key = [
    input.date,
    input.platform,
    input.group,
    input.tier,
    String(input.seedSalt || 0),
    String(input.attempt || 0),
  ].join(":");
  return dateToSeed(key);
}

export function canonicalizeTakkenaiPath(urlOrPath: string): string {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return "";
  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "https://takkenai.jp");
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname !== "takkenai.jp") return "";
    let pathname = parsed.pathname || "/";
    pathname = pathname.replace(/\/+$/, "") || "/";
    return pathname.toLowerCase();
  } catch {
    let normalized = raw.replace(/^https?:\/\/[^/]+/i, "");
    normalized = normalized.split(/[?#]/)[0];
    if (!normalized.startsWith("/")) normalized = `/${normalized}`;
    normalized = normalized.replace(/\/+$/, "") || "/";
    return normalized.toLowerCase();
  }
}

export function buildTakkenaiUrlFromPath(pathValue: string): string {
  const canonicalPath = canonicalizeTakkenaiPath(pathValue);
  return `https://takkenai.jp${canonicalPath || "/"}`;
}

export function inferTrafficUrlGroup(pathValue: string): TrafficUrlGroup {
  const canonicalPath = canonicalizeTakkenaiPath(pathValue);
  return canonicalPath.startsWith("/tools/") ? "tool" : "takken";
}

function getTrafficProfilePath(): string {
  const fromEnv = (process.env.TRAFFIC_URL_PROFILE_FILE || "").trim();
  if (!fromEnv) return DEFAULT_PROFILE_FILE;
  return path.isAbsolute(fromEnv)
    ? fromEnv
    : path.join(process.cwd(), fromEnv);
}

export function loadTrafficUrlProfile(): TrafficUrlProfile | null {
  const profilePath = getTrafficProfilePath();
  if (!fs.existsSync(profilePath)) return null;

  const stat = fs.statSync(profilePath);
  if (cachedProfile && cachedMtimeMs === stat.mtimeMs) {
    return cachedProfile;
  }

  try {
    const raw = fs.readFileSync(profilePath, "utf-8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeProfile(parsed);
    cachedProfile = normalized;
    cachedMtimeMs = stat.mtimeMs;
    return normalized;
  } catch {
    cachedProfile = null;
    cachedMtimeMs = stat.mtimeMs;
    return null;
  }
}

export function clearTrafficUrlProfileCache(): void {
  cachedProfile = null;
  cachedMtimeMs = 0;
}

export function choosePreferredTierForSlot(params: {
  date: string;
  platform: TrafficPlatform;
  seedSalt?: number;
  strategy?: TrafficUrlProfileStrategy;
}): TrafficUrlTier {
  const strategy = params.strategy || DEFAULT_STRATEGY;
  const highShare = clampRatio(strategy.highShare, DEFAULT_STRATEGY.highShare);
  const seed = dateToSeed(
    `${params.date}:${params.platform}:traffic-tier:${String(params.seedSalt || 0)}`
  );
  const rng = seededRandom(seed);
  return rng() < highShare ? "high" : "explore";
}

export function getTrafficItemsByGroup(
  profile: TrafficUrlProfile,
  group: TrafficUrlGroup
): TrafficUrlProfileItem[] {
  return profile.items
    .filter((item) => item.group === group)
    .sort((a, b) => b.weight - a.weight || b.sourceScore - a.sourceScore);
}

export function pickTrafficUrlForSlot(
  input: PickTrafficUrlInput
): TrafficUrlProfileItem | null {
  const excluded = input.excludeCanonicalPaths || new Set<string>();
  const allCandidates = getTrafficItemsByGroup(input.profile, input.group).filter(
    (item) => !excluded.has(canonicalizeTakkenaiPath(item.path))
  );
  if (allCandidates.length === 0) return null;

  const preferredOrder: TrafficUrlTier[] =
    input.preferredTier === "high"
      ? ["high", "explore", "cooldown"]
      : input.preferredTier === "explore"
      ? ["explore", "high", "cooldown"]
      : ["cooldown", "explore", "high"];

  const seed = buildRngSeed({
    date: input.date,
    platform: input.platform,
    group: input.group,
    tier: input.preferredTier,
    seedSalt: input.seedSalt,
    attempt: input.attempt,
  });
  const rng = seededRandom(seed);

  for (let i = 0; i < preferredOrder.length; i++) {
    const tier = preferredOrder[i];
    const tierItems = allCandidates.filter((item) => item.tier === tier);
    const picked = pickWeightedItem(tierItems, rng);
    if (picked) return picked;
  }

  return pickWeightedItem(allCandidates, rng);
}
