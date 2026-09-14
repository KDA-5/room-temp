/**
 * 강의실.
 *
 * 실제 자리표 그대로입니다 — 앞에 TV, 가운데 통로를 두고 왼쪽 블록(3열)과
 * 오른쪽 블록(2열), 오른쪽 벽에 앞문·뒷문. 문은 그림일 뿐이고 나가는 곳은
 * 없습니다.
 *
 * 바닥을 원근으로 깝니다. 뒤는 좁고 앞은 넓은 사다리꼴이고, 뒤에 선
 * 캐릭터일수록 작게 그려요. 위에서 내려다본 평면 격자로 그리면 아무리
 * 색을 예쁘게 칠해도 스프레드시트처럼 보입니다.
 *
 * 좌표는 두 종류입니다.
 *   논리 좌표  x,y 0~100. 자리 판정·이동에 쓰는 "바닥 위의 위치"
 *   화면 좌표  project() 를 통과한 값. 실제로 그려지는 위치
 *
 * 구역 여섯이 곧 "내 자리"예요. 한 칸에 5~6명이 들어가니 누가 누군지는
 * 안 보이고 "왼쪽 뒤가 춥다"만 남습니다. 정확한 책상을 찍게 하면
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
const PR = { backY: 27, frontY: 95, backHalf: 30, frontHalf: 49 };

export function project(x, y) {
  const t = clamp(y, 0, 100) / 100;
  const half = PR.backHalf + (PR.frontHalf - PR.backHalf) * t;
  return {
    left: 50 + ((x - 50) / 50) * half,
    top: PR.backY + (PR.frontY - PR.backY) * t,
    scale: 0.62 + 0.52 * t,
  };
}

export function unproject(sx, sy) {
  const t = clamp((sy - PR.backY) / (PR.frontY - PR.backY), 0, 1);
  const half = PR.backHalf + (PR.frontHalf - PR.backHalf) * t;
  return clampPos(50 + ((sx - 50) / half) * 50, t * 100);
}

const clampPos = (x, y) => ({ x: clamp(x, 3, 97), y: clamp(y, 3, 97) });

const VW = 160, VH = 90;
/** 논리 좌표 → viewBox 좌표. 반드시 숫자로 (문자열이면 계산이 이어붙이기가 됩니다). */
function pt(x, y) {
  const p = project(x, y);
  return [(p.left * VW) / 100, (p.top * VH) / 100];
}
const P2 = (x, y) => { const [a, b] = pt(x, y); return `${a.toFixed(2)} ${b.toFixed(2)}`; };

/* ── TV 안내 ─────────────────────────────────────────────────────────── */
// 이 앱이 뭐 하는 곳인지 강의실 안에서 바로 읽히게. 화면 밖 안내문은
// 아무도 안 읽지만, 벽에 걸린 TV 는 눈에 들어옵니다.
export const TV_SLIDES = [
  ["덥다 · 춥다", "편하게 말하는 곳", "🔒 완전 익명"],
  ["누가 썼는지", "아무도 몰라요", "이름도 계정도 없습니다"],
  ["온도가 안 맞으면", "바람으로 맞춥니다", "🌬️ 구역별로 배분"],
  ["강의가 빠른지 어려운지도", "눈치 안 보고 한마디", "🎓 정각마다 초기화"],
];

/* ── 방 ──────────────────────────────────────────────────────────────── */
// 자리표 그대로: 왼쪽 블록이 넓고(3열), 오른쪽 블록이 좁고(2열),
// 그 사이에 통로, 오른쪽 벽에 앞문·뒷문.

const LEFT_X = 6, LEFT_W = 38;
const RIGHT_X = 52, RIGHT_W = 30;
export const ZONE_MIN = 4;

export const ROOM = {
  name: "강의실", icon: "📺",
  doors: [
    { id: "front", x: 87, y: 14, w: 11, h: 24, label: "앞문" },
    { id: "back",  x: 87, y: 52, w: 11, h: 26, label: "뒷문" },
  ],
  zones: [
    { i: 0, name: "왼쪽 · 앞",     short: "왼·앞", x: LEFT_X,  y: 10, w: LEFT_W,  h: 26, hue: "peach" },
    { i: 1, name: "왼쪽 · 가운데", short: "왼·중", x: LEFT_X,  y: 38, w: LEFT_W,  h: 27, hue: "butter" },
    { i: 2, name: "왼쪽 · 뒤",     short: "왼·뒤", x: LEFT_X,  y: 67, w: LEFT_W,  h: 26, hue: "lilac" },
    { i: 3, name: "오른쪽 · 앞",     short: "오·앞", x: RIGHT_X, y: 10, w: RIGHT_W, h: 26, hue: "mint" },
    { i: 4, name: "오른쪽 · 가운데", short: "오·중", x: RIGHT_X, y: 38, w: RIGHT_W, h: 27, hue: "sky" },
    { i: 5, name: "오른쪽 · 뒤",     short: "오·뒤", x: RIGHT_X, y: 67, w: RIGHT_W, h: 26, hue: "rose" },
  ],
};

export const ZONES = ROOM.zones;

export function spawnPos() {
  return clampPos(26 + Math.random() * 44, 60 + Math.random() * 22);
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

export function zoneAt(pos) {
  if (!pos) return null;
  const z = ROOM.zones.find((z) => inRect(pos, z));
  return z ? z.i : null;
}

export function zoneCounts(people) {
  const m = new Map();
  for (const p of people) {
    const z = zoneAt(p);
    if (z !== null) m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}

/* ── 배경 ────────────────────────────────────────────────────────────── */
// 3D 느낌은 측면 벽에서 나옵니다. 뒷벽만 그리면 아무리 칠해도 평면이에요.

function floorCorners() {
  const [blx, bly] = pt(-10, 0);
  const [brx] = pt(110, 0);
  const [flx, fly] = pt(-16, 100);
  const [frx] = pt(116, 100);
  return { blx, bly, brx, flx, fly, frx };
}

function shell() {
  const { blx, bly, brx, flx, fly, frx } = floorCorners();
  const CT = 2, CF = -26;
  return (
    `<path d="M ${blx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${CT} L ${frx.toFixed(1)} ${CF} L ${flx.toFixed(1)} ${CF} Z" fill="var(--ceil)"/>` +
    `<rect x="${blx.toFixed(1)}" y="${CT}" width="${(brx - blx).toFixed(1)}" height="${(bly - CT).toFixed(1)}" fill="var(--wall)"/>` +
    `<path d="M ${blx.toFixed(1)} ${CT} L ${blx.toFixed(1)} ${bly.toFixed(1)} L ${flx.toFixed(1)} ${fly.toFixed(1)} L ${flx.toFixed(1)} ${CF} Z" fill="var(--wall-l)"/>` +
    `<path d="M ${brx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${bly.toFixed(1)} L ${frx.toFixed(1)} ${fly.toFixed(1)} L ${frx.toFixed(1)} ${CF} Z" fill="var(--wall-r)"/>` +
    `<path d="M ${blx.toFixed(1)} ${CT} L ${blx.toFixed(1)} ${bly.toFixed(1)} M ${brx.toFixed(1)} ${CT} L ${brx.toFixed(1)} ${bly.toFixed(1)}" stroke="var(--edge)" stroke-width=".9"/>`
  );
}

function floorPlate() {
  const { blx, bly, brx, flx, fly, frx } = floorCorners();
  const d = `M ${blx.toFixed(1)} ${bly.toFixed(1)} L ${brx.toFixed(1)} ${bly.toFixed(1)} ` +
            `L ${frx.toFixed(1)} ${fly.toFixed(1)} L ${flx.toFixed(1)} ${fly.toFixed(1)} Z`;
  return `<path d="${d}" fill="var(--wood)"/><path d="${d}" fill="url(#lightPool)"/>` +
         `<path d="M ${blx.toFixed(1)} ${bly.toFixed(1)} L ${brx.toFixed(1)} ${bly.toFixed(1)}" stroke="var(--edge)" stroke-width="1.4" opacity=".5"/>`;
}

/**
 * 구역 러그. 이 앱의 결론이 여기 찍힙니다.
 * 온도 하나로 36명을 다 맞추는 건 불가능해서(ASHRAE 도 최선이 80% 만족),
 * 온도는 하나로 정하고 남는 차이를 바람으로 메웁니다.
 */
function rug(z, n, flow) {
  const pad = 1;
  const r = { x: z.x + pad, y: z.y + pad, w: z.w - pad * 2, h: z.h - pad * 2 };
  const [mx, my] = pt(z.x + z.w / 2, z.y + z.h - 2.5);
  const [bx, by] = pt(z.x + z.w / 2, z.y + 3.5);
  const d = `M ${P2(r.x, r.y)} L ${P2(r.x + r.w, r.y)} L ${P2(r.x + r.w, r.y + r.h)} L ${P2(r.x, r.y + r.h)} Z`;

  let badge = "";
  if (flow && flow.dir !== 0) {
    const less = flow.dir < 0;
    const w = 23, h = 7.2;
    badge =
      `<g class="flowb">` +
      `<rect x="${(bx - w / 2).toFixed(2)}" y="${(by - h / 2).toFixed(2)}" width="${w}" height="${h}" rx="${h / 2}" fill="${less ? "var(--flow-less)" : "var(--flow-more)"}"/>` +
      `<text x="${bx.toFixed(2)}" y="${(by + 2.2).toFixed(2)}" text-anchor="middle" class="flab">${less ? "바람 ↓" : "바람 ↑"}</text></g>`;
  }

  return (
    `<g class="rug">` +
    `<path d="${d}" fill="var(--rug-${z.hue})" stroke="var(--rug-${z.hue}-line)" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="url(#rugShade)"/>` +
    `<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" class="rlab">${esc(z.short)}${n ? ` ${n}` : ""}</text>` +
    badge + `</g>`
  );
}

/** 입체 책상 — 윗면·앞면·옆면을 따로 칠해 상자로. */
function desk(x, y, w, dep = 3.2) {
  const sc = project(x, y).scale;
  const h = 4.6 * sc;
  const [blx, bly] = pt(x, y), [brx, bry] = pt(x + w, y);
  const [tlx, tly] = pt(x, y - dep), [trx, tryy] = pt(x + w, y - dep);
  const up = (v) => (v - h).toFixed(2);
  return (
    `<g class="desk">` +
    `<ellipse cx="${((blx + brx) / 2).toFixed(2)}" cy="${bly.toFixed(2)}" rx="${((brx - blx) / 2 + .8).toFixed(2)}" ry="${(.9 * sc).toFixed(2)}" fill="rgba(0,0,0,.15)"/>` +
    `<path d="M ${blx.toFixed(2)} ${up(bly)} L ${brx.toFixed(2)} ${up(bry)} L ${brx.toFixed(2)} ${bry.toFixed(2)} L ${blx.toFixed(2)} ${bly.toFixed(2)} Z" fill="var(--desk-front)"/>` +
    `<path d="M ${tlx.toFixed(2)} ${up(tly)} L ${trx.toFixed(2)} ${up(tryy)} L ${brx.toFixed(2)} ${up(bry)} L ${blx.toFixed(2)} ${up(bly)} Z" fill="var(--desk-top)"/>` +
    `<path d="M ${trx.toFixed(2)} ${up(tryy)} L ${brx.toFixed(2)} ${up(bry)} L ${brx.toFixed(2)} ${bry.toFixed(2)} L ${trx.toFixed(2)} ${(tryy + h * .4).toFixed(2)} Z" fill="var(--desk-side)"/>` +
    `</g>`
  );
}

/** 자리표 그대로 — 왼쪽 3열, 오른쪽 2열, 가운데는 통로. */
function deskRows() {
  const out = [];
  for (const y of [20, 33, 46, 59, 72, 85]) {
    for (let c = 0; c < 3; c++) out.push(desk(LEFT_X + 2 + c * 12.2, y, 9.4));
    for (let c = 0; c < 2; c++) out.push(desk(RIGHT_X + 2.5 + c * 13.2, y, 10.2));
  }
  return out.join("");
}

/** 문 — 그림입니다. 나가는 곳은 없어요. */
function archDoor(d) {
  const cx = d.x + d.w / 2;
  const [lx, ly] = pt(d.x + 1, d.y + d.h);
  const [rx] = pt(d.x + d.w - 1, d.y + d.h);
  const [, ty] = pt(cx, Math.max(d.y - 7, 0));
  const [nx, ny] = pt(cx, d.y + d.h + 4);
  const w = Math.abs(rx - lx);
  const arch = (ix) =>
    `M ${(lx + ix).toFixed(2)} ${ly.toFixed(2)} L ${(lx + ix).toFixed(2)} ${(ty + ix).toFixed(2)} ` +
    `A ${(w / 2 - ix).toFixed(2)} ${(w / 2.1 - ix).toFixed(2)} 0 0 1 ${(rx - ix).toFixed(2)} ${(ty + ix).toFixed(2)} ` +
    `L ${(rx - ix).toFixed(2)} ${ly.toFixed(2)} Z`;
  return (
    `<g class="door">` +
    `<path d="${arch(0)}" fill="var(--door-frame)"/>` +
    `<path d="${arch(1.4)}" fill="var(--door-fill)" stroke="var(--door-line)" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="${arch(1.4)}" fill="url(#doorGlow)"/>` +
    `<circle cx="${(lx + w * .24).toFixed(2)}" cy="${((ly + ty) / 2).toFixed(2)}" r="1.1" fill="var(--door-line)"/>` +
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

/* ── 기류 ────────────────────────────────────────────────────────────── */
// "왼·뒤 바람 줄이고 오·앞으로 더" 를 글로 읽는 것보다 흐르는 걸 보는 게 빠릅니다.

const VENTS = [{ x: 24 }, { x: 52 }, { x: 76 }];

function ventSlits() {
  return VENTS.map((v) => {
    const [vx] = pt(v.x, 0);
    return `<g class="vent"><rect x="${(vx - 7).toFixed(2)}" y="1.2" width="14" height="2.6" rx="1.3" fill="var(--vent)"/>` +
      `<rect x="${(vx - 5.6).toFixed(2)}" y="2" width="11.2" height=".7" rx=".35" fill="var(--vent-2)"/>` +
      `<rect x="${(vx - 5.6).toFixed(2)}" y="3" width="11.2" height=".7" rx=".35" fill="var(--vent-2)"/></g>`;
  }).join("");
}

const nearestVent = (z) => {
  const cx = z.x + z.w / 2;
  return VENTS.reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a));
};

function streamPath(vent, z, spread, dodge) {
  const [sx] = pt(vent.x, 0);
  const sy = 4.2;
  const [ex, ey] = pt(z.x + z.w / 2 + spread, z.y + z.h * 0.45);
  const tx = dodge ? ex + (ex > 80 ? 24 : -24) : ex;
  const ty = dodge ? ey - 7 : ey;
  const c2x = dodge ? sx + (tx - sx) * 0.9 : sx + (tx - sx) * 0.5;
  return `M ${sx.toFixed(1)} ${sy} C ${(sx + (tx - sx) * .15).toFixed(1)} ${(sy + (ty - sy) * .35).toFixed(1)}, ` +
         `${c2x.toFixed(1)} ${(ty - 11).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
}

export function windStreams(zones, flows) {
  if (!flows) return "";
  const out = [];
  for (const z of zones) {
    const dir = flows.get(z.i)?.dir ?? 0;
    const vent = nearestVent(z), dodge = dir < 0;
    const count = dir > 0 ? 3 : dir < 0 ? 2 : 1;
    const cls = dir > 0 ? "more" : dir < 0 ? "less" : "keep";
    for (let i = 0; i < count; i++) {
      out.push(`<path class="stream ${cls}" d="${streamPath(vent, z, (i - (count - 1) / 2) * 5, dodge)}" style="animation-delay:${(i * .45).toFixed(2)}s"/>`);
    }
    if (dir < 0) {
      const [bx, by] = pt(z.x + z.w / 2, z.y + z.h * .45);
      out.push(`<text x="${bx.toFixed(1)}" y="${(by - 2).toFixed(1)}" text-anchor="middle" class="dodge">↩</text>`);
    }
  }
  return `<g class="streams">${out.join("")}</g>`;
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
    `</defs>`
  );
}

export function roomSVG(counts, slideIdx = 0, flows) {
  const p = [`<svg class="roombg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">`, defs()];
  p.push(shell(), floorPlate(), tvScreen(TV_SLIDES[slideIdx % TV_SLIDES.length]), deskRows());
  for (const z of ROOM.zones) p.push(rug(z, counts?.get(z.i) ?? 0, flows?.get(z.i)));
  p.push(ventSlits(), windStreams(ROOM.zones, flows));
  for (const d of ROOM.doors) p.push(archDoor(d));
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
