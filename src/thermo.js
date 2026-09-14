/**
 * 세로 온도계 — 화면 왼쪽. 이 앱의 본체입니다.
 *
 * 진짜 온도계처럼 아래가 차갑고 위가 뜨겁습니다. 눈금 아무 데나 누르면
 * 그 온도가 내 희망이 돼요.
 *
 * 캐릭터는 여기 안 올립니다. 온도계에 내 캐릭터가 서 있으면 옆에서
 * 화면만 봐도 "저 캐릭터 = 저 온도"가 바로 읽혀서 익명이 깨져요.
 * 내 위치는 선 하나와 숫자 하나로만 표시합니다.
 *
 * 화면은 좌우로 역할을 나눠서 글자가 겹치지 않게 했습니다.
 *   왼쪽   표가 얼마나 몰렸는지 (가로 막대)
 *   가운데 관과 구근
 *   오른쪽 눈금 숫자, 그리고 내 온도 알약
 */

import { clamp, toHalf, fmt } from "./stats.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = 150, H = 586;
const TUBE_X = 54, TUBE_W = 30;        // 관 54~84
const TOP = 44, BOT = 442;             // 눈금 위(뜨거움)·아래(차가움)
const BULB_CY = 500, BULB_R = 46;
const HIST_R = 50, HIST_MAX = 26;      // 왼쪽 막대: 50에서 왼쪽으로
const TICK_X = 86;                     // 오른쪽 눈금 시작

const toY = (t, b) => BOT - ((t - b.min) / (b.max - b.min)) * (BOT - TOP);

/** 누른 지점 → 온도. 0.5도 단위. */
export function yToTemp(ev, el, b) {
  const r = el.getBoundingClientRect();
  if (!r.height) return null;
  const py = ((ev.clientY - r.top) / r.height) * H;
  return toHalf(clamp(b.min + ((BOT - py) / (BOT - TOP)) * (b.max - b.min), b.min, b.max));
}

export function drawThermo(svg, c, b, mine) {
  const out = [];

  out.push(
    `<defs><linearGradient id="tg" x1="0" y1="${BOT}" x2="0" y2="${TOP}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--cold)"/><stop offset="50%" stop-color="var(--mildt)"/>` +
    `<stop offset="100%" stop-color="var(--hot)"/></linearGradient>` +
    `<clipPath id="tclip"><rect x="${TUBE_X}" y="${TOP - 16}" width="${TUBE_W}" height="${BOT - TOP + 32}" rx="${TUBE_W / 2}"/></clipPath></defs>`
  );

  // 왼쪽 — 표가 몰린 곳. 0.5도 칸마다 가로 막대 하나.
  if (c.n) {
    const bucket = new Map();
    for (const x of c.xs) {
      const k = toHalf(x);
      if (k < b.min || k > b.max) continue;
      bucket.set(k, (bucket.get(k) ?? 0) + 1);
    }
    const max = Math.max(1, ...bucket.values());
    for (const [t, n] of bucket) {
      const y = toY(t, b);
      const len = 5 + (n / max) * HIST_MAX;
      out.push(`<rect x="${(HIST_R - len).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="${len.toFixed(1)}" height="6" rx="3" fill="var(--hist)"/>`);
    }
  }

  // 관 + 구근
  out.push(`<circle cx="${TUBE_X + TUBE_W / 2}" cy="${BULB_CY}" r="${BULB_R}" fill="var(--cold)"/>`);
  out.push(`<rect x="${TUBE_X}" y="${TOP - 16}" width="${TUBE_W}" height="${BULB_CY - TOP + 16}" rx="${TUBE_W / 2}" fill="url(#tg)"/>`);
  // 계절 밴드 밖은 뿌옇게 — 투표해도 못 가는 구간
  for (const [a, z] of [[b.min, b.lo], [b.hi, b.max]]) {
    const ya = toY(a, b), yz = toY(z, b);
    const y0 = Math.min(ya, yz), h = Math.abs(ya - yz);
    if (h > .5) out.push(`<rect x="${TUBE_X}" y="${y0.toFixed(1)}" width="${TUBE_W}" height="${h.toFixed(1)}" fill="var(--panel)" opacity=".62" clip-path="url(#tclip)"/>`);
  }
  // 유리 반사 — 관이 원통으로 보이게
  out.push(`<rect x="${TUBE_X + 5}" y="${TOP - 12}" width="6" height="${BULB_CY - TOP + 4}" rx="3" fill="#fff" opacity=".26"/>`);
  out.push(`<rect x="${TUBE_X}" y="${TOP - 16}" width="${TUBE_W}" height="${BULB_CY - TOP + 16}" rx="${TUBE_W / 2}" fill="none" stroke="var(--tube-line)" stroke-width="4"/>`);
  out.push(`<circle cx="${TUBE_X + TUBE_W / 2}" cy="${BULB_CY}" r="${BULB_R}" fill="none" stroke="var(--tube-line)" stroke-width="4"/>`);
  out.push(`<circle cx="${TUBE_X + TUBE_W / 2 - 14}" cy="${BULB_CY - 16}" r="9" fill="#fff" opacity=".22"/>`);

  // 구근 안 — 모두의 합의
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${BULB_CY - 2}" text-anchor="middle" class="thbulb">${fmt(c.setpoint)}°</text>`);
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${BULB_CY + 22}" text-anchor="middle" class="thbulbsub">모두의 합의</text>`);

  // 오른쪽 — 눈금. 1도마다 짧게, 2도마다 숫자.
  const myT = Number.isFinite(mine) ? toHalf(mine) : null;
  for (let t = Math.ceil(b.min); t <= b.max; t++) {
    const y = toY(t, b);
    const major = t % 2 === 0;
    out.push(`<line x1="${TICK_X}" y1="${y.toFixed(1)}" x2="${TICK_X + (major ? 12 : 7)}" y2="${y.toFixed(1)}" stroke="var(--tick)" stroke-width="${major ? 3.5 : 2.2}" stroke-linecap="round"/>`);
    // 내 알약이 덮을 자리엔 숫자를 안 그립니다 (겹치면 둘 다 안 읽혀요)
    if (major && !(myT !== null && Math.abs(t - myT) < 0.75)) {
      out.push(`<text x="${TICK_X + 17}" y="${(y + 7).toFixed(1)}" class="thtick">${t}</text>`);
    }
  }
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${TOP - 26}" text-anchor="middle" class="thend">🔥 따뜻</text>`);
  out.push(`<text x="${HIST_R - HIST_MAX - 4}" y="${BOT + 30}" class="thend">🧊 시원</text>`);

  // 모두의 합의 — 관을 가로지르는 진한 선
  const cy = toY(c.setpoint, b);
  out.push(
    `<g class="cons">` +
    `<rect x="${TUBE_X - 3}" y="${(cy - 3).toFixed(1)}" width="${TUBE_W + 6}" height="6" rx="3" fill="var(--ink)" opacity=".9"/>` +
    `<path d="M ${TUBE_X - 8} ${cy.toFixed(1)} l -11 -8 v 16 Z" fill="var(--ink)"/>` +
    `</g>`
  );

  // 내 온도 — 캐릭터 대신 선 하나와 알약 하나
  if (myT !== null) {
    const my = toY(myT, b);
    const pw = 54, ph = 28;
    out.push(
      `<g class="meline">` +
      `<rect x="${TUBE_X - 5}" y="${(my - 4).toFixed(1)}" width="${TUBE_W + 10}" height="8" rx="4" fill="var(--accent)"/>` +
      `<path d="M ${TICK_X + 2} ${my.toFixed(1)} l 9 -7 v 14 Z" fill="var(--accent)"/>` +
      `<rect x="${TICK_X + 10}" y="${(my - ph / 2).toFixed(1)}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="var(--accent)"/>` +
      `<text x="${TICK_X + 10 + pw / 2}" y="${(my + 7).toFixed(1)}" text-anchor="middle" class="thme">${fmt(myT)}°</text>` +
      `</g>`
    );
  } else {
    // 아직 안 골랐으면 계절 기본값 자리에서 살랑살랑
    const y = toY(b.def, b);
    out.push(
      `<g class="pickme" transform="translate(${TUBE_X + TUBE_W / 2},${y.toFixed(1)})">` +
      `<circle r="24" fill="var(--accent)" opacity=".2"/><circle r="14" fill="var(--accent)"/>` +
      `<text x="0" y="6" text-anchor="middle" class="thpick">👆</text></g>`
    );
  }

  svg.innerHTML = out.join("");
}

/** 온도계 아래 안내. 아직 안 골랐으면 고르라고 조릅니다. */
export function thermoTipHTML(c, b, mine, size) {
  if (!Number.isFinite(mine)) {
    return `<b class="big">👆 눈금을 눌러<br>내 온도 고르기</b><span>지금 ${c.n}/${size}명</span>`;
  }
  const gap = mine - c.setpoint;
  const mood = Math.abs(gap) <= 0.5 ? `합의랑 <b>딱 맞아요</b>`
    : gap > 0 ? `합의보다 <b>${fmt(Math.abs(gap))}° 따뜻</b>하게`
              : `합의보다 <b>${fmt(Math.abs(gap))}° 시원</b>하게`;
  return (
    `<b class="big">내 희망 ${fmt(mine)}°</b><span>${mood}</span>` +
    `<span>${c.n}/${size}명 참여${c.n >= 5 && c.split ? " · <i>의견 갈림</i>" : ""}</span>` +
    `<span class="dim">${esc(b.short)} ${b.lo}–${b.hi}°</span>`
  );
}
