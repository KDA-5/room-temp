/**
 * 세계 — 강의실과 마당. 한 화면에 들어가는 16:9 공간.
 *
 * 캐릭터는 바닥을 누른 곳으로 걸어가고, 문에 닿으면 다른 방으로 넘어갑니다.
 * 좌표는 전부 0~100 퍼센트라서 화면 크기가 바뀌어도 그대로 맞습니다.
 *
 * 강의실에는 큼직한 구역 넷이 깔려 있습니다. 어느 구역에 서 있느냐가
 * 곧 "내 자리"예요. 한 구역에 8~10명이 들어가니까 누가 누군지는 안 보이고,
 * "뒤쪽 왼쪽이 춥다" 같은 정보만 남습니다. 정확한 책상을 찍게 하면
 * 자리표에 이름이 적혀 있어서 익명성이 바로 무너집니다.
 *
 * 위치는 어디에도 저장하지 않습니다. 접속한 사람끼리 실시간으로만
 * 주고받고, 창을 닫으면 사라져요. 저장되는 건 "어느 구역"뿐입니다.
 */

import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const CHAT_MS = 8000;   // 말풍선이 떠 있는 시간
export const REACTIONS = ["👏", "😂", "🔥", "👍", "🥶", "🥵", "❓", "💤"];

const SPEED = 30;              // 초당 몇 % 를 걷는지
const MIN_MS = 220;
const MAX_MS = 2200;

/* ── 방 ──────────────────────────────────────────────────────────────── */

export const ROOMS = {
  classroom: {
    key: "classroom",
    name: "강의실",
    icon: "📺",
    door: { x: 88, y: 40, w: 12, h: 34, to: "yard", label: "마당 →" },
    zones: [
      { i: 0, name: "앞 · 왼쪽",   ac: "🌬️", acName: "천장(앞)",  x: 10, y: 26, w: 33, h: 27 },
      { i: 1, name: "앞 · 오른쪽", ac: "🌬️", acName: "천장(앞)",  x: 47, y: 26, w: 33, h: 27 },
      { i: 2, name: "뒤 · 왼쪽",   ac: "🗄️", acName: "스탠드",    x: 10, y: 58, w: 33, h: 30 },
      { i: 3, name: "뒤 · 오른쪽", ac: "🌬️", acName: "천장(뒤)",  x: 47, y: 58, w: 33, h: 30 },
    ],
  },
  yard: {
    key: "yard",
    name: "마당",
    icon: "🌳",
    door: { x: 0, y: 40, w: 12, h: 34, to: "classroom", label: "← 강의실" },
    zones: [],
  },
};

export const ZONES = ROOMS.classroom.zones;
export const ZONE_MIN = 4;     // 이보다 적게 모인 구역은 평균을 안 보여줍니다

const clampPos = (x, y) => ({
  x: Math.max(3, Math.min(97, x)),
  y: Math.max(16, Math.min(94, y)),
});

/** 방에 처음 들어올 때 설 자리. 문 반대쪽 근처에서 조금씩 흩어지게. */
export function spawnPos(roomKey) {
  const base = roomKey === "yard" ? { x: 40, y: 68 } : { x: 52, y: 62 };
  return clampPos(base.x + (Math.random() - 0.5) * 26, base.y + (Math.random() - 0.5) * 18);
}

export function walkDuration(from, to) {
  if (!from) return 0;
  const d = Math.hypot(to.x - from.x, (to.y - from.y) * 0.6);
  return Math.max(MIN_MS, Math.min(MAX_MS, (d / SPEED) * 1000));
}

export function pointToPos(ev, el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return clampPos(((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100);
}

const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** 문을 밟았나. 밟았으면 넘어갈 방 이름. */
export function doorAt(roomKey, pos) {
  const d = ROOMS[roomKey]?.door;
  return d && inRect(pos, d) ? d.to : null;
}

/** 지금 서 있는 구역 번호. 강의실 밖이거나 구역 사이면 null. */
export function zoneAt(roomKey, pos) {
  if (roomKey !== "classroom" || !pos) return null;
  const z = ROOMS.classroom.zones.find((z) => inRect(pos, z));
  return z ? z.i : null;
}

/* ── 배경 ────────────────────────────────────────────────────────────── */

function zoneRects(zones, counts) {
  return zones
    .map((z) => {
      const n = counts?.get(z.i) ?? 0;
      return (
        `<g class="zoneg" data-zone="${z.i}">` +
        `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="2.4" ` +
        `fill="var(--zone-fill)" stroke="var(--zone-line)" stroke-width="0.22" stroke-dasharray="1.2 0.9"/>` +
        `<text x="${z.x + 1.6}" y="${z.y + 3.4}" class="zlab">${z.ac} ${esc(z.name)}</text>` +
        `<text x="${z.x + z.w - 1.6}" y="${z.y + 3.4}" class="zn" text-anchor="end">${n ? n + "명" : ""}</text>` +
        `</g>`
      );
    })
    .join("");
}

/**
 * 방 배경. viewBox 를 0 0 100 100 으로 두고 좌표를 그대로 퍼센트로 씁니다.
 * preserveAspectRatio="none" 이라 가로세로가 늘어나지만, 배경 소품이라
 * 조금 늘어나도 어색하지 않게 그렸습니다.
 */
export function roomSVG(roomKey, counts) {
  const room = ROOMS[roomKey];
  const d = room.door;
  const doorMark =
    `<g class="doorg">` +
    `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="1.6" fill="var(--door-fill)" stroke="var(--door-line)" stroke-width="0.3"/>` +
    `<text x="${d.x + d.w / 2}" y="${d.y + d.h / 2 + 1.2}" text-anchor="middle" class="dlab">${esc(d.label)}</text>` +
    `</g>`;

  if (roomKey === "classroom") {
    return (
      `<svg class="roombg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<rect width="100" height="100" fill="var(--room-floor)"/>` +
      `<rect width="100" height="17" fill="var(--room-wall)"/>` +
      // TV
      `<rect x="34" y="3.5" width="32" height="10" rx="1" fill="#20303f"/>` +
      `<rect x="35.4" y="5" width="29.2" height="7" rx="0.6" fill="#3c5a72"/>` +
      `<rect x="46" y="13.5" width="8" height="1.6" fill="#2b3a48"/>` +
      // 에어컨 셋
      `<g class="acmark"><rect x="43" y="17.4" width="14" height="2.6" rx="1.1" fill="var(--ac)"/>` +
      `<text x="50" y="22.6" text-anchor="middle" class="aclab">🌬️ 천장(앞)</text></g>` +
      `<g class="acmark"><rect x="62" y="54" width="14" height="2.6" rx="1.1" fill="var(--ac)"/>` +
      `<text x="69" y="59.2" text-anchor="middle" class="aclab">🌬️ 천장(뒤)</text></g>` +
      `<g class="acmark"><rect x="3.2" y="78" width="4" height="12" rx="1.4" fill="var(--ac)"/>` +
      `<text x="5.2" y="93.6" text-anchor="middle" class="aclab">🗄️</text></g>` +
      zoneRects(room.zones, counts) +
      doorMark +
      `</svg>`
    );
  }

  // 마당 — 강의실이 아닌, 아무 뜻 없는 빈터
  return (
    `<svg class="roombg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs><linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--yard-far)"/><stop offset="100%" stop-color="var(--yard-near)"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#grass)"/>` +
    `<rect width="100" height="22" fill="var(--yard-sky)"/>` +
    `<ellipse cx="50" cy="22" rx="62" ry="3" fill="var(--yard-far)" opacity=".6"/>` +
    // 나무
    `<rect x="21.4" y="24" width="2.2" height="10" rx="1" fill="#8d6748"/>` +
    `<circle cx="22.5" cy="22" r="7" fill="#3f9e5e"/><circle cx="17.6" cy="25" r="4.6" fill="#48ad68"/>` +
    `<circle cx="27.4" cy="25" r="4.6" fill="#379055"/>` +
    // 벤치
    `<rect x="68" y="30" width="18" height="2" rx="0.8" fill="#a97c50"/>` +
    `<rect x="68" y="26.6" width="18" height="1.7" rx="0.8" fill="#bb8a5c"/>` +
    `<rect x="70" y="32" width="1.7" height="4" rx="0.7" fill="#8d6748"/>` +
    `<rect x="82.4" y="32" width="1.7" height="4" rx="0.7" fill="#8d6748"/>` +
    // 자판기
    `<rect x="46" y="21" width="9" height="15" rx="1.2" fill="#4a6fa5"/>` +
    `<rect x="47.2" y="22.6" width="4.4" height="8" rx="0.7" fill="#cfe2f5"/>` +
    `<circle cx="53.4" cy="24" r="0.7" fill="#f6b8cd"/><circle cx="53.4" cy="26.4" r="0.7" fill="#ffd66b"/>` +
    `<circle cx="53.4" cy="28.8" r="0.7" fill="#8fc9e8"/>` +
    // 잔디
    `<path d="M 34 52 q .8 -2.4 1.6 0 M 36 54 q .8 -2 1.6 0 M 62 48 q .8 -2.2 1.6 0
              M 64 50 q .8 -1.8 1.6 0 M 24 74 q .9 -2.6 1.8 0 M 78 70 q .9 -2.4 1.8 0"
           fill="none" stroke="var(--yard-blade)" stroke-width=".5" stroke-linecap="round"/>` +
    doorMark +
    `</svg>`
  );
}

/* ── 사람 ────────────────────────────────────────────────────────────── */

/**
 * 이 방에 있는 사람들을 그립니다.
 * 이미 있던 캐릭터는 DOM 을 두고 위치만 바꿔야 걸어가는 게 보입니다.
 * 통째로 다시 그리면 매번 순간이동해요.
 */
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

    // 캐릭터 모습은 바뀔 때만 다시 그립니다 (매번 그리면 깜빡여요)
    const sig = `${p.cfg.cc}.${p.cfg.ce}.${p.cfg.ch}.${p.cfg.cp}.${p.cfg.ci}`;
    if (el.dataset.sig !== sig) {
      el.querySelector(".body svg").innerHTML = creature(p.cfg, "happy");
      el.dataset.sig = sig;
    }

    el.classList.toggle("me", p.key === meKey);
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
    el.style.zIndex = String(Math.round(p.y * 10));

    const tag = el.querySelector(".tag");
    const label = p.key === meKey ? "나" : p.nick || "익명";
    if (tag.textContent !== label) tag.textContent = label;

    if (before && Math.abs(p.x - before.x) > 0.5) {
      el.querySelector(".body").style.transform = p.x < before.x ? "scaleX(-1)" : "scaleX(1)";
    }

    // 말풍선
    const say = el.querySelector(".say");
    const fresh = p.msg && p.msgAt && Date.now() - p.msgAt < CHAT_MS;
    if (fresh) {
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

/** 누군가의 머리 위로 리액션을 띄웁니다. */
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

/** 구역별 사람 수 — 배경에 숫자를 찍는 용도. */
export function zoneCounts(people) {
  const m = new Map();
  for (const p of people) {
    if (p.room !== "classroom") continue;
    const z = zoneAt("classroom", p);
    if (z !== null) m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}
