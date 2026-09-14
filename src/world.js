/**
 * 세계 — 강의실과 마당. 한 화면에 들어가는 16:9 공간.
 *
 * 바닥을 원근으로 깝니다. 뒤쪽은 좁고 앞쪽은 넓은 사다리꼴이고,
 * 뒤에 선 캐릭터일수록 작게 그려요. 위에서 내려다본 평면 격자로 그리면
 * 아무리 색을 예쁘게 칠해도 스프레드시트처럼 보입니다.
 *
 * 좌표는 두 종류가 있습니다.
 *   논리 좌표  x,y 0~100. 자리 판정·이동에 쓰는 "바닥 위의 위치"
 *   화면 좌표  project() 를 통과한 값. 실제로 그려지는 위치
 * 클릭은 반대로 unproject() 로 되돌립니다.
 *
 * 강의실 바닥의 큼직한 구역 넷이 곧 "내 자리"예요. 한 구역에 8~10명이
 * 들어가니 누가 누군지는 안 보이고 "뒤쪽 왼쪽이 춥다"만 남습니다.
 * 정확한 책상을 찍게 하면 자리표에 이름이 적혀 있어 바로 들킵니다.
 *
 * 위치는 어디에도 저장하지 않습니다. 창을 닫으면 사라져요.
 */

import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const CHAT_MS = 8000;
export const REACTIONS = ["👏", "😂", "🔥", "👍", "🥶", "🥵", "❓", "💤"];

const SPEED = 34;
const MIN_MS = 200;
const MAX_MS = 1800;

/* ── 원근 ────────────────────────────────────────────────────────────── */
// 바닥의 뒤쪽 모서리와 앞쪽 모서리. 화면 % 단위입니다.
const P = { backY: 30, frontY: 95, backHalf: 30, frontHalf: 49 };

/** 논리 좌표 → 화면 좌표(%) + 깊이에 따른 크기. */
export function project(x, y) {
  const t = clamp(y, 0, 100) / 100;
  const half = P.backHalf + (P.frontHalf - P.backHalf) * t;
  return {
    left: 50 + ((x - 50) / 50) * half,
    top: P.backY + (P.frontY - P.backY) * t,
    scale: 0.66 + 0.5 * t,
  };
}

/** 화면 좌표(%) → 논리 좌표. 클릭한 자리를 바닥 위 한 점으로 되돌립니다. */
export function unproject(sx, sy) {
  const t = clamp((sy - P.backY) / (P.frontY - P.backY), 0, 1);
  const half = P.backHalf + (P.frontHalf - P.backHalf) * t;
  return clampPos(50 + ((sx - 50) / half) * 50, t * 100);
}

const clampPos = (x, y) => ({ x: clamp(x, 4, 96), y: clamp(y, 4, 96) });

// SVG 는 16:9 viewBox 를 그대로 씁니다 (늘리지 않아서 동그라미가 동그라미로 남아요)
const VW = 160, VH = 90;
/** 논리 좌표 → viewBox 좌표. 반드시 숫자로 돌려줍니다 —
 *  문자열로 주면 이걸로 계산하는 곳에서 조용히 이어붙이기가 돼요. */
function pt(x, y) {
  const p = project(x, y);
  return [(p.left * VW) / 100, (p.top * VH) / 100];
}
/** path 에 바로 넣을 "x y" 문자열. */
const P2 = (x, y) => { const [a, b] = pt(x, y); return `${a.toFixed(2)} ${b.toFixed(2)}`; };

/* ── 방 ──────────────────────────────────────────────────────────────── */

export const ROOMS = {
  classroom: {
    key: "classroom", name: "강의실", icon: "📺",
    door: { x: 84, y: 12, w: 16, h: 34, to: "yard", label: "마당으로 🌳" },
    zones: [
      { i: 0, name: "앞 · 왼쪽",   ac: "🌬️", acName: "천장(앞)",  x: 8,  y: 14, w: 38, h: 32, hue: "peach" },
      { i: 1, name: "앞 · 오른쪽", ac: "🌬️", acName: "천장(앞)",  x: 54, y: 14, w: 38, h: 32, hue: "mint" },
      { i: 2, name: "뒤 · 왼쪽",   ac: "🗄️", acName: "스탠드",    x: 8,  y: 54, w: 38, h: 34, hue: "butter" },
      { i: 3, name: "뒤 · 오른쪽", ac: "🌬️", acName: "천장(뒤)",  x: 54, y: 54, w: 38, h: 34, hue: "lilac" },
    ],
  },
  yard: {
    key: "yard", name: "마당", icon: "🌳",
    door: { x: 0, y: 12, w: 16, h: 34, to: "classroom", label: "강의실로 📺" },
    zones: [],
  },
};

export const ZONES = ROOMS.classroom.zones;
export const ZONE_MIN = 4;

export function spawnPos(roomKey) {
  const base = roomKey === "yard" ? { x: 50, y: 72 } : { x: 50, y: 70 };
  return clampPos(base.x + (Math.random() - 0.5) * 30, base.y + (Math.random() - 0.5) * 20);
}

export function walkDuration(from, to) {
  if (!from) return 0;
  const d = Math.hypot(to.x - from.x, (to.y - from.y) * 0.7);
  return Math.max(MIN_MS, Math.min(MAX_MS, (d / SPEED) * 1000));
}

/** 화면에서 누른 지점을 바닥 위 논리 좌표로. */
export function pointToPos(ev, el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return unproject(((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100);
}

const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function doorAt(roomKey, pos) {
  const d = ROOMS[roomKey]?.door;
  return d && inRect(pos, d) ? d.to : null;
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

/* ── 배경 ────────────────────────────────────────────────────────────── */

/** 바닥 위의 사각형을 원근에 맞춰 사다리꼴로. */
/** 바닥에 놓인 러그 — 구역 표시. 점선 네모 대신 둥근 깔개로 그립니다. */
function rug(z, n) {
  const pad = 1.5;
  const r = { x: z.x + pad, y: z.y + pad, w: z.w - pad * 2, h: z.h - pad * 2 };
  const [mx, my] = pt(z.x + z.w / 2, z.y + z.h - 3);
  const d =
    `M ${P2(r.x, r.y)} L ${P2(r.x + r.w, r.y)} ` +
    `L ${P2(r.x + r.w, r.y + r.h)} L ${P2(r.x, r.y + r.h)} Z`;
  return (
    `<g class="rug">` +
    `<path d="${d}" fill="var(--rug-${z.hue})" stroke="var(--rug-${z.hue}-line)" stroke-width="1" stroke-linejoin="round"/>` +
    `<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" class="rlab">${z.ac} ${esc(z.name)}${n ? ` · ${n}명` : ""}</text>` +
    `</g>`
  );
}

/** 아치형 문. 네모난 문은 벽처럼 보여서 누를 수 있다는 게 안 읽혀요. */
function archDoor(d) {
  const cx = d.x + d.w / 2;
  const [lx, ly] = pt(d.x + 1, d.y + d.h);
  const [rx] = pt(d.x + d.w - 1, d.y + d.h);
  const [, ty] = pt(cx, d.y - 4);
  const [nx, ny] = pt(cx, d.y + d.h + 6);
  const w = Math.abs(rx - lx);
  return (
    `<g class="door">` +
    `<path d="M ${lx.toFixed(2)} ${ly.toFixed(2)} L ${lx.toFixed(2)} ${ty.toFixed(2)} ` +
    `A ${(w / 2).toFixed(2)} ${(w / 2.2).toFixed(2)} 0 0 1 ${rx.toFixed(2)} ${ty.toFixed(2)} ` +
    `L ${rx.toFixed(2)} ${ly.toFixed(2)} Z" ` +
    `fill="var(--door-fill)" stroke="var(--door-line)" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<circle cx="${(lx + w * 0.78).toFixed(2)}" cy="${((ly + ty) / 2).toFixed(2)}" r="1.2" fill="var(--door-line)"/>` +
    `<text x="${nx.toFixed(2)}" y="${ny.toFixed(2)}" text-anchor="middle" class="dlab">${esc(d.label)}</text>` +
    `</g>`
  );
}

export function roomSVG(roomKey, counts) {
  const room = ROOMS[roomKey];
  const [flx, fly] = pt(-8, 0), [frx, fry] = pt(108, 0);
  const [nlx, nly] = pt(-14, 100), [nrx, nry] = pt(114, 100);
  const FLOOR = `M ${flx.toFixed(2)} ${fly.toFixed(2)} L ${frx.toFixed(2)} ${fry.toFixed(2)} ` +
                `L ${nrx.toFixed(2)} ${nry.toFixed(2)} L ${nlx.toFixed(2)} ${nly.toFixed(2)} Z`;
  const parts = [`<svg class="roombg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">`];

  if (roomKey === "classroom") {
    parts.push(
      `<rect width="${VW}" height="${VH}" fill="var(--wall)"/>`,
      // 바닥 — 앞이 넓은 사다리꼴
      `<path d="${FLOOR}" fill="var(--wood)"/>`,
      `<path d="${FLOOR}" fill="url(#floorFade)"/>`,
      // 벽/바닥 만나는 선 — 걸레받이
      `<path d="M ${flx.toFixed(2)} ${fly.toFixed(2)} L ${frx.toFixed(2)} ${fry.toFixed(2)}" stroke="var(--wood-2)" stroke-width="1.6"/>`,
      // TV
      `<rect x="56" y="4" width="48" height="20" rx="2.4" fill="#2b3442"/>`,
      `<rect x="58" y="6" width="44" height="16" rx="1.6" fill="var(--tv)"/>`,
      `<rect x="76" y="24" width="8" height="1.8" rx=".9" fill="#242c38"/>`,
      // 에어컨 — 천장 둘, 스탠드 하나
      `<g class="ac"><rect x="64" y="1" width="22" height="4" rx="2" fill="var(--ac)"/>` +
        `<text x="75" y="9.4" text-anchor="middle" class="aclab">천장(앞)</text></g>`,
      `<g class="ac"><rect x="116" y="1" width="22" height="4" rx="2" fill="var(--ac)"/>` +
        `<text x="127" y="9.4" text-anchor="middle" class="aclab">천장(뒤)</text></g>`,
      `<g class="ac"><rect x="8" y="10" width="7" height="17" rx="3" fill="var(--ac)"/>` +
        `<rect x="9.4" y="13" width="4.2" height="6" rx="1.4" fill="var(--ac-2)"/>` +
        `<text x="11.5" y="31" text-anchor="middle" class="aclab">스탠드</text></g>`,
      // 화분
      `<g><ellipse cx="150" cy="34" rx="5" ry="1.6" fill="rgba(0,0,0,.1)"/>` +
        `<path d="M 147 34 h 6 l -.8 -6 h -4.4 Z" fill="#c88a62"/>` +
        `<circle cx="150" cy="25" r="4.4" fill="#5cb87a"/><circle cx="146.6" cy="27" r="3" fill="#68c888"/>` +
        `<circle cx="153.4" cy="27" r="3" fill="#4da76b"/></g>`,
      `<defs><linearGradient id="floorFade" x1="0" y1="${fly.toFixed(2)}" x2="0" y2="${nry.toFixed(2)}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".07"/></linearGradient></defs>`
    );
    for (const z of room.zones) parts.push(rug(z, counts?.get(z.i) ?? 0));
  } else {
    parts.push(
      `<rect width="${VW}" height="${VH}" fill="var(--sky)"/>`,
      `<circle cx="132" cy="13" r="7.5" fill="var(--sun)"/>`,
      `<g fill="var(--cloud)"><ellipse cx="34" cy="12" rx="11" ry="4.6"/><ellipse cx="42" cy="10" rx="7" ry="4"/>` +
        `<ellipse cx="96" cy="17" rx="9" ry="3.8"/></g>`,
      `<path d="M 0 30 q 26 -8 52 -2 q 30 7 56 -3 q 30 -9 52 1 L 160 34 L 0 34 Z" fill="var(--hill)"/>`,
      `<path d="${FLOOR}" fill="var(--grass)"/>`,
      `<path d="${FLOOR}" fill="url(#grassFade)"/>`,
      `<defs><linearGradient id="grassFade" x1="0" y1="${fly.toFixed(2)}" x2="0" y2="${nry.toFixed(2)}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient></defs>`,
      // 나무
      `<g><ellipse cx="34" cy="44" rx="9" ry="2.6" fill="rgba(0,0,0,.12)"/>` +
        `<path d="M 32 44 h 4 l -.6 -11 h -2.8 Z" fill="#8d6748"/>` +
        `<circle cx="34" cy="28" r="10" fill="#43a366"/><circle cx="26" cy="32" r="6.6" fill="#4db473"/>` +
        `<circle cx="42" cy="32" r="6.6" fill="#3a9159"/></g>`,
      // 벤치
      `<g><ellipse cx="120" cy="52" rx="16" ry="3" fill="rgba(0,0,0,.12)"/>` +
        `<rect x="106" y="44" width="28" height="3.4" rx="1.7" fill="#bb8a5c"/>` +
        `<rect x="106" y="38.6" width="28" height="3" rx="1.5" fill="#c99a6c"/>` +
        `<rect x="109" y="47" width="2.6" height="5" rx="1.3" fill="#8d6748"/>` +
        `<rect x="128.4" y="47" width="2.6" height="5" rx="1.3" fill="#8d6748"/></g>`,
      // 자판기
      `<g><ellipse cx="74" cy="46" rx="9" ry="2.4" fill="rgba(0,0,0,.12)"/>` +
        `<rect x="66" y="26" width="16" height="20" rx="2.4" fill="#5a7fb5"/>` +
        `<rect x="68" y="28.6" width="8" height="11" rx="1.4" fill="#d9e8f7"/>` +
        `<circle cx="79" cy="30" r="1.2" fill="#f6b8cd"/><circle cx="79" cy="34" r="1.2" fill="#ffd66b"/>` +
        `<circle cx="79" cy="38" r="1.2" fill="#8fc9e8"/></g>`,
      `<path d="M 20 66 q 1.4 -4 2.8 0 M 24 70 q 1.4 -3.4 2.8 0 M 138 62 q 1.4 -4 2.8 0
                M 143 67 q 1.4 -3.4 2.8 0 M 60 78 q 1.6 -4.4 3.2 0"
             fill="none" stroke="var(--blade)" stroke-width=".9" stroke-linecap="round"/>`
    );
  }

  parts.push(archDoor(room.door), `</svg>`);
  return parts.join("");
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

    // 원근 — 뒤에 설수록 작고, 아래에 있을수록 앞에 그립니다
    const s = project(p.x, p.y);
    el.classList.toggle("me", p.key === meKey);
    el.style.left = `${s.left.toFixed(2)}%`;
    el.style.top = `${s.top.toFixed(2)}%`;
    el.style.setProperty("--s", s.scale.toFixed(3));
    el.style.zIndex = String(Math.round(p.y * 10));

    const tag = el.querySelector(".tag");
    const label = p.key === meKey ? "나" : p.nick || "익명";
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
