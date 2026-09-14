/**
 * 온도바 — 화면 맨 위. 이 앱의 본체입니다.
 *
 * 아무 데나 톡 누르면 그 온도가 내 희망이 됩니다. 끌 필요 없어요.
 *
 * 보이는 건 둘뿐입니다.
 *   ● 내 캐릭터가 내가 고른 온도 자리에 서 있고
 *   ◆ 모두의 합의는 통통한 말풍선으로 떠 있습니다
 * 개인의 표는 바 위 말랑한 언덕으로만 보여요. 누가 몇 도를 찍었는지는
 * 어디에도 안 나옵니다.
 *
 * 눈금을 1도마다 촘촘히 박으면 계기판처럼 보여서, 끝과 가운데만 큼직하게 뒀습니다.
 */

import { bandwidth, kde, clamp, toHalf, r1, fmt } from "./stats.js";
import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = 1000, H = 168;
const X0 = 60, X1 = 940;
const BAR_Y = 96, BAR_H = 34;       // 통통한 알약
const HILL_TOP = 26;

const toX = (t, b) => X0 + ((t - b.min) / (b.max - b.min)) * (X1 - X0);

export function xToTemp(ev, el, b) {
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  const px = ((ev.clientX - r.left) / r.width) * W;
  return toHalf(clamp(b.min + ((px - X0) / (X1 - X0)) * (b.max - b.min), b.min, b.max));
}

export function drawTempBar(svg, c, b, mine, meCfg) {
  const out = [];
  const mid = (((b.def - b.min) / (b.max - b.min)) * 100).toFixed(1);

  out.push(
    `<defs>` +
    `<linearGradient id="tgrad" x1="${X0}" y1="0" x2="${X1}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--cold)"/><stop offset="${mid}%" stop-color="var(--mildt)"/>` +
    `<stop offset="100%" stop-color="var(--hot)"/></linearGradient>` +
    `<clipPath id="barclip"><rect x="${X0}" y="${BAR_Y}" width="${X1 - X0}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>` +
    `</defs>`
  );

  // 표가 몰린 곳 — 말랑한 언덕
  if (c.n >= 3) {
    const grid = [];
    for (let t = b.min; t <= b.max + 1e-9; t += 0.1) grid.push(r1(t));
    const dens = kde(c.xs, grid, Math.max(bandwidth(c.xs), 0.55));
    const dmax = Math.max(...dens) || 1;
    const h = BAR_Y - HILL_TOP - 10;
    const base = BAR_Y - 6;
    let d = `M ${toX(grid[0], b).toFixed(1)} ${base}`;
    grid.forEach((g, i) => {
      d += ` L ${toX(g, b).toFixed(1)} ${(base - (dens[i] / dmax) * h).toFixed(1)}`;
    });
    d += ` L ${toX(grid.at(-1), b).toFixed(1)} ${base} Z`;
    out.push(`<path d="${d}" fill="var(--hill-fill)"/>`);
    out.push(`<path d="${d}" fill="none" stroke="var(--hill-line)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  // 알약 바
  out.push(`<rect x="${X0}" y="${BAR_Y}" width="${X1 - X0}" height="${BAR_H}" rx="${BAR_H / 2}" fill="url(#tgrad)"/>`);
  // 계절 밴드 밖은 뿌옇게 — 투표해도 못 가는 구간
  for (const [a, z] of [[b.min, b.lo], [b.hi, b.max]]) {
    const xa = toX(a, b), xz = toX(z, b);
    if (xz > xa) out.push(`<rect x="${xa}" y="${BAR_Y}" width="${(xz - xa).toFixed(1)}" height="${BAR_H}" fill="var(--panel)" opacity=".62" clip-path="url(#barclip)"/>`);
  }
  out.push(`<rect x="${X0}" y="${BAR_Y}" width="${X1 - X0}" height="${BAR_H}" rx="${BAR_H / 2}" fill="none" stroke="var(--bar-line)" stroke-width="3"/>`);

  // 끝과 가운데만. 촘촘한 눈금은 계기판처럼 보여요
  const lab = (t, txt) => `<text x="${toX(t, b).toFixed(1)}" y="${BAR_Y + BAR_H + 26}" text-anchor="middle" class="tbtick">${txt}</text>`;
  out.push(lab(b.min, `${b.min}° 시원`), lab(b.def, `${b.def}°`), lab(b.max, `${b.max}° 따뜻`));

  // ◆ 모두의 합의 — 통통한 말풍선
  const cx = toX(c.setpoint, b);
  const tw = 108, th = 46, tx = clamp(cx - tw / 2, 4, W - tw - 4);
  out.push(
    `<g class="consens">` +
    `<path d="M ${cx.toFixed(1)} ${BAR_Y - 2} l -11 -14 h 22 Z" fill="var(--ink)"/>` +
    `<rect x="${tx.toFixed(1)}" y="${BAR_Y - 14 - th}" width="${tw}" height="${th}" rx="${th / 2}" fill="var(--ink)"/>` +
    `<text x="${(tx + tw / 2).toFixed(1)}" y="${(BAR_Y - 14 - th / 2 + 9).toFixed(1)}" text-anchor="middle" class="tbcons">${fmt(c.setpoint)}°</text>` +
    `</g>`
  );

  // ● 나 — 내 캐릭터가 그 온도 자리에 서 있습니다
  if (Number.isFinite(mine)) {
    const mx = toX(mine, b);
    const R = 30;
    out.push(
      `<g class="meknob" transform="translate(${mx.toFixed(1)},${BAR_Y + BAR_H / 2})">` +
      `<circle r="${R}" fill="var(--panel)" stroke="var(--accent)" stroke-width="4"/>` +
      `<g transform="translate(-21,-24) scale(0.95)">${creature(meCfg ?? { cc: 1 }, "happy")}</g>` +
      `</g>` +
      `<text x="${mx.toFixed(1)}" y="${BAR_Y + BAR_H + 26}" text-anchor="middle" class="tbme">${fmt(mine)}°</text>`
    );
  } else {
    out.push(
      `<g class="pickme"><rect x="${(W / 2 - 130).toFixed(0)}" y="${BAR_Y + BAR_H + 8}" width="260" height="30" rx="15" fill="var(--accent)"/>` +
      `<text x="${W / 2}" y="${BAR_Y + BAR_H + 29}" text-anchor="middle" class="tbpick">👆 여기를 눌러 내 온도 고르기</text></g>`
    );
  }

  svg.innerHTML = out.join("");
}

export function tempSummaryHTML(c, b, mine, size) {
  const bits = [];
  if (Number.isFinite(mine)) bits.push(`<b class="me">내 희망 ${fmt(mine)}°</b>`);
  bits.push(`<b class="cons">합의 ${fmt(c.setpoint)}°</b>`);
  bits.push(`<span>${c.n}/${size}명</span>`);
  if (c.n >= 5) {
    bits.push(
      c.split
        ? `<span class="warn">의견 갈림 ${fmt(c.split.lo)}° · ${fmt(c.split.hi)}°</span>`
        : `<span>${c.inBand}명이 ±1° 안</span>`
    );
  }
  bits.push(`<span class="dim">${esc(b.short)} ${b.lo}–${b.hi}°</span>`);
  return bits.join('<i class="sep"></i>');
}
