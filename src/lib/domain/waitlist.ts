const HOUR = 60 * 60 * 1000;

// キャンセル待ち繰上げ時の回答期限(docs/spec.md §2)。
// 通常24時間、開催24時間以内は最大6時間、開催6時間以内は最大1時間。開始時刻は超えない。
export function waitlistDeadline(now: Date, eventStart: Date): Date {
  const untilStart = eventStart.getTime() - now.getTime();
  if (untilStart <= 0) return now;
  const limit = untilStart <= 6 * HOUR ? 1 * HOUR : untilStart <= 24 * HOUR ? 6 * HOUR : 24 * HOUR;
  return new Date(Math.min(now.getTime() + limit, eventStart.getTime()));
}
