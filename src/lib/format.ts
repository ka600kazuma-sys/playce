const TZ = "Asia/Tokyo";
export const ymd = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso)); // YYYY-MM-DD
export const dateText = (iso: string) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "long", day: "numeric", weekday: "short" }).format(new Date(iso));
export const timeText = (iso: string) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: false }).format(new Date(iso));

// <input type="datetime-local"> は日本時間の「YYYY-MM-DDTHH:mm」。ISO(+09:00)と相互変換する。
export const toLocalInput = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
export const fromLocalInput = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+09:00` : "");
