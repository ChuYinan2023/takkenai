import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  buildFallbackNoteViralOptions,
  dedupeNoteViralOptions,
  getNoteViralOptionsDateCacheFile,
  normalizeNoteViralOption,
  NOTE_VIRAL_OPTION_LIMIT,
  NOTE_VIRAL_OPTIONS_LATEST_CACHE_FILE,
  type NoteViralOption,
  type NoteViralOptionsCache,
} from "@/lib/note-viral-options";
import {
  ensureDirExists,
  resolveGeneratedOutputDir,
  resolveRunContext,
  type SkillRunMode,
} from "@/lib/site-config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NOTE_VIRAL_RESEARCH_MODEL =
  process.env.OPENROUTER_NOTE_VIRAL_MODEL || "perplexity/sonar-pro";

function parseDate(date: string | null): string | null {
  if (!date) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function readCacheFile(filePath: string): NoteViralOptionsCache | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as NoteViralOptionsCache;
    if (!Array.isArray(parsed.options) || !parsed.date) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCacheFile(filePath: string, payload: NoteViralOptionsCache): void {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (head.ok) return true;
  } catch {
    // fallback to GET probe
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { range: "bytes=0-512" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchLiveOptions(date: string): Promise<NoteViralOption[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return [];

  const now = new Date().toISOString();
  const systemPrompt =
    "あなたはnote運用リサーチャーです。出力はJSONのみ。捏造禁止。日本語で返答。";
  const userPrompt =
    `目的: 宅建/不動産AI領域で使える note の爆款承接候補を作る。\n` +
    `日付: ${date}\n` +
    `要件:\n` +
    `- 競合アカウント由来と note 注目由来を混ぜる\n` +
    `- 反応が良い理由を短く具体化\n` +
    `- URL は note.com のみ\n` +
    `- 8件以内\n` +
    `JSON形式:\n` +
    `{\n` +
    `  "options":[\n` +
    `    {\n` +
    `      "sourceType":"competitor|note-pickup",\n` +
    `      "sourceAccount":"...",\n` +
    `      "sourceUrl":"https://note.com/...",\n` +
    `      "title":"...",\n` +
    `      "hotReason":"...",\n` +
    `      "viralPattern":"...",\n` +
    `      "fitReason":"..."\n` +
    `    }\n` +
    `  ]\n` +
    `}`;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://takkenai.jp",
      "X-Title": "TakkenAI Note Viral Options",
    },
    body: JSON.stringify({
      model: NOTE_VIRAL_RESEARCH_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) return [];
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content || "";
  if (!rawText.trim()) return [];

  let jsonText = rawText.trim();
  const codeBlock = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    jsonText = codeBlock[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText) as { options?: unknown[] };
    const collectedAt = now;
    const normalized = Array.isArray(parsed.options)
      ? parsed.options
          .map((item, index) =>
            normalizeNoteViralOption(item, index, collectedAt)
          )
          .filter((item): item is NoteViralOption => !!item)
      : [];

    if (normalized.length === 0) return [];

    const reachableFlags = await Promise.all(
      normalized.map((item) => isUrlReachable(item.sourceUrl))
    );
    const reachable = normalized.filter((_, index) => reachableFlags[index]);
    return reachable.length > 0 ? reachable : normalized;
  } catch {
    return [];
  }
}

function trimToLimit(options: NoteViralOption[]): NoteViralOption[] {
  return dedupeNoteViralOptions(options).slice(0, NOTE_VIRAL_OPTION_LIMIT);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = parseDate(searchParams.get("date"));
    if (!date) {
      return NextResponse.json(
        { error: "date は YYYY-MM-DD 形式で必須です" },
        { status: 400 }
      );
    }

    const runContext = resolveRunContext({
      siteId: searchParams.get("siteId") || undefined,
      language: searchParams.get("language") || undefined,
      mode: (searchParams.get("mode") as SkillRunMode | null) || undefined,
    });
    const generatedDir = resolveGeneratedOutputDir({
      mode: runContext.mode,
      siteId: runContext.siteId,
    });
    ensureDirExists(generatedDir);

    const dateCachePath = path.join(
      generatedDir,
      getNoteViralOptionsDateCacheFile(date)
    );
    const latestCachePath = path.join(
      generatedDir,
      NOTE_VIRAL_OPTIONS_LATEST_CACHE_FILE
    );
    const dateCache = readCacheFile(dateCachePath);
    const latestCache = readCacheFile(latestCachePath);

    const liveOptions = await fetchLiveOptions(date);
    const fallbackOptions = buildFallbackNoteViralOptions(date);

    const merged = trimToLimit([
      ...liveOptions,
      ...(dateCache?.options || []),
      ...(latestCache?.options || []),
      ...fallbackOptions,
    ]);

    if (merged.length === 0) {
      return NextResponse.json(
        { error: "爆款候选の取得に失敗しました" },
        { status: 500 }
      );
    }

    const source: NoteViralOptionsCache["source"] =
      liveOptions.length > 0
        ? "live"
        : dateCache?.options?.length
        ? "cache"
        : "fallback";

    const payload: NoteViralOptionsCache = {
      date,
      updatedAt: new Date().toISOString(),
      source,
      options: merged,
    };
    writeCacheFile(dateCachePath, payload);
    writeCacheFile(latestCachePath, payload);

    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
