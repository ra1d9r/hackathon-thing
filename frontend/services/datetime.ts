const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatSentAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (now.getTime() - date.getTime() < DAY_MS) {
    if (isSameDay(date, now)) return time;

    const yesterday = new Date(now.getTime() - DAY_MS);
    if (isSameDay(date, yesterday)) return `вчера, ${time}`;
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
