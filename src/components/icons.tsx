// 固定のSVGアイコン(ユーザー入力を含まない)。
const P: Record<string, React.ReactNode> = {
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  check: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M8.5 14l2.5 2.5 4.5-5" /></>,
  chart: <><rect x="3.5" y="13" width="4" height="7" /><rect x="10" y="4" width="4" height="16" /><rect x="16.5" y="9" width="4" height="11" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3.5 7l8.5 6.5L20.5 7" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1-4 4-5.5 7.5-5.5s6.5 1.5 7.5 5.5" /></>,
  shield: <path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6z" />,
  pin: <><path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  yen: <path d="M6 4l6 8 6-8M12 12v8M7.5 13.5h9M7.5 17h9" />,
  prev: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
};

export function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {P[name]}
    </svg>
  );
}
