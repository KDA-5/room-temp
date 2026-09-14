/**
 * 온도바 — 화면 맨 위에 가로로 놓이는 이 앱의 본체.
 *
 * 아무 데나 누르면 그 온도가 내 희망이 됩니다. 슬라이더를 끝까지 끌 필요 없이
 * 원하는 자리를 한 번 톡 치면 끝이에요.
 *
 * 표시되는 건 둘뿐입니다.
 *   ● 내가 고른 온도
 *   ◆ 모두의 합의 (20% 절사평균)
 * 개인의 표는 바 뒤에 깔린 흐릿한 능선으로만 보입니다. 누가 몇 도를
 * 찍었는지는 어디에도 안 나와요.
 */

import { bandwidth, kde, clamp, toHalf, r1, fmt } from "./stats.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 좌표계: 0~1000 × 0~120. 가로로 길어서 늘려 씁니다.
const W = 1000, H = 120;
const X0 = 42, X1 = 958;
const BAR_Y = 74, BAR_H = 15;

const toX = (t, b) => X0 + ((t - b.min) / (b.max - b.min)) * (X1 - X0);

/** 화면 좌표를 온도로. 0.5도 단위로 딱 떨어집니다. */
export function xToTemp(ev, el, b) {
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  const px = ((ev.clientX - r.left) / r.width) * W;
  const ratio = (px - X0) / (X1 - X0);
  return toHalf(clamp(b.min + ratio * (b.max - b.min), b.min, b.max));
}

/**
 * @param {SVGElement} svg  그릴 대상
 * @param {object} c        stats.summarise() 결과
 * @param {object} b        계절 밴드
 * @param {number|null} mine 내가 고른 온도
 */
export function drawTempBar(svg, c, b, mine) {
  const out = [];

  // 온도 그라데이션 — 중립이 계절 기준점에 오도록
  const mid = (((b.def - b.min) / (b.max - b.min)) * 100).toFixed(1);
  out.push(
    `<defs><linearGradient id="tgrad" x1="${X0}" y1="0" x2="${X1}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--grad-cold)"/>` +
    `<stop offset="${mid}%" stop-color="var(--grad-mid)"/>` +
    `<stop offset="100%" stop-color="var(--grad-hot)"/></linearGradient></defs>`
  );

  // 표들이 어디 몰렸는지 — 바 위에 얹히는 흐릿한 능선
  if (c.n >= 3) {
    const grid = [];
    for (let t = b.min; t <= b.max + 1e-9; t += 0.1) grid.push(r1(t));
    const dens = kde(c.xs, grid, bandwidth(c.xs));
    const dmax = Math.max(...dens) || 1;
    const top = 18, h = BAR_Y - top - 4;
    let d = `M ${toX(grid[0], b).toFixed(1)} ${BAR_Y - 2}`;
    grid.forEach((g, i) => {
      d += ` L ${toX(g, b).toFixed(1)} ${(BAR_Y - 2 - (dens[i] / dmax) * h).toFixed(1)}`;
    });
    d += ` L ${toX(grid[grid.length - 1], b).toFixed(1)} ${BAR_Y - 2} Z`;
    out.push(`<path d="${d}" fill="var(--ink)" opacity=".1"/>`);
    out.push(`<path d="${d}" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-linejoin="round" opacity=".5"/>`);
  }

  // 계절 밴드 밖은 어둡게 — 투표해도 못 가는 구간
  out.push(`<rect x="${X0}" y="${BAR_Y}" width="${X1 - X0}" height="${BAR_H}" rx="7.5" fill="url(#tgrad)"/>`);
  for (const [a, z] of [[b.min, b.lo], [b.hi, b.max]]) {
    const xa = toX(a, b), xz = toX(z, b);
    if (xz > xa) out.push(`<rect x="${xa}" y="${BAR_Y}" width="${(xz - xa).toFixed(1)}" height="${BAR_H}" fill="var(--panel)" opacity=".55"/>`);
  }

  // 눈금
  for (let t = Math.ceil(b.min); t <= b.max; t++) {
    const x = toX(t, b);
    const major = t % 2 === 0;
    out.push(`<line x1="${x.toFixed(1)}" y1="${BAR_Y + BAR_H}" x2="${x.toFixed(1)}" y2="${BAR_Y + BAR_H + (major ? 5 : 3)}" stroke="var(--line-2)" stroke-width="1.2"/>`);
    if (major) out.push(`<text x="${x.toFixed(1)}" y="${BAR_Y + BAR_H + 17}" text-anchor="middle" class="tbtick">${t}</text>`);
  }
  out.push(`<text x="${X0}" y="${BAR_Y - 6}" class="tbend">시원</text>`);
  out.push(`<text x="${X1}" y="${BAR_Y - 6}" text-anchor="end" class="tbend">따뜻</text>`);

  // ◆ 모두의 합의
  const cx = toX(c.setpoint, b);
  out.push(`<path d="M ${cx.toFixed(1)} ${BAR_Y - 11} l 8 8 l -8 8 l -8 -8 Z" fill="var(--ring)" stroke="var(--ring)" stroke-width="5" stroke-linejoin="round"/>`);
  out.push(`<path d="M ${cx.toFixed(1)} ${BAR_Y - 11} l 8 8 l -8 8 l -8 -8 Z" fill="var(--needle)"/>`);
  out.push(`<line x1="${cx.toFixed(1)}" y1="${BAR_Y - 3}" x2="${cx.toFixed(1)}" y2="${BAR_Y + BAR_H}" stroke="var(--needle)" stroke-width="2"/>`);

  // ● 내가 고른 온도
  if (Number.isFinite(mine)) {
    const mx = toX(mine, b);
    out.push(`<circle cx="${mx.toFixed(1)}" cy="${BAR_Y + BAR_H / 2}" r="12" fill="var(--ring)"/>`);
    out.push(`<circle cx="${mx.toFixed(1)}" cy="${BAR_Y + BAR_H / 2}" r="8.5" fill="var(--accent)"/>`);
    out.push(`<text x="${mx.toFixed(1)}" y="${BAR_Y + BAR_H + 17}" text-anchor="middle" class="tbme">나 ${fmt(mine)}°</text>`);
  }

  svg.innerHTML = out.join("");
}

/** 바 아래 한 줄 요약. */
export function tempSummaryHTML(c, b, mine, size) {
  const parts = [
    Number.isFinite(mine)
      ? `<b class="me">내 희망 ${fmt(mine)}°</b>`
      : `<b class="ghost">위 바를 눌러 온도를 고르세요</b>`,
    `<b class="cons">모두의 합의 ${fmt(c.setpoint)}°</b>`,
    `<span>${c.n}/${size}명</span>`,
  ];
  if (c.n >= 5) {
    parts.push(
      c.split
        ? `<span class="warn">의견 갈림 ${fmt(c.split.lo)}° · ${fmt(c.split.hi)}°</span>`
        : `<span>${c.inBand}명이 ±1° 안</span>`
    );
  }
  parts.push(`<span class="dim">${esc(b.short)} ${b.lo}–${b.hi}°</span>`);
  return parts.join('<i class="sep"></i>');
}
