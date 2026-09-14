/**
 * 마당 — 쉬는 시간에 다같이 나와서 노는 공간.
 *
 * 여기는 **강의실이 아닙니다. 일부러요.**
 * 실제 자리 배치를 그려두면 "뒤쪽 왼쪽에 선 캐릭터 = 박태정" 이 되고,
 * 같은 캐릭터를 온도 그래프에서 찾으면 그 사람이 몇 도를 찍었는지 드러납니다.
 * 아무 뜻 없는 빈터라야 그 추론이 시작조차 안 돼요.
 *
 * 위치는 어디에도 저장하지 않습니다. 접속한 사람끼리 실시간으로만 주고받고,
 * 브라우저를 닫으면 그 자리에서 사라집니다.
 *
 * 이동은 탭 한 번에 목적지 하나만 보냅니다. 걸어가는 건 각자 화면에서
 * 계산해요. 방향키처럼 위치를 계속 쏘면 메시지가 27배로 뜁니다.
 */

import { creature } from "./creature.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const REACTIONS = ["👏", "😂", "🔥", "👍", "🥶", "🥵", "❓", "💤"];

// 걷는 속도 — 화면 폭의 몇 %를 1초에 가는지
const SPEED = 26;
const MIN_MS = 250;
const MAX_MS = 2400;

/** 캐릭터가 화면 밖으로 나가지 않게 가장자리를 남깁니다. */
const clampPos = (x, y) => ({
  x: Math.max(4, Math.min(96, x)),
  y: Math.max(12, Math.min(92, y)),
});

/** 처음 들어올 때 설 자리 — 가운데 근처에 조금씩 흩어지게. */
export function spawnPos() {
  return clampPos(50 + (Math.random() - 0.5) * 34, 62 + (Math.random() - 0.5) * 26);
}

export function walkDuration(from, to) {
  if (!from) return 0;
  const dx = to.x - from.x;
  const dy = (to.y - from.y) * 0.55; // 세로는 원근 때문에 짧게 느껴집니다
  const dist = Math.hypot(dx, dy);
  return Math.max(MIN_MS, Math.min(MAX_MS, (dist / SPEED) * 1000));
}

/** 클릭·탭 좌표를 마당 좌표(0~100)로 바꿉니다. */
export function pointToPos(ev, el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return clampPos(((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100);
}

/** 배경 소품. 아무 기능 없고 그냥 빈터처럼 안 보이게 두는 것들입니다. */
export function propsSVG() {
  return `
  <svg class="yardprops" viewBox="0 0 800 450" aria-hidden="true" preserveAspectRatio="none">
    <defs>
      <linearGradient id="ygrass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--yard-far)"/>
        <stop offset="100%" stop-color="var(--yard-near)"/>
      </linearGradient>
    </defs>
    <rect width="800" height="450" fill="url(#ygrass)"/>
    <path d="M 0 128 Q 200 110 400 126 T 800 120 L 800 0 L 0 0 Z" fill="var(--yard-sky)"/>
    <ellipse cx="400" cy="128" rx="420" ry="16" fill="var(--yard-far)" opacity=".55"/>

    <!-- 나무 -->
    <ellipse cx="112" cy="196" rx="34" ry="9" fill="rgba(0,0,0,.12)"/>
    <rect x="105" y="150" width="14" height="46" rx="6" fill="#8d6748"/>
    <circle cx="112" cy="136" r="40" fill="#3f9e5e"/>
    <circle cx="84" cy="152" r="26" fill="#48ad68"/>
    <circle cx="140" cy="152" r="26" fill="#379055"/>

    <!-- 벤치 -->
    <ellipse cx="662" cy="214" rx="62" ry="10" fill="rgba(0,0,0,.12)"/>
    <rect x="604" y="176" width="116" height="12" rx="5" fill="#a97c50"/>
    <rect x="604" y="152" width="116" height="10" rx="5" fill="#bb8a5c"/>
    <rect x="614" y="188" width="10" height="24" rx="4" fill="#8d6748"/>
    <rect x="700" y="188" width="10" height="24" rx="4" fill="#8d6748"/>

    <!-- 자판기 -->
    <ellipse cx="380" cy="206" rx="40" ry="9" fill="rgba(0,0,0,.12)"/>
    <rect x="348" y="120" width="64" height="86" rx="9" fill="#4a6fa5"/>
    <rect x="356" y="130" width="30" height="46" rx="5" fill="#cfe2f5"/>
    <circle cx="400" cy="140" r="4" fill="#f6b8cd"/>
    <circle cx="400" cy="154" r="4" fill="#ffd66b"/>
    <circle cx="400" cy="168" r="4" fill="#8fc9e8"/>
    <rect x="356" y="184" width="30" height="12" rx="4" fill="#2f4374"/>

    <!-- 잔디 몇 포기 -->
    <path d="M 236 262 q 5 -14 10 0 M 250 268 q 5 -12 10 0 M 520 250 q 5 -13 10 0
             M 534 258 q 5 -11 10 0 M 148 330 q 6 -15 12 0 M 700 316 q 6 -14 12 0"
          fill="none" stroke="var(--yard-blade)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

/**
 * 마당에 있는 사람들을 그립니다.
 * 이미 있던 캐릭터는 DOM 을 그대로 두고 위치만 바꿔야 걸어가는 게 보입니다.
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
      el.className = "yperson";
      el.dataset.key = p.key;
      el.innerHTML =
        `<div class="ybody"><svg viewBox="0 0 44 48" aria-hidden="true">${creature(p.cfg, "happy")}</svg></div>` +
        `<span class="yname"></span><span class="yreact" aria-hidden="true"></span>`;
      layer.appendChild(el);
      // 처음 나타날 땐 걸어오지 않고 그 자리에 서게
      el.style.transitionDuration = "0ms";
    } else {
      el.style.transitionDuration = `${walkDuration(before, p)}ms`;
    }

    el.classList.toggle("me", p.key === meKey);
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;

    const name = el.querySelector(".yname");
    const label = p.key === meKey ? "나" : p.nick || "익명";
    if (name.textContent !== label) name.textContent = label;

    // 가는 방향을 보고 몸을 돌립니다
    if (before && Math.abs(p.x - before.x) > 0.6) {
      el.querySelector(".ybody").style.transform = p.x < before.x ? "scaleX(-1)" : "scaleX(1)";
    }
    // 아래쪽에 있을수록 앞에 그려지도록
    el.style.zIndex = String(Math.round(p.y * 10));

    prev.set(p.key, { x: p.x, y: p.y });
  }

  // 나간 사람은 지웁니다
  for (const el of [...layer.querySelectorAll(".yperson")]) {
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

  const bubble = document.createElement("span");
  bubble.className = "ypop";
  bubble.textContent = emoji;
  el.appendChild(bubble);
  bubble.addEventListener("animationend", () => bubble.remove(), { once: true });
  // 애니메이션이 안 도는 환경(모션 줄이기)에서도 쌓이지 않게
  setTimeout(() => bubble.remove(), 2500);
}

export function reactionBarHTML() {
  return REACTIONS.map(
    (e) => `<button class="yreactbtn" type="button" data-react="${esc(e)}" aria-label="${esc(e)} 보내기">${e}</button>`
  ).join("");
}
