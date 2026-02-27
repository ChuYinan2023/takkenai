import {
  loadCalendarStore,
  type MonthCalendar,
  type CalendarStore,
} from "@/lib/calendar-engine";
import CalendarClient from "./calendar-client";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const store: CalendarStore = loadCalendarStore();

  // Find the most recent calendar, or default to current month
  const now = new Date();
  const initialNowIso = now.toISOString();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const currentCalendar =
    store.calendars.find(
      (c) => c.year === currentYear && c.month === currentMonth
    ) || null;

  return (
    <CalendarClient
      initialCalendar={currentCalendar}
      allCalendars={store.calendars}
      initialNowIso={initialNowIso}
    />
  );
}
