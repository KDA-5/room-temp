/**
 * 전부 엮는 곳.
 *
 * 화면은 세 층입니다. 스크롤 없음.
 *   위    온도바 — 누른 자리가 곧 내 희망 온도
 *   가운데 세계 — 강의실 ⇄ 마당. 캐릭터가 걸어다니고 말풍선으로 채팅
 *   아래   채팅 입력 · 리액션 · 패널 여는 버튼들
 *
 * 통계·게시판·강의·날씨·뽑기는 전부 아래에서 올라오는 패널로 들어갑니다.
 */

import "./style.css";

import * as db from "./supa.js";
import { summarise, clamp, toHalf, r1, fmt } from "./stats.js";
import { setDark, randomMe, moodOf } from "./creature.js";
import {
  resolveSeason, zoneBreakdown, fetchWeather, triviaOfToday, TRIVIA,
  msToNextHour, countdownText,
} from "./climate.js";
import {
  ROOMS, roomSVG, paintPeople, popReaction, reactionBarHTML,
  spawnPos, pointToPos, doorAt, zoneAt, zoneCounts, CHAT_MS,
} from "./world.js";
import { drawTempBar, tempSummaryHTML, xToTemp } from "./tempbar.js";
import { drawRidge, drawSpark, drawHourly, drawLectureTrend, gaugeSVG, P } from "./chart.js";
import { openQuestions } from "./board.js";
import { makeGroups, pickOne, toMembers } from "./draw.js";
import * as panels from "./panels.js";

const $ = (id) => document.getElementById(id);

const ENV_SIZE = Number(import.meta.env.VITE_ROOM_SIZE) || 36;
const LAT = Number(import.meta.env.VITE_LAT) || 37.5665;
const LON = Number(import.meta.env.VITE_LON) || 126.978;

/* ── 상태 ─────────────────────────────────────────────────────────────── */
const S = {
  votes: [], posts: [], config: null, history: [], checkpoints: [],
  mine: null, me: null, uid: null, weather: null,
  room: "classroom", pos: null, myZone: null,
  people: [], prev: new Map(), peers: 0,
  msg: "", msgAt: 0,
  filter: "all", kind: "chat", panel: null, triviaIdx: null,
  lastHour: null, breakSeen: null, ready: false,
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 */ } };
const saveMe = () => lsSet("roomtemp.me", JSON.stringify(S.me));

const band = () => resolveSeason(S.config?.season);
const roomSize = () => S.config?.room_size || ENV_SIZE;
const startOfHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime(); };
const myTemp = () => (Number.isFinite(Number(S.mine?.t)) ? Number(S.mine.t) : null);
const myCfg = () => ({ cc: S.me.cc | 0, ce: S.me.ce | 0, ch: S.me.ch | 0, cp: S.me.cp | 0, ci: S.me.ci | 0 });

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  const dark = mode === "dark" || (mode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  setDark(dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1116" : "#e7ebf2");
}

/* ── 데이터 ───────────────────────────────────────────────────────────── */
let loading = false, queued = null;
const mergeScope = (a, b) => (!a ? b : a === b ? a : "all");

function syncMe() {
  if (!S.mine) return;
  S.me = {
    ...S.me,
    nick: S.mine.nick || S.me.nick,
    cc: S.mine.cc, ce: S.mine.ce, ch: S.mine.ch, cp: S.mine.cp, ci: S.mine.ci,
    show: !!S.mine.show_nick,
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
    if (data) { Object.assign(S, data); S.ready = true; syncMe(); }
  } catch (err) {
    console.error(err);
    toast(err.message?.slice(0, 110) || "불러오기에 실패했어요");
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

  drawTempBar($("tempBar"), c, b, myTemp());
  $("tempSummary").innerHTML = tempSummaryHTML(c, b, myTemp(), roomSize());
  paintWorld();

  const open = openQuestions(S.posts);
  const badge = $("qBadge");
  badge.hidden = open === 0;
  badge.textContent = String(open);

  if (S.panel) renderPanel(S.panel, c, b);
}

/** 방 배경은 방이 바뀌거나 구역 인원이 바뀔 때만 다시 그립니다. */
let bgSig = "";
function paintWorld() {
  const wrap = $("roomWrap");
  const counts = zoneCounts(S.people);
  const sig = S.room + "|" + [...counts.entries()].sort().join(",");
  if (bgSig !== sig) {
    wrap.querySelector(".roombg")?.remove();
    wrap.insertAdjacentHTML("afterbegin", roomSVG(S.room, counts));
    bgSig = sig;
  }

  paintPeople($("people"), S.people.filter((p) => p.room === S.room), S.uid, S.prev);

  const room = ROOMS[S.room];
  $("roomName").textContent = `${room.icon} ${room.name}`;
  const door = $("doorBtn");
  door.textContent = room.door.label;
  door.classList.toggle("left", S.room === "yard");

  const peer = $("peerPill");
  peer.hidden = S.peers < 2;
  peer.querySelector("b").textContent = String(S.peers);
}

/* ── 세계 이동 ────────────────────────────────────────────────────────── */
function pushPresence() {
  if (!S.pos) return;
  db.setPresence({
    room: S.room, x: S.pos.x, y: S.pos.y,
    nick: S.me.nick || "익명", cfg: myCfg(),
    msg: S.msg || "", msgAt: S.msgAt || 0,
  });
}

function moveTo(pos) {
  if (!pos) return;
  const through = doorAt(S.room, pos);
  if (through) return gotoRoom(through);
  S.pos = pos;
  pushPresence();
  syncZone();
  $("floorTip").style.opacity = "0";
}

function gotoRoom(key) {
  S.room = key;
  S.pos = spawnPos(key);
  S.prev.clear();
  $("people").innerHTML = "";
  bgSig = "";
  pushPresence();
  syncZone();
  paintWorld();
}

/** 강의실에서 어느 구역에 서 있는지가 곧 "내 자리"입니다. 바뀔 때만 저장해요. */
let zoneTimer = null;
function syncZone() {
  const z = zoneAt(S.room, S.pos);
  if (z === S.myZone) return;
  S.myZone = z;
  if (!S.mine) return;                    // 아직 표를 안 찍었으면 저장할 게 없음
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => pushVote({ zone: z }), 700);
}

/* ── 투표 ─────────────────────────────────────────────────────────────── */
let saveTimer = null;
async function pushVote(patch, { debounce = false } = {}) {
  if (!db.configured) return toast("아직 연결 전이에요");
  const b = band();
  const body = {
    t: clamp(Number(S.mine?.t) || b.def, b.min, b.max),
    nick: S.me.nick || "",
    ...myCfg(),
    show_nick: !!S.me.show,
    zone: S.myZone ?? null,
    season: b.key,
    ...patch,
  };

  // 화면 먼저, 저장은 뒤따라
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
  if (debounce) saveTimer = setTimeout(run, 450);
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
      await db.saveHistory({ d: key, setpoint: c.setpoint, raw: r1(c.raw), n: c.n, med: r1(c.median), p25: r1(c.p25), p75: r1(c.p75) });
    } catch { /* 기록은 실패해도 본편엔 지장 없음 */ }
  }, 2500);
}

async function saveConfig(patch) {
  try { await db.saveConfig(patch); await refresh("meta"); }
  catch { toast("저장하지 못했어요"); }
}

/* ── 강의 피드백 ──────────────────────────────────────────────────────── */
function lectureState() {
  const h0 = startOfHour();
  const live = S.votes.filter((v) => v.lec_at && Date.parse(v.lec_at) >= h0);
  const nums = (k) => live.map((v) => v[k]).filter((x) => x !== null && x !== undefined).map(Number);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const d = nums("diff"), p = nums("pace");
  const mineAt = S.mine?.lec_at ? Date.parse(S.mine.lec_at) : 0;
  const mine = mineAt >= h0 ? { diff: S.mine.diff, pace: S.mine.pace } : { diff: null, pace: null };

  const say = (v, lo, hi) => (Math.abs(v) < 0.4 ? "딱 좋음" : v > 0 ? (v >= 1.2 ? `많이 ${hi}` : `살짝 ${hi}`) : v <= -1.2 ? `많이 ${lo}` : `살짝 ${lo}`);
  let summary;
  if (live.length < 3) summary = `이번 시간 응답 <strong>${live.length}명</strong>. 3명만 넘으면 요약이 뜹니다.`;
  else {
    const parts = [];
    if (d.length) parts.push(`난이도는 <strong>${say(avg(d), "쉬움", "어려움")}</strong>(${d.length}명)`);
    if (p.length) parts.push(`속도는 <strong>${say(avg(p), "느림", "빠름")}</strong>(${p.length}명)`);
    let tip = "";
    if (avg(d) >= 1 && avg(p) >= 1) tip = " — 어렵고 빠르다는 신호가 같이 왔어요. 속도를 줄이는 쪽이 보통 먼저입니다.";
    else if (avg(d) >= 1) tip = " — 예시를 하나 더 짚고 넘어가면 좋겠다는 뜻이에요.";
    else if (avg(p) <= -1) tip = " — 다들 따라왔으니 좀 더 나가도 되겠어요.";
    summary = `이번 시간 ${parts.join(", ")}${tip}`;
  }
  return { n: live.length, hour: new Date(h0).getHours(), mine, dAvg: avg(d), pAvg: avg(p), dN: d.length, pN: p.length, summary };
}

/* ── 패널 ─────────────────────────────────────────────────────────────── */
function openPanel(key) {
  S.panel = key;
  $("panelTitle").textContent = panels.TITLES[key] ?? "";
  $("panel").hidden = false;
  $("scrim").hidden = false;
  document.querySelectorAll("#tools button").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.panel === key)));
  renderPanel(key, summarise(S.votes, band()), band());
  $("panelBody").scrollTop = 0;
}

function closePanel() {
  S.panel = null;
  $("panel").hidden = true;
  $("scrim").hidden = true;
  document.querySelectorAll("#tools button").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function renderPanel(key, c, b) {
  const body = $("panelBody");
  const zb = zoneBreakdown(S.votes);

  if (key === "me") body.innerHTML = panels.mePanel(S, c);
  else if (key === "wind") body.innerHTML = panels.windPanel(S, c, zb);
  else if (key === "board") body.innerHTML = panels.boardPanel(S);
  else if (key === "info") body.innerHTML = panels.infoPanel(S, b, S.triviaIdx === null ? triviaOfToday() : TRIVIA[S.triviaIdx % TRIVIA.length]);
  else if (key === "draw") body.innerHTML = panels.drawPanel(S, toMembers(S.votes));
  else if (key === "more") body.innerHTML = panels.morePanel(S, c, b, lsGet("roomtemp.theme") || "system");
  else if (key === "lecture") {
    const lec = lectureState();
    body.innerHTML = panels.lecturePanel(S, lec);
    const tone = (v, n) => (n < 2 ? "neutral" : Math.abs(v) >= 1 ? "warn" : Math.abs(v) >= 0.5 ? "neutral" : "good");
    $("diffGauge").innerHTML = gaugeSVG(lec.dAvg, lec.dN, ["너무 쉬움", "딱 좋음", "너무 어려움"], tone(lec.dAvg, lec.dN));
    $("paceGauge").innerHTML = gaugeSVG(lec.pAvg, lec.pN, ["너무 느림", "딱 좋음", "너무 빠름"], tone(lec.pAvg, lec.pN));
    drawLectureTrend($("lecTrend"), S.checkpoints);
  } else if (key === "stats") {
    body.innerHTML = panels.statsPanel(S, c, roomSize());
    const sx = drawRidge($("ridge"), c, b);
    wireRidgeHover(c, b, sx);
    drawHourly($("hourly"), S.checkpoints);
    const note = drawSpark($("spark"), S.history);
    if (note) $("sparkNote").textContent = note;
    fillTable(c);
    $("insight").innerHTML = insightHTML(c);
  }
}

function insightHTML(c) {
  if (!c.n) return "아직 표가 없어요. 위 온도바를 눌러 첫 표를 찍어보세요.";
  if (c.n < 5) return `표가 <strong>${c.n}개</strong>뿐이라 타점이 아직 크게 흔들려요. 10명쯤 모이면 안정적으로 읽힙니다.`;
  if (c.split) return `⚠︎ 의견이 <strong>${fmt(c.split.lo)}°C</strong>와 <strong>${fmt(c.split.hi)}°C</strong> 두 갈래로 갈렸어요. 평균 하나로 누르면 양쪽 다 불편합니다 — 바람 패널의 자리별 표를 보세요.`;
  if (c.iqr <= 1) return `합의가 잘 됐어요. 가운데 절반이 <strong>${fmt(c.p25)}–${fmt(c.p75)}°C</strong>에 모여 있어서, ${fmt(c.setpoint)}°C면 <strong>${c.inBand}/${c.n}명</strong>이 ±1°C 안에 들어옵니다.`;
  return `${fmt(c.setpoint)}°C면 <strong>${c.inBand}/${c.n}명</strong>이 ±1°C 안, <strong>${c.unhappy}명</strong>은 1.5°C 넘게 아쉬운 상태예요.`;
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
    return `<tr><td class="n">${k} °C</td><td class="n">${n}</td><td class="n">${((n / c.n) * 100).toFixed(0)}%</td><td><span class="bar" style="width:${((n / max) * 100).toFixed(1)}%"></span></td></tr>`;
  }).join("");
}

function wireRidgeHover(c, b, sx) {
  const svg = $("ridge"), tip = $("tip");
  const zone = svg.querySelector("#hitzone"), cross = svg.querySelector("#cross");
  if (!zone) return;
  const hide = () => { tip.style.opacity = "0"; cross?.setAttribute("opacity", "0"); };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const px = ((ev.clientX - r.left) / r.width) * P.w;
    if (px < P.x0 || px > P.x1) return hide();
    const t = toHalf(b.min + ((px - P.x0) / (P.x1 - P.x0)) * (b.max - b.min));
    const within = c.xs.filter((x) => Math.abs(x - t) <= 1).length;
    cross?.setAttribute("x1", sx(t).toFixed(1));
    cross?.setAttribute("x2", sx(t).toFixed(1));
    cross?.setAttribute("opacity", "1");
    tip.innerHTML = `<b>${fmt(t)}°C</b> · 이 온도면 <b>${within}</b>/${c.n}명이 ±1°C 안`;
    tip.style.left = `${(sx(t) / P.w) * 100}%`;
    tip.style.top = `${((P.top - 8) / P.h) * 100}%`;
    tip.style.opacity = "1";
  };
  zone.addEventListener("pointermove", move);
  zone.addEventListener("pointerdown", move);
  zone.addEventListener("pointerleave", hide);
}

/* ── 정각 시계 ────────────────────────────────────────────────────────── */
function breakState() {
  const until = S.config?.break_until ? Date.parse(S.config.break_until) : 0;
  const left = until - Date.now();
  return left > 0 ? { left, until } : null;
}

function tickClock() {
  const brk = breakState();
  const pill = $("clockPill");
  if (brk) {
    pill.textContent = `☕ 쉬는 시간 ${countdownText(brk.left)}`;
    pill.className = "pill onbreak";
    S.breakSeen = brk.until;
  } else {
    if (S.breakSeen) { toast("쉬는 시간 끝 — 자리로 돌아와 주세요 🙌"); S.breakSeen = null; }
    const left = msToNextHour();
    pill.textContent = `${left < 60e3 ? "🔔" : left < 300e3 ? "⏰" : "⏳"} 조절까지 ${countdownText(left)}`;
    pill.className = `pill${left < 60e3 ? " due" : ""}`;
  }

  const hour = startOfHour();
  if (S.lastHour === null) S.lastHour = hour;
  else if (hour !== S.lastHour) { S.lastHour = hour; onHourStruck(); }

  // 말풍선은 시간이 지나면 알아서 사라져야 합니다
  if (S.msg && Date.now() - S.msgAt > CHAT_MS) { S.msg = ""; pushPresence(); }
}

async function onHourStruck() {
  if (S.panel === "lecture") renderPanel("lecture", summarise(S.votes, band()), band());
  if (!db.configured) return;
  try {
    const row = await db.recordCheckpoint();
    await refresh("all");
    if (row?.created && row.changed) toast(`정각 확인 — ${fmt(row.applied)}°C → ${fmt(row.setpoint)}°C 로 바꿀 때예요`);
  } catch { /* 다음 정각에 다시 */ }
}

/* ── 이벤트 ───────────────────────────────────────────────────────────── */
function wire() {
  // 온도바 — 누른 자리가 내 희망 온도
  const tb = $("tempBar");
  const pick = (ev) => {
    const t = xToTemp(ev, tb, band());
    if (t !== null) pushVote({ t }, { debounce: true });
  };
  let dragging = false;
  tb.addEventListener("pointerdown", (e) => { dragging = true; tb.setPointerCapture?.(e.pointerId); pick(e); });
  tb.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
  tb.addEventListener("pointerup", () => { dragging = false; });
  tb.addEventListener("pointercancel", () => { dragging = false; });

  // 세계 — 바닥을 누르면 걸어감
  $("roomWrap").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".person, .doorbtn")) return;
    moveTo(pointToPos(e, $("roomWrap")));
  });
  $("doorBtn").addEventListener("click", () => gotoRoom(ROOMS[S.room].door.to));

  // 채팅 — 머리 위 말풍선으로 뜹니다
  $("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const msg = input.value.trim().slice(0, 60);
    if (!msg) return;
    S.msg = msg;
    S.msgAt = Date.now();
    pushPresence();
    input.value = "";
  });

  // 리액션
  $("reactBar").innerHTML = reactionBarHTML();
  $("reactBar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-react]");
    if (!btn) return;
    db.sendReact(btn.dataset.react, S.uid);
    popReaction($("people"), S.uid, btn.dataset.react);
  });

  // 패널
  $("tools").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-panel]");
    if (!btn) return;
    S.panel === btn.dataset.panel ? closePanel() : openPanel(btn.dataset.panel);
  });
  $("panelClose").addEventListener("click", closePanel);
  $("scrim").addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.panel) closePanel(); });

  $("panelBody").addEventListener("click", onPanelClick);
  $("panelBody").addEventListener("input", onPanelInput);
  $("panelBody").addEventListener("change", onPanelChange);

  window.addEventListener("pagehide", () => db.setPresence(null));
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applyTheme(lsGet("roomtemp.theme") || "system");
    bgSig = "";
    render();
  });
}

async function onPanelClick(e) {
  const hit = (sel) => e.target.closest(sel);
  const reopen = (k) => renderPanel(k, summarise(S.votes, band()), band());

  // 나
  const opt = hit("[data-axis]");
  if (opt) { S.me[opt.dataset.axis] = Number(opt.dataset.v); saveMe(); pushPresence(); return pushVote({}); }
  if (hit("#rerollBtn")) { const { show } = S.me; S.me = { ...randomMe(), show }; saveMe(); pushPresence(); return pushVote({}); }

  // 바람
  const w = hit("[data-wind]");
  if (w) {
    const on = w.getAttribute("aria-pressed") === "true";
    return pushVote({ wind: on ? null : Number(w.dataset.wind), wind_at: on ? null : new Date().toISOString() });
  }

  // 강의
  for (const k of ["diff", "pace"]) {
    const b = hit(`[data-${k}]`);
    if (b) {
      const on = b.getAttribute("aria-pressed") === "true";
      return pushVote({ [k]: on ? null : Number(b.dataset[k]), lec_at: on ? null : new Date().toISOString() });
    }
  }

  // 게시판
  const kind = hit("[data-kind]");
  if (kind) { S.kind = kind.dataset.kind; return reopen("board"); }
  const filt = hit("[data-filter]");
  if (filt) { S.filter = filt.dataset.filter; return reopen("board"); }
  if (hit("#postBtn")) {
    const ta = $("postText"), body = ta.value.trim();
    if (!body) return ta.focus();
    try {
      await db.addPost({ body: body.slice(0, 300), kind: S.kind, nick: S.me.nick || "익명", ...myCfg() });
      ta.value = "";
      await refresh("posts");
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
    } catch (err) { toast(err.message?.slice(0, 80) || "처리하지 못했어요"); }
    return;
  }

  // 잡학
  if (hit("#triviaNext")) { S.triviaIdx = ((S.triviaIdx ?? 0) + 1) % TRIVIA.length; return reopen("info"); }

  // 뽑기
  const g = hit("[data-groups]");
  if (g) {
    const members = toMembers(S.votes);
    if (members.length < 2) return toast("표를 낸 사람이 너무 적어요");
    const n = Number(g.dataset.groups);
    return saveConfig({ draw_groups: { n, at: new Date().toISOString(), groups: makeGroups(members, n) } });
  }
  if (hit("#groupsClear")) return saveConfig({ draw_groups: null });
  if (hit("#pickBtn")) {
    const members = toMembers(S.votes);
    if (!members.length) return toast("아직 표를 낸 사람이 없어요");
    const res = pickOne(members, S.config?.draw_pick?.history ?? []);
    if (!res) return;
    const box = $("pickBox");
    if (box && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      box.classList.add("rolling");
      await new Promise((r) => setTimeout(r, 600));
    }
    if (res.wrapped) toast("한 바퀴 다 돌아서 새로 시작합니다");
    return saveConfig({ draw_pick: { at: new Date().toISOString(), current: res.picked, history: res.history } });
  }
  if (hit("#pickReset")) return saveConfig({ draw_pick: null });

  // 설정
  if (hit("#applyBtn")) return saveConfig({ applied: summarise(S.votes, band()).setpoint, applied_at: new Date().toISOString() });
  const brk = hit("[data-break]");
  if (brk) {
    const cur = breakState(), mins = Number(brk.dataset.break);
    const until = new Date((cur ? cur.until : Date.now()) + mins * 60e3).toISOString();
    const total = Math.round(((cur ? cur.until - Date.now() : 0) + mins * 60e3) / 60e3);
    toast(cur ? `쉬는 시간 ${mins}분 연장` : `쉬는 시간 ${mins}분 시작 ☕`);
    return saveConfig({ break_until: until, break_label: String(total) });
  }
  if (hit("#breakEnd")) return saveConfig({ break_until: null, break_label: null });
  const season = hit("[data-season]");
  if (season) return saveConfig({ season: season.dataset.season });
  if (hit("#indoorSave")) {
    const t = parseFloat($("indoorT").value), rh = parseFloat($("indoorRh").value);
    return saveConfig({ indoor_t: Number.isFinite(t) ? t : null, indoor_rh: Number.isFinite(rh) ? rh : null, indoor_at: new Date().toISOString() });
  }
  if (hit("#indoorClear")) return saveConfig({ indoor_t: null, indoor_rh: null, indoor_at: null });
  if (hit("#themeBtn")) {
    const cur = lsGet("roomtemp.theme") || "system";
    const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    lsSet("roomtemp.theme", next);
    applyTheme(next);
    bgSig = "";
    return reopen("more");
  }
  if (hit("#qrBtn")) {
    const box = $("qrBox");
    box.innerHTML = `<span class="dim">만드는 중…</span>`;
    try {
      const QR = await import("qrcode");
      const canvas = document.createElement("canvas");
      await QR.toCanvas(canvas, location.origin + location.pathname, { width: 200, margin: 1, color: { dark: "#1b2430", light: "#ffffff" } });
      box.innerHTML = "";
      box.append(canvas);
    } catch { box.innerHTML = `<span class="dim">QR 을 만들지 못했어요.</span>`; }
    return;
  }
}

function onPanelInput(e) {
  if (e.target.id === "nickIn") {
    S.me.nick = e.target.value.slice(0, 12);
    saveMe();
    pushPresence();
    pushVote({ nick: S.me.nick }, { debounce: true });
  } else if (e.target.id === "postText") {
    const cnt = $("counter");
    if (cnt) cnt.textContent = `${e.target.value.length}/300`;
  }
}

function onPanelChange(e) {
  if (e.target.id === "showNickIn") {
    S.me.show = e.target.checked;
    saveMe();
    pushVote({ show_nick: S.me.show });
  }
}

/* ── 시작 ─────────────────────────────────────────────────────────────── */
async function boot() {
  applyTheme(lsGet("roomtemp.theme") || "system");

  const raw = lsGet("roomtemp.me");
  try { S.me = raw ? { ...randomMe(), ...JSON.parse(raw) } : randomMe(); }
  catch { S.me = randomMe(); }
  saveMe();

  S.pos = spawnPos(S.room);
  S.myZone = zoneAt(S.room, S.pos);
  S.lastHour = startOfHour();

  wire();
  render();
  tickClock();
  setInterval(tickClock, 1000);

  fetchWeather(LAT, LON)
    .then((w) => { S.weather = w; if (S.panel === "info") renderPanel("info", summarise(S.votes, band()), band()); })
    .catch(() => {});
  setInterval(() => fetchWeather(LAT, LON).then((w) => { S.weather = w; }).catch(() => {}), 15 * 60e3);

  $("boot").classList.add("gone");
  setTimeout(() => $("boot")?.remove(), 400);

  if (!db.configured) return toast(".env 가 아직 안 채워졌어요");

  try { S.uid = await db.signIn(); }
  catch (err) { console.error(err); return toast(err.message.slice(0, 120)); }

  db.watchPeople((people) => {
    S.people = people;
    S.peers = people.length;
    paintWorld();
  });
  db.onReaction(({ emoji, from }) => { if (from !== S.uid) popReaction($("people"), from, emoji); });

  pushPresence();
  await refresh();
  db.subscribe((scope) => refresh(scope));
  db.recordCheckpoint().then((row) => { if (row?.created) refresh("meta"); }).catch(() => {});
}

boot();
