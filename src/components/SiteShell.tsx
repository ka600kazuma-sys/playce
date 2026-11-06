"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { visibleMenu, type MenuItem } from "@/lib/menu";

// 参加者向け画面の共通枠: 上部バー+左スライドメニュー。下部の固定ナビは設けない。
// 閉じ方: ×ボタン / 背景タップ / 左スワイプ / Esc / 項目選択。管理画面(/admin)は独自レイアウトのため枠を出さない。
export function SiteShell({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number; dx: number; lock: "x" | "y" | null } | null>(null);
  const [lastPath, setLastPath] = useState(pathname);

  // 画面が切り替わったら閉じる(項目選択後)。レンダー中の状態調整で行う。
  if (pathname !== lastPath) { setLastPath(pathname); setOpen(false); }

  const close = useCallback(() => { setOpen(false); setDrag(0); }, []);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); openerRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (pathname.startsWith("/admin")) return <>{children}</>;

  const items = visibleMenu(isAdmin);
  const footer = items.find((i) => i.id === "login");
  const list = items.filter((i) => i.id !== "login");
  const current = (i: MenuItem) => i.href === "/" ? pathname === "/" : !!i.href && pathname.startsWith(i.href);

  const onStart = (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, dx: 0, lock: null }; };
  const onMove = (e: React.TouchEvent) => {
    const s = touch.current; if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.lock && Math.hypot(dx, dy) > 8) s.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (s.lock === "x") { s.dx = Math.min(0, dx); setDrag(s.dx); }
  };
  const onEnd = () => { const s = touch.current; touch.current = null; if (s?.lock === "x" && s.dx < -60) { close(); openerRef.current?.focus(); } else setDrag(0); };

  return (
    <>
      <div inert={open} className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-6">
        <header className="grid grid-cols-[48px_1fr_48px] items-center border-b border-line pb-2 pt-[max(8px,env(safe-area-inset-top))]">
          <button ref={openerRef} type="button" aria-label="メニューを開く" aria-expanded={open} aria-controls="site-drawer" onClick={() => setOpen(true)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-tint"><Icon name="menu" /></button>
          <Link href="/" className="text-center font-serif text-[22px] font-bold tracking-[.24em] text-ink">PLAYCE</Link>
          <Link href="/soon/notices" aria-label="お知らせ" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-tint"><Icon name="bell" /></Link>
        </header>
        <div className="flex-1">{children}</div>
      </div>

      <div onClick={close} aria-hidden="true" className={`fixed inset-0 z-10 bg-[rgba(10,18,40,.45)] transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <nav
        id="site-drawer" aria-label="メニュー" aria-hidden={!open} inert={!open}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}
        style={{ transform: open ? `translateX(${drag}px)` : "translateX(-102%)", transition: drag ? "none" : undefined }}
        className={`fixed inset-y-0 left-0 z-20 flex w-[min(86vw,360px)] flex-col overflow-y-auto rounded-r-3xl bg-white px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(10px,env(safe-area-inset-top))] transition-transform duration-300 motion-reduce:transition-none ${open ? "shadow-[0_10px_40px_rgba(15,40,90,.18)]" : "invisible"}`}
      >
        <div className="flex items-center justify-between pb-3 pl-3 pr-1">
          <span className="font-serif text-[22px] font-bold tracking-[.24em] text-ink">PLAYCE</span>
          <button ref={closeRef} type="button" aria-label="メニューを閉じる" onClick={() => { close(); openerRef.current?.focus(); }} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-tint"><Icon name="close" /></button>
        </div>
        <p className="mx-3 mb-1.5 mt-2 font-serif text-[15px] tracking-widest text-soft">メニュー</p>
        <ul className="grid gap-0.5">
          {list.map((i) => i.divider
            ? <li key={i.id}><hr className="mx-3 my-3.5 border-line" /></li>
            : <li key={i.id}><MenuLink item={i} current={current(i)} onPick={close} /></li>)}
        </ul>
        {footer && <div className="mt-auto border-t border-line pt-2.5"><MenuLink item={footer} current={current(footer)} onPick={close} muted /></div>}
      </nav>
    </>
  );
}

function MenuLink({ item, current, muted, onPick }: { item: MenuItem; current: boolean; muted?: boolean; onPick: () => void }) {
  return (
    <Link href={item.href ?? "/"} onClick={onPick} aria-current={current ? "page" : undefined}
      className={`flex min-h-[52px] items-center gap-4 rounded-2xl px-4 py-2 ${muted ? "text-base text-soft" : "font-serif text-lg"} ${current ? "bg-tint font-bold text-navy" : "hover:bg-tint"}`}>
      <Icon name={item.icon} />
      {item.label}
      {item.badge && <span className="rounded-full bg-line px-2.5 py-0.5 font-sans text-xs text-soft">{item.badge}</span>}
      {item.ready === false && <span className="ml-auto font-sans text-[11px] text-soft">準備中</span>}
    </Link>
  );
}
