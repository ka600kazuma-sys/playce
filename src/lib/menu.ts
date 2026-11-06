// 左メニューの定義。ready=false は「準備中」画面(未実装の機能を動作済みに見せない)。
// 主催者向けの項目は表示の出し分けだけで、保護はサーバー側(requireAdmin)が行う。
export type MenuItem = { id: string; label: string; icon: string; href?: string; ready?: boolean; badge?: string; divider?: boolean };

const ALL: MenuItem[] = [
  { id: "calendar", label: "カレンダー", icon: "calendar", href: "/", ready: true },
  { id: "mine", label: "自分の参加予定", icon: "check", href: "/me", ready: true },
  { id: "record", label: "対戦成績", icon: "chart", href: "/soon/record", ready: false, badge: "任意" },
  { id: "notices", label: "お知らせ", icon: "bell", href: "/soon/notices", ready: false },
  { id: "contact", label: "主催者への連絡", icon: "mail", href: "/soon/contact", ready: false },
  { id: "div", label: "", icon: "", divider: true },
  { id: "settings", label: "設定", icon: "gear", href: "/soon/settings", ready: false },
];
const ADMIN: MenuItem = { id: "admin", label: "主催者メニュー", icon: "shield", href: "/admin", ready: true };
export const LOGIN: MenuItem = { id: "login", label: "主催者ログイン", icon: "user", href: "/admin/login", ready: true };

export const visibleMenu = (isAdmin: boolean): MenuItem[] => [...ALL, ...(isAdmin ? [ADMIN] : [LOGIN])];
export const SOON_TITLES: Record<string, { title: string; note: string }> = {
  record: { title: "対戦成績", note: "対戦成績は、見たい人だけが利用できる任意の機能です。ログインと保存の仕組みが整い次第、提供します。" },
  notices: { title: "お知らせ", note: "開催の変更や中止のお知らせは、準備ができ次第こちらに表示します。" },
  contact: { title: "主催者への連絡", note: "主催者へのメッセージ機能は準備中です。" },
  settings: { title: "設定", note: "通知などの設定は準備中です。" },
};
