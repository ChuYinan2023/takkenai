"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type {
  MonthCalendar,
  CalendarDay,
  ContentStatus,
} from "@/lib/calendar-engine";
import { formatAssetIdLabel } from "@/lib/topic-label";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const PLATFORM_COLORS = {
  ameba: {
    filled: "bg-green-500",
    empty: "bg-green-500/20 border border-green-400",
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    badge: "bg-green-100 text-green-800",
    label: "Ameba",
  },
  note: {
    filled: "bg-yellow-500",
    empty: "bg-yellow-500/20 border border-yellow-400",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-700",
    badge: "bg-yellow-100 text-yellow-800",
    label: "note",
  },
  hatena: {
    filled: "bg-blue-500",
    empty: "bg-blue-500/20 border border-blue-400",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-800",
    label: "はてな",
  },
} as const;

type Platform = keyof typeof PLATFORM_COLORS;

const STATUS_LABELS: Record<ContentStatus, string> = {
  pending: "未生成",
  generated: "生成済み",
  reviewed: "レビュー済み",
  published: "公開済み",
  skipped: "スキップ",
};

const STATUS_BADGE_COLORS: Record<ContentStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  generated: "bg-emerald-100 text-emerald-700",
  reviewed: "bg-blue-100 text-blue-700",
  published: "bg-purple-100 text-purple-700",
  skipped: "bg-gray-100 text-gray-400",
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTodayStringFromDate(value: Date): string {
  return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function resolveInitialNow(iso: string): Date {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function isPlatformDone(day: CalendarDay, platform: Platform): boolean {
  const status = day.platforms[platform].status;
  return (
    status === "generated" ||
    status === "reviewed" ||
    status === "published"
  );
}

function getPlatformHeadline(day: CalendarDay, platform: Platform): string {
  const entry = day.platforms[platform];
  if (entry.generatedTitle && isPlatformDone(day, platform)) {
    return entry.generatedTitle;
  }
  return entry.titleSuggestion;
}

function getAssetLabel(day: CalendarDay, platform: Platform = "ameba"): string {
  const mt = day.motherTopics?.[platform];
  if (!mt) return "";
  return formatAssetIdLabel(
    mt.assetId,
    mt.assetType as "knowledge-point" | "tool" | "past-question"
  );
}

export default function CalendarClient({
  initialCalendar,
  allCalendars,
  initialNowIso,
}: {
  initialCalendar: MonthCalendar | null;
  allCalendars: MonthCalendar[];
  initialNowIso: string;
}) {
  const initialNow = resolveInitialNow(initialNowIso);
  const initialTodayStr = getTodayStringFromDate(initialNow);
  const [currentYear, setCurrentYear] = useState(() => initialNow.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => initialNow.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string>(() => initialTodayStr);
  const [todayStr, setTodayStr] = useState<string>(() => initialTodayStr);
  const [calendar, setCalendar] = useState<MonthCalendar | null>(
    initialCalendar
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchCalendar = useCallback(
    async (year: number, month: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/calendar?year=${year}&month=${month}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.days) {
            setCalendar(data);
          } else {
            setCalendar(null);
          }
        } else {
          setCalendar(null);
        }
      } catch (err) {
        console.error("Failed to fetch calendar:", err);
        setCalendar(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const generateCalendar = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: currentYear, month: currentMonth }),
      });
      if (res.ok) {
        const data = await res.json();
        setCalendar(data);
      } else {
        const err = await res.json();
        alert(`カレンダー生成に失敗しました: ${err.error || "不明なエラー"}`);
      }
    } catch (err) {
      console.error("Failed to generate calendar:", err);
      alert("カレンダー生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!initialCalendar) {
      fetchCalendar(currentYear, currentMonth);
    }
  }, []);

  useEffect(() => {
    setTodayStr(getTodayStringFromDate(new Date()));
  }, []);

  const navigateMonth = (direction: -1 | 1) => {
    let newMonth = currentMonth + direction;
    let newYear = currentYear;
    if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    }
    setCurrentYear(newYear);
    setCurrentMonth(newMonth);
    fetchCalendar(newYear, newMonth);
  };

  // Build day lookup from calendar
  const dayLookup: Record<string, CalendarDay> = {};
  if (calendar) {
    for (const day of calendar.days) {
      dayLookup[day.date] = day;
    }
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);

  const selectedDay: CalendarDay | null = dayLookup[selectedDate] || null;

  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(d);
  }

  return (
    <div className="space-y-6">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateMonth(-1)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          &#8592; 前月
        </button>
        <h2 className="text-2xl font-bold text-gray-900">
          {currentYear}年 {currentMonth}月
        </h2>
        <button
          onClick={() => navigateMonth(1)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          翌月 &#8594;
        </button>
      </div>

      {/* Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          <span className="ml-3 text-gray-600">読み込み中...</span>
        </div>
      ) : !calendar ? (
        <div className="text-center py-20 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">
            {currentYear}年{currentMonth}月のカレンダーデータがありません
          </p>
          <button
            onClick={generateCalendar}
            disabled={generating}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                生成中...
              </span>
            ) : (
              "カレンダーを生成する"
            )}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {WEEKDAYS.map((day, i) => (
              <div
                key={day}
                className={`py-2 text-center text-sm font-medium ${
                  i === 0
                    ? "text-red-500"
                    : i === 6
                      ? "text-blue-500"
                      : "text-gray-600"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {calendarCells.map((day, idx) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="h-20 border-b border-r border-gray-100 bg-gray-50/50"
                  />
                );
              }

              const dateStr = formatDate(currentYear, currentMonth, day);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const calDay = dayLookup[dateStr];
              const dayOfWeek = new Date(
                currentYear,
                currentMonth - 1,
                day
              ).getDay();

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`h-20 border-b border-r border-gray-100 p-1.5 text-left transition-colors hover:bg-gray-50 ${
                    isSelected
                      ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-sm font-medium ${
                        isToday
                          ? "bg-indigo-600 text-white rounded-full w-6 h-6 flex items-center justify-center"
                          : dayOfWeek === 0
                            ? "text-red-500"
                            : dayOfWeek === 6
                              ? "text-blue-500"
                              : "text-gray-700"
                      }`}
                    >
                      {day}
                    </span>
                  </div>

                  {calDay && (
                    <div className="mt-1">
                      <div className="flex gap-1 mb-1">
                        {(["ameba", "note", "hatena"] as const).map(
                          (platform) => (
                            <div
                              key={platform}
                              className={`w-2.5 h-2.5 rounded-full ${
                                isPlatformDone(calDay, platform)
                                  ? PLATFORM_COLORS[platform].filled
                                  : PLATFORM_COLORS[platform].empty
                              }`}
                              title={`${PLATFORM_COLORS[platform].label}: ${
                                isPlatformDone(calDay, platform)
                                  ? "完了"
                                  : "未生成"
                              }`}
                            />
                          )
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 truncate leading-tight">
                        {calDay.motherTopics?.ameba?.assetType === "past-question"
                          ? getPlatformHeadline(calDay, "ameba").slice(0, 20)
                          : getAssetLabel(calDay, "ameba")}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">凡例:</span>
        {(["ameba", "note", "hatena"] as const).map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span
              className={`w-2.5 h-2.5 rounded-full ${PLATFORM_COLORS[p].filled}`}
            />
            {PLATFORM_COLORS[p].label}
          </span>
        ))}
        <span className="text-gray-400">|</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /> =
          生成済み
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300/30 border border-gray-300" />{" "}
          = 未生成
        </span>
      </div>

      {/* Selected Day Details */}
      {selectedDate && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {selectedDate}
              </h3>
              {selectedDay ? (
                <p className="text-sm text-gray-500 mt-1">
                  各プラットフォームに異なるトピックを配信
                </p>
              ) : (
                <p className="text-sm text-gray-400 mt-1">
                  この日のデータはありません
                </p>
              )}
            </div>
            {selectedDay && (
              <Link
                href={`/day/${selectedDate}`}
                className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 transition-colors"
              >
                日別ページを開く &#8594;
              </Link>
            )}
          </div>

          {selectedDay && (
            <div className="grid grid-cols-3 gap-4">
              {(["ameba", "note", "hatena"] as const).map((platform) => {
                const pEntry = selectedDay.platforms[platform];
                const colors = PLATFORM_COLORS[platform];

                return (
                  <div
                    key={platform}
                    className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-bold ${colors.text}`}>
                        {colors.label}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          STATUS_BADGE_COLORS[pEntry.status]
                        }`}
                      >
                        {STATUS_LABELS[pEntry.status]}
                      </span>
                    </div>
                    {selectedDay.motherTopics?.[platform] && (
                      <p className="text-xs text-gray-500 mb-1">
                        {selectedDay.motherTopics[platform].assetType === "knowledge-point"
                          ? "知識ポイント"
                          : selectedDay.motherTopics[platform].assetType === "tool"
                            ? "ツール"
                            : "過去問"}
                        : {getAssetLabel(selectedDay, platform)}
                      </p>
                    )}
                    <p className="text-sm text-gray-800 font-medium mb-3 line-clamp-2">
                      {selectedDay
                        ? getPlatformHeadline(selectedDay, platform)
                        : pEntry.titleSuggestion}
                    </p>
                    <Link
                      href={`/day/${selectedDate}/${platform}`}
                      className={`block text-center text-sm font-medium py-1.5 rounded-md ${colors.text} bg-white border ${colors.border} hover:opacity-80 transition-opacity`}
                    >
                      Open
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
