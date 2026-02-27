import fs from "fs";
import path from "path";
import type { Platform } from "./topic-engine";
import type {
  CoverImageProfile,
  CoverRegion,
  CoverTextDensity,
} from "./cover-profile";

export type SkillRunMode = "shadow" | "promote";

export interface PlatformProfile {
  enabled: boolean;
  utmSource?: string;
}

export interface LanguageProfile {
  code: string;
  label: string;
}

export interface SiteManifest {
  siteId: string;
  displayName: string;
  domain: string;
  timezone: string;
  defaultLanguage: string;
  languages: LanguageProfile[];
  platforms: Record<Platform, PlatformProfile>;
  profileVersion: string;
  skillVersion: string;
  cover: CoverImageProfile;
}

export interface ResolveRunContextInput {
  siteId?: string;
  language?: string;
  mode?: SkillRunMode | string;
}

export interface RunContext {
  siteId: string;
  language: string;
  mode: SkillRunMode;
  manifest: SiteManifest;
}

const DEFAULT_SITE_ID = "takkenai-jp";
const DEFAULT_PROFILE_VERSION = "2026.02.13";
const DEFAULT_SKILL_VERSION = "content-factory-portable@0.1.0";

const DEFAULT_SITE_MANIFEST: SiteManifest = {
  siteId: DEFAULT_SITE_ID,
  displayName: "TakkenAI JP",
  domain: "takkenai.jp",
  timezone: "Asia/Tokyo",
  defaultLanguage: "ja",
  languages: [
    { code: "ja", label: "Japanese" },
    { code: "zh", label: "Chinese (Simplified)" },
  ],
  platforms: {
    ameba: { enabled: true, utmSource: "ameba" },
    note: { enabled: true, utmSource: "note" },
    hatena: { enabled: true, utmSource: "hatena" },
  },
  profileVersion: DEFAULT_PROFILE_VERSION,
  skillVersion: DEFAULT_SKILL_VERSION,
  cover: {
    region: "jp",
    stylePack: "jp-classic-v2",
    textDensity: "medium",
    styleId: "lecture_blue",
    platformOverrides: {
      ameba: { textDensity: "medium" },
      note: { textDensity: "medium" },
      hatena: { textDensity: "medium" },
    },
  },
};

function sanitizeSiteId(siteId?: string): string {
  const raw = (siteId || "").trim();
  if (!raw) return DEFAULT_SITE_ID;
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return safe || DEFAULT_SITE_ID;
}

function normalizeLanguage(value: string | undefined, manifest: SiteManifest): string {
  const candidate = (value || "").trim().toLowerCase();
  if (!candidate) return manifest.defaultLanguage;
  const allowed = new Set(manifest.languages.map((item) => item.code.toLowerCase()));
  return allowed.has(candidate) ? candidate : manifest.defaultLanguage;
}

function parseCover(raw: unknown): CoverImageProfile {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<CoverImageProfile>;
  const region = input.region === "na" ? "na" : ("jp" as CoverRegion);
  const stylePack =
    typeof input.stylePack === "string" && input.stylePack.trim()
      ? input.stylePack.trim()
      : region === "na"
      ? "na-lowtext-v2"
      : "jp-classic-v2";
  const textDensity =
    input.textDensity === "low" ||
    input.textDensity === "medium" ||
    input.textDensity === "high"
      ? input.textDensity
      : region === "na"
      ? ("low" as CoverTextDensity)
      : ("medium" as CoverTextDensity);

  return {
    region,
    stylePack,
    textDensity,
    styleId: typeof input.styleId === "string" ? (input.styleId as CoverImageProfile["styleId"]) : "lecture_blue",
    platformOverrides:
      input.platformOverrides && typeof input.platformOverrides === "object"
        ? input.platformOverrides
        : undefined,
  };
}

function parseManifest(raw: unknown, fallbackSiteId: string): SiteManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<SiteManifest>;

  const siteId = sanitizeSiteId(typeof input.siteId === "string" ? input.siteId : fallbackSiteId);
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : siteId;
  const domain =
    typeof input.domain === "string" && input.domain.trim()
      ? input.domain.trim()
      : DEFAULT_SITE_MANIFEST.domain;
  const timezone =
    typeof input.timezone === "string" && input.timezone.trim()
      ? input.timezone.trim()
      : DEFAULT_SITE_MANIFEST.timezone;

  const languages = Array.isArray(input.languages)
    ? input.languages
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const code =
            typeof (item as LanguageProfile).code === "string"
              ? (item as LanguageProfile).code.trim().toLowerCase()
              : "";
          const label =
            typeof (item as LanguageProfile).label === "string"
              ? (item as LanguageProfile).label.trim()
              : code;
          if (!code || !label) return null;
          return { code, label } satisfies LanguageProfile;
        })
        .filter((item): item is LanguageProfile => !!item)
    : [];

  const normalizedLanguages =
    languages.length > 0 ? languages : [...DEFAULT_SITE_MANIFEST.languages];

  const defaultLanguage =
    typeof input.defaultLanguage === "string" && input.defaultLanguage.trim()
      ? input.defaultLanguage.trim().toLowerCase()
      : normalizedLanguages[0]?.code || DEFAULT_SITE_MANIFEST.defaultLanguage;

  const defaultPlatforms = DEFAULT_SITE_MANIFEST.platforms;
  const inputPlatforms =
    input.platforms && typeof input.platforms === "object" ? input.platforms : {};
  const platforms: Record<Platform, PlatformProfile> = {
    ameba: {
      enabled:
        typeof (inputPlatforms as Record<string, PlatformProfile>)?.ameba?.enabled === "boolean"
          ? Boolean((inputPlatforms as Record<string, PlatformProfile>).ameba.enabled)
          : defaultPlatforms.ameba.enabled,
      utmSource:
        (inputPlatforms as Record<string, PlatformProfile>)?.ameba?.utmSource ||
        defaultPlatforms.ameba.utmSource,
    },
    note: {
      enabled:
        typeof (inputPlatforms as Record<string, PlatformProfile>)?.note?.enabled === "boolean"
          ? Boolean((inputPlatforms as Record<string, PlatformProfile>).note.enabled)
          : defaultPlatforms.note.enabled,
      utmSource:
        (inputPlatforms as Record<string, PlatformProfile>)?.note?.utmSource ||
        defaultPlatforms.note.utmSource,
    },
    hatena: {
      enabled:
        typeof (inputPlatforms as Record<string, PlatformProfile>)?.hatena?.enabled === "boolean"
          ? Boolean((inputPlatforms as Record<string, PlatformProfile>).hatena.enabled)
          : defaultPlatforms.hatena.enabled,
      utmSource:
        (inputPlatforms as Record<string, PlatformProfile>)?.hatena?.utmSource ||
        defaultPlatforms.hatena.utmSource,
    },
  };

  return {
    siteId,
    displayName,
    domain,
    timezone,
    defaultLanguage,
    languages: normalizedLanguages,
    platforms,
    profileVersion:
      typeof input.profileVersion === "string" && input.profileVersion.trim()
        ? input.profileVersion.trim()
        : DEFAULT_PROFILE_VERSION,
    skillVersion:
      typeof input.skillVersion === "string" && input.skillVersion.trim()
        ? input.skillVersion.trim()
        : DEFAULT_SKILL_VERSION,
    cover: parseCover(input.cover),
  };
}

function manifestPathForSite(siteId: string): string {
  return path.join(process.cwd(), "data", "site-manifests", `${siteId}.json`);
}

export function resolveSiteManifest(siteId?: string): SiteManifest {
  const normalizedSiteId = sanitizeSiteId(siteId);
  const manifestPath = manifestPathForSite(normalizedSiteId);

  if (!fs.existsSync(manifestPath)) {
    if (normalizedSiteId === DEFAULT_SITE_ID) {
      return DEFAULT_SITE_MANIFEST;
    }
    return {
      ...DEFAULT_SITE_MANIFEST,
      siteId: normalizedSiteId,
      displayName: normalizedSiteId,
      cover:
        normalizedSiteId.includes("na") || normalizedSiteId.includes("us")
          ? {
              ...DEFAULT_SITE_MANIFEST.cover,
              region: "na",
              stylePack: "na-lowtext-v2",
              textDensity: "low",
              styleId: "cyber_blue",
            }
          : DEFAULT_SITE_MANIFEST.cover,
    };
  }

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    const manifest = parseManifest(parsed, normalizedSiteId);
    if (manifest) return manifest;
  } catch {
    // Use fallback manifest.
  }

  return {
    ...DEFAULT_SITE_MANIFEST,
    siteId: normalizedSiteId,
    displayName: normalizedSiteId,
  };
}

export function resolveSkillRunMode(
  mode?: SkillRunMode | string,
  siteId?: string
): SkillRunMode {
  if (mode === "shadow" || mode === "promote") {
    return mode;
  }
  // Backward-compatible: legacy calls (without siteId) keep current production behavior.
  if (!siteId || !siteId.trim()) {
    return "promote";
  }
  return "shadow";
}

export function resolveRunContext(input: ResolveRunContextInput): RunContext {
  const siteId = sanitizeSiteId(input.siteId);
  const manifest = resolveSiteManifest(siteId);
  const language = normalizeLanguage(input.language, manifest);
  const mode = resolveSkillRunMode(input.mode, input.siteId);

  return {
    siteId,
    language,
    mode,
    manifest,
  };
}

export function resolveGeneratedOutputDir(params: {
  mode: SkillRunMode;
  siteId: string;
}): string {
  if (params.mode === "shadow") {
    return path.join(
      process.cwd(),
      "data",
      "skill-sandbox",
      sanitizeSiteId(params.siteId),
      "generated"
    );
  }
  return path.join(process.cwd(), "data", "generated");
}

export function ensureDirExists(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}
