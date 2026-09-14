/**
 * 전부 엮는 곳.
 *
 * 흐름은 단순합니다.
 *   1) 익명 로그인 → 2) 전부 읽어오기 → 3) 그리기
 *   4) 누가 뭘 바꾸면 브로드캐스트가 날아오고 다시 2)로
 *   5) 정각이 되면 도장을 찍고 강의 피드백을 초기화
 */

import "./style.css";

import * as db from "./supa.js";
import { summarise, clamp, toHalf, r1, fmt } from "./stats.js";
import {
  creature, creatureSVG, setDark, colorOf, moodOf, randomMe,
  AXES, COLORS, MOOD_WORD, DEFAULT_CFG, ITEMS,
} from "./creature.js";
import {
  resolveSeason, SEASONS, ZONES, ZONE_MIN, zoneBreakdown,
  fetchWeather, weatherLabel, discomfortIndex, discomfortLabel,
  adaptiveComfort, humidityAdvice, triviaOfToday, TRIVIA,
  msToNextHour, countdownText, hhmm,
} from "./climate.js";
import { drawRidge, drawSpark, drawHourly, drawLectureTrend, gaugeSVG, zoneMapHTML, P } from "./chart.js";
import { feedHTML, openQuestions, KINDS, MAX_PIN } from "./board.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FEEL_MS = 3 * 3600e3;
const DEADBAND = 0.5;
const VENT_MS = 50 * 60e3;   // 사람 찬 교실은 50분이면 CO2 가 올라옵니다
const ENV_SIZE = Number(import.meta.env.VITE_ROOM_SIZE) || 36;
const LAT = Number(import.meta.env.VITE_LAT) || 37.5665;
const LON = Number(import.meta.env.VITE_LON) || 126.978;

// ── 상태 ────────────────────────────────────────────────────────────────
const S = {
  votes: [], posts: [], config: null, history: [], checkpoints: [],
  mine: null,          // 서버에 있는 내 votes 행
  me: null,            // 닉네임 · 캐릭터 (로컬에도 저장)
  weather: null,
  kind: "chat",
  filter: "all",       // 게시판 갈래 필터
  peers: 0,            // 지금 같이 보고 있는 사람 수
  triviaIdx: null,
  ready: false,
  lastHour: null,
  breakSeen: null,     // 이 쉬는 시간의 종료 알림을 이미 띄웠는지
};

// ── 로컬 저장 ───────────────────────────────────────────────────────────
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 */ } };

function loadMe() {
  const raw = lsGet("roomtemp.me");
  if (raw) {
    try {
      const m = JSON.parse(raw);
      if (m && typeof m.nick === "string") return { ...randomMe(), ...m };
    } catch { /* 깨졌으면 새로 */ }
  }
  const fresh = randomMe();
  lsSet("roomtemp.me", JSON.stringify(fresh));
  return fresh;
}
const saveMe = () => lsSet("roomtemp.me", JSON.stringify(S.me));

// ── 테마 ────────────────────────────────────────────────────────────────
function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  const dark =
    mode === "dark" ||
    (mode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  setDark(dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#12151b" : "#eceff5");
}
function cycleTheme() {
  const cur = lsGet("roomtemp.theme") || "system";
  const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
  lsSet("roomtemp.theme", next);
  applyTheme(next);
  toast(next === "system" ? "시스템 설정을 따라갑니다" : next === "light" ? "밝은 테마" : "어두운 테마");
  render();
}

// ── 자잘한 도우미 ───────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function setSave(msg, cls = "") {
  const el = $("saveState");
  el.textContent = msg;
  el.className = `savestate ${cls}`;
}
const band = () => resolveSeason(S.config?.season);
const roomSize = () => S.config?.room_size || ENV_SIZE;
const startOfHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime(); };

/** 지금 이 시간의 내 강의 피드백만 유효합니다 (정각에 초기화). */
function myLecture() {
  const at = S.mine?.lec_at ? Date.parse(S.mine.lec_at) : 0;
  return at >= startOfHour() ? { diff: S.mine.diff, pace: S.mine.pace } : { diff: null, pace: null };
}

// ── 읽기 · 그리기 ───────────────────────────────────────────────────────
//
// scope 를 받아서 바뀐 조각만 다시 읽습니다. 전송량 아끼는 핵심이에요.
// 읽는 중에 또 요청이 오면 버리지 않고 하나로 합쳐서 뒤에 이어 돌립니다.

let loading = false;
let queued = null;

const mergeScope = (a, b) => (!a ? b : a === b ? a : "all");

/** 서버에 내 행이 있으면 닉네임·캐릭터는 그쪽이 정답입니다 (기기 바꿔도 유지). */
function syncMe() {
  if (!S.mine) return;
  S.me = {
    ...S.me,
    nick: S.mine.nick || S.me.nick,
    cc: S.mine.cc, ce: S.mine.ce, ch: S.mine.ch, cp: S.mine.cp, ci: S.mine.ci,
    show: !!S.mine.show_nick,
    zone: S.mine.zone,
  };
  saveMe();
}

async function refresh(scope = "all") {
  if (!db.configured) return;
  if (loading) { queued = mergeScope(queued, scope); return; }

  loading = true;
  try {
    const data =
      scope === "votes" ? await db.readVotes()
      : scope === "live" ? await db.readLive()
      : scope === "posts" ? await db.readPosts()
      : scope === "meta" ? await db.readMeta()
      : await db.readAll();

    if (data) {
      Object.assign(S, data);
      S.ready = true;
      syncMe();
    }
  } catch (err) {
    console.error(err);
    toast(err.message?.slice(0, 120) || "불러오기에 실패했어요");
  } finally {
    loading = false;
    render();
    if (queued) {
      const next = queued;
      queued = null;
      refresh(next);
    }
  }
}

function render() {
  const b = band();
  const c = summarise(S.votes, b);
  renderHero(c, b);
  renderTiles(c);
  renderChart(c, b);
  renderZones(c);
  renderMe(c, b);
  renderLecture();
  renderWeather(b);
  renderBoard();
  renderRecords();
  renderTable(c);
  $("mBand").textContent = `${b.short} ${b.lo}–${b.hi}°C`;
  $("footNote").textContent = db.configured
    ? `${roomSize()}명 기준 · 20% 절사평균 · 매 정각 확인`
    : ".env 가 아직 안 채워졌어요. README 의 3번 항목을 보세요.";
}

// ── 권장 온도 ───────────────────────────────────────────────────────────
function renderHero(c, b) {
  const chip = $("chip");
  if (!db.configured) { chip.textContent = "설정 필요"; chip.className = "chip warn"; }
  else if (!S.ready) { chip.textContent = "연결 중…"; chip.className = "chip"; }
  else if (!c.n) { chip.textContent = "표 없음"; chip.className = "chip"; }
  else { chip.textContent = "실시간"; chip.className = "chip live"; }

  $("setpoint").textContent = fmt(c.setpoint);
  $("delta").textContent = c.n
    ? `20% 절사평균 ${fmt(c.raw)}°C${c.clamped ? ` → ${b.short} 권장 ${b.lo}–${b.hi}°C 안으로 당김` : " · 0.5°C 단위로 반올림"}`
    : `아직 표가 없어 ${b.short} 기본값을 보여주고 있어요`;

  const applied = Number.isFinite(Number(S.config?.applied)) ? Number(S.config.applied) : null;
  const act = $("action"), txt = $("actionText"), btn = $("applyBtn");

  if (applied === null) {
    act.className = "action";
    txt.textContent = "지금 에어컨이 몇 도로 맞춰져 있나요? 한 번 알려주면 바뀔 때만 알려드릴게요.";
    btn.textContent = `${fmt(c.setpoint)}°C로 맞췄어요`;
    btn.className = "btn primary";
  } else if (Math.abs(c.setpoint - applied) >= DEADBAND) {
    act.className = "action move";
    txt.innerHTML = `🔧 바꿀 때가 됐어요 — <strong>${fmt(applied)}°C</strong> → <strong>${fmt(c.setpoint)}°C</strong>`;
    btn.textContent = "바꿨어요";
    btn.className = "btn primary";
  } else {
    act.className = "action";
    txt.innerHTML = `✓ 지금 설정 <strong>${fmt(applied)}°C</strong> 유지 — 계산값과 0.5°C 안이라 안 건드려도 돼요.`;
    btn.textContent = "설정 바꾸기";
    btn.className = "btn";
  }
  btn.disabled = !db.configured;

  const want = S.config?.season || "auto";
  document.querySelectorAll(".seasonseg button").forEach((el) => {
    el.setAttribute("aria-pressed", String(el.dataset.season === want));
  });
}

function renderTiles(c) {
  $("tPart").innerHTML = `${c.n}<span class="sub"> / ${roomSize()}</span>`;
  $("tPartNote").textContent = c.n
    ? `${Math.round((c.n / roomSize()) * 100)}% 참여 · 7일 지난 표는 빠져요`
    : "아직 아무도 안 찍었어요";

  let word, col;
  if (!c.n) { word = "—"; col = "var(--ink-3)"; }
  else if (c.iqr <= 1.0) { word = "좁게 모임"; col = "var(--good)"; }
  else if (c.iqr <= 2.0) { word = "보통"; col = "var(--ink-3)"; }
  else { word = "의견 갈림"; col = "var(--warn)"; }
  $("tCons").innerHTML = `<span class="dotstate" style="background:${col}"></span>${word}`;
  $("tConsNote").textContent = c.n ? `가운데 절반이 ${fmt(c.iqr)}°C 폭 안에` : "표가 모이면 계산돼요";

  $("tMed").textContent = c.n ? fmt(c.median) : "—";
  $("tMedNote").textContent = c.n ? `절사평균과 ${fmt(Math.abs(c.median - c.raw))}°C 차이` : "절반이 이 아래, 절반이 위";

  $("tUnhappy").textContent = c.n ? c.unhappy : "—";
  $("tUnhappyNote").textContent = c.n ? `${c.inBand}명은 ±1°C 안에 들어와요` : "희망과 1.5°C 넘게 벌어진 사람";
}

// ── 차트 ────────────────────────────────────────────────────────────────
function renderChart(c, b) {
  $("chartSub").textContent = c.n
    ? `캐릭터 하나가 한 사람 · ${c.n}명 · 타점에서 멀수록 표정이 힘들어져요`
    : "캐릭터 하나가 한 사람. 세로선이 지금의 합의 타점이에요.";

  const sx = drawRidge($("ridge"), c, b);
  wireHover(c, b, sx);

  const ins = $("insight");
  if (!c.n) {
    ins.innerHTML = "아직 표가 없어요. 아래에서 첫 표를 찍으면 여기가 살아납니다.";
  } else if (c.n < 5) {
    ins.innerHTML = `표가 <strong>${c.n}개</strong>뿐이라 타점이 아직 크게 흔들려요. 10명쯤 모이면 안정적으로 읽힙니다.`;
  } else if (c.split) {
    ins.innerHTML =
      `⚠︎ 의견이 <strong>${fmt(c.split.lo)}°C</strong>와 <strong>${fmt(c.split.hi)}°C</strong> 두 갈래로 갈렸어요. ` +
      `평균 하나로 누르면 양쪽 다 불편합니다 — 위의 자리별 표를 보세요. 보통 송풍 방향이나 자리 문제예요.`;
  } else if (c.iqr <= 1.0) {
    ins.innerHTML =
      `합의가 잘 됐어요. 가운데 절반이 <strong>${fmt(c.p25)}–${fmt(c.p75)}°C</strong>에 모여 있어서, ` +
      `${fmt(c.setpoint)}°C면 <strong>${c.inBand}/${c.n}명</strong>이 ±1°C 안에 들어옵니다.`;
  } else {
    ins.innerHTML =
      `${fmt(c.setpoint)}°C면 <strong>${c.inBand}/${c.n}명</strong>이 ±1°C 안, <strong>${c.unhappy}명</strong>은 ` +
      `1.5°C 넘게 아쉬운 상태예요. 가운데 절반의 폭이 ${fmt(c.iqr)}°C라 아주 좁지는 않습니다.`;
  }
}

function wireHover(c, b, sx) {
  const svg = $("ridge"), tip = $("tip");
  const zone = svg.querySelector("#hitzone");
  const cross = svg.querySelector("#cross");
  if (!zone) return;

  const hide = () => { tip.style.opacity = "0"; cross?.setAttribute("opacity", "0"); };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const px = ((ev.clientX - r.left) / r.width) * P.w;
    if (px < P.x0 || px > P.x1) return hide();

    const t = toHalf(b.min + ((px - P.x0) / (P.x1 - P.x0)) * (b.max - b.min));
    const within = c.xs.filter((x) => Math.abs(x - t) <= 1).length;
    const exact = c.xs.filter((x) => toHalf(x) === t).length;

    cross?.setAttribute("x1", sx(t).toFixed(1));
    cross?.setAttribute("x2", sx(t).toFixed(1));
    cross?.setAttribute("opacity", "1");
    tip.innerHTML = `<b>${fmt(t)}°C</b> · 여기 ${exact}명<br>이 온도면 <b>${within}</b>/${c.n}명이 ±1°C 안`;
    tip.style.left = `${(sx(t) / P.w) * 100}%`;
    tip.style.top = `${((P.top - 8) / P.h) * 100}%`;
    tip.style.opacity = "1";
  };

  zone.addEventListener("pointermove", move);
  zone.addEventListener("pointerdown", move);
  zone.addEventListener("pointerleave", hide);
  svg.addEventListener("pointerleave", hide);
}

// ── 자리 구역 ───────────────────────────────────────────────────────────
function renderZones(c) {
  const { rows, spread } = zoneBreakdown(S.votes);
  const overall = c.n ? c.raw : band().def;
  $("zoneMap").innerHTML = zoneMapHTML(rows, S.me.zone, overall);

  const picked = S.votes.filter((v) => v.zone !== null && v.zone !== undefined).length;
  const el = $("zoneInsight");

  if (picked < ZONE_MIN) {
    el.innerHTML = `자리를 고른 사람이 <strong>${picked}명</strong>이에요. ${ZONE_MIN}명 넘게 모인 구역부터 평균이 공개됩니다.`;
  } else if (spread) {
    const colder = spread.hi;  // 더 높은 온도를 원한다 = 그 자리가 춥다
    const hotter = spread.lo;
    el.innerHTML =
      `<strong>${esc(colder.name)}</strong>(${colder.n}명)가 <strong>${esc(hotter.name)}</strong>(${hotter.n}명)보다 ` +
      `<strong>${fmt(spread.gap)}°C</strong> 높은 온도를 원합니다. 그쪽이 그만큼 춥다는 뜻이에요. ` +
      `전체 온도를 올리기 전에 그 구역 송풍구를 막거나 방향을 돌리는 쪽이 먼저입니다 — 온도 1도보다 바람 한 방향이 셉니다.`;
  } else {
    el.innerHTML = `구역 간 차이가 0.8°C 미만이라 자리 문제는 아닌 것 같아요. 온도 자체로 조절하면 됩니다.`;
  }
}

// ── 나 ──────────────────────────────────────────────────────────────────
function feelWord(t, b) {
  const d = t - b.def;
  if (d <= -2.5) return "많이 시원한 쪽";
  if (d <= -1.0) return "시원한 쪽";
  if (d < 1.0) return "이 정도면 딱 좋아요";
  if (d < 2.5) return "따뜻한 쪽";
  return "많이 따뜻한 쪽";
}

function renderMe(c, b) {
  const t = clamp(Number(S.mine?.t) || b.def, b.min, b.max);
  const sl = $("slider");
  sl.min = b.min; sl.max = b.max; sl.value = t;
  sl.setAttribute("aria-valuetext", `${fmt(t)}도`);

  $("myNum").textContent = S.mine ? fmt(t) : "—";
  $("myWord").textContent = S.mine ? feelWord(t, b) : "아래 막대를 움직여 첫 표를 찍어보세요";
  $("scaleLo").textContent = `${b.min} · 춥게`;
  $("scaleMid").textContent = String(b.def);
  $("scaleHi").textContent = `${b.max} · 덥게`;

  const mood = S.mine ? moodOf(t, c.setpoint) : "happy";
  $("mePreview").innerHTML = creature(S.me, mood);
  $("meMood").textContent = S.mine ? MOOD_WORD[mood] : "아직 표 없음";
  $("composeAvatar").innerHTML = creature(S.me, "happy");
  $("composeNick").textContent = S.me.nick || "나";
  if ($("nick") !== document.activeElement) $("nick").value = S.me.nick || "";
  $("showNick").checked = !!S.me.show;

  renderAxes();

  const sAt = S.mine?.s_at ? Date.parse(S.mine.s_at) : 0;
  const sLive = Date.now() - sAt < FEEL_MS;
  document.querySelectorAll("#feelRow .feel").forEach((el) => {
    el.setAttribute("aria-pressed", String(sLive && String(S.mine?.s) === el.dataset.feel));
  });

  // 최근 3시간 체감 요약
  const now = Date.now();
  const vals = S.votes
    .filter((v) => v.s !== null && v.s !== undefined && v.s_at && now - Date.parse(v.s_at) < FEEL_MS)
    .map((v) => Number(v.s));
  const nl = $("nowLine");

  if (vals.length < 2) {
    nl.textContent = `최근 3시간 안에 들어온 체감 응답이 ${vals.length}개예요. 몇 명만 더 눌러주면 지금 상태가 보입니다.`;
  } else {
    const m = vals.reduce((a, x) => a + x, 0) / vals.length;
    let label, advice;
    if (Math.abs(m) < 0.35) { label = "딱 좋음"; advice = "지금은 그대로 두면 돼요."; }
    else if (m > 0) { label = m > 1 ? "덥다" : "살짝 덥다"; advice = `지금 당장 ${m > 1 ? "1.0" : "0.5"}°C 내리면 좋겠다는 신호예요.`; }
    else { label = m < -1 ? "춥다" : "살짝 춥다"; advice = `지금 당장 ${m < -1 ? "1.0" : "0.5"}°C 올리거나 송풍을 약하게 해보세요.`; }
    nl.innerHTML = `지금 교실 — <strong>${label}</strong> (최근 3시간 ${vals.length}명, 평균 ${m > 0 ? "+" : ""}${m.toFixed(1)}). ${advice}`;
  }
}

function renderAxes() {
  $("axes").innerHTML = AXES.map((ax) => {
    const opts = ax.list.map((item, i) => {
      const on = (S.me[ax.key] | 0) === i;
      const name = ax.swatch ? item.n : item;
      const inner = ax.swatch
        ? `<i style="background:${colorOf(i)}"></i>`
        : creatureSVG({ ...DEFAULT_CFG, ...S.me, [ax.key]: i }, "happy");
      return (
        `<button class="opt ${ax.swatch ? "sw2" : ""}" type="button" data-axis="${ax.key}" data-v="${i}" ` +
        `aria-pressed="${on}" title="${esc(name)}" aria-label="${esc(ax.label)} ${esc(name)}">${inner}</button>`
      );
    }).join("");
    return `<div class="optrow"><div class="olabel">${esc(ax.label)}</div><div class="opts">${opts}</div></div>`;
  }).join("");
}

// ── 강의 피드백 ─────────────────────────────────────────────────────────
function renderLecture() {
  const hourStart = startOfHour();
  const live = S.votes.filter((v) => v.lec_at && Date.parse(v.lec_at) >= hourStart);

  const diffs = live.map((v) => v.diff).filter((x) => x !== null && x !== undefined).map(Number);
  const paces = live.map((v) => v.pace).filter((x) => x !== null && x !== undefined).map(Number);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const dAvg = avg(diffs), pAvg = avg(paces);

  const tone = (v, n) => (n < 2 ? "neutral" : Math.abs(v) >= 1 ? "warn" : Math.abs(v) >= 0.5 ? "neutral" : "good");
  $("diffGauge").innerHTML = gaugeSVG(dAvg, diffs.length, ["너무 쉬움", "딱 좋음", "너무 어려움"], tone(dAvg, diffs.length));
  $("paceGauge").innerHTML = gaugeSVG(pAvg, paces.length, ["너무 느림", "딱 좋음", "너무 빠름"], tone(pAvg, paces.length));

  const mine = myLecture();
  document.querySelectorAll("#diffRow .feel").forEach((el) => {
    el.setAttribute("aria-pressed", String(mine.diff !== null && String(mine.diff) === el.dataset.diff));
  });
  document.querySelectorAll("#paceRow .feel").forEach((el) => {
    el.setAttribute("aria-pressed", String(mine.pace !== null && String(mine.pace) === el.dataset.pace));
  });

  drawLectureTrend($("lecTrend"), S.checkpoints);

  const hh = new Date(hourStart).getHours();
  $("lecReset").textContent = `${hh}시 집계 · ${live.length}명`;

  const el = $("lecInsight");
  const say = (v, lowWord, highWord) =>
    Math.abs(v) < 0.4 ? "딱 좋음" : v > 0 ? (v >= 1.2 ? `많이 ${highWord}` : `살짝 ${highWord}`) : v <= -1.2 ? `많이 ${lowWord}` : `살짝 ${lowWord}`;

  if (live.length < 3) {
    el.innerHTML = `이번 시간 응답 <strong>${live.length}명</strong>. 3명만 넘으면 요약이 뜹니다. 정각에 초기화되니 부담 없이 눌러주세요.`;
  } else {
    const parts = [];
    if (diffs.length) parts.push(`난이도는 <strong>${say(dAvg, "쉬움", "어려움")}</strong>(${diffs.length}명)`);
    if (paces.length) parts.push(`속도는 <strong>${say(pAvg, "느림", "빠름")}</strong>(${paces.length}명)`);
    let tip = "";
    if (dAvg >= 1 && pAvg >= 1) tip = " — 어렵고 빠르다는 신호가 같이 왔어요. 속도를 줄이는 쪽이 보통 먼저입니다.";
    else if (dAvg >= 1) tip = " — 예시를 하나 더 짚고 넘어가면 좋겠다는 뜻이에요.";
    else if (pAvg <= -1) tip = " — 다들 따라왔으니 좀 더 나가도 되겠어요.";
    else if (dAvg <= -1 && pAvg <= -0.5) tip = " — 쉽고 느리다니 진도를 당겨도 괜찮겠습니다.";
    el.innerHTML = `이번 시간 ${parts.join(", ")}${tip}`;
  }
}

// ── 날씨 · 잡학 ─────────────────────────────────────────────────────────
function renderWeather(b) {
  const w = S.weather;
  const inT = Number(S.config?.indoor_t);
  const inRh = Number(S.config?.indoor_rh);
  const hasIndoor = Number.isFinite(inT) && Number.isFinite(inRh);

  if (!w) {
    $("wRow").innerHTML = `<span class="dim">날씨를 불러오는 중…</span>`;
    $("wGrid").innerHTML = "";
    return;
  }

  const [desc, icon] = weatherLabel(w.code);
  $("wRow").innerHTML =
    `<span class="wicon">${icon}</span>` +
    `<div><div class="wtemp">${fmt(w.t)}°</div><div class="wdesc">${esc(desc)} · 체감 ${fmt(w.feels)}° · 오늘 ${fmt(w.min)}~${fmt(w.max)}°</div></div>`;

  const di = discomfortIndex(hasIndoor ? inT : w.t, hasIndoor ? inRh : w.rh);
  const diL = discomfortLabel(di);
  const adapt = adaptiveComfort(w.t);
  const hum = humidityAdvice(hasIndoor ? inRh : w.rh, hasIndoor);

  const cells = [
    { k: hasIndoor ? "실내 습도" : "실외 습도", v: `${Math.round(hasIndoor ? inRh : w.rh)}%`, tone: hum?.tone },
    { k: "불쾌지수", v: di ? di.toFixed(0) : "—", tone: diL?.tone === "bad" ? "bad" : diL?.tone },
    { k: "적응 쾌적", v: adapt ? `${fmt(adapt)}°` : "범위 밖" },
  ];
  $("wGrid").innerHTML = cells
    .map((c) => `<div class="wcell ${c.tone || ""}"><span class="k">${esc(c.k)}</span><span class="v">${esc(c.v)}</span></div>`)
    .join("");

  const bits = [];
  if (hum) bits.push(hum.text);
  if (diL) bits.push(`불쾌지수 ${di.toFixed(0)} — ${diL.text}.`);
  if (adapt) {
    const gap = adapt - b.def;
    bits.push(
      `실외 ${fmt(w.t)}°면 적응 쾌적 모델(0.31×실외+17.8)로는 ${fmt(adapt)}°가 기준이에요` +
      (Math.abs(gap) >= 1 ? ` — ${b.short} 기본값(${b.def}°)보다 ${gap > 0 ? "높습니다" : "낮습니다"}.` : ".")
    );
  } else {
    bits.push("실외가 10°C 아래라 적응 쾌적 모델은 적용 범위 밖입니다. 난방기엔 계절 밴드만 씁니다.");
  }
  if (!hasIndoor) bits.push("실내 온습도계가 있으면 '실내 실측 입력'에 넣어주세요. 훨씬 정확해집니다.");
  $("wNote").textContent = bits.join(" ");
}

function renderTrivia() {
  $("triviaText").textContent = S.triviaIdx === null ? triviaOfToday() : TRIVIA[S.triviaIdx % TRIVIA.length];
}

// ── 게시판 ──────────────────────────────────────────────────────────────
function renderBoard() {
  // 갈래별 개수를 세서 탭에 같이 보여줍니다. 0개인 갈래도 남겨둬야
  // 누르는 자리가 안 움직여요.
  const count = (k) => (k === "all" ? S.posts.length : S.posts.filter((p) => p.kind === k).length);
  $("filters").innerHTML = KINDS.map(
    (k) =>
      `<button type="button" data-filter="${k.key}" aria-pressed="${S.filter === k.key}">` +
      `${esc(k.label)}<span class="n">${count(k.key)}</span></button>`
  ).join("");

  $("feed").innerHTML = feedHTML(S.posts, db.myUid(), S.filter);

  const pinned = S.posts.filter((p) => p.pinned).length;
  $("pinCount").textContent = `고정 ${pinned} / ${MAX_PIN}`;

  const open = openQuestions(S.posts);
  const badge = $("openQ");
  badge.hidden = open === 0;
  badge.textContent = `❓ 답변 대기 ${open}`;
  badge.className = open ? "chip alert" : "chip";
}

// ── 기록 · 표 ───────────────────────────────────────────────────────────
function renderRecords() {
  drawHourly($("hourly"), S.checkpoints);
  const note = drawSpark($("spark"), S.history);
  if (note) $("sparkNote").textContent = note;
}

function renderTable(c) {
  const buckets = new Map();
  for (const x of c.xs) {
    const k = toHalf(x).toFixed(1);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const keys = [...buckets.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
  if (!keys.length) {
    $("tbody").innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-3)">아직 표가 없어요</td></tr>`;
    return;
  }
  const maxC = Math.max(...buckets.values());
  $("tbody").innerHTML = keys
    .map((k) => {
      const n = buckets.get(k);
      return (
        `<tr><td class="n">${k} °C</td><td class="n">${n}</td>` +
        `<td class="n">${((n / c.n) * 100).toFixed(0)}%</td>` +
        `<td><span class="bar" style="width:${((n / maxC) * 100).toFixed(1)}%"></span></td></tr>`
      );
    })
    .join("");
}

// ── 쓰기 ────────────────────────────────────────────────────────────────
let saveTimer = null;
async function pushVote(patch, { debounce = false } = {}) {
  if (!db.configured) { setSave("설정이 아직이에요", "bad"); return; }

  const b = band();
  const base = {
    t: clamp(Number(S.mine?.t) || b.def, b.min, b.max),
    nick: S.me.nick || "",
    cc: S.me.cc | 0, ce: S.me.ce | 0, ch: S.me.ch | 0, cp: S.me.cp | 0, ci: S.me.ci | 0,
    show_nick: !!S.me.show,
    zone: S.me.zone ?? null,
    season: b.key,
  };
  const body = { ...base, ...patch };

  // 화면은 먼저 움직이고, 저장은 뒤따라갑니다.
  // 내 캐릭터가 바로 움직이려면 votes 배열 안의 내 행도 같이 손봐야 해요.
  S.mine = { ...(S.mine || {}), ...body, updated_at: new Date().toISOString() };
  const pub = { ...body, show_nick: body.show_nick, is_me: true, updated_at: S.mine.updated_at };
  const i = S.votes.findIndex((v) => v.is_me);
  if (i >= 0) S.votes[i] = { ...S.votes[i], ...pub };
  else S.votes = [...S.votes, pub];
  render();

  const run = async () => {
    setSave("저장 중…");
    try {
      await db.saveVote(body);
      setSave("저장됨 ✓", "ok");
      queueHistory();
    } catch (err) {
      console.error(err);
      setSave("저장 실패 — 잠시 뒤 다시", "bad");
    }
  };

  clearTimeout(saveTimer);
  if (debounce) saveTimer = setTimeout(run, 550);
  else await run();
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
      await db.saveHistory({
        d: key, setpoint: c.setpoint, raw: r1(c.raw), n: c.n,
        med: r1(c.median), p25: r1(c.p25), p75: r1(c.p75),
      });
    } catch (err) { console.warn("기록 저장 건너뜀", err); }
  }, 2500);
}

// ── 정각 리듬 ───────────────────────────────────────────────────────────
const RING_C = 2 * Math.PI * 36;

/** 쉬는 시간이 돌고 있으면 { left, total } 을, 아니면 null. */
function breakState() {
  const until = S.config?.break_until ? Date.parse(S.config.break_until) : 0;
  const left = until - Date.now();
  if (!(left > 0)) return null;
  const mins = Number(S.config?.break_label) || 10;
  return { left, total: mins * 60e3, until };
}

function tickClock() {
  const brk = breakState();
  const card = $("clockCard");

  if (brk) {
    // 쉬는 시간이 최우선. 시계 카드가 통째로 모드를 바꿉니다.
    $("clockLabel").textContent = "쉬는 시간 남은 시간";
    $("countdown").textContent = countdownText(brk.left);
    $("clockNote").textContent = "끝나기 1분 전에 알려드릴게요. 화장실·환기 다녀오세요 ☕";
    $("nextLabel").textContent = "끝나는 시각";
    $("nextHour").textContent = hhmm(brk.until);
    $("ringArc").setAttribute("stroke-dashoffset", String((RING_C * (1 - clamp(brk.left / brk.total, 0, 1))).toFixed(1)));
    $("clockIcon").textContent = brk.left < 60e3 ? "🔔" : "☕";
    card.classList.add("onbreak");
    card.classList.remove("due");
    S.breakSeen = brk.until;
  } else {
    if (S.breakSeen) {
      // 방금 끝났습니다
      toast("쉬는 시간 끝 — 자리로 돌아와 주세요 🙌");
      notify("쉬는 시간 끝", "자리로 돌아와 주세요");
      S.breakSeen = null;
    }
    const left = msToNextHour();
    const next = new Date(Date.now() + left);
    $("clockLabel").textContent = "다음 조절 확인까지";
    $("countdown").textContent = countdownText(left);
    $("clockNote").textContent = '매 정각에 그 시점 표를 모아서 "바꿀지 말지"를 판단합니다. 매 분 들여다볼 순 없으니까요.';
    $("nextLabel").textContent = "다음 정각";
    $("nextHour").textContent = `${next.getHours()}시 00분`;
    $("ringArc").setAttribute("stroke-dashoffset", String((RING_C * (1 - clamp(left / 3600e3, 0, 1))).toFixed(1)));
    $("clockIcon").textContent = left < 60e3 ? "🔔" : left < 300e3 ? "⏰" : "⏳";
    card.classList.toggle("due", left < 60e3);
    card.classList.remove("onbreak");
  }

  renderClockBar(brk);

  const hour = startOfHour();
  if (S.lastHour === null) S.lastHour = hour;
  else if (hour !== S.lastHour) {
    S.lastHour = hour;
    onHourStruck();
  }
}

/** 쉬는 시간 버튼 · 환기 · 접속자 수 줄. */
function renderClockBar(brk) {
  $("breakSet").hidden = !!brk;
  $("breakOn").hidden = !brk;

  const vented = S.config?.vented_at ? Date.parse(S.config.vented_at) : 0;
  const note = $("ventNote");
  if (!vented) {
    note.textContent = "환기 기록 없음";
    note.className = "ventnote";
  } else {
    const ago = Date.now() - vented;
    const mins = Math.floor(ago / 60e3);
    const due = ago > VENT_MS;
    note.textContent = due
      ? `${mins}분째 — 창문 열 때가 됐어요`
      : `${mins}분 전 환기함`;
    note.className = `ventnote ${due ? "due" : ""}`;
  }

  const peers = $("peers");
  peers.hidden = S.peers < 2;
  $("peerCount").textContent = String(S.peers);
}

async function onHourStruck() {
  renderLecture(); // 강의 피드백은 즉시 초기화
  if (!db.configured) return;
  try {
    const row = await db.recordCheckpoint();
    await refresh("all");
    if (row?.created && row.changed) {
      toast(`정각 확인 — ${fmt(row.applied)}°C → ${fmt(row.setpoint)}°C 로 바꿀 때예요`);
      notify(`온도 바꿀 시간`, `${fmt(row.applied)}°C → ${fmt(row.setpoint)}°C`);
      fetch("/api/notify", { method: "POST" }).catch(() => {});
    } else if (row?.created) {
      toast("정각 확인 — 지금 설정 그대로 두면 됩니다");
    }
  } catch (err) { console.warn("정각 기록 실패", err); }
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "/icon.svg" }); } catch { /* 무시 */ }
}

// ── 이벤트 ──────────────────────────────────────────────────────────────
function wire() {
  $("themeBtn").addEventListener("click", cycleTheme);

  $("slider").addEventListener("input", (e) => {
    pushVote({ t: parseFloat(e.target.value) }, { debounce: true });
  });
  const nudge = (d) => {
    const b = band();
    const base = Number(S.mine?.t) || b.def;
    pushVote({ t: clamp(toHalf(base + d), b.min, b.max) });
  };
  $("colder").addEventListener("click", () => nudge(-0.5));
  $("hotter").addEventListener("click", () => nudge(0.5));

  $("feelRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".feel");
    if (!btn) return;
    const on = btn.getAttribute("aria-pressed") === "true";
    pushVote({ s: on ? null : Number(btn.dataset.feel), s_at: on ? null : new Date().toISOString() });
  });

  for (const [rowId, key] of [["diffRow", "diff"], ["paceRow", "pace"]]) {
    $(rowId).addEventListener("click", (e) => {
      const btn = e.target.closest(".feel");
      if (!btn) return;
      const on = btn.getAttribute("aria-pressed") === "true";
      pushVote({ [key]: on ? null : Number(btn.dataset[key]), lec_at: on ? null : new Date().toISOString() });
    });
  }

  $("zoneMap").addEventListener("click", (e) => {
    const btn = e.target.closest(".zone");
    if (!btn) return;
    const z = Number(btn.dataset.zone);
    S.me.zone = S.me.zone === z ? null : z;
    saveMe();
    pushVote({ zone: S.me.zone });
  });

  $("axes").addEventListener("click", (e) => {
    const btn = e.target.closest(".opt");
    if (!btn) return;
    S.me[btn.dataset.axis] = Number(btn.dataset.v);
    saveMe();
    pushVote({});
  });

  $("nick").addEventListener("input", (e) => {
    S.me.nick = e.target.value.slice(0, 12);
    saveMe();
    $("composeNick").textContent = S.me.nick || "나";
    pushVote({ nick: S.me.nick }, { debounce: true });
  });

  $("reroll").addEventListener("click", () => {
    const { show, zone } = S.me;
    S.me = { ...randomMe(), show, zone };
    saveMe();
    pushVote({});
  });

  $("showNick").addEventListener("change", (e) => {
    S.me.show = e.target.checked;
    saveMe();
    pushVote({ show_nick: S.me.show });
  });

  document.querySelector(".seasonseg").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try { await db.saveConfig({ season: btn.dataset.season }); await refresh("meta"); }
    catch { toast("계절을 바꾸지 못했어요"); }
  });

  $("applyBtn").addEventListener("click", async () => {
    const c = summarise(S.votes, band());
    try {
      await db.saveConfig({ applied: c.setpoint, applied_at: new Date().toISOString() });
      await refresh("meta");
      toast(`${fmt(c.setpoint)}°C 로 기록했어요`);
    } catch { toast("저장하지 못했어요"); }
  });

  // 쉬는 시간 — 아무나 시작하고 아무나 끝낼 수 있습니다.
  // "언제 끝나는지"를 절대 시각으로 저장하니, 중간에 들어온 사람도 같은 숫자를 봅니다.
  async function setBreak(mins) {
    const now = Date.now();
    const cur = breakState();
    // 이미 돌고 있으면 연장, 아니면 지금부터 시작
    const until = new Date((cur ? cur.until : now) + mins * 60e3).toISOString();
    const total = Math.round(((cur ? cur.until - now : 0) + mins * 60e3) / 60e3);
    try {
      await db.saveConfig({ break_until: until, break_label: String(total) });
      await refresh("meta");
      toast(cur ? `쉬는 시간 ${mins}분 연장` : `쉬는 시간 ${mins}분 시작 ☕`);
    } catch { toast("쉬는 시간을 시작하지 못했어요"); }
  }
  for (const id of ["breakSet", "breakOn"]) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest("[data-break]");
      if (btn) setBreak(Number(btn.dataset.break));
    });
  }
  $("breakEnd").addEventListener("click", async () => {
    try {
      await db.saveConfig({ break_until: null, break_label: null });
      await refresh("meta");
    } catch { toast("끝내지 못했어요"); }
  });

  // 환기
  $("ventBtn").addEventListener("click", async () => {
    try {
      await db.saveConfig({ vented_at: new Date().toISOString() });
      await refresh("meta");
      toast("환기 기록했어요 🪟");
    } catch { toast("기록하지 못했어요"); }
  });

  // 게시판 갈래 필터
  $("filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    S.filter = btn.dataset.filter;
    renderBoard();
  });

  // 게시판
  document.querySelector(".kindseg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    S.kind = btn.dataset.kind;
    document.querySelectorAll(".kindseg button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  });
  $("postText").addEventListener("input", (e) => { $("counter").textContent = `${e.target.value.length}/300`; });

  $("postBtn").addEventListener("click", async () => {
    const ta = $("postText");
    const body = ta.value.trim();
    if (!body) return ta.focus();
    const btn = $("postBtn");
    btn.disabled = true;
    try {
      await db.addPost({
        body: body.slice(0, 300), kind: S.kind, nick: S.me.nick || "익명",
        cc: S.me.cc | 0, ce: S.me.ce | 0, ch: S.me.ch | 0, cp: S.me.cp | 0, ci: S.me.ci | 0,
      });
      ta.value = "";
      $("counter").textContent = "0/300";
      await refresh("posts");
    } catch (err) {
      console.error(err);
      toast("글을 올리지 못했어요");
    } finally { btn.disabled = false; }
  });

  $("feed").addEventListener("click", async (e) => {
    const btn = e.target.closest(".bact");
    if (!btn) return;
    const { act, id } = btn.dataset;
    const post = S.posts.find((p) => p.id === id);
    if (!post) return;
    try {
      if (act === "like") await db.setLike(id, !post.liked_by_me);
      else if (act === "ans") await db.toggleAnswered(id);
      else if (act === "pin") await db.togglePin(id);
      else if (act === "del") {
        if (!confirm("이 글을 지울까요?")) return;
        await db.deletePost(id);
      }
      await refresh("posts");
    } catch (err) { toast(err.message?.slice(0, 90) || "처리하지 못했어요"); }
  });

  // 잡학
  $("triviaNext").addEventListener("click", () => {
    S.triviaIdx = ((S.triviaIdx ?? 0) + 1) % TRIVIA.length;
    renderTrivia();
  });

  // QR
  $("qrBtn").addEventListener("click", openQR);
  $("qrClose").addEventListener("click", () => { $("qrModal").hidden = true; });
  $("copyUrl").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.origin); toast("주소를 복사했어요"); }
    catch { toast("복사에 실패했어요 — 주소창에서 직접 복사해 주세요"); }
  });

  // 실내 실측
  $("indoorBtn").addEventListener("click", () => {
    $("indoorT").value = S.config?.indoor_t ?? "";
    $("indoorRh").value = S.config?.indoor_rh ?? "";
    $("indoorModal").hidden = false;
  });
  $("indoorSave").addEventListener("click", async () => {
    const t = parseFloat($("indoorT").value);
    const rh = parseFloat($("indoorRh").value);
    try {
      await db.saveConfig({
        indoor_t: Number.isFinite(t) ? t : null,
        indoor_rh: Number.isFinite(rh) ? rh : null,
        indoor_at: new Date().toISOString(),
      });
      $("indoorModal").hidden = true;
      await refresh("meta");
      toast("실내 값을 반영했어요");
    } catch { toast("저장하지 못했어요"); }
  });
  $("indoorClear").addEventListener("click", async () => {
    try {
      await db.saveConfig({ indoor_t: null, indoor_rh: null, indoor_at: null });
      $("indoorModal").hidden = true;
      await refresh("meta");
    } catch { toast("저장하지 못했어요"); }
  });

  for (const m of ["qrModal", "indoorModal"]) {
    $(m).addEventListener("click", (e) => { if (e.target.id === m) $(m).hidden = true; });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $("qrModal").hidden = true;
    $("indoorModal").hidden = true;
  });

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applyTheme(lsGet("roomtemp.theme") || "system");
    render();
  });
}

async function openQR() {
  const url = location.origin + location.pathname;
  $("urlText").textContent = url;
  $("qrModal").hidden = false;
  const box = $("qrBox");
  box.innerHTML = `<span class="dim">만드는 중…</span>`;
  try {
    const QR = await import("qrcode");
    const canvas = document.createElement("canvas");
    await QR.toCanvas(canvas, url, { width: 220, margin: 1, color: { dark: "#1b2430", light: "#ffffff" } });
    box.innerHTML = "";
    box.appendChild(canvas);
  } catch (err) {
    console.error(err);
    box.innerHTML = `<span class="dim">QR 을 만들지 못했어요. 아래 주소를 복사해 주세요.</span>`;
  }
}

// ── 시작 ────────────────────────────────────────────────────────────────
async function boot() {
  applyTheme(lsGet("roomtemp.theme") || "system");
  S.me = loadMe();
  S.lastHour = startOfHour();

  renderTrivia();
  render();
  wire();

  tickClock();
  setInterval(tickClock, 1000);

  // 날씨는 실패해도 나머지는 돌아가야 합니다
  fetchWeather(LAT, LON)
    .then((w) => { S.weather = w; render(); })
    .catch((err) => {
      console.warn("날씨 조회 실패", err);
      $("wRow").innerHTML = `<span class="dim">날씨를 못 불러왔어요. 잠시 뒤 새로고침해 보세요.</span>`;
    });
  setInterval(() => {
    fetchWeather(LAT, LON).then((w) => { S.weather = w; renderWeather(band()); }).catch(() => {});
  }, 15 * 60e3);

  if (!db.configured) {
    setSave(".env 설정 필요", "bad");
    $("chip").textContent = "설정 필요";
    return;
  }

  try {
    await db.signIn();
  } catch (err) {
    console.error(err);
    toast(err.message);
    setSave("로그인 실패", "bad");
    return;
  }

  setSave("아직 내 표 없음");
  db.watchPeers((n) => {
    S.peers = n;
    renderClockBar(breakState());
  });
  await refresh();
  db.subscribe((scope) => refresh(scope));

  // 이번 시간 도장이 아직이면 지금 찍어둡니다
  db.recordCheckpoint().then((row) => { if (row?.created) refresh("meta"); }).catch(() => {});

  // 알림은 사용자가 한 번 눌러야 물어봅니다 (자동으로 뜨면 다들 차단해 버려요)
  $("clockCard").addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") toast("정각마다 알려드릴게요");
      });
    }
  }, { once: true });
}

boot();
