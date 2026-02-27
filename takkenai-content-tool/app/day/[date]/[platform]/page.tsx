import fs from "fs";
import path from "path";
import { getCalendarDay, type CalendarDay } from "@/lib/calendar-engine";
import type { GeneratedContent } from "@/lib/claude";
import ContentPageClient from "./content-page-client";
import {
  getGeneratedContentFilename,
  getGeneratedImagePrefix,
  type ContentKey,
} from "@/lib/content-variant";

export const dynamic = "force-dynamic";

type Platform = "ameba" | "note" | "hatena";

function parseDateString(dateStr: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  };
}

function loadGeneratedContent(
  date: string,
  platform: Platform,
  contentKey: ContentKey
): GeneratedContent | null {
  const filePath = path.join(
    process.cwd(),
    "data",
    "generated",
    getGeneratedContentFilename(date, platform, contentKey)
  );
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as GeneratedContent;
    }
  } catch {
    // ignore
  }
  return null;
}

function listImageFiles(
  date: string,
  platform: Platform,
  imageType: "cover" | "inline",
  contentKey: ContentKey
): string[] {
  const generatedDir = path.join(process.cwd(), "data", "generated");
  if (!fs.existsSync(generatedDir)) return [];

  const prefix = getGeneratedImagePrefix(date, platform, imageType, contentKey);
  return fs
    .readdirSync(generatedDir)
    .filter((file) => file.startsWith(prefix))
    .filter((file) => /\.(png|jpg|webp)$/i.test(file))
    .sort((a, b) => {
      const aPath = path.join(generatedDir, a);
      const bPath = path.join(generatedDir, b);
      const aMtime = fs.statSync(aPath).mtimeMs;
      const bMtime = fs.statSync(bPath).mtimeMs;
      return bMtime - aMtime;
    });
}

export default async function ContentPage({
  params,
}: {
  params: { date: string; platform: string };
}) {
  const { date, platform } = params;

  if (!["ameba", "note", "hatena"].includes(platform)) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500">
          不正なプラットフォーム: {platform}
        </p>
      </div>
    );
  }

  const parsed = parseDateString(date);
  let calendarDay: CalendarDay | undefined;
  if (parsed) {
    calendarDay = getCalendarDay(parsed.year, parsed.month, parsed.day);
  }

  const typedPlatform = platform as Platform;
  const generatedContent = loadGeneratedContent(date, typedPlatform, "standard");
  const coverFiles = listImageFiles(date, typedPlatform, "cover", "standard");
  const coverFile = coverFiles[0] || null;
  const inlineFiles = listImageFiles(date, typedPlatform, "inline", "standard");
  const inlineFile = inlineFiles[0] || null;

  return (
    <ContentPageClient
      date={date}
      platform={typedPlatform}
      calendarDay={calendarDay || null}
      generatedContent={generatedContent}
      coverFile={coverFile}
      coverFiles={coverFiles}
      inlineFile={inlineFile}
      inlineFiles={inlineFiles}
      contentKey="standard"
      isNoteViralPage={false}
    />
  );
}
