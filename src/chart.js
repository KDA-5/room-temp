/**
 * 그림 그리는 곳 — 전부 손으로 만든 SVG 문자열입니다. 차트 라이브러리 없음.
 *
 * 분포 차트는 점 하나가 한 사람입니다. 합의 타점에서 멀어질수록
 * 점 색이 파랑(더 따뜻하길 원함) 또는 빨강(더 시원하길 원함)으로 갑니다.
 * 뒤에 깔린 능선은 그 점들의 분포를 매끄럽게 편 것이고요.
 */

import { bandwidth, kde, clamp, toHalf, r1, fmt } from "./stats.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 차트 좌표계 (viewBox 760 × 392)
export const P = { w: 760, h: 392, x0: 58, x1: 702, base: 298, top: 56, tickY: 320, capY: 344 };

/**
 * 메인 차트.
 * @param {SVGElement} svg   그릴 대상
 * @param {object}     c     stats.summarise() 결과
 * @param {object}     band  계절 밴드 { min, max, lo, hi, def, name }
 * @returns {(t:number)=>number}  온도를 x좌표로 바꾸는 함수 (마우스 추적에 씁니다)
 */
export function drawRidge(svg, c, band) {
  const sx = (v) => P.x0 + ((v - band.min) / (band.max - band.min)) * (P.x1 - P.x0);
  const out = [];

  // 온도 그라데이션. 중립(회색)이 계절의 쾌적 기준점에 오도록 위치를 잡습니다.
  const midOff = (((band.def - band.min) / (band.max - band.min)) * 100).toFixed(1);
  out.push(
    `<defs><linearGradient id="thermo" x1="${P.x0}" y1="0" x2="${P.x1}" y2="0" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" style="stop-color:var(--grad-cold);stop-opacity:var(--grad-a)"/>` +
      `<stop offset="${midOff}%" style="stop-color:var(--grad-mid);stop-opacity:var(--grad-a-mid)"/>` +
      `<stop offset="100%" style="stop-color:var(--grad-hot);stop-opacity:var(--grad-a)"/>` +
      `</linearGradient></defs>`
  );

  // 계절 밴드 밖은 살짝 어둡게 — 투표해도 못 가는 구간이라는 표시
  out.push(`<rect x="${P.x0}" y="${P.top}" width="${(sx(band.lo) - P.x0).toFixed(1)}" height="${P.base - P.top}" fill="var(--outside)"/>`);
  out.push(`<rect x="${sx(band.hi).toFixed(1)}" y="${P.top}" width="${(P.x1 - sx(band.hi)).toFixed(1)}" height="${P.base - P.top}" fill="var(--outside)"/>`);
  for (const edge of [band.lo, band.hi]) {
    out.push(`<line x1="${sx(edge).toFixed(1)}" y1="${P.top}" x2="${sx(edge).toFixed(1)}" y2="${P.base}" stroke="var(--line-2)" stroke-width="1" fill="none"/>`);
  }

  // 캐릭터를 쌓을 자리 계산
  const buckets = new Map();
  for (const x of c.xs) {
    const k = toHalf(x).toFixed(1);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const maxCount = Math.max(0, ...buckets.values());
  const gap = maxCount > 1 ? Math.min(15, 210 / (maxCount - 1)) : 15;
  const stackTop = P.base - 12 - Math.max(0, maxCount - 1) * gap - 8;

  // 부드러운 능선 — 캐릭터 더미의 겉선이 되도록 높이를 맞춥니다
  if (c.n >= 3) {
    const grid = [];
    for (let t = band.min; t <= band.max + 1e-9; t += 0.1) grid.push(r1(t));
    const dens = kde(c.xs, grid, bandwidth(c.xs));
    const dmax = Math.max(...dens) || 1;
    const hRidge = P.base - Math.max(P.top, stackTop - 8);

    let d = `M ${sx(grid[0]).toFixed(1)} ${P.base}`;
    grid.forEach((g, i) => {
      d += ` L ${sx(g).toFixed(1)} ${(P.base - (dens[i] / dmax) * hRidge).toFixed(1)}`;
    });
    d += ` L ${sx(grid[grid.length - 1]).toFixed(1)} ${P.base} Z`;

    out.push(`<path d="${d}" fill="url(#thermo)" stroke="none"/>`);
    out.push(`<path d="${d}" fill="none" stroke="var(--line-2)" stroke-width="1.4" stroke-linejoin="round" opacity=".75"/>`);
  }

  // 타점 ±1도 구간
  const bl = sx(Math.max(band.min, c.setpoint - 1));
  const br = sx(Math.min(band.max, c.setpoint + 1));
  out.push(`<rect x="${bl.toFixed(1)}" y="${P.top}" width="${(br - bl).toFixed(1)}" height="${P.base - P.top}" fill="var(--needle)" opacity="0.04"/>`);

  // 축
  out.push(`<line x1="${P.x0}" y1="${P.base}" x2="${P.x1}" y2="${P.base}" stroke="var(--line-2)" stroke-width="1.5" fill="none"/>`);
  for (let t = Math.ceil(band.min); t <= band.max; t++) {
    out.push(`<line x1="${sx(t).toFixed(1)}" y1="${P.base}" x2="${sx(t).toFixed(1)}" y2="${P.base + 6}" stroke="var(--line-2)" stroke-width="1" fill="none"/>`);
    out.push(`<text x="${sx(t).toFixed(1)}" y="${P.tickY}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--mono)" font-size="12">${t}</text>`);
  }
  out.push(`<text x="${P.x0}" y="${P.capY}" text-anchor="start" fill="var(--ink-3)" font-family="var(--sans)" font-size="11.5">← 시원하게</text>`);
  out.push(`<text x="${P.x1}" y="${P.capY}" text-anchor="end" fill="var(--ink-3)" font-family="var(--sans)" font-size="11.5">따뜻하게 →</text>`);
  out.push(
    `<text x="${((sx(band.lo) + sx(band.hi)) / 2).toFixed(1)}" y="${P.capY}" text-anchor="middle" ` +
    `fill="var(--ink-2)" font-family="var(--sans)" font-size="11.5">${esc(band.name)} 권장 ${band.lo}–${band.hi}°C</text>`
  );

  // 점 하나가 한 사람. 합의에서 멀수록 색이 진해집니다.
  const placed = new Map();
  const ordered = c.votes.slice().sort((a, b) => (a.is_me ? 1 : 0) - (b.is_me ? 1 : 0));

  ordered.forEach((v) => {
    if (!Number.isFinite(v.t)) return;
    const k = toHalf(v.t).toFixed(1);
    const stack = placed.get(k) ?? 0;
    placed.set(k, stack + 1);

    const cx = sx(parseFloat(k));
    const cy = P.base - 12 - stack * gap;
    const d = v.t - c.setpoint;
    const far = Math.abs(d) > 1.5;
    const fill = Math.abs(d) <= 0.5 ? "var(--ink-3)" : d > 0 ? "var(--cold)" : "var(--hot)";

    out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(far ? 7 : 6).toFixed(1)}" fill="var(--card)"/>`);
    out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(far ? 5.5 : 4.5).toFixed(1)}" fill="${fill}"` +
             (v.is_me ? ` stroke="var(--accent)" stroke-width="2.5"` : "") + `/>`);
  });

  // 합의 타점
  const nx = sx(c.setpoint);
  out.push(`<line x1="${nx.toFixed(1)}" y1="${P.top - 14}" x2="${nx.toFixed(1)}" y2="${P.base + 10}" stroke="var(--ring)" stroke-width="6" fill="none"/>`);
  out.push(`<line x1="${nx.toFixed(1)}" y1="${P.top - 14}" x2="${nx.toFixed(1)}" y2="${P.base + 10}" stroke="var(--needle)" stroke-width="2.2" stroke-linecap="round" fill="none"/>`);
  const lw = 80;
  const lx = clamp(nx - lw / 2, 4, P.w - lw - 4);
  out.push(`<rect x="${lx.toFixed(1)}" y="12" width="${lw}" height="25" rx="9" fill="var(--needle)"/>`);
  out.push(`<text x="${(lx + lw / 2).toFixed(1)}" y="29.5" text-anchor="middle" fill="var(--ring)" font-family="var(--mono)" font-size="13" font-weight="600">${fmt(c.setpoint)}°C</text>`);

  // 중앙값은 타점과 실제로 어긋날 때만 표시합니다
  if (c.n && Math.abs(c.median - c.setpoint) >= 0.25) {
    const mx = sx(c.median);
    out.push(`<line x1="${mx.toFixed(1)}" y1="${P.base - 14}" x2="${mx.toFixed(1)}" y2="${P.base + 10}" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>`);
    out.push(`<text x="${mx.toFixed(1)}" y="${P.base - 19}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="11">중앙값</text>`);
  }

  out.push(`<line id="cross" x1="0" y1="${P.top}" x2="0" y2="${P.base + 10}" stroke="var(--ink-3)" stroke-width="1" fill="none" opacity="0"/>`);
  out.push(`<rect id="hitzone" x="${P.x0}" y="${P.top - 34}" width="${P.x1 - P.x0}" height="${P.base - P.top + 46}" fill="transparent" style="cursor:crosshair"/>`);

  svg.innerHTML = `<title>희망 온도별 분포와 권장 설정온도</title>${out.join("")}`;
  return sx;
}

/** 14일 추이 스파크라인. */
export function drawSpark(svg, history) {
  const h = history.slice(-14);
  if (h.length < 2) {
    svg.innerHTML =
      `<text x="160" y="52" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="13">` +
      `${h.length ? "오늘치 한 점만 기록됐어요" : "아직 기록이 없어요"}</text>`;
    return h.length ? "이틀 이상 쌓이면 선이 그려져요." : "정각마다 기록이 쌓입니다.";
  }

  const vals = h.map((d) => Number(d.setpoint));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }

  const X0 = 14, X1 = 262, Y0 = 20, Y1 = 68;
  const px = (i) => X0 + (i / (h.length - 1)) * (X1 - X0);
  const py = (v) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);

  let d = "";
  vals.forEach((v, i) => (d += `${i ? " L " : "M "}${px(i).toFixed(1)} ${py(v).toFixed(1)}`));
  const last = h.length - 1;

  svg.innerHTML =
    `<line x1="${X0}" y1="${Y1}" x2="${X1}" y2="${Y1}" stroke="var(--line)" stroke-width="1" fill="none"/>` +
    `<path d="${d}" fill="none" stroke="var(--grad-cold)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${px(last).toFixed(1)}" cy="${py(vals[last]).toFixed(1)}" r="6.5" fill="var(--ring)"/>` +
    `<circle cx="${px(last).toFixed(1)}" cy="${py(vals[last]).toFixed(1)}" r="4.2" fill="var(--grad-cold)"/>` +
    `<text x="316" y="${(py(vals[last]) + 4.5).toFixed(1)}" text-anchor="end" fill="var(--ink)" font-family="var(--mono)" font-size="13" font-weight="600">${fmt(vals[last])}°</text>` +
    `<text x="${X0}" y="${Y1 + 18}" text-anchor="start" fill="var(--ink-3)" font-family="var(--sans)" font-size="11">${esc(String(h[0].d).slice(5))}</text>` +
    `<text x="${X1}" y="${Y1 + 18}" text-anchor="end" fill="var(--ink-3)" font-family="var(--sans)" font-size="11">${esc(String(h[last].d).slice(5))}</text>`;

  return `${h.length}일치 기록 · 폭 ${fmt(hi - lo)}°C 안에서 움직였어요.`;
}

/**
 * 오늘의 정각 타임라인.
 * 매 정각마다 찍힌 도장을 가로로 늘어놓고, 실제로 바꾼 시간은 강조합니다.
 */
export function drawHourly(svg, checkpoints) {
  const today = new Date().toDateString();
  const rows = checkpoints.filter((c) => new Date(c.hour_at).toDateString() === today);

  if (!rows.length) {
    svg.innerHTML =
      `<text x="180" y="46" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="13">` +
      `첫 정각이 지나면 여기에 도장이 찍혀요</text>`;
    return;
  }

  const W = 360, H = 92, PADX = 18, Y = 44;
  const step = rows.length > 1 ? (W - PADX * 2) / (rows.length - 1) : 0;
  const out = [`<line x1="${PADX}" y1="${Y}" x2="${W - PADX}" y2="${Y}" stroke="var(--line)" stroke-width="2" fill="none"/>`];

  rows.forEach((r, i) => {
    const x = rows.length > 1 ? PADX + i * step : W / 2;
    const hh = new Date(r.hour_at).getHours();
    const changed = r.changed;
    out.push(`<circle cx="${x.toFixed(1)}" cy="${Y}" r="${changed ? 7.5 : 5}" fill="var(--ring)"/>`);
    out.push(`<circle cx="${x.toFixed(1)}" cy="${Y}" r="${changed ? 5.5 : 3.4}" fill="${changed ? "var(--accent)" : "var(--ink-3)"}"/>`);
    out.push(`<text x="${x.toFixed(1)}" y="${Y - 15}" text-anchor="middle" fill="var(--ink)" font-family="var(--mono)" font-size="11.5" font-weight="600">${fmt(r.setpoint)}</text>`);
    out.push(`<text x="${x.toFixed(1)}" y="${Y + 21}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--mono)" font-size="10.5">${hh}시</text>`);
    if (changed) {
      out.push(`<text x="${x.toFixed(1)}" y="${Y + 34}" text-anchor="middle" fill="var(--accent)" font-family="var(--sans)" font-size="10">바꿈</text>`);
    }
  });

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = out.join("");
}

/**
 * 오늘 시간별 강의 피드백 추이.
 *
 * 정각마다 마감된 난이도·속도 평균이 checkpoints 에 이미 쌓이고 있는데
 * 화면에 안 보여주고 있었습니다. 강사 입장에선 이게 제일 쓸모 있는 화면이에요 —
 * "3교시에 다들 어려워했구나" 가 한눈에 보입니다.
 *
 * 두 선 모두 -2~+2 로 같은 눈금이라 한 축에 겹쳐 그립니다.
 */
export function drawLectureTrend(svg, checkpoints) {
  const today = new Date().toDateString();
  const rows = checkpoints
    .filter((c) => new Date(c.hour_at).toDateString() === today && Number(c.lec_n) > 0)
    .sort((a, b) => new Date(a.hour_at) - new Date(b.hour_at));

  if (rows.length < 2) {
    svg.innerHTML =
      `<text x="180" y="52" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="12.5">` +
      `${rows.length ? "한 시간치만 마감됐어요" : "정각이 두 번 지나면 추이가 그려져요"}</text>`;
    return;
  }

  const W = 360, H = 116, X0 = 34, X1 = 326, Y0 = 16, Y1 = 84;
  const px = (i) => X0 + (i / (rows.length - 1)) * (X1 - X0);
  const py = (v) => Y1 - ((clamp(v, -2, 2) + 2) / 4) * (Y1 - Y0);
  const out = [];

  // 눈금: 딱 좋음(0) 선을 굵게
  for (const [v, lab] of [[2, "+2"], [0, "0"], [-2, "−2"]]) {
    out.push(`<line x1="${X0}" y1="${py(v).toFixed(1)}" x2="${X1}" y2="${py(v).toFixed(1)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.5 : 1}" fill="none"/>`);
    out.push(`<text x="${X0 - 7}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end" fill="var(--ink-3)" font-family="var(--mono)" font-size="10">${lab}</text>`);
  }
  out.push(`<text x="${X1}" y="${(py(0) - 6).toFixed(1)}" text-anchor="end" fill="var(--ink-3)" font-family="var(--sans)" font-size="10">딱 좋음</text>`);

  const series = [
    { key: "diff_avg", color: "var(--grad-hot)", name: "난이도" },
    { key: "pace_avg", color: "var(--grad-cold)", name: "속도" },
  ];

  for (const s of series) {
    const pts = rows.map((r, i) => ({ i, v: Number(r[s.key]) })).filter((p) => Number.isFinite(p.v));
    if (pts.length < 2) continue;
    const d = pts.map((p, k) => `${k ? "L" : "M"} ${px(p.i).toFixed(1)} ${py(p.v).toFixed(1)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    for (const p of pts) {
      out.push(`<circle cx="${px(p.i).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="5" fill="var(--ring)"/>`);
      out.push(`<circle cx="${px(p.i).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="3.2" fill="${s.color}"/>`);
    }
  }

  rows.forEach((r, i) => {
    out.push(`<text x="${px(i).toFixed(1)}" y="${Y1 + 16}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--mono)" font-size="10.5">${new Date(r.hour_at).getHours()}시</text>`);
    out.push(`<text x="${px(i).toFixed(1)}" y="${Y1 + 28}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="9.5">${r.lec_n}명</text>`);
  });

  // 선이 둘이라 범례가 필요합니다
  series.forEach((s, k) => {
    const lx = X0 + k * 70;
    out.push(`<circle cx="${lx}" cy="${H - 6}" r="4" fill="${s.color}"/>`);
    out.push(`<text x="${lx + 8}" y="${H - 2}" fill="var(--ink-2)" font-family="var(--sans)" font-size="10.5">${s.name}</text>`);
  });

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = out.join("");
}

/**
 * -2 ~ +2 눈금 위에 바늘 하나. 강의 난이도·속도와 "지금 체감"에 씁니다.
 * @param {string[]} labels 왼쪽 끝 · 가운데 · 오른쪽 끝 라벨
 */
export function gaugeSVG(value, n, labels, tone = "neutral") {
  const W = 300, H = 62, X0 = 30, X1 = 270, Y = 30;
  const x = (v) => X0 + ((clamp(v, -2, 2) + 2) / 4) * (X1 - X0);
  const stroke = tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--ink)";
  const out = [];

  out.push(`<line x1="${X0}" y1="${Y}" x2="${X1}" y2="${Y}" stroke="var(--line-2)" stroke-width="2" stroke-linecap="round" fill="none"/>`);
  for (let v = -2; v <= 2; v++) {
    out.push(`<line x1="${x(v).toFixed(1)}" y1="${Y - 4}" x2="${x(v).toFixed(1)}" y2="${Y + 4}" stroke="var(--line-2)" stroke-width="${v === 0 ? 2 : 1}" fill="none"/>`);
  }
  out.push(`<circle cx="${x(0).toFixed(1)}" cy="${Y}" r="3" fill="var(--line-2)"/>`);

  if (n > 0 && Number.isFinite(value)) {
    out.push(`<circle cx="${x(value).toFixed(1)}" cy="${Y}" r="9" fill="var(--ring)"/>`);
    out.push(`<circle cx="${x(value).toFixed(1)}" cy="${Y}" r="6.5" fill="${stroke}"/>`);
    out.push(`<text x="${x(value).toFixed(1)}" y="${Y - 14}" text-anchor="middle" fill="var(--ink)" font-family="var(--mono)" font-size="11.5" font-weight="600">${value > 0 ? "+" : ""}${value.toFixed(1)}</text>`);
  } else {
    out.push(`<text x="${((X0 + X1) / 2).toFixed(1)}" y="${Y - 13}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="11">응답 대기 중</text>`);
  }

  out.push(`<text x="${X0}" y="${Y + 20}" text-anchor="start" fill="var(--ink-3)" font-family="var(--sans)" font-size="10.5">${esc(labels[0])}</text>`);
  out.push(`<text x="${((X0 + X1) / 2).toFixed(1)}" y="${Y + 20}" text-anchor="middle" fill="var(--ink-3)" font-family="var(--sans)" font-size="10.5">${esc(labels[1])}</text>`);
  out.push(`<text x="${X1}" y="${Y + 20}" text-anchor="end" fill="var(--ink-3)" font-family="var(--sans)" font-size="10.5">${esc(labels[2])}</text>`);

  return `<svg viewBox="0 0 ${W} ${H}" class="gauge" role="img" aria-label="${esc(labels[1])} 게이지">${out.join("")}</svg>`;
}

/**
 * 자리 구역 미니 지도 (앞/뒤 × 왼쪽/오른쪽).
 * 각 칸에 그 구역을 때리는 에어컨을 같이 표시해서,
 * "어느 유닛을 건드려야 하는지"까지 한 화면에서 읽히게 합니다.
 */
export function zoneMapHTML(rows, mine, overallAvg) {
  return rows
    .map((z) => {
      const on = mine === z.i;
      let sub = "—";
      let cls = "";
      if (z.shown) {
        const diff = z.avg - overallAvg;
        sub = `${fmt(z.avg)}°`;
        if (Math.abs(diff) >= 0.5) cls = diff > 0 ? "cold" : "hot";
      } else if (z.n) {
        sub = `${z.n}명`;
      }
      // 이 구역에서 바람을 약하게 해달라는 소리가 나오면 표시합니다
      const windy = z.windN >= 2 && z.windAvg <= -0.5 ? '<span class="zwind">💨 바람 셈</span>' : "";
      return (
        `<button class="zone ${cls}" type="button" data-zone="${z.i}" aria-pressed="${on}" ` +
        `title="${esc(z.acName)}">` +
        `<span class="zac">${z.ac} ${esc(z.acName)}</span>` +
        `<span class="zname">${esc(z.name)}</span>` +
        `<span class="zval">${sub}</span>` +
        `<span class="zn">${z.n}명${windy ? " · " : ""}</span>${windy}` +
        `</button>`
      );
    })
    .join("");
}
