import test from "node:test";
import assert from "node:assert/strict";
import { ZOOM_MAX, ZOOM_MIN, clampCrop, coverScale, initialCrop, panBy, rotateBy, sliderToZoom, transformFor, zoomBy, zoomToSlider } from "../src/lib/domain/photoCrop.ts";

const W = 400, H = 200, F = 100; // 横長の写真、枠100

test("拡大率1は、枠をちょうど埋める大きさ(短い辺に合わせる)。回転しても同じ。動かせる範囲は、回転で縦横が入れ替わる", () => {
  assert.equal(coverScale(W, H, 0, F), 0.5);  // 短い辺(高さ200)を枠100に合わせる
  assert.equal(coverScale(W, H, 90, F), 0.5); // 回転しても、短い辺に合わせるので同じ
  assert.equal(coverScale(100, 100, 0, F), 1);
  const r0 = panBy(initialCrop(), 9, 9, W, H, F), r90 = panBy({ ...initialCrop(), rot: 90 }, 9, 9, W, H, F);
  assert.deepEqual([r0.dx, r0.dy], [1, 0.5]);   // 横長のまま: 横に大きく動かせる
  assert.deepEqual([r90.dx, r90.dy], [0.5, 1]); // 90度回すと縦長: 縦に大きく動かせる
});

test("初期状態: 写真の中心が枠の中心(位置のずれなし)", () => {
  const t = transformFor(initialCrop(), W, H, F);
  assert.deepEqual([t.scale, t.tx, t.ty, t.angle], [0.5, 50, 50, 0]);
});

test("拡大縮小: 範囲(0.4〜5倍)に収まる。数でないものは1として扱う", () => {
  assert.equal(zoomBy(initialCrop(), 100, W, H, F).zoom, ZOOM_MAX);
  assert.equal(zoomBy(initialCrop(), 0.0001, W, H, F).zoom, ZOOM_MIN);
  assert.equal(clampCrop({ ...initialCrop(), zoom: NaN }, W, H, F).zoom, 1);
  assert.equal(clampCrop({ ...initialCrop(), zoom: Infinity }, W, H, F).zoom, 1, "数として扱えない値は1");
});

test("移動: 自由に動かせるが、写真の外へ出すぎない(枠の中心が写真の外に出ない)", () => {
  // 拡大率1: 写真は 200x100(枠100)。中心が写真の内側にとどまる範囲: 横 ±1.0(枠の割合)、縦 ±0.5
  const c = panBy(initialCrop(), 5, -5, W, H, F);
  assert.equal(c.dx, 1); assert.equal(c.dy, -0.5);
  const small = panBy(zoomBy(initialCrop(), 0.4, W, H, F), 9, 9, W, H, F); // 縮小すると、動かせる範囲も狭い
  assert.ok(Math.abs(small.dx) <= 0.4 && Math.abs(small.dy) <= 0.2, JSON.stringify(small));
  assert.deepEqual([panBy(initialCrop(), NaN, NaN, W, H, F).dx, panBy(initialCrop(), NaN, NaN, W, H, F).dy], [0, 0]);
});

test("回転: 90度ずつ、4回で元に戻る。回転後も範囲に収まる", () => {
  let c = initialCrop();
  for (const r of [90, 180, 270, 0]) { c = rotateBy(c, 1, W, H, F); assert.equal(c.rot, r); }
  assert.equal(rotateBy(initialCrop(), -1, W, H, F).rot, 270);
  const moved = panBy(initialCrop(), 1, 0.5, W, H, F), rotated = rotateBy(moved, 1, W, H, F);
  const t = transformFor(rotated, W, H, F);
  assert.equal(t.angle, Math.PI / 2);
  assert.ok(Math.abs(rotated.dx) <= 0.5 * 2 * (coverScale(W, H, 90, F) * 200) / 100 + 1e-9);
});

test("スライダーと拡大率の対応(対数): 端と1倍、往復", () => {
  assert.equal(zoomToSlider(ZOOM_MIN), 0); assert.equal(zoomToSlider(ZOOM_MAX), 100);
  assert.ok(Math.abs(sliderToZoom(0) - ZOOM_MIN) < 1e-9 && Math.abs(sliderToZoom(100) - ZOOM_MAX) < 1e-9);
  for (const z of [0.5, 1, 2, 4]) assert.ok(Math.abs(sliderToZoom(zoomToSlider(z)) / z - 1) < 0.05, String(z));
});

test("出力は枠の大きさに依存しない(同じ割合で動く)", () => {
  const c = panBy(zoomBy(initialCrop(), 2, W, H, 100), 0.1, -0.2, W, H, 100);
  const a = transformFor(c, W, H, 100), b = transformFor(c, W, H, 256);
  assert.ok(Math.abs(a.tx / 100 - b.tx / 256) < 1e-12 && Math.abs(a.ty / 100 - b.ty / 256) < 1e-12);
  assert.ok(Math.abs(b.scale / a.scale - 2.56) < 1e-9, "拡大率は枠の大きさに比例");
});
