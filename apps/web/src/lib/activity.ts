type ActivityDay = { date: string; count: number };

export function buildMonthLabels(activity: ActivityDay[], locale: string) {
  const weekStarts = activity.filter((_, index) => index % 7 === 0);
  let previousMonth = "";
  return weekStarts.map((day) => {
    const date = new Date(`${day.date}T12:00:00Z`);
    const month = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    }).format(date);
    if (month === previousMonth) return { date: day.date, label: "" };
    previousMonth = month;
    return { date: day.date, label: month };
  });
}
