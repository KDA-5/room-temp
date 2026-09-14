/**
 * 캐릭터 — 이미지 파일 없이 전부 SVG 로 그립니다.
 *
 * 고를 수 있는 축이 다섯 개예요:
 *   색 14 × 머리 8 × 소품 10 × 무늬 6 × 손에 든 것 8 = 53,760가지
 * 36명이 겹칠 걱정은 안 하셔도 됩니다.
 *
 * 표정만은 못 고릅니다. 표정은 데이터가 정해요 —
 * 내 희망 온도가 합의 타점에서 얼마나 멀리 있느냐에 따라
 * 웃거나 / 무표정이거나 / 덜덜 떨거나 / 땀을 흘립니다.
 * 그래서 그래프만 봐도 어느 쪽 사람들이 힘든지 바로 보입니다.
 */

// 앞의 8색은 색맹 검증을 통과한 팔레트, 뒤의 6색은 거기서 충분히 떨어진 색으로 골랐습니다.
export const COLORS = [
  { n: "파랑",   light: "#2a78d6", dark: "#3987e5" },
  { n: "주황",   light: "#eb6834", dark: "#d95926" },
  { n: "민트",   light: "#1baf7a", dark: "#199e70" },
  { n: "노랑",   light: "#eda100", dark: "#c98500" },
  { n: "분홍",   light: "#e87ba4", dark: "#d55181" },
  { n: "초록",   light: "#008300", dark: "#12a012" },
  { n: "보라",   light: "#4a3aa7", dark: "#9085e9" },
  { n: "빨강",   light: "#e34948", dark: "#e66767" },
  { n: "하늘",   light: "#5bb2dd", dark: "#6ec6ef" },
  { n: "라임",   light: "#8fbf3a", dark: "#a3d44e" },
  { n: "남색",   light: "#2f4374", dark: "#5d74b5" },
  { n: "갈색",   light: "#996a4a", dark: "#b3855f" },
  { n: "청록",   light: "#00918a", dark: "#1cb0a8" },
  { n: "자주",   light: "#9c3a86", dark: "#c05aa8" },
];

export const EARS = ["민머리", "동글 귀", "뾰족 귀", "더듬이", "긴 귀", "뿔", "삐죽머리", "물방울"];
export const HATS = ["없음", "비니", "리본", "잎사귀", "왕관", "안경", "헤드폰", "캡모자", "별", "꽃"];
export const PATTERNS = ["민무늬", "주근깨", "줄무늬", "점박이", "하트", "별"];
export const ITEMS = ["빈손", "커피", "부채", "담요", "아이스크림", "핫팩", "미니선풍기", "우산"];

/** 손에 든 것 중 온도 편을 드는 것들 — 요약 문구에 씁니다. */
export const ITEM_SIDE = { 2: "hot", 4: "hot", 6: "hot", 3: "cold", 5: "cold", 1: "cold" };

export const MOOD_WORD = {
  happy: "기분 좋음 😊",
  ok: "그럭저럭 😐",
  cold: "으슬으슬 🥶",
  hot: "더워 죽겠음 🥵",
};

export const DEFAULT_CFG = { cc: 0, ce: 0, ch: 0, cp: 0, ci: 0 };

let darkMode = false;
/** 테마가 바뀔 때 main.js 가 불러줍니다. */
export function setDark(v) {
  darkMode = !!v;
}

export function colorOf(i) {
  const c = COLORS[((i | 0) % COLORS.length + COLORS.length) % COLORS.length];
  return darkMode ? c.dark : c.light;
}

/** 합의 타점에서 얼마나 떨어졌는지로 표정을 정합니다. */
export function moodOf(t, setpoint) {
  const d = t - setpoint;
  const a = Math.abs(d);
  if (a <= 0.5) return "happy";
  if (a <= 1.5) return "ok";
  // 설정보다 높은 온도를 원한다 → 지금이 춥다는 뜻
  return d > 0 ? "cold" : "hot";
}

/** 몸 색이 어두우면 위에 올리는 무늬를 밝은 쪽으로 뒤집습니다. */
function inkOn(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "rgba(0,0,0,.34)" : "rgba(255,255,255,.5)";
}

/**
 * 44 × 48 좌표계 안에 캐릭터 하나를 그려서 SVG 조각 문자열로 돌려줍니다.
 * 얼굴은 항상 밝은 "얼굴 판" 위에 그려서, 몸 색이 뭐든 눈이 보이게 했습니다.
 */
export function creature(cfg = DEFAULT_CFG, mood = "happy") {
  const col = colorOf(cfg.cc);
  const ear = cfg.ce | 0;
  const hat = cfg.ch | 0;
  const pat = cfg.cp | 0;
  const item = cfg.ci | 0;
  const patch = darkMode ? "#f2ece0" : "#fffdf7";
  const face = "#2a3038";
  const shade = "rgba(0,0,0,.12)";
  const mark = inkOn(col);
  const p = [];

  // ── 귀 · 머리 (몸 뒤에 깔립니다) ──
  if (ear === 1) {
    p.push(`<circle cx="12" cy="17" r="6.5" fill="${col}"/><circle cx="32" cy="17" r="6.5" fill="${col}"/>`);
  } else if (ear === 2) {
    p.push(`<path d="M 8 21 L 11.5 6 L 18.5 16 Z" fill="${col}"/><path d="M 36 21 L 32.5 6 L 25.5 16 Z" fill="${col}"/>`);
  } else if (ear === 3) {
    p.push(
      `<path d="M 22 16 C 21 11 19 9 17 7" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<circle cx="16.4" cy="6" r="3.2" fill="${col}"/>`
    );
  } else if (ear === 4) {
    p.push(
      `<ellipse cx="13.5" cy="10" rx="4" ry="9" transform="rotate(-12 13.5 10)" fill="${col}"/>` +
      `<ellipse cx="30.5" cy="10" rx="4" ry="9" transform="rotate(12 30.5 10)" fill="${col}"/>`
    );
  } else if (ear === 5) {
    p.push(
      `<path d="M 13 16 C 11 10 12 6 15.5 4 C 15 8 16 12 17.5 15 Z" fill="${col}"/>` +
      `<path d="M 31 16 C 33 10 32 6 28.5 4 C 29 8 28 12 26.5 15 Z" fill="${col}"/>`
    );
  } else if (ear === 6) {
    p.push(`<path d="M 12 18 L 15 8 L 19 15 L 22 5 L 25 15 L 29 8 L 32 18 Z" fill="${col}"/>`);
  } else if (ear === 7) {
    p.push(`<path d="M 22 2 C 26 9 28 12 28 14.5 a 6 6 0 0 1 -12 0 C 16 12 18 9 22 2 Z" fill="${col}"/>`);
  }

  // ── 몸 · 발 ──
  p.push(`<rect x="5" y="14" width="34" height="31" rx="15.5" ry="15" fill="${col}"/>`);
  p.push(`<ellipse cx="15" cy="45.4" rx="4.2" ry="2.3" fill="${shade}"/><ellipse cx="29" cy="45.4" rx="4.2" ry="2.3" fill="${shade}"/>`);

  // ── 몸 무늬 (얼굴 판 위쪽 띠에 얹습니다) ──
  if (pat === 2) {
    p.push(
      `<path d="M 9.5 19 Q 22 15.6 34.5 19" fill="none" stroke="${mark}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M 12 23.6 Q 22 20.8 32 23.6" fill="none" stroke="${mark}" stroke-width="2.2" stroke-linecap="round"/>`
    );
  } else if (pat === 3) {
    p.push(
      `<circle cx="13" cy="21" r="2.4" fill="${mark}"/><circle cx="22" cy="17.6" r="2.8" fill="${mark}"/>` +
      `<circle cx="31" cy="21" r="2.4" fill="${mark}"/>`
    );
  } else if (pat === 4) {
    p.push(`<path d="M 22 23 C 18.4 19.6 16.4 18 16.4 16.2 a 2.9 2.9 0 0 1 5.6 -1 a 2.9 2.9 0 0 1 5.6 1 C 27.6 18 25.6 19.6 22 23 Z" fill="${mark}"/>`);
  } else if (pat === 5) {
    p.push(`<path d="M 22 15.4 l 1.7 3.5 3.8 0.5 -2.8 2.6 0.7 3.8 -3.4 -1.8 -3.4 1.8 0.7 -3.8 -2.8 -2.6 3.8 -0.5 Z" fill="${mark}"/>`);
  }

  // ── 얼굴 판 ──
  p.push(`<ellipse cx="22" cy="33" rx="12.6" ry="10.8" fill="${patch}"/>`);

  // ── 볼 ──
  const cheek = mood === "cold" ? "#7fb2ec" : mood === "hot" ? "#f2907f" : "#f3aab8";
  const cheekA = mood === "ok" ? ".55" : ".8";
  p.push(`<ellipse cx="12.8" cy="35" rx="3.1" ry="2.2" fill="${cheek}" opacity="${cheekA}"/>`);
  p.push(`<ellipse cx="31.2" cy="35" rx="3.1" ry="2.2" fill="${cheek}" opacity="${cheekA}"/>`);

  // 주근깨는 얼굴 판 위에 올라가야 보입니다
  if (pat === 1) {
    p.push(
      `<circle cx="14.4" cy="33.4" r="0.85" fill="#c98b74"/><circle cx="12.2" cy="35.8" r="0.85" fill="#c98b74"/>` +
      `<circle cx="16" cy="36.4" r="0.85" fill="#c98b74"/>` +
      `<circle cx="29.6" cy="33.4" r="0.85" fill="#c98b74"/><circle cx="31.8" cy="35.8" r="0.85" fill="#c98b74"/>` +
      `<circle cx="28" cy="36.4" r="0.85" fill="#c98b74"/>`
    );
  }

  // ── 표정 ──
  if (mood === "happy") {
    p.push(`<path d="M 15.4 30.6 Q 17.8 27.8 20.2 30.6" fill="none" stroke="${face}" stroke-width="2.1" stroke-linecap="round"/>`);
    p.push(`<path d="M 23.8 30.6 Q 26.2 27.8 28.6 30.6" fill="none" stroke="${face}" stroke-width="2.1" stroke-linecap="round"/>`);
    p.push(`<path d="M 18.6 35.4 Q 22 38.8 25.4 35.4" fill="none" stroke="${face}" stroke-width="2" stroke-linecap="round"/>`);
    p.push(`<path d="M 35.5 20 l 1.2 2.6 2.6 1.2 -2.6 1.2 -1.2 2.6 -1.2 -2.6 -2.6 -1.2 2.6 -1.2 Z" fill="${col}" opacity=".85"/>`);
  } else if (mood === "ok") {
    p.push(`<ellipse cx="17.8" cy="30" rx="1.9" ry="2.4" fill="${face}"/><ellipse cx="26.2" cy="30" rx="1.9" ry="2.4" fill="${face}"/>`);
    p.push(`<path d="M 19.6 36 L 24.4 36" fill="none" stroke="${face}" stroke-width="2" stroke-linecap="round"/>`);
  } else if (mood === "cold") {
    p.push(`<ellipse cx="17.8" cy="30" rx="1.9" ry="2.4" fill="${face}"/><ellipse cx="26.2" cy="30" rx="1.9" ry="2.4" fill="${face}"/>`);
    p.push(`<path d="M 18 36 q 1.35 -2 2.7 0 q 1.35 2 2.7 0 q 1.35 -2 2.7 0" fill="none" stroke="${face}" stroke-width="1.9" stroke-linecap="round"/>`);
    p.push(`<path d="M 2.5 22 q 2 2 0 4 M 41.5 22 q -2 2 0 4" fill="none" stroke="#7fb2ec" stroke-width="2" stroke-linecap="round"/>`);
  } else {
    p.push(`<path d="M 15.6 29.4 L 20 31.4 M 28.4 29.4 L 24 31.4" fill="none" stroke="${face}" stroke-width="2.1" stroke-linecap="round"/>`);
    p.push(`<ellipse cx="22" cy="36.6" rx="3" ry="2.6" fill="${face}"/>`);
    p.push(`<path d="M 36.6 17.5 c 2.6 3.4 3 4.6 3 5.8 a 3 3 0 0 1 -6 0 c 0 -1.2 0.4 -2.4 3 -5.8 Z" fill="#5aa9e6"/>`);
  }

  // ── 머리 위 소품 ──
  if (hat === 1) {
    p.push(
      `<path d="M 9.5 16.5 Q 22 1.5 34.5 16.5 Z" fill="#5b6b82"/>` +
      `<rect x="7.5" y="14.5" width="29" height="5.2" rx="2.6" fill="#8497af"/>` +
      `<circle cx="22" cy="3.6" r="2.8" fill="#cfd9e6"/>`
    );
  } else if (hat === 2) {
    p.push(
      `<path d="M 30 14 L 24.5 9.5 L 25.5 17.5 Z" fill="#e87ba4"/>` +
      `<path d="M 32 14 L 38.5 10.5 L 37 18.5 Z" fill="#e87ba4"/>` +
      `<circle cx="31.4" cy="14" r="2.6" fill="#f6b8cd"/>`
    );
  } else if (hat === 3) {
    p.push(
      `<path d="M 22 14 C 22 8 26 4 32 3.5 C 32 9.5 28 14 22 14 Z" fill="#1baf7a"/>` +
      `<path d="M 22 14 C 24.5 11 27.5 8.5 31 6.5" fill="none" stroke="#0d7a55" stroke-width="1.3" stroke-linecap="round"/>`
    );
  } else if (hat === 4) {
    p.push(
      `<path d="M 11.5 17 L 13.5 7 L 18 13 L 22 4.5 L 26 13 L 30.5 7 L 32.5 17 Z" fill="#eda100"/>` +
      `<circle cx="22" cy="3.4" r="2.2" fill="#ffd66b"/>`
    );
  } else if (hat === 5) {
    p.push(
      `<circle cx="17.8" cy="30" r="5" fill="none" stroke="${face}" stroke-width="1.8"/>` +
      `<circle cx="26.2" cy="30" r="5" fill="none" stroke="${face}" stroke-width="1.8"/>` +
      `<path d="M 22.8 30 L 21.2 30" stroke="${face}" stroke-width="1.8" stroke-linecap="round"/>`
    );
  } else if (hat === 6) {
    p.push(
      `<path d="M 7 24 C 7 12 37 12 37 24" fill="none" stroke="#41506b" stroke-width="3"/>` +
      `<rect x="3.5" y="22" width="7.5" height="11" rx="3.4" fill="#41506b"/>` +
      `<rect x="33" y="22" width="7.5" height="11" rx="3.4" fill="#41506b"/>`
    );
  } else if (hat === 7) {
    p.push(
      `<path d="M 9 16 C 9 6.5 35 6.5 35 16 Z" fill="#e34948"/>` +
      `<path d="M 33 16 L 43 18.6 L 43 14.4 Z" fill="#c23a39"/>` +
      `<circle cx="22" cy="6.6" r="2.1" fill="#f6a2a2"/>`
    );
  } else if (hat === 8) {
    p.push(`<path d="M 22 1.5 l 2.4 5 5.5 0.8 -4 3.8 0.95 5.4 -4.85 -2.6 -4.85 2.6 0.95 -5.4 -4 -3.8 5.5 -0.8 Z" fill="#eda100"/>`);
  } else if (hat === 9) {
    p.push(
      `<circle cx="29" cy="9" r="3.1" fill="#f6b8cd"/><circle cx="34.4" cy="11.2" r="3.1" fill="#f6b8cd"/>` +
      `<circle cx="33" cy="16.6" r="3.1" fill="#f6b8cd"/><circle cx="27.6" cy="14.4" r="3.1" fill="#f6b8cd"/>` +
      `<circle cx="31" cy="12.8" r="2.4" fill="#eda100"/>`
    );
  }

  // ── 손에 든 것 (왼쪽 옆구리) ──
  if (item === 1) {
    // 커피
    p.push(
      `<path d="M 2.5 32 h 9 v 6.4 a 3.2 3.2 0 0 1 -3.2 3.2 h -2.6 a 3.2 3.2 0 0 1 -3.2 -3.2 Z" fill="#f7f3ec"/>` +
      `<rect x="2.5" y="31" width="9" height="2.6" rx="1.3" fill="#9c6f4e"/>` +
      `<path d="M 11.5 33.6 a 2.2 2.2 0 0 1 0 4" fill="none" stroke="#f7f3ec" stroke-width="1.4"/>` +
      `<path d="M 5.4 29 q 1.2 -1.6 0 -3.2 M 8.4 29 q 1.2 -1.6 0 -3.2" fill="none" stroke="#c9b9a4" stroke-width="1.2" stroke-linecap="round"/>`
    );
  } else if (item === 2) {
    // 부채
    p.push(
      `<path d="M 7.5 41 L 1 30 A 12 12 0 0 1 14 30 Z" fill="#e8e2d4"/>` +
      `<path d="M 7.5 41 L 4 31.5 M 7.5 41 L 7.5 29.8 M 7.5 41 L 11 31.5" fill="none" stroke="#b9ae97" stroke-width="0.9"/>` +
      `<circle cx="7.5" cy="41" r="1.6" fill="#9c6f4e"/>`
    );
  } else if (item === 3) {
    // 담요
    p.push(
      `<path d="M 1.5 29 h 11.5 v 10 q -2.9 2.6 -5.75 0 Q 4.4 41.6 1.5 39 Z" fill="#c06a8e"/>` +
      `<path d="M 1.5 32.4 h 11.5 M 1.5 35.8 h 11.5" fill="none" stroke="#e2a7bf" stroke-width="1.3"/>`
    );
  } else if (item === 4) {
    // 아이스크림
    p.push(
      `<path d="M 3.6 33.5 L 11.4 33.5 L 7.5 43 Z" fill="#d3a05e"/>` +
      `<circle cx="7.5" cy="31.4" r="4.4" fill="#f6b8cd"/><circle cx="5.4" cy="29.6" r="2.9" fill="#fbd5e2"/>`
    );
  } else if (item === 5) {
    // 핫팩
    p.push(
      `<rect x="1.8" y="30" width="11.4" height="11.4" rx="3.4" fill="#e8934f"/>` +
      `<path d="M 7.5 33.4 v 4.6 M 5.2 35.7 h 4.6" fill="none" stroke="#fff1e2" stroke-width="1.7" stroke-linecap="round"/>`
    );
  } else if (item === 6) {
    // 미니 선풍기
    p.push(
      `<circle cx="7.5" cy="33.6" r="5.8" fill="none" stroke="#7d8b9e" stroke-width="1.5"/>` +
      `<path d="M 7.5 33.6 C 4.6 31.6 4.6 28.8 7.5 29 C 6.3 31.5 9.3 31.6 7.5 33.6 Z" fill="#8fc9e8"/>` +
      `<path d="M 7.5 33.6 C 10.4 35.6 10.4 38.4 7.5 38.2 C 8.7 35.7 5.7 35.6 7.5 33.6 Z" fill="#8fc9e8"/>` +
      `<rect x="6.6" y="39.2" width="1.8" height="3.6" rx="0.9" fill="#7d8b9e"/>`
    );
  } else if (item === 7) {
    // 우산
    p.push(
      `<path d="M 1.2 32.6 A 6.4 6.4 0 0 1 13.8 32.6 Z" fill="#4a6fa5"/>` +
      `<path d="M 7.5 32.6 v 8 a 2.4 2.4 0 0 1 -4.6 0.9" fill="none" stroke="#4a6fa5" stroke-width="1.5" stroke-linecap="round"/>`
    );
  }

  return p.join("");
}

/** HTML 안에 바로 넣을 수 있게 <svg> 로 감싼 버전. */
export function creatureSVG(cfg, mood = "happy", cls = "") {
  return `<svg viewBox="0 0 44 48" class="${cls}" aria-hidden="true">${creature(cfg, mood)}</svg>`;
}

// ── 랜덤 닉네임 ──────────────────────────────────────────────────────────
// 처음 들어오면 이게 자동으로 붙습니다. 실명을 쓸 이유를 없애려고요.
const ADJ = [
  "졸린", "배고픈", "신난", "느긋한", "반짝이는", "구름같은", "뜨끈한", "서늘한",
  "동글한", "수줍은", "용감한", "말랑한", "포근한", "엉뚱한", "조용한", "까칠한",
  "달콤한", "부지런한", "멍한", "산뜻한", "나른한", "꼼꼼한", "따끈한", "시원한",
  "몽글한", "늠름한", "바삭한", "촉촉한",
];
const ANI = [
  "수달", "펭귄", "두더지", "고양이", "너구리", "알파카", "다람쥐", "복어",
  "햄스터", "올빼미", "코알라", "여우", "물개", "토끼", "판다", "하마",
  "고슴도치", "오리", "양", "곰", "라쿤", "해달", "카피바라", "왈라비",
  "나무늘보", "친칠라", "미어캣", "돌고래",
];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

export function randomMe() {
  return {
    nick: `${pick(ADJ)} ${pick(ANI)}`,
    cc: rnd(COLORS.length),
    ce: rnd(EARS.length),
    ch: rnd(HATS.length),
    cp: rnd(PATTERNS.length),
    ci: rnd(ITEMS.length),
    show: false,
    zone: null,
  };
}

/** 커스터마이저가 쓰는 축 목록. 순서대로 화면에 줄이 그려집니다. */
export const AXES = [
  { key: "cc", label: "색",        list: COLORS,   swatch: true },
  { key: "ce", label: "머리",      list: EARS },
  { key: "ch", label: "소품",      list: HATS },
  { key: "cp", label: "무늬",      list: PATTERNS },
  { key: "ci", label: "손에 든 것", list: ITEMS },
];
