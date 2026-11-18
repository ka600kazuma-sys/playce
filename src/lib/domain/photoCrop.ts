// プロフィール写真の調整(移動・拡大縮小・回転)の計算。画面(canvas)に依存しない純粋関数。
// 枠は正方形(出力は 256px 四方)。位置のずれ dx, dy は「枠の一辺に対する割合」で持つので、プレビューと出力で同じ見た目になる。
// zoom=1 は「枠をちょうど埋める大きさ(はみ出す辺は切れる)」。1より小さいと、写真全体が枠に収まり、余白は白になる。
export type Rot = 0 | 90 | 180 | 270;
export type Crop = { zoom: number; dx: number; dy: number; rot: Rot };

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 5;
export const initialCrop = (): Crop => ({ zoom: 1, dx: 0, dy: 0, rot: 0 });

const dims = (w: number, h: number, rot: Rot) => (rot === 90 || rot === 270 ? { iw: h, ih: w } : { iw: w, ih: h });
export function coverScale(w: number, h: number, rot: Rot, frame: number): number {
  const { iw, ih } = dims(w, h, rot);
  return Math.max(frame / iw, frame / ih);
}

// 範囲に収める: 拡大率は ZOOM_MIN〜ZOOM_MAX。写真を、枠の中心が写真の外に出るほど動かせない(写真を見失わない)。
export function clampCrop(c: Crop, w: number, h: number, frame: number): Crop {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(c.zoom) ? c.zoom : 1));
  const { iw, ih } = dims(w, h, c.rot);
  const s = coverScale(w, h, c.rot, frame) * zoom;
  const mx = (iw * s) / (2 * frame), my = (ih * s) / (2 * frame);
  const cl = (v: number, m: number) => Math.min(m, Math.max(-m, Number.isFinite(v) ? v : 0));
  return { zoom, dx: cl(c.dx, mx), dy: cl(c.dy, my), rot: c.rot };
}

// 描画の変換: 写真の中心を (tx, ty) に置き、angle 回転し、scale 倍する。
export function transformFor(c: Crop, w: number, h: number, frame: number) {
  return { scale: coverScale(w, h, c.rot, frame) * c.zoom, tx: frame * (0.5 + c.dx), ty: frame * (0.5 + c.dy), angle: (c.rot * Math.PI) / 180 };
}

export const panBy = (c: Crop, fx: number, fy: number, w: number, h: number, frame: number) => clampCrop({ ...c, dx: c.dx + fx, dy: c.dy + fy }, w, h, frame);
export const zoomBy = (c: Crop, factor: number, w: number, h: number, frame: number) => clampCrop({ ...c, zoom: c.zoom * factor }, w, h, frame);
export const rotateBy = (c: Crop, dir: 1 | -1, w: number, h: number, frame: number) => clampCrop({ ...c, rot: ((c.rot + 90 * dir + 360) % 360) as Rot }, w, h, frame);

// スライダー(0〜100)と拡大率の対応(対数。小さい側も大きい側も、同じ感覚で動かせる)。
export const zoomToSlider = (zoom: number) => Math.round((100 * Math.log(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) / ZOOM_MIN)) / Math.log(ZOOM_MAX / ZOOM_MIN));
export const sliderToZoom = (v: number) => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Math.min(100, Math.max(0, v)) / 100);
