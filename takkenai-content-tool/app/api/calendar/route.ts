import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateCalendar,
  regenerateCalendar,
  getCalendarDay,
  updatePlatformEntry,
  loadCalendarStore,
  type MonthCalendar,
  type ContentStatus,
} from "@/lib/calendar-engine";
import type { Platform } from "@/lib/topic-engine";
import {
  normalizeNoteArticleUrl,
  registerPublishedNoteUrl,
} from "@/lib/note-internal-link-pool";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const monthStr = searchParams.get("month");

  if (!yearStr || !monthStr) {
    return NextResponse.json(
      { error: "year と month は必須です" },
      { status: 400 }
    );
  }

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "無効な年月です" },
      { status: 400 }
    );
  }

  // Check if calendar exists for this month
  const store = loadCalendarStore();
  const existing = store.calendars.find(
    (c) => c.year === year && c.month === month
  );

  if (!existing) {
    // Return null-like response so the client can offer to generate
    return NextResponse.json(null);
  }

  // Re-load through engine to auto-refresh pending topics with latest rules.
  const calendar = getOrCreateCalendar(year, month);
  return NextResponse.json(calendar);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, month, regenerate } = body;

    if (!year || !month) {
      return NextResponse.json(
        { error: "year と month は必須です" },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return NextResponse.json(
        { error: "無効な年月です" },
        { status: 400 }
      );
    }

    let calendar: MonthCalendar;

    if (regenerate) {
      // Force regenerate (preserving generated content)
      calendar = regenerateCalendar(yearNum, monthNum, true);
    } else {
      // Get or create
      calendar = getOrCreateCalendar(yearNum, monthNum);
    }

    return NextResponse.json(calendar);
  } catch (err: unknown) {
    console.error("Calendar generation failed:", err);
    const message =
      err instanceof Error ? err.message : "不明なエラーが発生しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, platform, status, publishedUrl } = body as {
      date: string;
      platform: Platform;
      status: ContentStatus;
      publishedUrl?: string;
    };

    if (!date || !platform || !status) {
      return NextResponse.json(
        { error: "date, platform, status は必須です" },
        { status: 400 }
      );
    }

    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return NextResponse.json(
        { error: "不正な日付形式です" },
        { status: 400 }
      );
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    const calendarDay = getCalendarDay(year, month, day);
    if (!calendarDay) {
      return NextResponse.json(
        { error: "指定された日付のデータが見つかりません" },
        { status: 404 }
      );
    }

    const normalizedPublishedUrl = normalizeNoteArticleUrl(
      typeof publishedUrl === "string" ? publishedUrl : ""
    );
    if (
      status === "published" &&
      platform === "note" &&
      typeof publishedUrl === "string" &&
      publishedUrl.trim() &&
      !normalizedPublishedUrl
    ) {
      return NextResponse.json(
        { error: "publishedUrl は note.com の記事URLのみ指定できます" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    if (status === "published" && platform === "note" && normalizedPublishedUrl) {
      try {
        const sourceEntry = calendarDay.platforms.note;
        registerPublishedNoteUrl({
          url: normalizedPublishedUrl,
          title: sourceEntry.generatedTitle || sourceEntry.titleSuggestion || "",
          date,
          publishedAt: nowIso,
          contentKey: "standard",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "note URL の登録に失敗しました";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const result = updatePlatformEntry(year, month, day, platform, {
      status,
      ...(status === "published"
        ? {
            publishedAt: nowIso,
            ...(platform === "note" && normalizedPublishedUrl
              ? { publishedUrl: normalizedPublishedUrl }
              : {}),
          }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "指定された日付のデータが見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, day: result });
  } catch (err: unknown) {
    console.error("Calendar update failed:", err);
    const message =
      err instanceof Error ? err.message : "不明なエラーが発生しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
