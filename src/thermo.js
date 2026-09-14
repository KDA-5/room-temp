/**
 * 세로 온도계 — 화면 왼쪽. 이 앱의 본체입니다.
 *
 * 진짜 온도계처럼 아래가 차갑고 위가 뜨겁습니다. 눈금 아무 데나 누르면
 * 그 온도가 내 희망이 돼요.
 *
 * 보이는 건 셋뿐입니다.
 *   ● 내 캐릭터가 내가 고른 눈금에 매달려 있고
 *   ▸ 모두의 합의는 관 옆 화살표로 표시되고
 *   ◉ 맨 아래 구근에 합의 온도가 큼직하게 찍힙니다
 * 개인의 표는 관 왼쪽 말랑한 언덕으로만 보여요. 누가 몇 도를 찍었는지는
 * 어디에도 안 나옵니다.
 */

import { bandwidth, kde, clamp, toHalf, r1, fmt } from "./stats.js";
import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = 130, H = 560;
const TUBE_X = 78, TUBE_W = 30;          // 관
const TOP = 34, BOT = 430;               // 눈금 위·아래 (위가 뜨거움)
const BULB_CY = 480, BULB_R = 44;        // 구근

/** 온도 → y. 위가 뜨겁습니다. */
const toY = (t, b) => BOT - ((t - b.min) / (b.max - b.min)) * (BOT - TOP);

/** 누른 지점 → 온도. 0.5도 단위. */
export function yToTemp(ev, el, b) {
  const r = el.getBoundingClientRect();
  if (!r.height) return null;
  const py = ((ev.clientY - r.top) / r.height) * H;
  return toHalf(clamp(b.min + ((BOT - py) / (BOT - TOP)) * (b.max - b.min), b.min, b.max));
}

export function drawThermo(svg, c, b, mine, meCfg) {
  const out = [];

  out.push(
    `<defs>` +
    `<linearGradient id="tg" x1="0" y1="${BOT}" x2="0" y2="${TOP}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--cold)"/><stop offset="50%" stop-color="var(--mildt)"/>` +
    `<stop offset="100%" stop-color="var(--hot)"/></linearGradient>` +
    `<clipPath id="tclip"><rect x="${TUBE_X}" y="${TOP - 14}" width="${TUBE_W}" height="${BOT - TOP + 28}" rx="${TUBE_W / 2}"/></clipPath>` +
    `</defs>`
  );

  // 표가 몰린 곳 — 관 왼쪽으로 부푸는 언덕
  if (c.n >= 3) {
    const grid = [];
    for (let t = b.min; t <= b.max + 1e-9; t += 0.1) grid.push(r1(t));
    const dens = kde(c.xs, grid, Math.max(bandwidth(c.xs), 0.55));
    const dmax = Math.max(...dens) || 1;
    const base = TUBE_X - 8, wMax = 52;
    let d = `M ${base} ${toY(grid[0], b).toFixed(1)}`;
    grid.forEach((g, i) => {
      d += ` L ${(base - (dens[i] / dmax) * wMax).toFixed(1)} ${toY(g, b).toFixed(1)}`;
    });
    d += ` L ${base} ${toY(grid.at(-1), b).toFixed(1)} Z`;
    out.push(`<path d="${d}" fill="var(--hill-fill)"/>`);
    out.push(`<path d="${d}" fill="none" stroke="var(--hill-line)" stroke-width="3" stroke-linejoin="round"/>`);
  }

  // 관 + 구근
  out.push(`<circle cx="${TUBE_X + TUBE_W / 2}" cy="${BULB_CY}" r="${BULB_R}" fill="var(--cold)"/>`);
  out.push(`<rect x="${TUBE_X}" y="${TOP - 14}" width="${TUBE_W}" height="${BULB_CY - TOP + 14}" rx="${TUBE_W / 2}" fill="url(#tg)"/>`);
  // 계절 밴드 밖은 뿌옇게 — 투표해도 못 가는 구간
  for (const [a, z] of [[b.min, b.lo], [b.hi, b.max]]) {
    const ya = toY(a, b), yz = toY(z, b);
    const y0 = Math.min(ya, yz), h = Math.abs(ya - yz);
    if (h > 0.5) out.push(`<rect x="${TUBE_X}" y="${y0.toFixed(1)}" width="${TUBE_W}" height="${h.toFixed(1)}" fill="var(--panel)" opacity=".66" clip-path="url(#tclip)"/>`);
  }
  out.push(`<rect x="${TUBE_X}" y="${TOP - 14}" width="${TUBE_W}" height="${BULB_CY - TOP + 14}" rx="${TUBE_W / 2}" fill="none" stroke="var(--tube-line)" stroke-width="4"/>`);
  out.push(`<circle cx="${TUBE_X + TUBE_W / 2}" cy="${BULB_CY}" r="${BULB_R}" fill="none" stroke="var(--tube-line)" stroke-width="4"/>`);

  // 구근 안에 합의 온도
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${BULB_CY - 4}" text-anchor="middle" class="thbulb">${fmt(c.setpoint)}</text>`);
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${BULB_CY + 20}" text-anchor="middle" class="thbulbsub">모두의 합의</text>`);

  // 눈금 — 1도마다 짧게, 2도마다 숫자
  for (let t = Math.ceil(b.min); t <= b.max; t++) {
    const y = toY(t, b);
    const major = t % 2 === 0;
    out.push(`<line x1="${TUBE_X + TUBE_W + 4}" y1="${y.toFixed(1)}" x2="${TUBE_X + TUBE_W + (major ? 16 : 9)}" y2="${y.toFixed(1)}" stroke="var(--tick)" stroke-width="${major ? 4 : 2.5}" stroke-linecap="round"/>`);
    if (major) out.push(`<text x="${TUBE_X + TUBE_W + 22}" y="${(y + 8).toFixed(1)}" class="thtick">${t}°</text>`);
  }
  out.push(`<text x="${TUBE_X + TUBE_W / 2}" y="${TOP - 24}" text-anchor="middle" class="thend">🔥 따뜻</text>`);
  out.push(`<text x="6" y="${BOT + 26}" class="thend">🧊 시원</text>`);

  // ▸ 모두의 합의 — 관 옆 화살표
  const cy = toY(c.setpoint, b);
  out.push(
    `<g class="cons">` +
    `<path d="M ${TUBE_X - 6} ${cy.toFixed(1)} l -13 -10 v 20 Z" fill="var(--ink)"/>` +
    `<rect x="${TUBE_X}" y="${(cy - 2.5).toFixed(1)}" width="${TUBE_W}" height="5" fill="var(--ink)" opacity=".55" clip-path="url(#tclip)"/>` +
    `</g>`
  );

  // ● 나 — 내 캐릭터가 그 눈금에 매달려 있습니다
  if (Number.isFinite(mine)) {
    const my = toY(mine, b);
    out.push(
      `<g class="meknob" transform="translate(${TUBE_X + TUBE_W / 2},${my.toFixed(1)})">` +
      `<circle r="30" fill="var(--panel)" stroke="var(--accent)" stroke-width="5"/>` +
      `<g transform="translate(-21,-24) scale(.95)">${creature(meCfg ?? { cc: 1 }, "happy")}</g>` +
      `<rect x="-31" y="30" width="62" height="24" rx="12" fill="var(--accent)"/>` +
      `<text x="0" y="47" text-anchor="middle" class="thme">${fmt(mine)}°</text>` +
      `</g>`
    );
  } else {
    const y = toY(b.def, b);
    out.push(
      `<g class="pickme" transform="translate(${TUBE_X + TUBE_W / 2},${y.toFixed(1)})">` +
      `<circle r="26" fill="var(--accent)" opacity=".18"/>` +
      `<circle r="16" fill="var(--accent)"/>` +
      `<text x="0" y="6" text-anchor="middle" class="thpick">👆</text></g>`
    );
  }

  svg.innerHTML = out.join("");
}

/** 온도계 아래 안내 문구. 아직 안 골랐으면 고르라고 조릅니다. */
export function thermoTipHTML(c, b, mine, size) {
  if (!Number.isFinite(mine)) {
    return `<b class="big">👆 눈금을 눌러<br>내 온도를 고르세요</b>` +
      `<span>지금 ${c.n}/${size}명 참여</span>`;
  }
  const gap = mine - c.setpoint;
  let mood;
  if (Math.abs(gap) <= 0.5) mood = `합의랑 <b>딱 맞아요</b>`;
  else if (gap > 0) mood = `합의보다 <b>${fmt(Math.abs(gap))}° 따뜻</b>하게`;
  else mood = `합의보다 <b>${fmt(Math.abs(gap))}° 시원</b>하게`;
  return (
    `<b class="big">내 희망 ${fmt(mine)}°</b>` +
    `<span>${mood}</span>` +
    `<span>${c.n}/${size}명 참여${c.n >= 5 && c.split ? " · <i>의견 갈림</i>" : ""}</span>` +
    `<span class="dim">${esc(b.short)} ${b.lo}–${b.hi}°</span>`
  );
}
