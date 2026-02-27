import Link from "next/link";
import {
  getCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-engine";
import DayOverviewClient from "./day-overview-client";

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

export default async function DayPage({
  params,
}: {
  params: { date: string };
}) {
  const { date } = params;
  const parsed = parseDateString(date);

  if (!parsed) {
    return (
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          &#8592; カレンダーに戻る
        </Link>
        <div className="text-center py-20 bg-white rounded-lg border border-gray-200">
          <p className="text-red-500">
            不正な日付形式: {date}
          </p>
          <Link
            href="/"
            className="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
          >
            カレンダーに戻る
          </Link>
        </div>
      </div>
    );
  }

  const calendarDay = getCalendarDay(parsed.year, parsed.month, parsed.day);

  if (!calendarDay) {
    return (
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          &#8592; カレンダーに戻る
        </Link>
        <div className="text-center py-20 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">
            {date} のデータが見つかりません
          </p>
          <Link
            href="/"
            className="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
          >
            カレンダーに戻る
          </Link>
        </div>
      </div>
    );
  }

  return <DayOverviewClient date={date} calendarDay={calendarDay} />;
}
