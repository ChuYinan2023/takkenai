import fs from "fs";
import path from "path";
import { getCalendarDay, type CalendarDay } from "@/lib/calendar-engine";
import type { GeneratedContent } from "@/lib/claude";
import NoteViralPageClient from "./note-viral-page-client";
import {
  getGeneratedContentFilename,
  getGeneratedImagePrefix,
} from "@/lib/content-variant";

export const dynamic = "force-dynamic";

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

function loadGeneratedContent(date: string): GeneratedContent | null {
  const filePath = path.join(
    process.cwd(),
    "data",
    "generated",
    getGeneratedContentFilename(date, "note", "note-viral")
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
  imageType: "cover" | "inline"
): string[] {
  const generatedDir = path.join(process.cwd(), "data", "generated");
  if (!fs.existsSync(generatedDir)) return [];

  const prefix = getGeneratedImagePrefix(date, "note", imageType, "note-viral");
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

export default async function NoteViralPage({
  params,
}: {
  params: { date: string };
}) {
  const { date } = params;
  const parsed = parseDateString(date);

  if (!parsed) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500">不正な日付形式: {date}</p>
      </div>
    );
  }

  const calendarDay: CalendarDay | undefined = getCalendarDay(
    parsed.year,
    parsed.month,
    parsed.day
  );

  const generatedContent = loadGeneratedContent(date);
  const coverFiles = listImageFiles(date, "cover");
  const coverFile = coverFiles[0] || null;
  const inlineFiles = listImageFiles(date, "inline");
  const inlineFile = inlineFiles[0] || null;

  return (
    <NoteViralPageClient
      date={date}
      calendarDay={calendarDay || null}
      generatedContent={generatedContent}
      coverFile={coverFile}
      coverFiles={coverFiles}
      inlineFile={inlineFile}
      inlineFiles={inlineFiles}
    />
  );
}
