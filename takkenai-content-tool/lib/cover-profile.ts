import {
  COVER_STYLE_IDS,
  DEFAULT_COVER_STYLE,
  type CoverStyleId,
} from "./cover-style";
import type { Platform } from "./topic-engine";

export type CoverRegion = "jp" | "na";
export type CoverTextDensity = "low" | "medium" | "high";

export interface CoverImageProfile {
  region: CoverRegion;
  stylePack: string;
  textDensity: CoverTextDensity;
  styleId: CoverStyleId;
  platformOverrides?: Partial<
    Record<Platform, Partial<Pick<CoverImageProfile, "stylePack" | "textDensity" | "styleId">>>
  >;
}

export interface ResolveCoverProfileInput {
  profile: CoverImageProfile;
  platform: Platform;
  stylePack?: string;
  textDensity?: CoverTextDensity;
  styleId?: string;
}

export interface ResolvedCoverProfile {
  region: CoverRegion;
  stylePack: string;
  textDensity: CoverTextDensity;
  styleId: CoverStyleId;
  availableStyles: CoverStyleId[];
}

const STYLE_PACKS: Record<string, CoverStyleId[]> = {
  "jp-classic-v2": [...COVER_STYLE_IDS],
  "jp-classic-v1": [...COVER_STYLE_IDS],
  "na-lowtext-v2": [
    "cyber_blue",
    "impact_money",
    "paper_sns",
    "note_minimal_bold",
    "editorial_white",
    "data_card_modern",
  ],
  "na-lowtext-v1": ["cyber_blue", "impact_money", "paper_sns"],
};

function normalizeTextDensity(
  value: string | undefined,
  fallback: CoverTextDensity
): CoverTextDensity {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return fallback;
}

function resolveStylePackName(stylePack: string): string {
  const trimmed = (stylePack || "").trim();
  if (!trimmed) return "jp-classic-v2";
  return STYLE_PACKS[trimmed] ? trimmed : "jp-classic-v2";
}

function pickStyleByPack(pack: string, requestedStyleId?: string): CoverStyleId {
  const pool = STYLE_PACKS[pack] || STYLE_PACKS["jp-classic-v2"];
  if (requestedStyleId && pool.includes(requestedStyleId as CoverStyleId)) {
    return requestedStyleId as CoverStyleId;
  }
  if (pool.includes(DEFAULT_COVER_STYLE)) {
    return DEFAULT_COVER_STYLE;
  }
  return pool[0] || DEFAULT_COVER_STYLE;
}

export function resolveCoverProfile(
  input: ResolveCoverProfileInput
): ResolvedCoverProfile {
  const platformOverride = input.profile.platformOverrides?.[input.platform];

  const region = input.profile.region;
  const baseStylePack = platformOverride?.stylePack || input.profile.stylePack;
  const baseTextDensity =
    platformOverride?.textDensity ||
    input.profile.textDensity ||
    (region === "na" ? "low" : "medium");

  const stylePack = resolveStylePackName(input.stylePack || baseStylePack);
  const textDensity = normalizeTextDensity(input.textDensity, baseTextDensity);
  const requestedStyleId =
    input.styleId || platformOverride?.styleId || input.profile.styleId;
  const styleId = pickStyleByPack(stylePack, requestedStyleId);

  return {
    region,
    stylePack,
    textDensity,
    styleId,
    availableStyles: [...(STYLE_PACKS[stylePack] || STYLE_PACKS["jp-classic-v2"])],
  };
}

export function getStylePackStyles(stylePack: string): CoverStyleId[] {
  const pack = resolveStylePackName(stylePack);
  return [...(STYLE_PACKS[pack] || STYLE_PACKS["jp-classic-v2"])];
}
