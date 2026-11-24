"use client";
import { useEffect, useRef, useState } from "react";
import type { TicketModel } from "@/lib/domain/stampticket";
import { dateText, timeText } from "@/lib/format";
import Link from "next/link";
import QrScanner from "./QrScanner";
import "./stamp.css";

type Notice = { sport: string | null; text: string };

const yen = (n: number) => n.toLocaleString("ja-JP");

function Ticket({ m, notice, animate }: { m: TicketModel; notice: Notice | null; animate: boolean }) {
  return (
    <div className={`st-ticket ${m.enabled ? "" : "off"}`} style={{ ["--accent" as string]: m.accent }} data-sport={m.sport}>
      <div className="st-main">
        <div className="st-band"><span>PLAYCE STAMP TICKET</span><span>{m.code}</span></div>
        <div className="st-body">
          <div>
            <div className="st-kicker">{m.kicker}</div>
            <div className="st-title">{m.label}<small>{m.en}</small></div>
          </div>
          {m.hasEvent ? (
            <div>
              <div className="st-price">
                <span className="st-yen">{yen(m.priceYen)}<small>円</small></span>
                {m.discountYen > 0 ? <><s>通常 {yen(m.baseFeeYen)}円</s><span className="st-badge">{m.discountYen}円引き</span></> : <span className="st-plain">通常料金</span>}
              </div>
              <div className="st-next">{m.nextText}</div>
            </div>
          ) : (
            <div>
              <div className="st-none">参加予定なし</div>
              <div className="st-next">この競技の、参加確定の申込がありません</div>
              {m.enabled && <div className="st-next">{m.nextText}</div>}
            </div>
          )}
          <dl className="st-info">
            <div><dt>開催日</dt><dd>{m.hasEvent && m.startAt ? `${dateText(m.startAt)} ${timeText(m.startAt)}〜` : "―"}</dd></div>
            <div><dt>会場</dt><dd>{m.hasEvent ? (m.venueHref ? <a href={m.venueHref} target="_blank" rel="noopener noreferrer" aria-label={`${m.venue}をGoogleマップで開く`} className="st-maplink">{m.venue}</a> : m.venue) : "―"}</dd></div>
            <div><dt>参加者</dt><dd>{m.hasEvent ? m.participant : "―"}</dd></div>
          </dl>
          {m.tapped && m.hasEvent && <span className={`st-admit ${animate ? "new" : ""}`}>THANK<br />YOU</span>}
        </div>
      </div>
      <div className="st-stub">
        <div className="st-head"><b>STAMPS</b><span>{m.points} / 5</span></div>
        <div className="st-slots">
          {m.slots.map((s) => (
            <div key={s.n} className={`st-slot ${s.on ? "on" : ""} ${s.tier ? "tier" : ""} ${animate && s.isNew ? "new" : ""}`}>
              <span className="n">{s.on ? "済" : s.n}</span><span className="t">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="st-bar"><div className="st-barcode" aria-hidden="true" /><div className="st-serial">No. {m.serial}</div></div>
      </div>
      {notice && <div className="st-notice" role="status">{notice.text}</div>}
      <div className="st-offmark"><span>スタンプカードはOFFです<small>メニューの「スタンプカード設定」でONにできます</small></span></div>
    </div>
  );
}

// チケットだけを全画面に表示する。バドミントンとバレーボールは左右にスワイプして切り替える。
export default function StampTickets({ models, initialSport, notice, animateSport }: { models: TicketModel[]; initialSport: string; notice: Notice | null; animateSport: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(Math.max(0, models.findIndex((m) => m.sport === initialSport)));
  const [note, setNote] = useState<Notice | null>(notice);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.scrollLeft = el.clientWidth * idx; // 最初に見せる競技(かざした競技)へ
    // 再読み込みでハンコの演出がもう一度流れないよう、結果の印を、アドレスから外す。
    if (location.search) history.replaceState(null, "", location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3400); return () => clearTimeout(t); }, [note]);

  return (
    <div className="st-screen">
      <div className="st-slides" ref={ref} onScroll={(e) => { const el = e.currentTarget; setIdx(Math.max(0, Math.min(models.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))))); }}>
        {models.map((m) => (
          <section key={m.sport} className="st-slide" aria-label={`${m.label}のチケット`}>
            <div className="st-wrap">
              <Ticket m={m} animate={animateSport === m.sport} notice={note && (note.sport === m.sport || (note.sport === null && m.sport === models[0].sport)) ? note : null} />
            </div>
          </section>
        ))}
      </div>
      <div className="st-pointslink"><Link href="/stamp/points">ポイント・クーポンを見る</Link></div>
      <QrScanner />
      <div className="st-dots" aria-hidden="true">{models.map((m, i) => <i key={m.sport} className={i === idx ? "on" : ""} />)}</div>
    </div>
  );
}
