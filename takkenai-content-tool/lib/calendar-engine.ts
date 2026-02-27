import fs from "fs";
import path from "path";
import {
  generateDayTopics,
  type DayTopics,
  type Platform,
  type MotherTopic,
  type PlatformPlan,
} from "./topic-engine";
import { canonicalizeTakkenaiPath } from "./traffic-url-profile";
import type { ArticleType } from "./article-type";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentStatus =
  | "pending"      // Not yet generated
  | "generated"    // Content generated, awaiting review
  | "reviewed"     // Reviewed and approved
  | "published"    // Published to the platform
  | "skipped";     // Intentionally skipped

export interface PlatformEntry {
  /** The content angle for this platform */
  angle: string;
  /** Suggested title */
  titleSuggestion: string;
  /** Current status of this content piece */
  status: ContentStatus;
  /** Generated content (populated after generation) */
  generatedTitle?: string;
  /** Generated body text */
  generatedBody?: string;
  /** Generated hashtags */
  generatedHashtags?: string[];
  /** Image prompt for generation */
  imagePrompt?: string;
  /** Timestamp of last generation */
  generatedAt?: string;
  /** Timestamp of publication */
  publishedAt?: string;
  /** Published platform URL (used for note internal-link pool) */
  publishedUrl?: string;
  /** Target character count */
  targetLength: { min: number; max: number };
  /** The takkenai.jp URL to link to */
  takkenaiUrl: string;
  /** Selected article type for this platform generation */
  articleType?: ArticleType;
}

type MotherTopicSerialized = {
  assetType: string;
  assetId: string;
  phase: string;
  phaseLabel: string;
  takkenaiUrl: string;
  topicLabelOverride?: string;
  urlSelectionMode?: "asset" | "url-direct";
  urlTier?: "high" | "explore" | "cooldown";
  secondaryAssetType?: string;
  secondaryAssetId?: string;
};

export interface CalendarDay {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Per-platform mother topics — each platform has its own independent topic */
  motherTopics: {
    ameba: MotherTopicSerialized;
    note: MotherTopicSerialized;
    hatena: MotherTopicSerialized;
  };
  /** Platform-specific content entries */
  platforms: {
    ameba: PlatformEntry;
    note: PlatformEntry;
    hatena: PlatformEntry;
  };
}

export interface MonthCalendar {
  year: number;
  month: number;
  /** ISO string of when this calendar was generated */
  generatedAt: string;
  /** ISO string of last modification */
  updatedAt: string;
  days: CalendarDay[];
}

export interface CalendarStore {
  calendars: MonthCalendar[];
}

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

const CALENDAR_FILE = path.join(process.cwd(), "data", "calendar.json");

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Convert a MotherTopic into a serializable shape for the calendar JSON.
 */
function serializeMotherTopic(mt: MotherTopic): MotherTopicSerialized {
  const result: MotherTopicSerialized = {
    assetType: mt.asset.type,
    assetId: getAssetId(mt.asset),
    phase: mt.phase,
    phaseLabel: mt.phaseLabel,
    takkenaiUrl: mt.takkenaiUrl,
    topicLabelOverride: mt.topicLabelOverride,
    urlSelectionMode: mt.urlSelectionMode,
    urlTier: mt.urlTier,
  };

  if (mt.secondaryAsset) {
    result.secondaryAssetType = mt.secondaryAsset.type;
    result.secondaryAssetId = getAssetId(mt.secondaryAsset);
  }

  return result;
}

function getAssetId(asset: DayTopics["motherTopics"]["ameba"]["asset"]): string {
  switch (asset.type) {
    case "knowledge-point":
      return asset.data.id;
    case "tool":
      return asset.data.id;
    case "past-question":
      return asset.data.id;
  }
}

/**
 * Convert a PlatformPlan into a PlatformEntry for the calendar.
 */
function planToEntry(plan: PlatformPlan): PlatformEntry {
  return {
    angle: plan.angle,
    titleSuggestion: plan.titleSuggestion,
    status: "pending",
    targetLength: plan.targetLength,
    takkenaiUrl: plan.takkenaiUrl,
  };
}

/**
 * Convert DayTopics into a CalendarDay.
 */
function dayTopicsToCalendarDay(topics: DayTopics): CalendarDay {
  return {
    date: topics.motherTopics.ameba.date,
    motherTopics: {
      ameba: serializeMotherTopic(topics.motherTopics.ameba),
      note: serializeMotherTopic(topics.motherTopics.note),
      hatena: serializeMotherTopic(topics.motherTopics.hatena),
    },
    platforms: {
      ameba: planToEntry(topics.platforms.ameba),
      note: planToEntry(topics.platforms.note),
      hatena: planToEntry(topics.platforms.hatena),
    },
  };
}

function isLockedStatus(status: ContentStatus): boolean {
  return status === "generated" || status === "reviewed" || status === "published";
}

function isRefreshTargetStatus(status: ContentStatus): boolean {
  return status === "pending" || status === "skipped";
}

function getMotherTopicKey(mt: MotherTopicSerialized): string {
  const canonicalPath = canonicalizeTakkenaiPath(mt.takkenaiUrl);
  if (canonicalPath) return canonicalPath;
  return `${mt.assetType}:${mt.assetId}`;
}

function refreshPendingPlatformsInDay(day: CalendarDay): boolean {
  const platforms = ["ameba", "note", "hatena"] as const;
  const mutablePlatforms = platforms.filter((platform) =>
    isRefreshTargetStatus(day.platforms[platform].status)
  );
  if (mutablePlatforms.length === 0) return false;

  const lockedKeys = new Set<string>();
  for (const platform of platforms) {
    if (isLockedStatus(day.platforms[platform].status)) {
      lockedKeys.add(getMotherTopicKey(day.motherTopics[platform]));
    }
  }

  for (let seedSalt = 0; seedSalt < 96; seedSalt++) {
    const fresh = generateDayTopics(day.date, seedSalt);
    const chosenMother = {} as Record<Platform, MotherTopicSerialized>;
    const chosenPlan = {} as Record<Platform, PlatformPlan>;
    const usedKeys = new Set<string>(lockedKeys);
    let valid = true;

    for (const platform of mutablePlatforms) {
      const candidate = serializeMotherTopic(fresh.motherTopics[platform]);
      const candidateKey = getMotherTopicKey(candidate);
      if (usedKeys.has(candidateKey)) {
        valid = false;
        break;
      }
      usedKeys.add(candidateKey);
      chosenMother[platform] = candidate;
      chosenPlan[platform] = fresh.platforms[platform];
    }

    if (!valid) {
      continue;
    }

    let changed = false;
    for (const platform of mutablePlatforms) {
      const nextMother = chosenMother[platform];
      const currentMother = day.motherTopics[platform];

      if (
        currentMother.assetType !== nextMother.assetType ||
        currentMother.assetId !== nextMother.assetId ||
        currentMother.takkenaiUrl !== nextMother.takkenaiUrl ||
        currentMother.phase !== nextMother.phase ||
        currentMother.phaseLabel !== nextMother.phaseLabel ||
        currentMother.topicLabelOverride !== nextMother.topicLabelOverride ||
        currentMother.urlSelectionMode !== nextMother.urlSelectionMode ||
        currentMother.urlTier !== nextMother.urlTier ||
        currentMother.secondaryAssetType !== nextMother.secondaryAssetType ||
        currentMother.secondaryAssetId !== nextMother.secondaryAssetId
      ) {
        day.motherTopics[platform] = nextMother;
        changed = true;
      }

      const currentEntry = day.platforms[platform];
      const nextPlan = chosenPlan[platform];
      if (
        currentEntry.angle !== nextPlan.angle ||
        currentEntry.titleSuggestion !== nextPlan.titleSuggestion ||
        currentEntry.takkenaiUrl !== nextPlan.takkenaiUrl ||
        currentEntry.targetLength.min !== nextPlan.targetLength.min ||
        currentEntry.targetLength.max !== nextPlan.targetLength.max
      ) {
        day.platforms[platform] = {
          ...currentEntry,
          angle: nextPlan.angle,
          titleSuggestion: nextPlan.titleSuggestion,
          targetLength: nextPlan.targetLength,
          takkenaiUrl: nextPlan.takkenaiUrl,
        };
        changed = true;
      }
    }
    return changed;
  }

  return false;
}

function refreshPendingTopics(calendar: MonthCalendar): boolean {
  let changed = false;
  for (const day of calendar.days) {
    if (refreshPendingPlatformsInDay(day)) {
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Calendar generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete month calendar with content plans for every day.
 *
 * @param year  - e.g. 2026
 * @param month - 1-12
 */
export function generateMonthCalendar(
  year: number,
  month: number
): MonthCalendar {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: CalendarDay[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const topics = generateDayTopics(dateStr);
    days.push(dayTopicsToCalendarDay(topics));
  }

  const now = new Date().toISOString();
  return {
    year,
    month,
    generatedAt: now,
    updatedAt: now,
    days,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load the entire calendar store from disk.
 * Returns an empty store if the file does not exist.
 */
export function loadCalendarStore(): CalendarStore {
  try {
    if (fs.existsSync(CALENDAR_FILE)) {
      const raw = fs.readFileSync(CALENDAR_FILE, "utf-8");
      return JSON.parse(raw) as CalendarStore;
    }
  } catch (err) {
    console.error("Failed to load calendar store, starting fresh:", err);
  }
  return { calendars: [] };
}

/**
 * Save the entire calendar store to disk.
 */
export function saveCalendarStore(store: CalendarStore): void {
  const dir = path.dirname(CALENDAR_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CALENDAR_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Find a month calendar in the store.
 */
function findMonthCalendar(
  store: CalendarStore,
  year: number,
  month: number
): MonthCalendar | undefined {
  return store.calendars.find(
    (cal) => cal.year === year && cal.month === month
  );
}

/**
 * Get or create a month calendar.
 * - If a calendar for the given month exists on disk, return it.
 * - Otherwise generate a new one, save it to disk, and return it.
 *
 * @param year  - e.g. 2026
 * @param month - 1-12
 */
export function getOrCreateCalendar(
  year: number,
  month: number
): MonthCalendar {
  const store = loadCalendarStore();
  const existing = findMonthCalendar(store, year, month);

  if (existing) {
    if (refreshPendingTopics(existing)) {
      existing.updatedAt = new Date().toISOString();
      saveCalendarStore(store);
    }
    return existing;
  }

  const calendar = generateMonthCalendar(year, month);
  store.calendars.push(calendar);
  saveCalendarStore(store);
  return calendar;
}

/**
 * Force regenerate a month calendar, replacing any existing one.
 * Preserves any content that has already been generated or published.
 */
export function regenerateCalendar(
  year: number,
  month: number,
  preserveGenerated: boolean = true
): MonthCalendar {
  const store = loadCalendarStore();
  const existing = findMonthCalendar(store, year, month);
  const fresh = generateMonthCalendar(year, month);

  if (preserveGenerated && existing) {
    // Merge: keep generated/published content from old calendar
    for (const freshDay of fresh.days) {
      const oldDay = existing.days.find((d) => d.date === freshDay.date);
      if (!oldDay) continue;

      for (const platform of ["ameba", "note", "hatena"] as const) {
        const oldEntry = oldDay.platforms[platform];
        if (
          oldEntry.status === "generated" ||
          oldEntry.status === "reviewed" ||
          oldEntry.status === "published"
        ) {
          freshDay.platforms[platform] = { ...oldEntry };
          freshDay.motherTopics[platform] = { ...oldDay.motherTopics[platform] };
        }
      }
    }
  }

  if (refreshPendingTopics(fresh)) {
    fresh.updatedAt = new Date().toISOString();
  }

  // Replace in store
  const index = store.calendars.findIndex(
    (cal) => cal.year === year && cal.month === month
  );
  if (index >= 0) {
    store.calendars[index] = fresh;
  } else {
    store.calendars.push(fresh);
  }

  saveCalendarStore(store);
  return fresh;
}

// ---------------------------------------------------------------------------
// Day-level operations
// ---------------------------------------------------------------------------

/**
 * Get a specific day from the calendar.
 */
export function getCalendarDay(
  year: number,
  month: number,
  day: number
): CalendarDay | undefined {
  const calendar = getOrCreateCalendar(year, month);
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return calendar.days.find((d) => d.date === dateStr);
}

/**
 * Update a specific platform entry for a given day.
 * Used after content generation to store the results.
 */
export function updatePlatformEntry(
  year: number,
  month: number,
  day: number,
  platform: Platform,
  updates: Partial<PlatformEntry>
): CalendarDay | undefined {
  const store = loadCalendarStore();
  const calendar = findMonthCalendar(store, year, month);
  if (!calendar) return undefined;

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const calendarDay = calendar.days.find((d) => d.date === dateStr);
  if (!calendarDay) return undefined;

  const entry = calendarDay.platforms[platform];
  Object.assign(entry, updates);

  calendar.updatedAt = new Date().toISOString();
  saveCalendarStore(store);

  return calendarDay;
}

/**
 * Update the status of a platform entry.
 */
export function updateStatus(
  year: number,
  month: number,
  day: number,
  platform: Platform,
  status: ContentStatus
): CalendarDay | undefined {
  return updatePlatformEntry(year, month, day, platform, { status });
}

/**
 * Mark a platform entry as published with a timestamp.
 */
export function markPublished(
  year: number,
  month: number,
  day: number,
  platform: Platform
): CalendarDay | undefined {
  return updatePlatformEntry(year, month, day, platform, {
    status: "published",
    publishedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

/**
 * Get summary statistics for a month.
 */
export function getMonthStats(year: number, month: number) {
  const calendar = getOrCreateCalendar(year, month);
  const stats = {
    totalDays: calendar.days.length,
    totalPieces: calendar.days.length * 3,
    byStatus: {
      pending: 0,
      generated: 0,
      reviewed: 0,
      published: 0,
      skipped: 0,
    },
    byPlatform: {
      ameba: { pending: 0, generated: 0, reviewed: 0, published: 0, skipped: 0 },
      note: { pending: 0, generated: 0, reviewed: 0, published: 0, skipped: 0 },
      hatena: { pending: 0, generated: 0, reviewed: 0, published: 0, skipped: 0 },
    },
  };

  for (const day of calendar.days) {
    for (const platform of ["ameba", "note", "hatena"] as const) {
      const status = day.platforms[platform].status;
      stats.byStatus[status]++;
      stats.byPlatform[platform][status]++;
    }
  }

  return stats;
}

/**
 * Get all days that have pending content for a given platform.
 */
export function getPendingDays(
  year: number,
  month: number,
  platform?: Platform
): CalendarDay[] {
  const calendar = getOrCreateCalendar(year, month);

  return calendar.days.filter((day) => {
    if (platform) {
      return day.platforms[platform].status === "pending";
    }
    return (
      day.platforms.ameba.status === "pending" ||
      day.platforms.note.status === "pending" ||
      day.platforms.hatena.status === "pending"
    );
  });
}
