/**
 * 전부 엮는 곳.
 *
 * 화면은 탭 넷입니다.
 *   🌡️ 온도      지금 맞춰야 할 온도 + 추워요/딱좋음/더워요 + 내 자리 + 바람 배분
 *   🎓 강의      난이도 · 속도
 *   🗨️ 익명 채팅  지금 접속한 사람끼리만, 저장 안 됨
 *   ⋯ 더보기     게시판 · 통계 · 뽑기 · 날씨 · QR · 설정
 *
 * 하루에 하는 일은 버튼 하나 누르는 것뿐이라, 그게 폰 첫 화면에서
 * 바로 눌리게 만드는 게 전부입니다.
 *
 * 🥶/🥵 는 내 희망 온도를 ±1도 밀어줍니다. 그래서 한 번만 눌러도
 * 기존 20% 절사평균 계산이 그대로 돌아가요.
 *
 * 이 앱의 결론은 "몇 도"가 아니라 **"어느 쪽에 바람을 더/덜 보낼까"** 입니다.
 * 36명의 희망은 절대 하나로 안 모이니까요.
 */

import "./style.css";

import * as db from "./supa.js";
import { summarise, clamp, toHalf, r1, fmt } from "./stats.js";
import { ZONES, SEAT_ROWS, ZONE_MIN } from "./zones.js";
import {
  resolveSeason, zoneBreakdown, airflow, airflowText,
  fetchWeather, weatherLabel, discomfortIndex, discomfortLabel,
  triviaIndexOfNow, TRIVIA, countdownText,
} from "./climate.js";
import { scheduleNow } from "./schedule.js";
import { drawRidge, drawSpark, drawHourly, P } from "./chart.js";
import { openQuestions } from "./board.js";
import {
  wheelItems, LUNCH_DEFAULT, MIN_SLOTS, MAX_SLOTS, spinAngle,
  POLL_PRESETS, MAX_CHOICES, makePoll,
  makeLadder, walkLadder, LADDER_MIN, LADDER_MAX,
  questionOfDay, answerBody,
} from "./fun.js";
import * as sh from "./sheets.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ENV_SIZE = Number(import.meta.env.VITE_ROOM_SIZE) || 36;
const LAT = Number(import.meta.env.VITE_LAT) || 37.5447;   // 서울 성수동
const LON = Number(import.meta.env.VITE_LON) || 127.0557;
const FEEL_MS = 3 * 3600e3;
const STEP = 1.0;   // 🥶/🥵 한 번에 움직이는 폭

const TAB_TITLE = { temp: "강의실 온도", lecture: "강의 어때요?", chat: "익명 채팅", more: "더보기" };

/* 난이도·속도 다섯 칸. 몇 명이 눌렀는지 같이 보여주려고 JS 에서 그립니다. */
const DIFF = [
  { v: -2, em: "🥱", t: "너무<br>쉬움" }, { v: -1, em: "🙂", t: "좀<br>쉬움" },
  { v: 0, em: "👌", t: "딱<br>좋음" },
  { v: 1, em: "😵‍💫", t: "좀<br>어려움" }, { v: 2, em: "🆘", t: "너무<br>어려움" },
];
const PACE = [
  { v: -2, em: "🐢", t: "너무<br>느림" }, { v: -1, em: "🚶", t: "좀<br>느림" },
  { v: 0, em: "👌", t: "딱<br>좋음" },
  { v: 1, em: "🏃", t: "좀<br>빠름" }, { v: 2, em: "🚀", t: "너무<br>빠름" },
];

const ADJ = ["졸린", "신난", "느긋한", "반짝이는", "포근한", "산뜻한", "조용한", "부지런한", "엉뚱한", "말랑한"];
const ANI = ["수달", "펭귄", "너구리", "알파카", "다람쥐", "올빼미", "코알라", "여우", "토끼", "판다"];
const randomNick = () => `${ADJ[(Math.random() * ADJ.length) | 0]} ${ANI[(Math.random() * ANI.length) | 0]}`;

const S = {
  votes: [], posts: [], config: null, history: [], checkpoints: [],
  mine: null, me: null, uid: null, weather: null,
  peers: 0, chatlog: [], seenMsg: new Map(),
  tab: "temp", sheet: null, filter: "all", kind: "chat",
  triviaIdx: null, barOpen: false, lastHour: null, breakSeen: null,
  editSlots: false, newPoll: false, spinning: false,
  sched: null, phaseSeen: null, chatSeen: 0, left: false,
  matchSeen: null, nowSeen: null,
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 */ } };
const saveMe = () => lsSet("roomtemp.me", JSON.stringify(S.me));

const band = () => resolveSeason(S.config?.season);
const roomSize = () => S.config?.room_size || ENV_SIZE;
const startOfHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime(); };
const myTemp = () => (Number.isFinite(Number(S.mine?.t)) ? Number(S.mine.t) : null);

/* ── 움직임 도구 ──────────────────────────────────────────────────────
   CSS 애니메이션은 "클래스를 뗐다 붙이면" 다시 돕니다. 다만 그 사이에
   브라우저가 한 번 레이아웃을 읽어야 해서 offsetWidth 를 건드려 줍니다. */
const REDUCED = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function replay(el, cls, ms) {
  if (!el || REDUCED()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if (ms) setTimeout(() => el.classList.remove(cls), ms);
}

/** 방금 내가 누른 칸에만 링을 한 번 퍼뜨립니다. 남이 눌러 다시 그릴 땐 안 나와요. */
const pulse = (sel) => replay(typeof sel === "string" ? document.querySelector(sel) : sel, "just", 700);

/**
 * 숫자를 툭 바꾸지 않고 굴립니다. 온도가 몇 도에서 몇 도로 움직였는지가
 * 눈에 남아야 "내가 누른 게 반영됐구나"가 보이거든요.
 */
const numTweens = new WeakMap();
function setNum(el, val) {
  if (!el) return;
  const prev = el.dataset.v === "" || el.dataset.v === undefined ? NaN : Number(el.dataset.v);
  const to = Number.isFinite(Number(val)) ? Number(val) : null;
  const paint = (v) => { el.innerHTML = `${v === null ? "–" : fmt(v)}<i>°</i>`; };

  cancelAnimationFrame(numTweens.get(el) ?? 0);
  if (to === null) { el.dataset.v = ""; paint(null); return; }
  el.dataset.v = String(to);

  if (!Number.isFinite(prev) || Math.abs(prev - to) < 0.05 || REDUCED()) {
    paint(to);
    if (Number.isFinite(prev) && prev !== to) replay(el, "bump", 600);
    return;
  }
  replay(el, "bump", 600);
  const t0 = performance.now(), dur = 460;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    paint(prev + (to - prev) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) numTweens.set(el, requestAnimationFrame(step));
  };
  numTweens.set(el, requestAnimationFrame(step));
}

let toastTimer = null, toastHide = null;
function toast(msg) {
  const t = $("toast");
  clearTimeout(toastTimer);
  clearTimeout(toastHide);
  t.textContent = msg;
  t.classList.remove("out");
  // 이미 떠 있으면 숨겼다 켜서 등장 애니메이션을 다시 돌립니다
  t.hidden = true;
  void t.offsetWidth;
  t.hidden = false;
  toastTimer = setTimeout(() => {
    t.classList.add("out");
    toastHide = setTimeout(() => { t.hidden = true; t.classList.remove("out"); }, 220);
  }, 2600);
}

function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  const dark = mode === "dark" || (mode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d0f13" : "#f4f5f7");
}

/* ── 데이터 ───────────────────────────────────────────────────────────── */
let loading = false, queued = null;
const merge = (a, b) => (!a ? b : a === b ? a : "all");

async function refresh(scope = "all") {
  if (!db.configured) return;
  if (loading) { queued = merge(queued, scope); return; }
  loading = true;
  try {
    const data =
      scope === "votes" ? await db.readVotes()
      : scope === "live" ? await db.readLive()
      : scope === "posts" ? await db.readPosts()
      : scope === "meta" ? await db.readMeta()
      : await db.readAll();
    if (data) {
      const before = S.config?.roulette?.at;
      Object.assign(S, data);
      // 남이 돌린 룰렛도 내 화면에서 같이 돌아갑니다
      const after = S.config?.roulette?.at;
      if (after && after !== before && S.sheet === "roulette" && !S.spinning) {
        setTimeout(() => turnWheel(S.config.roulette.pick, wheelItems(S.config).length), 40);
      }
      if (S.mine?.nick) { S.me.nick = S.mine.nick; saveMe(); }
    }
  } catch (err) {
    console.error(err);
    toast(err.message?.slice(0, 90) || "불러오기에 실패했어요");
  } finally {
    loading = false;
    render();
    if (queued) { const n = queued; queued = null; refresh(n); }
  }
}

/* ── 그리기 ───────────────────────────────────────────────────────────── */
function render() {
  const b = band();
  const c = summarise(S.votes, b);
  const zb = zoneBreakdown(S.votes);
  const af = airflow(zb, c.setpoint);

  renderHero(c);
  renderOutside();
  renderNow();
  renderFeel(c);
  renderSeats(af);
  renderFlow(af);
  renderLeave();
  renderLecture();

  setBadge($("qBadge"), openQuestions(S.posts));
  renderChatBadge();
  $("peerChip").hidden = S.peers < 2;
  $("peerChip").querySelector("b").textContent = String(S.peers);

  if (S.tab === "more" && !S.sheet) $("moreMenu").innerHTML = sh.menuHTML(S);
  if (S.sheet) renderSheet(S.sheet, c, b);
}

/**
 * 숫자 둘을 나란히 둡니다 — 지금 실내가 몇 도인지, 그리고 다들 몇 도를 원하는지.
 * 하나만 보여주면 "그래서 지금 뭘 해야 하는데"가 안 보이거든요.
 *
 * 지금 실내 온도는 설정에서 "이 온도로 맞췄어요"로 남긴 값(applied)이 먼저고,
 * 없으면 손으로 잰 실내 온도(indoor_t)를 씁니다.
 */
function renderHero(c) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const applied = num(S.config?.applied) ?? num(S.config?.indoor_t);
  const want = c.n ? c.setpoint : null;

  setNum($("nowTemp"), applied);
  setNum($("setpoint"), want);

  const act = $("heroAct"), arrow = $("heroArrow");
  const matched = applied !== null && want !== null && Math.abs(want - applied) < 0.5;
  arrow.className = `harrow${applied === null || want === null ? "" : matched ? " ok" : " move"}`;
  arrow.textContent = applied === null || want === null ? "→" : matched ? "＝" : "→";

  // 막 맞춰진 순간에만 카드가 한 번 초록으로 번집니다
  if (matched && S.matchSeen === false) replay($("hero"), "flash", 1100);
  if (applied !== null && want !== null) S.matchSeen = matched;

  if (!c.n) {
    act.className = "heroact";
    act.textContent = "아직 표가 없어요. 아래 버튼을 눌러주세요.";
  } else if (applied === null) {
    act.className = "heroact";
    act.innerHTML = `${c.n}명이 누른 값의 평균이에요. 지금 실내 온도는 <b>더보기 › 설정</b>에서 알려주세요`;
  } else if (!matched) {
    act.className = "heroact move";
    act.innerHTML = `🔧 학생들이 누른 값 평균으로 <b>맞춰지는 중</b> — 온도를 <b>${fmt(want)}°</b> 로`;
  } else {
    act.className = "heroact keep";
    act.innerHTML = `✓ <b>맞춰짐</b> — 그대로 두면 돼요`;
  }
}

/** 바깥(성수동) 기온. 이게 없으면 안이 더운지 추운지 감으로만 얘기하게 돼요. */
function renderOutside() {
  const w = S.weather, el = $("heroOut");
  if (!w || !Number.isFinite(w.t)) { el.hidden = true; return; }
  const [word, icon] = weatherLabel(w.code);
  const dl = discomfortLabel(discomfortIndex(w.t, w.rh));
  el.hidden = false;
  el.innerHTML =
    `<span class="oc"><em>${icon}</em>성수동 <b>${fmt(w.t)}°</b></span>` +
    (Number.isFinite(w.rh) ? `<span class="oc">습도 <b>${Math.round(w.rh)}%</b></span>` : "") +
    (Number.isFinite(w.feels) ? `<span class="oc">체감 <b>${fmt(w.feels)}°</b></span>` : "") +
    (dl ? `<span class="oc ${esc(dl.tone)}">${esc(dl.text)}</span>` : `<span class="oc">${esc(word)}</span>`);
}

/**
 * 띠에는 잡학을 깔았습니다. 지금 몇 교시인지는 위 칩이 말해주니까요.
 * 눌러서 다음 걸로 넘길 수 있고, 바깥·잡학 시트와 같은 번호를 씁니다.
 */
function trivia() {
  // null 이면 시계를 따라갑니다. '다음' 을 누른 동안만 손으로 고정돼요.
  return TRIVIA[(S.triviaIdx ?? triviaIndexOfNow()) % TRIVIA.length];
}

function renderNow(animate = false) {
  const el = $("nowBar");
  el.innerHTML = `<em>💡</em><span>${esc(trivia())}</span><i>다음 ›</i>`;
  if (animate) replay(el, "swap", 700);
}

function nextTrivia() {
  S.triviaIdx = ((S.triviaIdx ?? triviaIndexOfNow()) + 1) % TRIVIA.length;
  renderNow(true);
  if (S.sheet === "info") renderSheet("info", summarise(S.votes, band()), band());
}

/** 17:50 이후에만 뜨는 퇴실 칸. */
function renderLeave() {
  const sc = S.sched ?? scheduleNow();
  const show = sc.phase === "done";
  $("leaveBlock").hidden = !show;
  if (!show) return;
  const btn = $("leaveBtn");
  if (S.left) {
    $("leaveText").textContent = "퇴실했어요. 내 표는 빠졌습니다 — 내일 아침에 다시 눌러주세요.";
    btn.disabled = true;
    btn.textContent = "퇴실 완료 👋";
  } else if (!S.mine) {
    $("leaveText").textContent = "오늘은 표를 낸 적이 없어요. 바로 들어가셔도 됩니다.";
    btn.disabled = true;
    btn.textContent = "내 표 없음";
  } else {
    $("leaveText").textContent = "집에 간 사람 표가 남아 있으면 남은 사람 에어컨이 엉뚱해져요. 나가면서 한 번 눌러주세요.";
    btn.disabled = false;
    btn.textContent = "퇴실하기 — 내 표 빼기";
  }
}

function renderFeel(c) {
  const t = myTemp();
  $("myVal").textContent = t === null ? "–" : `${fmt(t)}°`;
  $("myRow").setAttribute("aria-expanded", String(S.barOpen));
  $("barWrap").hidden = !S.barOpen;
  if (S.barOpen) drawBar(c, band(), t);

  // 최근 3시간 체감 — 버튼을 눌렀는지, 전체 분위기는 어떤지
  const now = Date.now();
  const sAt = S.mine?.s_at ? Date.parse(S.mine.s_at) : 0;
  const live = now - sAt < FEEL_MS;
  document.querySelectorAll("#feelRow button").forEach((el) => {
    el.setAttribute("aria-pressed", String(live && String(S.mine?.s) === el.dataset.feel));
  });

  const vals = S.votes
    .filter((v) => v.s !== null && v.s !== undefined && v.s_at && now - Date.parse(v.s_at) < FEEL_MS)
    .map((v) => Number(v.s));
  const sub = $("feelSub");
  if (vals.length < 2) { sub.textContent = `최근 3시간 ${vals.length}명`; return; }
  const m = vals.reduce((a, x) => a + x, 0) / vals.length;
  const word = Math.abs(m) < 0.3 ? "대체로 괜찮음" : m > 0 ? (m > 0.6 ? "덥다는 쪽" : "살짝 덥다는 쪽") : (m < -0.6 ? "춥다는 쪽" : "살짝 춥다는 쪽");
  sub.textContent = `최근 3시간 ${vals.length}명 · ${word}`;
}

/**
 * 구역이 합의 온도보다 얼마나 더 따뜻하길 원하는가.
 * gap 이 + 면 "여긴 춥다"(더 따뜻한 온도를 원한다), − 면 "여긴 덥다" 입니다.
 */
function seatFeel(r) {
  if (!r?.shown || !Number.isFinite(r.gap)) return { em: "", cls: "" };
  if (r.gap >= 0.6) return { em: "🥶", cls: "cold" };
  if (r.gap <= -0.6) return { em: "🥵", cls: "hot" };
  return { em: "👌", cls: "ok" };
}

/**
 * 자리는 실제 강의실처럼 왼쪽 블록 / 오른쪽 블록을 나란히 두고,
 * 위에서 아래로 앞·중·뒤입니다. ZONES 순서대로 2열 그리드에 부으면
 * "왼뒤 옆에 오앞"이 돼서 SEAT_ROWS 로 다시 묶어 깝니다.
 *
 * 한 칸에 그 구역이 원하는 온도와 이모지·색을 같이 얹어서,
 * 표를 안 읽어도 "왼쪽 뒤가 춥구나"가 바로 보이게 했습니다.
 * 3명 미만인 구역은 여전히 숫자를 안 보여줍니다 (역추적 방지).
 */
function renderSeats(af) {
  const mine = S.mine?.zone;
  const cell = (i) => {
    const z = ZONES[i], r = af.byZone.get(i);
    const f = seatFeel(r);
    const wind = r?.dir < 0 ? "바람 ↓" : r?.dir > 0 ? "바람 ↑" : "";
    const cls = [f.cls, r?.dir < 0 ? "less" : r?.dir > 0 ? "more" : ""].filter(Boolean).join(" ");

    let big, sub;
    if (!r?.n) { big = `<span class="none">–</span>`; sub = "빈 자리"; }
    else if (!r.shown) { big = `<span class="none">–</span>`; sub = `${r.n}명 · ${ZONE_MIN}명부터`; }
    else { big = `<em>${f.em}</em><b>${fmt(r.avg)}°</b>`; sub = wind ? `${r.n}명 · ${wind}` : `${r.n}명`; }

    return `<button type="button" data-zone="${i}" class="${cls}" aria-pressed="${mine === i}">` +
      `<span class="sn">${esc(z.short)}</span><span class="st">${big}</span>` +
      `<span class="sm">${esc(sub)}</span></button>`;
  };

  $("seats").innerHTML =
    `<div class="seatfront">칠판 · 앞</div>` +
    SEAT_ROWS.map((row) =>
      `<div class="seatrow"><span class="rl">${esc(row.label)}</span>${row.zones.map(cell).join("")}</div>`).join("") +
    `<p class="seatkey"><span>🥶 여긴 춥대</span><span>👌 괜찮대</span><span>🥵 여긴 덥대</span></p>`;
}

function renderFlow(af) {
  const zoned = S.votes.filter((v) => v.zone !== null && v.zone !== undefined).length;
  $("flowText").innerHTML = airflowText(af, zoned);
}

/* 온도 막대 — 직접 고르고 싶을 때만 펼칩니다 */
const BX0 = 40, BX1 = 600, BY = 40, BH = 22;
const toX = (t, b) => BX0 + ((t - b.min) / (b.max - b.min)) * (BX1 - BX0);

function drawBar(c, b, mine) {
  const out = [`<defs><linearGradient id="bg" x1="${BX0}" y1="0" x2="${BX1}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--cold)"/><stop offset="50%" stop-color="var(--line-2)"/>` +
    `<stop offset="100%" stop-color="var(--hot)"/></linearGradient></defs>`];

  out.push(`<rect x="${BX0}" y="${BY}" width="${BX1 - BX0}" height="${BH}" rx="${BH / 2}" fill="url(#bg)" opacity=".85"/>`);
  for (const [a, z] of [[b.min, b.lo], [b.hi, b.max]]) {
    const xa = toX(a, b), xz = toX(z, b);
    if (xz > xa) out.push(`<rect x="${xa.toFixed(1)}" y="${BY}" width="${(xz - xa).toFixed(1)}" height="${BH}" fill="var(--card)" opacity=".6"/>`);
  }
  for (let t = Math.ceil(b.min); t <= b.max; t += 2) {
    out.push(`<text x="${toX(t, b).toFixed(1)}" y="${BY + BH + 22}" text-anchor="middle" class="bx">${t}</text>`);
  }
  // 모두의 합의
  const cx = toX(c.setpoint, b);
  out.push(`<rect x="${(cx - 2).toFixed(1)}" y="${BY - 7}" width="4" height="${BH + 14}" rx="2" fill="var(--ink)"/>`);
  out.push(`<text x="${cx.toFixed(1)}" y="${BY - 12}" text-anchor="middle" class="bx" style="fill:var(--ink)">합의</text>`);
  // 내 온도 — 선 하나와 알약 하나. 캐릭터는 안 올립니다(익명).
  if (Number.isFinite(mine)) {
    const mx = toX(mine, b);
    out.push(`<rect x="${(mx - 3).toFixed(1)}" y="${BY - 4}" width="6" height="${BH + 8}" rx="3" fill="var(--accent)"/>`);
    const pw = 56, px = clamp(mx - pw / 2, 2, 640 - pw - 2);
    out.push(`<rect x="${px.toFixed(1)}" y="${BY + BH + 30}" width="${pw}" height="26" rx="13" fill="var(--accent)"/>`);
    out.push(`<text x="${(px + pw / 2).toFixed(1)}" y="${BY + BH + 48}" text-anchor="middle" class="bme">${fmt(mine)}°</text>`);
  }
  $("tempBar").innerHTML = out.join("");
}

function xToTemp(ev, b) {
  const el = $("tempBar");
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  const px = ((ev.clientX - r.left) / r.width) * 640;
  return toHalf(clamp(b.min + ((px - BX0) / (BX1 - BX0)) * (b.max - b.min), b.min, b.max));
}

/* ── 강의 ─────────────────────────────────────────────────────────────── */
function lectureState() {
  const h0 = startOfHour();
  const live = S.votes.filter((v) => v.lec_at && Date.parse(v.lec_at) >= h0);
  const nums = (k) => live.map((v) => v[k]).filter((x) => x !== null && x !== undefined).map(Number);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const d = nums("diff"), p = nums("pace");
  const dist = (k) => {
    const m = new Map();
    for (const v of live) { const x = v[k]; if (x === null || x === undefined) continue; m.set(Number(x), (m.get(Number(x)) ?? 0) + 1); }
    return m;
  };
  const at = S.mine?.lec_at ? Date.parse(S.mine.lec_at) : 0;
  const mine = at >= h0 ? { diff: S.mine.diff, pace: S.mine.pace } : { diff: null, pace: null };

  let tip = "";
  if (d.length >= 2 && p.length >= 2) {
    const D = avg(d), Pc = avg(p);
    if (D >= 1 && Pc >= 1) tip = "어렵고 빠르다는 신호가 같이 왔어요. <b>속도를 줄이는 쪽</b>이 보통 먼저입니다.";
    else if (D >= 1) tip = "예시를 하나 더 짚고 넘어가면 좋겠다는 뜻이에요.";
    else if (Pc <= -1) tip = "다들 따라왔으니 <b>좀 더 나가도</b> 되겠어요.";
    else if (D <= -1 && Pc <= -0.5) tip = "쉽고 느리다니 진도를 당겨도 괜찮겠습니다.";
  }
  return { n: live.length, hour: new Date(h0).getHours(), mine,
           dAvg: avg(d), pAvg: avg(p), dN: d.length, pN: p.length,
           dDist: dist("diff"), pDist: dist("pace"), tip };
}

function verdictHTML(avg, n, lowWord, highWord, emLow, emHigh) {
  if (n < 2) return `<div class="verdict"><span class="vf">–</span><div><div class="vt">아직 ${n}명</div><div class="vs">2명만 넘으면 결론이 나와요</div></div></div>`;
  const a = Math.abs(avg);
  let tone = "good", face = "👌", txt = "딱 좋아요";
  if (a >= 1.1) { tone = "warn"; face = avg > 0 ? emHigh : emLow; txt = `많이 ${avg > 0 ? highWord : lowWord}`; }
  else if (a >= .45) { tone = ""; face = avg > 0 ? emHigh : emLow; txt = `살짝 ${avg > 0 ? highWord : lowWord}`; }
  return `<div class="verdict ${tone}"><span class="vf">${face}</span><div>` +
    `<div class="vt">${esc(txt)}</div><div class="vs">${n}명 · 평균 ${avg > 0 ? "+" : ""}${avg.toFixed(1)}</div></div></div>`;
}

/**
 * 다섯 칸을 그립니다. 아래 가는 띠는 그 칸에 몇 표가 왔는지 — 남들이
 * 이미 눌렀다는 게 보여야 나도 누르게 되거든요. 숫자만 나오고 누군지는 안 나옵니다.
 */
function renderFive(id, key, opts, mine, dist) {
  const max = Math.max(1, ...dist.values());
  const has = mine !== null && mine !== undefined;
  $(id).innerHTML = opts.map((o) => {
    const n = dist.get(o.v) ?? 0;
    const on = has && Number(mine) === o.v;
    return `<button type="button" data-${key}="${o.v}" aria-pressed="${on}" style="--w:${(n / max).toFixed(2)}">` +
      `<em>${o.em}</em><b>${o.t}</b>` + (n ? `<i class="n">${n}</i>` : "") + `</button>`;
  }).join("");
}

function renderLecture() {
  const lec = lectureState();
  const sc = S.sched ?? scheduleNow();
  const when = sc.phase === "class" && sc.period ? `${sc.period}교시` : `${lec.hour}시`;
  $("lecNote").innerHTML = `익명입니다. <b>교시마다 초기화</b>되니 매 시간 편하게 눌러주세요. 지금은 <b>${esc(when)}</b> 집계 · ${lec.n}명.`;

  renderFive("diffRow", "diff", DIFF, lec.mine.diff, lec.dDist);
  renderFive("paceRow", "pace", PACE, lec.mine.pace, lec.pDist);
  for (const [id, mine] of [["diffSub", lec.mine.diff], ["paceSub", lec.mine.pace]]) {
    const ask = mine === null || mine === undefined;
    $(id).className = ask ? "sub ask" : "sub";
    $(id).textContent = ask ? "아직 안 눌렀어요" : "완료 · 다시 누르면 취소";
  }
  $("diffVerdict").innerHTML = verdictHTML(lec.dAvg, lec.dN, "쉬움", "어려움", "🥱", "🆘");
  $("paceVerdict").innerHTML = verdictHTML(lec.pAvg, lec.pN, "느림", "빠름", "🐢", "🚀");
  $("lecTip").hidden = !lec.tip;
  $("lecTip").innerHTML = `💡 ${lec.tip}`;
}

/* ── 투표 ─────────────────────────────────────────────────────────────── */
let saveTimer = null;
async function pushVote(patch, { debounce = false } = {}) {
  if (!db.configured) return toast("아직 연결 전이에요");
  const b = band();
  const body = {
    t: clamp(Number(S.mine?.t) || b.def, b.min, b.max),
    nick: S.me.nick || "",
    zone: S.mine?.zone ?? null,
    season: b.key,
    ...patch,
  };

  S.mine = { ...(S.mine || {}), ...body, updated_at: new Date().toISOString() };
  const pub = { ...body, is_me: true, updated_at: S.mine.updated_at };
  const i = S.votes.findIndex((v) => v.is_me);
  if (i >= 0) S.votes[i] = { ...S.votes[i], ...pub };
  else S.votes = [...S.votes, pub];
  render();

  const run = async () => {
    try { await db.saveVote(body); queueHistory(); }
    catch (err) { console.error(err); toast("저장 실패 — 잠시 뒤 다시"); }
  };
  clearTimeout(saveTimer);
  if (debounce) saveTimer = setTimeout(run, 400);
  else await run();
}

/**
 * 🥶/🥵 한 번이 내 희망 온도를 1도 밀어줍니다.
 * 🥶 추워요(dir −1) 는 "더 따뜻하게"라서 희망 온도가 **올라가고**,
 * 🥵 더워요(dir +1) 는 내려갑니다. s 에는 체감 부호를 그대로 남겨요.
 */
function nudge(dir) {
  const b = band(), c = summarise(S.votes, b);
  const base = myTemp() ?? c.setpoint ?? b.def;
  const t = dir === 0 ? toHalf(c.setpoint) : clamp(toHalf(base - dir * STEP), b.min, b.max);
  S.left = false;
  pushVote({ t, s: dir, s_at: new Date().toISOString() });
  toast(dir === 0 ? `딱 좋음 — 내 희망 ${fmt(t)}°` : `내 희망 ${fmt(t)}° 로 ${dir < 0 ? "올렸" : "내렸"}어요`);
}

let histTimer = null;
function queueHistory() {
  clearTimeout(histTimer);
  histTimer = setTimeout(async () => {
    const c = summarise(S.votes, band());
    if (!c.n) return;
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      await db.saveHistory({ d: key, setpoint: c.setpoint, raw: r1(c.raw), n: c.n,
                             med: r1(c.median), p25: r1(c.p25), p75: r1(c.p75) });
    } catch { /* 기록은 실패해도 본편엔 지장 없음 */ }
  }, 2500);
}

/** 퇴실 — 내 표를 빼서, 남아 있는 사람 기준으로 온도가 다시 잡히게 합니다. */
async function leaveForDay() {
  if (!db.configured) return toast("아직 연결 전이에요");
  try {
    await db.clearVote();
    S.left = true;
    S.mine = null;
    S.votes = S.votes.filter((v) => !v.is_me);
    render();
    toast("오늘 수고하셨어요 👋");
  } catch { toast("표를 빼지 못했어요"); }
}

async function saveConfig(patch) {
  try { await db.saveConfig(patch); await refresh("meta"); }
  catch { toast("저장하지 못했어요"); }
}

/* ── 탭 · 시트 ────────────────────────────────────────────────────────── */
const TAB_ORDER = ["temp", "lecture", "chat", "more"];

function setTab(tab) {
  // 오른쪽 탭으로 가면 오른쪽에서, 왼쪽으로 가면 왼쪽에서 밀려 들어옵니다
  const from = TAB_ORDER.indexOf(S.tab), to = TAB_ORDER.indexOf(tab);
  $("main").dataset.dir = to >= from ? "r" : "l";

  S.tab = tab;
  for (const [k, id] of [["temp", "viewTemp"], ["lecture", "viewLecture"], ["chat", "viewChat"], ["more", "viewMore"]]) {
    $(id).hidden = k !== tab;
  }
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("title").textContent = TAB_TITLE[tab] ?? TAB_TITLE.temp;
  if (tab === "more" && !S.sheet) $("moreMenu").innerHTML = sh.menuHTML(S);
  if (tab === "chat") renderChat();
  renderChatBadge();
  $("main").scrollTop = 0;
}

/* ── 익명 채팅 ────────────────────────────────────────────────────────── */
/**
 * 접속한 사람끼리만 오갑니다(presence). 서버에 안 남으니 창을 닫으면 사라져요.
 * 다시 그릴 때 쓰던 글이 날아가지 않게 입력칸 내용만 옮겨 담습니다.
 */
function renderChat() {
  const draft = $("chatText")?.value ?? "";
  const at = $("chatText")?.selectionStart ?? draft.length;
  $("viewChat").innerHTML = sh.chatView(S);
  const ta = $("chatText");
  if (ta && draft) { ta.value = draft; ta.setSelectionRange(at, at); }
  // 새 말은 늘 맨 아래에 붙으니 거기로 내려줍니다
  const log = $("chatLog");
  if (log) log.scrollTop = log.scrollHeight;
  if (S.tab === "chat") S.chatSeen = S.chatlog.length;
}

/** 숫자가 진짜 바뀐 때만 톡 튀게 합니다. 매번 튀면 눈이 아파요. */
function setBadge(el, n) {
  const txt = n > 9 ? "9+" : String(n);
  if (n <= 0) { el.hidden = true; el.textContent = "0"; return; }
  const changed = el.hidden || el.textContent !== txt;
  el.textContent = txt;
  el.hidden = false;
  if (changed) replay(el, "pop", 600);
}

function renderChatBadge() {
  setBadge($("cBadge"), S.tab === "chat" ? 0 : S.chatlog.length - S.chatSeen);
}

function sendChat() {
  const ta = $("chatText");
  if (!ta) return;
  const msg = ta.value.trim().slice(0, 80);
  if (!msg) return ta.focus();
  const at = Date.now();
  db.setPresence({ nick: S.me.nick || "익명", msg, msgAt: at });
  S.chatlog.push({ nick: S.me.nick || "익명", msg, at, mine: true });
  ta.value = "";
  renderChat();
  $("chatText")?.focus();
}

function openSheet(key) {
  S.sheet = key;
  $("sheetTitle").textContent = sh.TITLES[key] ?? "";
  $("sheet").classList.remove("out");
  $("sheet").hidden = false;
  renderSheet(key, summarise(S.votes, band()), band());
  $("sheetBody").scrollTop = 0;
}

function closeSheet() {
  const el = $("sheet");
  S.sheet = null;
  $("moreMenu").innerHTML = sh.menuHTML(S);
  if (REDUCED()) { el.hidden = true; return; }
  el.classList.add("out");
  // 닫히는 동안 다시 열 수도 있으니 그때는 그대로 둡니다
  setTimeout(() => { el.classList.remove("out"); if (!S.sheet) el.hidden = true; }, 200);
}

function renderSheet(key, c, b) {
  const body = $("sheetBody");
  if (key === "board") body.innerHTML = sh.boardSheet(S);
  else if (key === "roulette") { body.innerHTML = sh.rouletteSheet(S); restWheel(); }
  else if (key === "poll") body.innerHTML = sh.pollSheet(S);
  else if (key === "ladder") body.innerHTML = sh.ladderSheet(S);
  else if (key === "dailyq") body.innerHTML = sh.dailyqSheet(S);
  else if (key === "info") body.innerHTML = sh.infoSheet(S, b, trivia());
  else if (key === "config") body.innerHTML = sh.configSheet(S, c, b, lsGet("roomtemp.theme") || "system");
  else if (key === "qr") { body.innerHTML = sh.qrSheet(); makeQR(); }
  else if (key === "stats") {
    body.innerHTML = sh.statsSheet(S, c, roomSize());
    drawRidge($("ridge"), c, b);
    drawHourly($("hourly"), S.checkpoints);
    const note = drawSpark($("spark"), S.history);
    if (note) $("sparkNote").textContent = note;
    fillTable(c);
    $("insight").innerHTML = insight(c);
  }
}

function insight(c) {
  if (!c.n) return "아직 표가 없어요.";
  if (c.n < 5) return `표가 <strong>${c.n}개</strong>뿐이라 아직 크게 흔들려요.`;
  if (c.split) return `⚠︎ 의견이 <strong>${fmt(c.split.lo)}°</strong>와 <strong>${fmt(c.split.hi)}°</strong> 두 갈래로 갈렸어요. 평균 하나로 누르면 양쪽 다 불편합니다 — <strong>바람 배분</strong>으로 메워야 해요.`;
  if (c.iqr <= 1) return `합의가 잘 됐어요. 가운데 절반이 <strong>${fmt(c.p25)}–${fmt(c.p75)}°</strong>에 모여 ${fmt(c.setpoint)}°면 <strong>${c.inBand}/${c.n}명</strong>이 ±1° 안입니다.`;
  return `${fmt(c.setpoint)}°면 <strong>${c.inBand}/${c.n}명</strong>이 ±1° 안, <strong>${c.unhappy}명</strong>은 1.5° 넘게 아쉬워요. 나머지는 바람으로 메웁니다.`;
}

function fillTable(c) {
  const m = new Map();
  for (const x of c.xs) { const k = toHalf(x).toFixed(1); m.set(k, (m.get(k) ?? 0) + 1); }
  const keys = [...m.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
  const tb = $("tbody");
  if (!keys.length) { tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-3)">아직 표가 없어요</td></tr>`; return; }
  const max = Math.max(...m.values());
  tb.innerHTML = keys.map((k) => {
    const n = m.get(k);
    return `<tr><td>${k}°</td><td>${n}</td><td>${((n / c.n) * 100).toFixed(0)}%</td><td><span class="bar" style="width:${((n / max) * 100).toFixed(1)}%"></span></td></tr>`;
  }).join("");
}

async function makeQR() {
  const url = location.origin + location.pathname;
  $("urlText").textContent = url;
  try {
    const QR = await import("qrcode");
    const canvas = document.createElement("canvas");
    await QR.toCanvas(canvas, url, { width: 220, margin: 1, color: { dark: "#16181d", light: "#ffffff" } });
    $("qrBox").innerHTML = "";
    $("qrBox").appendChild(canvas);
  } catch { $("qrBox").innerHTML = `<span class="dim">QR 을 만들지 못했어요. 아래 주소를 복사해 주세요.</span>`; }
}

/* ── 시계 ─────────────────────────────────────────────────────────────── */
function breakState() {
  const until = S.config?.break_until ? Date.parse(S.config.break_until) : 0;
  const left = until - Date.now();
  return left > 0 ? { left, until } : null;
}

/**
 * 1초마다. 시간표(수업 50분 · 쉬는 10분 · 점심 11:50~13:00 · 17:50 끝)를
 * 헤더 칩에 띄우고, 교시가 바뀌는 순간에만 화면을 다시 그립니다.
 */
function tickClock() {
  const brk = breakState(), chip = $("clockChip");
  const sc = scheduleNow();
  S.sched = sc;

  if (brk) {
    // 설정에서 손으로 켠 쉬는 시간이 시간표보다 우선입니다
    chip.textContent = `☕ 쉬는 시간 · ${countdownText(brk.left)}`;
    chip.className = "chip live";
    S.breakSeen = brk.until;
  } else {
    if (S.breakSeen) { toast("쉬는 시간 끝 — 자리로 돌아와 주세요"); S.breakSeen = null; }
    chip.textContent = sc.short ? `${sc.icon} ${sc.label} · ${sc.short}` : `${sc.icon} ${sc.label}`;
    chip.className = `chip${sc.phase === "break" || sc.phase === "lunch" ? " live" : ""}` +
                     `${sc.phase === "class" && sc.left < 60e3 ? " due" : ""}`;
  }

  const hour = startOfHour();
  if (S.lastHour === null) S.lastHour = hour;
  else if (hour !== S.lastHour) { S.lastHour = hour; onHourStruck(); }

  // 수업 ↔ 쉬는 시간이 바뀌는 순간에만 전체를 다시 그립니다
  if (S.phaseSeen !== sc.phase) {
    const first = S.phaseSeen === null;
    S.phaseSeen = sc.phase;
    if (!first) {
      render();
      if (sc.phase === "break") toast("쉬는 시간이에요 ☕");
      else if (sc.phase === "lunch") toast("점심시간 🍚");
      else if (sc.phase === "done") toast("오늘 수업 끝 — 퇴실 버튼 눌러주세요 🏠");
    }
  }
}

async function onHourStruck() {
  S.triviaIdx = null;   // 손으로 넘겨봤더라도 정각엔 다시 시계를 따릅니다
  renderNow(true);
  renderLecture();
  if (!db.configured) return;
  try {
    const row = await db.recordCheckpoint();
    await refresh("all");
    if (row?.created && row.changed) toast(`정각 — ${fmt(row.applied)}° → ${fmt(row.setpoint)}° 로 바꿀 때예요`);
  } catch { /* 다음 정각에 다시 */ }
}

/* ── 이벤트 ───────────────────────────────────────────────────────────── */
function wire() {
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });

  $("feelRow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-feel]");
    if (!b) return;
    nudge(Number(b.dataset.feel));
    pulse(b);   // 이 칸은 다시 안 그려지니 그대로 클래스를 붙입니다
  });

  $("myRow").addEventListener("click", () => { S.barOpen = !S.barOpen; render(); });

  const bar = $("tempBar");
  let drag = false;
  const pick = (ev) => { const t = xToTemp(ev, band()); if (t !== null) pushVote({ t }, { debounce: true }); };
  bar.addEventListener("pointerdown", (e) => { drag = true; bar.setPointerCapture?.(e.pointerId); pick(e); });
  bar.addEventListener("pointermove", (e) => { if (drag) pick(e); });
  bar.addEventListener("pointerup", () => { drag = false; });
  bar.addEventListener("pointercancel", () => { drag = false; });

  $("seats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-zone]");
    if (!b) return;
    const z = Number(b.dataset.zone);
    const off = S.mine?.zone === z;
    pushVote({ zone: off ? null : z });
    if (!off) pulse(`#seats [data-zone="${z}"]`);   // pushVote 안에서 이미 다시 그려진 뒤입니다
  });

  for (const [row, key] of [["diffRow", "diff"], ["paceRow", "pace"]]) {
    $(row).addEventListener("click", (e) => {
      const b = e.target.closest(`[data-${key}]`);
      if (!b) return;
      const on = b.getAttribute("aria-pressed") === "true";
      const v = Number(b.dataset[key]);
      pushVote({ [key]: on ? null : v, lec_at: on ? null : new Date().toISOString() });
      if (!on) pulse(`#${row} [data-${key}="${v}"]`);
    });
  }

  $("viewChat").addEventListener("click", (e) => {
    if (e.target.closest("#chatSend")) sendChat();
  });
  $("viewChat").addEventListener("keydown", (e) => {
    if (e.target.id === "chatText" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  $("leaveBtn").addEventListener("click", leaveForDay);
  $("nowBar").addEventListener("click", nextTrivia);

  $("moreMenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sheet]");
    if (b) openSheet(b.dataset.sheet);
  });
  $("sheetBack").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.sheet) closeSheet(); });

  $("sheetBody").addEventListener("click", onSheetClick);
  $("sheetBody").addEventListener("input", (e) => {
    if (e.target.id === "nickIn") {
      S.me.nick = e.target.value.slice(0, 12);
      saveMe();
      pushVote({ nick: S.me.nick }, { debounce: true });
    }
  });

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applyTheme(lsGet("roomtemp.theme") || "system");
    render();
  });
}

async function onSheetClick(e) {
  const hit = (s) => e.target.closest(s);
  const again = (k) => renderSheet(k, summarise(S.votes, band()), band());

  // 게시판
  const kind = hit("[data-kind]");
  if (kind) { S.kind = kind.dataset.kind; return again("board"); }
  const filt = hit("[data-filter]");
  if (filt) { S.filter = filt.dataset.filter; return again("board"); }
  if (hit("#postBtn")) {
    const ta = $("postText"), body = ta.value.trim();
    if (!body) return ta.focus();
    try {
      await db.addPost({ body: body.slice(0, 300), kind: S.kind, nick: S.me.nick || "익명" });
      ta.value = "";
      await refresh("posts");
      again("board");
    } catch { toast("글을 올리지 못했어요"); }
    return;
  }
  const act = hit(".bact");
  if (act) {
    const { act: a, id } = act.dataset;
    const post = S.posts.find((p) => p.id === id);
    if (!post) return;
    try {
      if (a === "like") await db.setLike(id, !post.liked_by_me);
      else if (a === "ans") await db.toggleAnswered(id);
      else if (a === "pin") await db.togglePin(id);
      else if (a === "del") { if (!confirm("이 글을 지울까요?")) return; await db.deletePost(id); }
      await refresh("posts");
      again("board");
    } catch (err) { toast(err.message?.slice(0, 70) || "처리하지 못했어요"); }
    return;
  }

  if (hit("#triviaNext")) return nextTrivia();

  // 🎡 점심 룰렛
  if (hit("#editSlots")) { S.editSlots = !S.editSlots; return again("roulette"); }
  if (hit("#resetSlots")) { S.editSlots = false; return saveConfig({ roulette: { items: LUNCH_DEFAULT, pick: null } }); }
  if (hit("#saveSlots")) {
    const items = lines($("slotText")?.value, MAX_SLOTS);
    if (items.length < MIN_SLOTS) return toast(`${MIN_SLOTS}개는 있어야 해요`);
    S.editSlots = false;
    return saveConfig({ roulette: { items, pick: null } });
  }
  if (hit("#spinBtn")) return spinWheel();

  // 🗳️ 즉석 투표
  const preset = hit("[data-preset]");
  if (preset) {
    const pr = POLL_PRESETS[Number(preset.dataset.preset)];
    if ($("pollQ")) $("pollQ").value = pr.q;
    if ($("pollOpts")) $("pollOpts").value = pr.opts.join("\n");
    return;
  }
  if (hit("#newPoll")) { S.newPoll = true; return again("poll"); }
  if (hit("#cancelPoll")) { S.newPoll = false; return again("poll"); }
  if (hit("#closePoll")) {
    if (!confirm("투표를 닫을까요? 결과는 사라집니다.")) return;
    S.newPoll = false;
    return saveConfig({ poll: null });
  }
  if (hit("#makePoll")) {
    const q = ($("pollQ")?.value ?? "").trim();
    const opts = lines($("pollOpts")?.value, MAX_CHOICES);
    if (!q) return $("pollQ")?.focus();
    if (opts.length < 2) return toast("선택지를 2개 이상 적어주세요");
    S.newPoll = false;
    return saveConfig({ poll: makePoll(q, opts) });
  }
  const pick = hit("[data-pick]");
  if (pick) {
    const poll = S.config?.poll;
    if (!poll?.id) return;
    const k = Number(pick.dataset.pick);
    const off = Number(S.mine?.poll_pick) === k && S.mine?.poll_id === poll.id;
    await pushVote(off
      ? { poll_id: null, poll_pick: null, poll_at: null }
      : { poll_id: poll.id, poll_pick: k, poll_at: new Date().toISOString() });
    pulse(`.pollbox [data-pick="${k}"]`);
    return again("poll");
  }

  // 🪜 사다리 타기
  if (hit("#makeLadder")) {
    const top = lines($("ladTop")?.value, LADDER_MAX);
    const bot = lines($("ladBot")?.value, LADDER_MAX);
    if (top.length < LADDER_MIN) return toast(`참가자가 ${LADDER_MIN}명은 있어야 해요`);
    if (top.length !== bot.length) return toast(`결과도 ${top.length}개로 맞춰주세요`);
    return saveConfig({ ladder: { ladder: makeLadder(top.length), top, bot, picked: {}, at: new Date().toISOString() } });
  }
  if (hit("#resetLadder")) return saveConfig({ ladder: null });
  const climb = hit("[data-climb]");
  if (climb) return climbLadder(Number(climb.dataset.climb));

  // 🌟 오늘의 질문
  if (hit("#qaSend")) {
    const ta = $("qaText"), body = ta.value.trim();
    if (!body) return ta.focus();
    try {
      await db.addPost({ body: answerBody(questionOfDay().i, body), kind: "qa", nick: S.me.nick || "익명" });
      await refresh("posts");
      again("dailyq");
    } catch { toast("남기지 못했어요"); }
    return;
  }

  // QR
  if (hit("#copyUrl")) {
    try { await navigator.clipboard.writeText(location.origin + location.pathname); toast("주소를 복사했어요"); }
    catch { toast("복사에 실패했어요 — 주소창에서 직접 복사해 주세요"); }
    return;
  }

  // 설정
  if (hit("#applyBtn")) return saveConfig({ applied: summarise(S.votes, band()).setpoint, applied_at: new Date().toISOString() });
  const brk = hit("[data-break]");
  if (brk) {
    const cur = breakState(), mins = Number(brk.dataset.break);
    const until = new Date((cur ? cur.until : Date.now()) + mins * 60e3).toISOString();
    toast(cur ? `쉬는 시간 ${mins}분 연장` : `쉬는 시간 ${mins}분 시작`);
    return saveConfig({ break_until: until, break_label: String(mins) });
  }
  if (hit("#breakEnd")) return saveConfig({ break_until: null, break_label: null });
  const season = hit("[data-season]");
  if (season) return saveConfig({ season: season.dataset.season });
  if (hit("#indoorSave")) {
    const t = parseFloat($("indoorT").value), rh = parseFloat($("indoorRh").value);
    return saveConfig({ indoor_t: Number.isFinite(t) ? t : null, indoor_rh: Number.isFinite(rh) ? rh : null, indoor_at: new Date().toISOString() });
  }
  if (hit("#indoorClear")) return saveConfig({ indoor_t: null, indoor_rh: null, indoor_at: null });
  if (hit("#rerollBtn")) {
    S.me.nick = randomNick();
    saveMe();
    pushVote({ nick: S.me.nick });
    return again("config");
  }
  if (hit("#themeBtn")) {
    const cur = lsGet("roomtemp.theme") || "system";
    const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    lsSet("roomtemp.theme", next);
    applyTheme(next);
    return again("config");
  }
}

/* ── 재미 기능 동작 ───────────────────────────────────────────────────── */

/** 여러 줄 입력칸을 목록으로. 빈 줄과 앞뒤 공백은 버립니다. */
const lines = (text, max) =>
  String(text ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, max);

/**
 * 룰렛. 결과를 먼저 뽑아 서버에 적고, 그 각도로 원판을 돌립니다.
 * 각자 자기 폰에서 따로 돌리면 결과가 달라져서 아무 소용이 없으니까요.
 */
async function spinWheel() {
  if (S.spinning) return;
  const items = wheelItems(S.config);
  const pick = Math.floor(Math.random() * items.length);
  S.spinning = true;
  turnWheel(pick, items.length);
  try {
    await saveConfig({ roulette: { items, pick, at: new Date().toISOString() } });
  } finally {
    setTimeout(() => { S.spinning = false; }, 4200);
  }
}

/** 실제로 돌리는 부분. 다른 사람이 돌려도 이 함수가 불립니다. */
function turnWheel(pick, n) {
  const g = $("wheelSpin");
  if (!g) return;
  const deg = REDUCED() ? spinAngle(pick, n, 0) : spinAngle(pick, n);
  g.style.transition = REDUCED() ? "none" : "transform 4s cubic-bezier(.16,.84,.26,1)";
  g.style.transform = `rotate(${deg}deg)`;
  if (!REDUCED()) setTimeout(() => replay($("wheelWin"), "bump", 700), 4000);
}

/** 시트를 다시 그렸을 때, 이미 나온 결과 위치에 원판을 얹어둡니다. */
function restWheel() {
  const r = S.config?.roulette;
  const g = $("wheelSpin");
  if (!g || r?.pick == null) return;
  g.style.transition = "none";
  g.style.transform = `rotate(${spinAngle(r.pick, wheelItems(S.config).length, 0)}deg)`;
}

/** 사다리를 한 칸에서 타고 내려갑니다. 지나간 길을 선으로 그려요. */
async function climbLadder(start) {
  const L = S.config?.ladder;
  if (!L?.ladder) return;
  const { end, path } = walkLadder(L.ladder, start);

  const W = 40, H = 26, PAD = 14;
  const d = path.map((pt, i) => {
    const x = PAD + pt.x * W, y = 30 + pt.y * H;
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(" ") + ` L ${PAD + end * W} ${30 + L.ladder.rows * H}`;

  const el = $("ladPath");
  if (el) {
    el.setAttribute("d", d);
    if (!REDUCED()) {
      const len = el.getTotalLength();
      el.style.transition = "none";
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      void el.getBoundingClientRect();
      el.style.transition = "stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)";
      el.style.strokeDashoffset = "0";
    }
  }
  toast(`${L.top[start]} → ${L.bot[end]}`);
  await saveConfig({ ladder: { ...L, picked: { ...(L.picked ?? {}), [start]: end } } });
}

/* ── 시작 ─────────────────────────────────────────────────────────────── */
async function boot() {
  applyTheme(lsGet("roomtemp.theme") || "system");

  const raw = lsGet("roomtemp.me");
  try { S.me = raw ? JSON.parse(raw) : {}; } catch { S.me = {}; }
  if (!S.me.nick) S.me.nick = randomNick();
  saveMe();

  S.lastHour = startOfHour();
  wire();
  setTab("temp");
  render();
  tickClock();
  setInterval(tickClock, 1000);

  const pullWeather = () =>
    fetchWeather(LAT, LON).then((w) => {
      S.weather = w;
      renderOutside();
      if (S.sheet === "info") renderSheet("info", summarise(S.votes, band()), band());
    }).catch(() => {});
  pullWeather();
  setInterval(pullWeather, 15 * 60e3);

  $("boot").classList.add("gone");
  setTimeout(() => $("boot")?.remove(), 400);

  if (!db.configured) return toast(".env 가 아직 안 채워졌어요");

  try { S.uid = await db.signIn(); }
  catch (err) { console.error(err); return toast(err.message.slice(0, 100)); }

  db.watchPeople((people) => {
    S.peers = people.length;
    for (const p of people) {
      if (!p.msg || !p.msgAt || S.seenMsg.get(p.key) === p.msgAt) continue;
      S.seenMsg.set(p.key, p.msgAt);
      if (p.key === S.uid) continue;
      S.chatlog.push({ nick: p.nick || "익명", msg: p.msg, at: p.msgAt, mine: false });
      if (S.chatlog.length > 120) { S.chatlog.splice(0, S.chatlog.length - 120); S.chatSeen = Math.max(0, S.chatSeen - 1); }
      if (S.tab === "chat") renderChat();
    }
    renderChatBadge();
    $("peerChip").hidden = S.peers < 2;
    $("peerChip").querySelector("b").textContent = String(S.peers);
  });

  db.setPresence({ nick: S.me.nick || "익명", msg: "", msgAt: 0 });
  await refresh();
  db.subscribe((scope) => refresh(scope));
  db.recordCheckpoint().then((row) => { if (row?.created) refresh("meta"); }).catch(() => {});
}

boot();
