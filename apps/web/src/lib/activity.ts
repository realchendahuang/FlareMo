type ActivityDay = { date: string; count: number };

const monthFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getMonthFormatter(locale: string) {
  let formatter = monthFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    });
    monthFormatterCache.set(locale, formatter);
  }
  return formatter;
}

export function buildMonthLabels(activity: ActivityDay[], locale: string) {
  const weekStarts = activity.filter((_, index) => index % 7 === 0);
  const formatter = getMonthFormatter(locale);
  let previousMonth = "";
  return weekStarts.map((day) => {
    const date = new Date(`${day.date}T12:00:00Z`);
    const month = formatter.format(date);
    if (month === previousMonth) return { date: day.date, label: "" };
    previousMonth = month;
    return { date: day.date, label: month };
  });
}
