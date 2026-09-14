/**
 * 세계 — 강의실과 마당.
 *
 * 바닥을 원근으로 깝니다. 뒤는 좁고 앞은 넓은 사다리꼴이고, 뒤에 선
 * 캐릭터일수록 작게 그려요. 위에서 내려다본 평면 격자로 그리면 아무리
 * 색을 예쁘게 칠해도 스프레드시트처럼 보입니다.
 *
 * 좌표는 두 종류입니다.
 *   논리 좌표  x,y 0~100. 자리 판정·이동에 쓰는 "바닥 위의 위치"
 *   화면 좌표  project() 를 통과한 값. 실제로 그려지는 위치
 * 클릭은 unproject() 로 되돌립니다.
 *
 * 바닥 여섯 칸이 곧 "내 자리"예요. 한 칸에 5~6명이 들어가니 누가 누군지는
 * 안 보이고 "뒤쪽 왼쪽이 춥다"만 남습니다. 정확한 책상을 찍게 하면
 * 자리표에 이름이 적혀 있어 바로 들킵니다.
 *
 * 위치는 어디에도 저장하지 않습니다. 창을 닫으면 사라져요.
 */

import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const CHAT_MS = 8000;
export const REACTIONS = ["👏", "😂", "🔥", "👍", "🥶", "🥵", "❓", "💤", "🙏", "🎉"];

const SPEED = 34, MIN_MS = 200, MAX_MS = 1800;

/* ── 원근 ────────────────────────────────────────────────────────────── */
const PR = { backY: 28, frontY: 95, backHalf: 29, frontHalf: 49 };

export function project(x, y) {
  const t = clamp(y, 0, 100) / 100;
  const half = PR.backHalf + (PR.frontHalf - PR.backHalf) * t;
  return {
    left: 50 + ((x - 50) / 50) * half,
    top: PR.backY + (PR.frontY - PR.backY) * t,
    scale: 0.64 + 0.5 * t,
  };
}

export function unproject(sx, sy) {
  const t = clamp((sy - PR.backY) / (PR.frontY - PR.backY), 0, 1);
  const half = PR.backHalf + (PR.frontHalf - PR.backHalf) * t;
  return clampPos(50 + ((sx - 50) / half) * 50, t * 100);
}

const clampPos = (x, y) => ({ x: clamp(x, 3, 97), y: clamp(y, 3, 97) });

const VW = 160, VH = 90;
/** 논리 좌표 → viewBox 좌표. 반드시 숫자로 돌려줍니다 —
 *  문자열이면 이걸로 계산하는 곳에서 조용히 이어붙이기가 돼요. */
function pt(x, y) {
  const p = project(x, y);
  return [(p.left * VW) / 100, (p.top * VH) / 100];
}
const P2 = (x, y) => { const [a, b] = pt(x, y); return `${a.toFixed(2)} ${b.toFixed(2)}`; };

/* ── TV 화면에 띄우는 안내 ───────────────────────────────────────────── */
// 이 앱이 뭐 하는 곳인지 강의실 안에서 바로 읽히게. 화면 밖 안내문은
// 아무도 안 읽지만, 벽에 걸린 TV 는 눈에 들어옵니다.
export const TV_SLIDES = [
  ["덥다 · 춥다", "편하게 말하는 곳", "🔒 완전 익명"],
  ["누가 썼는지", "아무도 몰라요", "이름도 계정도 없음"],
  ["강의가 빠른지 어려운지도", "눈치 안 보고 한마디", "🎓 정각마다 초기화"],
  ["왼쪽 온도계를 눌러", "원하는 온도를 고르세요", "👆 아무 때나 바꿔도 돼요"],
];

/* ── 방 ──────────────────────────────────────────────────────────────── */

const ZW = 26, ZX = [4, 32, 60];
export const ZONE_MIN = 4;

export const ROOMS = {
  classroom: {
    key: "classroom", name: "강의실", icon: "📺",
    doors: [
      { id: "front", x: 88, y: 8,  w: 12, h: 28, to: "yard", label: "앞문" },
      { id: "back",  x: 88, y: 48, w: 12, h: 30, to: "yard", label: "뒷문" },
    ],
    zones: [
      { i: 0, name: "앞 · 왼쪽",   short: "앞·왼",   x: ZX[0], y: 12, w: ZW, h: 34, hue: "peach" },
      { i: 1, name: "앞 · 가운데", short: "앞·중",   x: ZX[1], y: 12, w: ZW, h: 34, hue: "mint" },
      { i: 2, name: "앞 · 오른쪽", short: "앞·오",   x: ZX[2], y: 12, w: ZW, h: 34, hue: "butter" },
      { i: 3, name: "뒤 · 왼쪽",   short: "뒤·왼",   x: ZX[0], y: 50, w: ZW, h: 40, hue: "lilac" },
      { i: 4, name: "뒤 · 가운데", short: "뒤·중",   x: ZX[1], y: 50, w: ZW, h: 40, hue: "sky" },
      { i: 5, name: "뒤 · 오른쪽", short: "뒤·오",   x: ZX[2], y: 50, w: ZW, h: 40, hue: "rose" },
    ],
  },
  yard: {
    key: "yard", name: "마당", icon: "🌳",
    doors: [
      { id: "front", x: 0, y: 8,  w: 12, h: 28, to: "classroom", label: "앞문" },
      { id: "back",  x: 0, y: 48, w: 12, h: 30, to: "classroom", label: "뒷문" },
    ],
    zones: [],
  },
};

export const ZONES = ROOMS.classroom.zones;

export function spawnPos(roomKey, doorId) {
  // 문으로 들어왔으면 그 문 앞에서 시작합니다
  if (doorId) {
    const d = ROOMS[roomKey].doors.find((d) => d.id === doorId);
    if (d) {
      const inward = roomKey === "yard" ? 16 : -16;
      return clampPos(d.x + d.w / 2 + inward, d.y + d.h / 2 + (Math.random() - 0.5) * 8);
    }
  }
  const base = roomKey === "yard" ? { x: 52, y: 72 } : { x: 46, y: 70 };
  return clampPos(base.x + (Math.random() - 0.5) * 26, base.y + (Math.random() - 0.5) * 18);
}

export function walkDuration(from, to) {
  if (!from) return 0;
  const d = Math.hypot(to.x - from.x, (to.y - from.y) * 0.7);
  return Math.max(MIN_MS, Math.min(MAX_MS, (d / SPEED) * 1000));
}

export function pointToPos(ev, el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return unproject(((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100);
}

const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** 문을 밟았나. 밟았으면 { to, id }. */
export function doorAt(roomKey, pos) {
  const d = ROOMS[roomKey]?.doors.find((d) => inRect(pos, d));
  return d ? { to: d.to, id: d.id } : null;
}

export function zoneAt(roomKey, pos) {
  if (roomKey !== "classroom" || !pos) return null;
  const z = ROOMS.classroom.zones.find((z) => inRect(pos, z));
  return z ? z.i : null;
}

export function zoneCounts(people) {
  const m = new Map();
  for (const p of people) {
    if (p.room !== "classroom") continue;
    const z = zoneAt("classroom", p);
    if (z !== null) m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}

/* ── 기류 ────────────────────────────────────────────────────────────── */
//
// 이 앱의 결론을 눈으로 보여주는 부분입니다.
// "뒤·왼쪽 바람 줄이고 앞·가운데로 더" 를 글로 읽는 것보다,
// 천장 송풍구에서 그쪽으로 흘러가는 기류를 보는 게 훨씬 빠릅니다.
//
//   바람을 더 보내야 하는 구역  →  굵고 빠르게 흐르는 줄기 셋
//   바람을 줄여야 하는 구역      →  중간에 휘어 빠져나가는 흐린 줄기 + ↩ 표시
//   그대로 둬도 되는 구역        →  가는 줄기 하나

// 천장 송풍구 — 큼직한 에어컨 그림 대신 얇은 슬릿으로만.
const VENTS = [
  { x: 22, label: "왼" },
  { x: 50, label: "가운데" },
  { x: 78, label: "오른" },
];

function ventSlits() {
  return VENTS.map((v) => {
    const [vx] = pt(v.x, 0);
    return (
      `<g class="vent">` +
      `<rect x="${(vx - 7).toFixed(2)}" y="1.2" width="14" height="2.6" rx="1.3" fill="var(--vent)"/>` +
      `<rect x="${(vx - 5.6).toFixed(2)}" y="2" width="11.2" height=".7" rx=".35" fill="var(--vent-2)"/>` +
      `<rect x="${(vx - 5.6).toFixed(2)}" y="3" width="11.2" height=".7" rx=".35" fill="var(--vent-2)"/>` +
      `</g>`
    );
  }).join("");
}

/** 송풍구에서 구역 한가운데로 흐르는 곡선 하나. */
function streamPath(vent, z, spread, dodge) {
  const [sx] = pt(vent.x, 0);
  const sy = 4.2;
  const [ex, ey] = pt(z.x + z.w / 2 + spread, z.y + z.h * 0.45);
  // 비껴 나가는 흐름은 목적지 옆으로 휘어 지나갑니다
  const tx = dodge ? ex + (ex > 80 ? 26 : -26) : ex;
  const ty = dodge ? ey - 8 : ey;
  const c1y = sy + (ty - sy) * 0.35;
  const c2x = dodge ? sx + (tx - sx) * 0.9 : sx + (tx - sx) * 0.5;
  return `M ${sx.toFixed(1)} ${sy} C ${(sx + (tx - sx) * 0.15).toFixed(1)} ${c1y.toFixed(1)}, ` +
         `${c2x.toFixed(1)} ${(ty - 12).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
}

/** 구역에서 제일 가까운 송풍구. */
function nearestVent(z) {
  const cx = z.x + z.w / 2;
  return VENTS.reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a));
}

export function windStreams(zones, flows) {
  if (!flows) return "";
  const out = [];

  for (const z of zones) {
    const f = flows.get(z.i);
    const dir = f?.dir ?? 0;
    const vent = nearestVent(z);
    const dodge = dir < 0;
    const count = dir > 0 ? 3 : dir < 0 ? 2 : 1;
    const cls = dir > 0 ? "more" : dir < 0 ? "less" : "keep";

    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 6;
      out.push(
        `<path class="stream ${cls}" d="${streamPath(vent, z, spread, dodge)}" ` +
        `style="animation-delay:${(i * 0.45).toFixed(2)}s"/>`
      );
    }

    // 비껴 보내라는 구역엔 ↩ 를 하나 얹습니다
    if (dir < 0) {
      const [bx, by] = pt(z.x + z.w / 2, z.y + z.h * 0.45);
      out.push(`<text x="${bx.toFixed(1)}" y="${(by - 2).toFixed(1)}" text-anchor="middle" class="dodge">↩</text>`);
    }
  }
  return `<g class="streams">${out.join("")}</g>`;
}

/* ── 배경 ────────────────────────────────────────────────────────────── */
//
// 3D 느낌은 측면 벽에서 나옵니다. 뒷벽만 그리면 아무리 칠해도 평면이에요.
// 왼벽·오른벽이 뒤로 모이면서 소실점을 만들고, 면마다 밝기를 달리 주면
// 방이 깊어 보입니다. 바닥 조명·입체 책상·비네트까지 얹으면 렌더링한
// 장면처럼 읽혀요.

function floorCorners() {
  const [blx, bly] = pt(-10, 0);
  const [brx] = pt(110, 0);
  const [flx, fly] = pt(-16, 100);
  const [frx] = pt(116, 100);
  return { blx, bly, brx, flx, fly, frx };
}

/** 방의 껍데기 — 천장 · 뒷벽 · 좌우 벽. */
function shell(wallVar) {
  const { blx, bly, brx, flx, fly, frx } = floorCorners();
  const CT = 2, CF = -26;
  return (
    `<path d="M ${blx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${CT} L ${frx.toFixed(1)} ${CF} L ${flx.toFixed(1)} ${CF} Z" fill="var(--ceil)"/>` +
    `<rect x="${blx.toFixed(1)}" y="${CT}" width="${(brx - blx).toFixed(1)}" height="${(bly - CT).toFixed(1)}" fill="var(--${wallVar})"/>` +
    `<path d="M ${blx.toFixed(1)} ${CT} L ${blx.toFixed(1)} ${bly.toFixed(1)} L ${flx.toFixed(1)} ${fly.toFixed(1)} L ${flx.toFixed(1)} ${CF} Z" fill="var(--wall-l)"/>` +
    `<path d="M ${brx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${bly.toFixed(1)} L ${frx.toFixed(1)} ${fly.toFixed(1)} L ${frx.toFixed(1)} ${CF} Z" fill="var(--wall-r)"/>` +
    `<path d="M ${blx.toFixed(1)} ${CT} L ${blx.toFixed(1)} ${bly.toFixed(1)} M ${brx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${bly.toFixed(1)}" stroke="var(--edge)" stroke-width=".9"/>`
  );
}

function floorPlate(fillVar) {
  const { blx, bly, brx, flx, fly, frx } = floorCorners();
  const d = `M ${blx.toFixed(1)} ${bly.toFixed(1)} L ${brx.toFixed(1)} ${bly.toFixed(1)} ` +
            `L ${frx.toFixed(1)} ${fly.toFixed(1)} L ${flx.toFixed(1)} ${fly.toFixed(1)} Z`;
  return (
    `<path d="${d}" fill="var(--${fillVar})"/>` +
    `<path d="${d}" fill="url(#lightPool)"/>` +
    `<path d="M ${blx.toFixed(1)} ${bly.toFixed(1)} L ${brx.toFixed(1)} ${bly.toFixed(1)}" stroke="var(--edge)" stroke-width="1.4" opacity=".5"/>`
  );
}

/**
 * 러그 = 구역. 이 앱의 진짜 목적이 여기 찍힙니다.
 *
 * 온도 하나로 36명을 다 맞추는 건 불가능합니다 (ASHRAE 기준으로도 최선이
 * 80% 만족). 그래서 온도는 하나로 정하고, 남는 차이는 **바람으로** 메웁니다.
 * 이 구역이 합의보다 따뜻하길 원하면 = 여기가 춥다 = 바람을 줄이고,
 * 시원하길 원하면 = 여기가 덥다 = 바람을 더 보냅니다.
 */
function rug(z, n, flow) {
  const pad = 1.2;
  const r = { x: z.x + pad, y: z.y + pad, w: z.w - pad * 2, h: z.h - pad * 2 };
  const [mx, my] = pt(z.x + z.w / 2, z.y + z.h - 4);
  const [bx, by] = pt(z.x + z.w / 2, z.y + 5);
  const d = `M ${P2(r.x, r.y)} L ${P2(r.x + r.w, r.y)} L ${P2(r.x + r.w, r.y + r.h)} L ${P2(r.x, r.y + r.h)} Z`;

  let badge = "";
  if (flow && flow.dir !== 0) {
    const warm = flow.dir < 0;                    // 바람 줄이기 = 여기가 춥다
    const w = 26, h = 8.4;
    badge =
      `<g class="flowb ${warm ? "less" : "more"}">` +
      `<rect x="${(bx - w / 2).toFixed(2)}" y="${(by - h / 2).toFixed(2)}" width="${w}" height="${h}" rx="${h / 2}" ` +
      `fill="${warm ? "var(--flow-less)" : "var(--flow-more)"}"/>` +
      `<text x="${bx.toFixed(2)}" y="${(by + 2.6).toFixed(2)}" text-anchor="middle" class="flab">` +
      `${warm ? "바람 줄여 ↓" : "바람 더 ↑"}</text></g>`;
  }

  return (
    `<g class="rug">` +
    `<path d="${d}" fill="var(--rug-${z.hue})" stroke="var(--rug-${z.hue}-line)" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="url(#rugShade)"/>` +
    `<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" class="rlab">${esc(z.short)}${n ? ` ${n}` : ""}</text>` +
    badge +
    `</g>`
  );
}

/** 입체 책상 — 윗면·앞면·옆면을 따로 칠해 상자로. */
function desk(x, y, w, dep = 4) {
  const sc = project(x, y).scale;
  const h = 5.2 * sc;
  const [blx, bly] = pt(x, y), [brx, bry] = pt(x + w, y);
  const [tlx, tly] = pt(x, y - dep), [trx, tryy] = pt(x + w, y - dep);
  const up = (v) => (v - h).toFixed(2);
  return (
    `<g class="desk">` +
    `<ellipse cx="${((blx + brx) / 2).toFixed(2)}" cy="${bly.toFixed(2)}" rx="${((brx - blx) / 2 + 1).toFixed(2)}" ry="${(1.1 * sc).toFixed(2)}" fill="rgba(0,0,0,.16)"/>` +
    `<path d="M ${blx.toFixed(2)} ${up(bly)} L ${brx.toFixed(2)} ${up(bry)} L ${brx.toFixed(2)} ${bry.toFixed(2)} L ${blx.toFixed(2)} ${bly.toFixed(2)} Z" fill="var(--desk-front)"/>` +
    `<path d="M ${tlx.toFixed(2)} ${up(tly)} L ${trx.toFixed(2)} ${up(tryy)} L ${brx.toFixed(2)} ${up(bry)} L ${blx.toFixed(2)} ${up(bly)} Z" fill="var(--desk-top)"/>` +
    `<path d="M ${trx.toFixed(2)} ${up(tryy)} L ${brx.toFixed(2)} ${up(bry)} L ${brx.toFixed(2)} ${bry.toFixed(2)} L ${trx.toFixed(2)} ${(tryy + h * 0.4).toFixed(2)} Z" fill="var(--desk-side)"/>` +
    `</g>`
  );
}

function archDoor(d, roomKey) {
  const cx = d.x + d.w / 2;
  const [lx, ly] = pt(d.x + 1, d.y + d.h);
  const [rx] = pt(d.x + d.w - 1, d.y + d.h);
  const [, ty] = pt(cx, Math.max(d.y - 6, 0));
  const [nx, ny] = pt(cx, d.y + d.h + 5);
  const w = Math.abs(rx - lx);
  const knobX = roomKey === "yard" ? lx + w * 0.76 : lx + w * 0.22;
  const arch = (ix) =>
    `M ${(lx + ix).toFixed(2)} ${ly.toFixed(2)} L ${(lx + ix).toFixed(2)} ${(ty + ix).toFixed(2)} ` +
    `A ${(w / 2 - ix).toFixed(2)} ${(w / 2.1 - ix).toFixed(2)} 0 0 1 ${(rx - ix).toFixed(2)} ${(ty + ix).toFixed(2)} ` +
    `L ${(rx - ix).toFixed(2)} ${ly.toFixed(2)} Z`;
  return (
    `<g class="door" data-door="${esc(d.id)}">` +
    `<path d="${arch(0)}" fill="var(--door-frame)"/>` +
    `<path d="${arch(1.6)}" fill="var(--door-fill)" stroke="var(--door-line)" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="${arch(1.6)}" fill="url(#doorGlow)"/>` +
    `<circle cx="${knobX.toFixed(2)}" cy="${((ly + ty) / 2).toFixed(2)}" r="1.3" fill="var(--door-line)"/>` +
    `<text x="${nx.toFixed(2)}" y="${ny.toFixed(2)}" text-anchor="middle" class="dlab">${esc(d.label)}</text>` +
    `</g>`
  );
}

function tvScreen(slide) {
  const [l1, l2, l3] = slide;
  return (
    `<g class="tv">` +
    `<rect x="44.6" y="2.4" width="70.8" height="29.2" rx="3.4" fill="var(--tv-shadow)"/>` +
    `<rect x="46" y="3" width="68" height="27" rx="3" fill="var(--tv-frame)"/>` +
    `<rect x="48.4" y="5" width="63.2" height="21.6" rx="2" fill="var(--tv)"/>` +
    `<rect x="48.4" y="5" width="63.2" height="21.6" rx="2" fill="url(#glassGlow)"/>` +
    `<rect x="76" y="30" width="8" height="2.4" rx="1.2" fill="var(--tv-frame)"/>` +
    `<text x="80" y="12.4" text-anchor="middle" class="tv1">${esc(l1)}</text>` +
    `<text x="80" y="18.6" text-anchor="middle" class="tv2">${esc(l2)}</text>` +
    `<text x="80" y="24.4" text-anchor="middle" class="tv3">${esc(l3)}</text>` +
    `</g>`
  );
}

function defs() {
  const { bly, fly } = floorCorners();
  return (
    `<defs>` +
    `<radialGradient id="lightPool" cx="50%" cy="16%" r="78%">` +
    `<stop offset="0%" stop-color="#fff" stop-opacity=".18"/><stop offset="58%" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity=".2"/></radialGradient>` +
    `<linearGradient id="rugShade" x1="0" y1="${bly.toFixed(1)}" x2="0" y2="${fly.toFixed(1)}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>` +
    `<linearGradient id="glassGlow" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset="55%" stop-color="#fff" stop-opacity=".04"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity=".14"/></linearGradient>` +
    `<linearGradient id="doorGlow" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="100%" stop-color="#000" stop-opacity=".12"/></linearGradient>` +
    `<radialGradient id="vignette" cx="50%" cy="44%" r="72%">` +
    `<stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".32"/></radialGradient>` +
    `<radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#fff7d6" stop-opacity=".85"/><stop offset="100%" stop-color="#fff7d6" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `</defs>`
  );
}

/**
 * @param {Map} counts 구역별 인원
 * @param {Map} flows  구역별 바람 배분 지시 { dir: -1|0|1, ... }
 */
export function roomSVG(roomKey, counts, slideIdx = 0, flows) {
  const room = ROOMS[roomKey];
  const p = [`<svg class="roombg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">`, defs()];

  if (roomKey === "classroom") {
    p.push(shell("wall"), floorPlate("wood"), tvScreen(TV_SLIDES[slideIdx % TV_SLIDES.length]));
    for (const z of room.zones) {
      p.push(desk(z.x + 2.5, z.y + 7, z.w * 0.38), desk(z.x + z.w * 0.55, z.y + 7, z.w * 0.38));
    }
    for (const z of room.zones) p.push(rug(z, counts?.get(z.i) ?? 0, flows?.get(z.i)));
    p.push(ventSlits(), windStreams(room.zones, flows));
    p.push(
      `<g><ellipse cx="12" cy="34" rx="5.4" ry="1.8" fill="rgba(0,0,0,.2)"/>` +
      `<path d="M 8.8 34 h 6.4 l -.9 -6.6 h -4.6 Z" fill="#cf8f66"/>` +
      `<path d="M 8.8 34 h 3.2 l -.45 -6.6 h -2.3 Z" fill="#b87a52"/>` +
      `<circle cx="12" cy="24.6" r="4.8" fill="#5cb87a"/><circle cx="8.4" cy="26.8" r="3.2" fill="#6bc98a"/>` +
      `<circle cx="15.6" cy="26.8" r="3.2" fill="#4ba86c"/></g>`
    );
  } else {
    p.push(
      `<rect width="${VW}" height="${VH}" fill="var(--sky)"/>`,
      `<rect width="${VW}" height="40" fill="url(#skyFade)"/>`,
      `<circle cx="138" cy="12" r="20" fill="url(#sunGlow)"/><circle cx="138" cy="12" r="8" fill="var(--sun)"/>`,
      `<g fill="var(--cloud)"><ellipse cx="40" cy="11" rx="12" ry="4.8"/><ellipse cx="49" cy="9" rx="7.5" ry="4.2"/>` +
        `<ellipse cx="100" cy="16" rx="9.5" ry="4"/></g>`,
      `<path d="M 0 26 q 28 -10 56 -2 q 32 9 60 -3 q 26 -9 44 1 L 160 32 L 0 32 Z" fill="var(--hill-far)"/>`,
      `<path d="M 0 30 q 34 -7 62 0 q 30 7 54 -2 q 26 -7 44 2 L 160 36 L 0 36 Z" fill="var(--hill2)"/>`,
      floorPlate("grass"),
      `<g><ellipse cx="42" cy="46" rx="10.5" ry="3.2" fill="rgba(0,0,0,.2)"/>` +
        `<path d="M 39.8 46 h 4.4 l -.7 -12 h -3 Z" fill="#8d6748"/>` +
        `<path d="M 39.8 46 h 2.2 l -.35 -12 h -1.5 Z" fill="#7a573c"/>` +
        `<circle cx="42" cy="29" r="10.5" fill="#43a366"/><circle cx="33.6" cy="33" r="7" fill="#4db473"/>` +
        `<circle cx="50.4" cy="33" r="7" fill="#3a9159"/>` +
        `<circle cx="38.6" cy="25.6" r="4.4" fill="#5cc286" opacity=".7"/></g>`,
      `<g><ellipse cx="124" cy="54" rx="17" ry="3.4" fill="rgba(0,0,0,.2)"/>` +
        `<rect x="109" y="45" width="30" height="3.6" rx="1.8" fill="#c99a6c"/>` +
        `<rect x="109" y="47" width="30" height="1.6" rx=".8" fill="#a87b50"/>` +
        `<rect x="109" y="39.4" width="30" height="3.2" rx="1.6" fill="#d4a877"/>` +
        `<rect x="112" y="48.4" width="2.8" height="5.4" rx="1.4" fill="#8d6748"/>` +
        `<rect x="133.2" y="48.4" width="2.8" height="5.4" rx="1.4" fill="#8d6748"/></g>`,
      `<g><ellipse cx="80" cy="48" rx="10" ry="2.8" fill="rgba(0,0,0,.2)"/>` +
        `<rect x="71" y="27" width="17" height="21" rx="2.6" fill="#5a7fb5"/>` +
        `<rect x="84.6" y="27" width="3.4" height="21" rx="1.6" fill="#4a6b9c"/>` +
        `<rect x="73.2" y="29.8" width="8.4" height="11.6" rx="1.5" fill="#d9e8f7"/>` +
        `<rect x="73.2" y="29.8" width="8.4" height="11.6" rx="1.5" fill="url(#glassGlow)"/>` +
        `<circle cx="83.4" cy="31.4" r="1.2" fill="#f6b8cd"/><circle cx="83.4" cy="35.6" r="1.2" fill="#ffd66b"/>` +
        `<circle cx="83.4" cy="39.8" r="1.2" fill="#8fc9e8"/></g>`,
      `<path d="M 28 68 q 1.5 -4.2 3 0 M 33 73 q 1.5 -3.6 3 0 M 140 64 q 1.5 -4.2 3 0
                M 146 70 q 1.5 -3.6 3 0 M 66 80 q 1.7 -4.6 3.4 0"
             fill="none" stroke="var(--blade)" stroke-width="1" stroke-linecap="round"/>`
    );
  }

  for (const d of room.doors) p.push(archDoor(d, roomKey));
  p.push(`<rect width="${VW}" height="${VH}" fill="url(#vignette)" pointer-events="none"/>`, `</svg>`);
  return p.join("");
}

/* ── 사람 ────────────────────────────────────────────────────────────── */

export function paintPeople(layer, people, meKey, prev) {
  const seen = new Set();

  for (const p of people) {
    seen.add(p.key);
    const before = prev.get(p.key);
    let el = layer.querySelector(`[data-key="${CSS.escape(p.key)}"]`);

    if (!el) {
      el = document.createElement("div");
      el.className = "person";
      el.dataset.key = p.key;
      el.innerHTML =
        `<span class="say" hidden></span>` +
        `<span class="body"><svg viewBox="0 0 44 48" aria-hidden="true"></svg></span>` +
        `<span class="tag"></span>`;
      layer.appendChild(el);
      el.style.transitionDuration = "0ms";
    } else {
      el.style.transitionDuration = `${walkDuration(before, p)}ms`;
    }

    const sig = `${p.cfg.cc}.${p.cfg.ce}.${p.cfg.ch}.${p.cfg.cp}.${p.cfg.ci}`;
    if (el.dataset.sig !== sig) {
      el.querySelector(".body svg").innerHTML = creature(p.cfg, "happy");
      el.dataset.sig = sig;
    }

    const s = project(p.x, p.y);
    el.classList.toggle("me", p.key === meKey);
    el.style.left = `${s.left.toFixed(2)}%`;
    el.style.top = `${s.top.toFixed(2)}%`;
    el.style.setProperty("--s", s.scale.toFixed(3));
    el.style.zIndex = String(Math.round(p.y * 10));

    const tag = el.querySelector(".tag");
    const label = p.nick || "익명";
    if (tag.textContent !== label) tag.textContent = label;

    if (before && Math.abs(p.x - before.x) > 0.4) {
      el.querySelector(".body").style.setProperty("--flip", p.x < before.x ? "-1" : "1");
    }

    const say = el.querySelector(".say");
    if (p.msg && p.msgAt && Date.now() - p.msgAt < CHAT_MS) {
      if (say.textContent !== p.msg) say.textContent = p.msg;
      say.hidden = false;
    } else {
      say.hidden = true;
    }

    prev.set(p.key, { x: p.x, y: p.y });
  }

  for (const el of [...layer.querySelectorAll(".person")]) {
    if (!seen.has(el.dataset.key)) {
      prev.delete(el.dataset.key);
      el.remove();
    }
  }
}

export function popReaction(layer, key, emoji) {
  const el = layer.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!el) return;
  const b = document.createElement("span");
  b.className = "pop";
  b.textContent = emoji;
  el.appendChild(b);
  b.addEventListener("animationend", () => b.remove(), { once: true });
  setTimeout(() => b.remove(), 2600);
}

export function reactionBarHTML() {
  return REACTIONS.map(
    (e) => `<button class="rbtn" type="button" data-react="${esc(e)}" aria-label="${esc(e)} 보내기">${e}</button>`
  ).join("");
}
