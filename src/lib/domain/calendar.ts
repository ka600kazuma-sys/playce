// カレンダー計算(純粋関数)。月は 1〜12、日付キーは "YYYY-MM-DD"。
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const pad = (n: number) => String(n).padStart(2, "0");
export const toKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const shiftYm = (y: number, m: number, delta: number) => {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
export const ymText = (y: number, m: number) => `${y}-${pad(m)}`;

// 日曜始まりの週配列。範囲外は null。
export function monthGrid(y: number, m: number): (number | null)[][] {
  const cells: (number | null)[] = [...Array<null>(weekdayOf(y, m, 1)).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const nthMonday = (y: number, m: number, n: number) => 1 + ((8 - weekdayOf(y, m, 1)) % 7) + 7 * (n - 1);
const vernal = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnal = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

// 祝日(1980〜2099年に対応。国民の休日・振替休日を含む)。{ "YYYY-MM-DD": 名称 }
export function holidaysOf(y: number): Record<string, string> {
  const h: Record<string, string> = {};
  const add = (m: number, d: number, name: string) => { h[toKey(y, m, d)] = name; };
  add(1, 1, "元日"); add(1, nthMonday(y, 1, 2), "成人の日"); add(2, 11, "建国記念の日"); if (y >= 2020) add(2, 23, "天皇誕生日");
  add(3, vernal(y), "春分の日"); add(4, 29, "昭和の日"); add(5, 3, "憲法記念日"); add(5, 4, "みどりの日"); add(5, 5, "こどもの日");
  add(7, nthMonday(y, 7, 3), "海の日"); add(8, 11, "山の日"); add(9, nthMonday(y, 9, 3), "敬老の日"); add(9, autumnal(y), "秋分の日");
  add(10, nthMonday(y, 10, 2), "スポーツの日"); add(11, 3, "文化の日"); add(11, 23, "勤労感謝の日");
  for (const k of Object.keys(h)) { // 国民の休日(祝日に挟まれた平日)
    const [, m, d] = k.split("-").map(Number);
    const mid = toKey(y, m, d + 1), after = toKey(y, m, d + 2);
    if (h[after] && !h[mid] && d + 2 <= daysInMonth(y, m) && weekdayOf(y, m, d + 1) !== 0) h[mid] = "国民の休日";
  }
  for (const k of Object.keys(h)) { // 振替休日(日曜の祝日 → 次の祝日でない日)
    const [, m, d] = k.split("-").map(Number);
    if (weekdayOf(y, m, d) !== 0) continue;
    let t = new Date(Date.UTC(y, m - 1, d + 1));
    const key = (x: Date) => toKey(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
    while (h[key(t)]) t = new Date(t.getTime() + 864e5);
    if (t.getUTCFullYear() === y) h[key(t)] = "振替休日";
  }
  return h;
}

export function dateLabel(y: number, m: number, d: number) {
  const hol = holidaysOf(y)[toKey(y, m, d)];
  return `${m}月${d}日(${WEEKDAYS[weekdayOf(y, m, d)]}${hol ? "・祝" : ""})`;
}
