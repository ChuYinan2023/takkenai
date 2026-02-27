"use client";

import type { CalendarDay } from "@/lib/calendar-engine";
import type { GeneratedContent } from "@/lib/claude";
import ContentPageClient from "../[platform]/content-page-client";

export default function NoteViralPageClient({
  date,
  calendarDay,
  generatedContent,
  coverFile,
  coverFiles,
  inlineFile,
  inlineFiles,
}: {
  date: string;
  calendarDay: CalendarDay | null;
  generatedContent: GeneratedContent | null;
  coverFile: string | null;
  coverFiles: string[];
  inlineFile: string | null;
  inlineFiles: string[];
}) {
  return (
    <ContentPageClient
      date={date}
      platform="note"
      calendarDay={calendarDay}
      generatedContent={generatedContent}
      coverFile={coverFile}
      coverFiles={coverFiles}
      inlineFile={inlineFile}
      inlineFiles={inlineFiles}
      contentKey="note-viral"
      isNoteViralPage={true}
    />
  );
}
