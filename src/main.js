/**
 * 전부 엮는 곳.
 *
 *   왼쪽   세로 온도계 — 눈금을 누르면 그게 내 희망 온도
 *   가운데 강의실 — 바닥을 누르면 내 자리로 걸어가고, 말풍선으로 채팅
 *   아래   이모지 + 채팅 입력
 *   오른쪽 패널 + 아이콘 레일 (강의 · 바람 · 대화 · 게시판 …)
 *
 * 이 앱의 결론은 "몇 도"가 아니라 **"어느 쪽에 바람을 더/덜 보낼까"** 입니다.
 * 36명의 희망은 절대 하나로 안 모이니까요. 온도는 하나로 정하고,
 * 남는 차이는 구역별 바람으로 메웁니다.
 */

import "./style.css";

import * as db from "./supa.js";
import { summarise, clamp, toHalf, r1, fmt } from "./stats.js";
import { setDark, randomMe, creature } from "./creature.js";
import {
  resolveSeason, zoneBreakdown, airflow, fetchWeather, triviaOfToday, TRIVIA,
  msToNextHour, countdownText,
} from "./climate.js";
import {
  ROOM, TV_SLIDES, roomSVG, paintPeople, popReaction, reactionBarHTML,
  spawnPos, pointToPos, zoneAt, zoneCounts, CHAT_MS,
} from "./world.js";
import { drawThermo, thermoTipHTML, yToTemp } from "./thermo.js";
import { drawRidge, drawSpark, drawHourly, drawLectureTrend, P } from "./chart.js";
import { openQuestions } from "./board.js";
import { makeGroups, pickOne, toMembers } from "./draw.js";
import * as panels from "./panels.js";

const $ = (id) => document.getElementById(id);
const ENV_SIZE = Number(import.meta.env.VITE_ROOM_SIZE) || 36;
const LAT = Number(import.meta.env.VITE_LAT) || 37.5665;
const LON = Number(import.meta.env.VITE_LON) || 126.978;
const WIDE = () => window.matchMedia("(min-width: 861px)").matches;

const S = {
  votes: [], posts: [], config: null, history: [], checkpoints: [],
  mine: null, me: null, uid: null, weather: null,
  pos: null, myZone: null,
  people: [], prev: new Map(), peers: 0,
  msg: "", msgAt: 0, chatlog: [], seenMsg: new Map(),
  filter: "all", kind: "chat", panel: null, triviaIdx: null,
  slide: 0, lastHour: null, breakSeen: null,
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  const dark = mode === "dark" || (mode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  setDark(dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#12101c" : "#cddff2");
}

/* ── 데이터 ───────────────────────────────────────────────────────────── */
let loading = false, queued = null;
const merge = (a, b) => (!a ? b : a === b ? a : "all");

function syncMe() {
  if (!S.mine) return;
  S.me = { ...S.me, nick: S.mine.nick || S.me.nick, cc: S.mine.cc, ce: S.mine.ce,
           ch: S.mine.ch, cp: S.mine.cp, ci: S.mine.ci, show: !!S.mine.show_nick };
  saveMe();
}

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
    if (data) { Object.assign(S, data); syncMe(); }
  } catch (err) {
    console.error(err);
    toast(err.message?.slice(0, 100) || "불러오기에 실패했어요");
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

  drawThermo($("thermoSvg"), c, b, myTemp());
  $("thTip").innerHTML = thermoTipHTML(c, b, myTemp(), roomSize());
  paintWorld(c);

  const open = openQuestions(S.posts);
  $("qBadge").hidden = open === 0;
  $("qBadge").textContent = String(open);

  if (S.panel) renderPanel(S.panel, c, b);
}

let bgSig = "";
function paintWorld(c) {
  const cc = c ?? summarise(S.votes, band());
  const counts = zoneCounts(S.people);
  const af = airflow(zoneBreakdown(S.votes), cc.setpoint);

  const sig = [S.slide, [...counts.entries()].sort().join(","),
               af.rows.map((r) => r.dir).join("")].join("|");
  if (bgSig !== sig) {
    $("roomWrap").querySelector(".roombg")?.remove();
    $("roomWrap").insertAdjacentHTML("afterbegin", roomSVG(counts, S.slide, af.byZone));
    bgSig = sig;
  }

  // 내 캐릭터는 서버 왕복을 기다리지 않고 로컬 상태로 바로 그립니다
  const meKey = S.uid ?? "me";
  const others = S.people.filter((p) => p.key !== meKey);
  const me = { key: meKey, x: S.pos.x, y: S.pos.y,
               nick: S.me.nick || "익명", cfg: myCfg(), msg: S.msg, msgAt: S.msgAt };
  paintPeople($("people"), [...others, me], meKey, S.prev);

  $("roomName").textContent = `${ROOM.icon} ${ROOM.name}`;
  $("peerPill").hidden = S.peers < 2;
  $("peerPill").querySelector("b").textContent = String(S.peers);
}

/* ── 이동 ─────────────────────────────────────────────────────────────── */
// 빨리 연달아 누르면 실시간 한도에 걸립니다. 260ms 로 묶되 마지막 위치는 꼭 보냅니다.
let presTimer = null, presDirty = false;
function pushPresence() {
  if (!S.pos) return;
  presDirty = true;
  if (presTimer) return;
  const send = () => {
    if (!presDirty) { presTimer = null; return; }
    presDirty = false;
    db.setPresence({ x: S.pos.x, y: S.pos.y, nick: S.me.nick || "익명",
                     cfg: myCfg(), msg: S.msg || "", msgAt: S.msgAt || 0 });
    presTimer = setTimeout(send, 260);
  };
  send();
}

function moveTo(pos) {
  if (!pos) return;
  S.pos = pos;
  paintWorld();
  pushPresence();
  syncZone();
  $("floorTip").style.opacity = "0";
}

let zoneTimer = null;
function syncZone() {
  const z = zoneAt(S.pos);
  if (z === S.myZone) return;
  S.myZone = z;
  if (!S.mine) return;
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
    nick: S.me.nick || "", ...myCfg(),
    show_nick: !!S.me.show, zone: S.myZone ?? null, season: b.key, ...patch,
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
  if (debounce) saveTimer = setTimeout(run, 420);
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
      await db.saveHistory({ d: key, setpoint: c.setpoint, raw: r1(c.raw), n: c.n,
                             med: r1(c.median), p25: r1(c.p25), p75: r1(c.p75) });
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
  const at = S.mine?.lec_at ? Date.parse(S.mine.lec_at) : 0;
  const mine = at >= h0 ? { diff: S.mine.diff, pace: S.mine.pace } : { diff: null, pace: null };

  let tip = "";
  if (d.length >= 2 && p.length >= 2) {
    const D = avg(d), Pc = avg(p);
    if (D >= 1 && Pc >= 1) tip = "어렵고 빠르다는 신호가 같이 왔어요. <strong>속도를 줄이는 쪽</strong>이 보통 먼저입니다.";
    else if (D >= 1) tip = "예시를 하나 더 짚고 넘어가면 좋겠다는 뜻이에요.";
    else if (Pc <= -1) tip = "다들 따라왔으니 <strong>좀 더 나가도</strong> 되겠어요.";
    else if (D <= -1 && Pc <= -0.5) tip = "쉽고 느리다니 진도를 당겨도 괜찮겠습니다.";
  }
  return { n: live.length, hour: new Date(h0).getHours(), mine,
           dAvg: avg(d), pAvg: avg(p), dN: d.length, pN: p.length, tip };
}

/* ── 패널 ─────────────────────────────────────────────────────────────── */
function openPanel(key) {
  S.panel = key;
  $("sideTitle").textContent = panels.TITLES[key] ?? "";
  $("sidePanel").hidden = false;
  $("scrim").hidden = WIDE();
  document.querySelectorAll("#rail button").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.panel === key)));
  renderPanel(key, summarise(S.votes, band()), band());
  $("sideBody").scrollTop = 0;
}

function closePanel() {
  S.panel = null;
  $("sidePanel").hidden = true;
  $("scrim").hidden = true;
  document.querySelectorAll("#rail button").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function renderPanel(key, c, b) {
  const body = $("sideBody");
  const zb = zoneBreakdown(S.votes);
  const zoned = S.votes.filter((v) => v.zone !== null && v.zone !== undefined).length;

  if (key === "lecture") {
    const lec = lectureState();
    body.innerHTML = panels.lecturePanel(S, lec);
    drawLectureTrend($("lecTrend"), S.checkpoints);
  } else if (key === "wind") {
    body.innerHTML = panels.windPanel(S, c, airflow(zb, c.setpoint), zoned);
  } else if (key === "chat") body.innerHTML = panels.chatPanel(S);
  else if (key === "board") body.innerHTML = panels.boardPanel(S);
  else if (key === "me") body.innerHTML = panels.mePanel(S, c);
  else if (key === "draw") body.innerHTML = panels.drawPanel(S, toMembers(S.votes));
  else if (key === "info") body.innerHTML = panels.infoPanel(S, b, S.triviaIdx === null ? triviaOfToday() : TRIVIA[S.triviaIdx % TRIVIA.length]);
  else if (key === "more") body.innerHTML = panels.morePanel(S, c, b, lsGet("roomtemp.theme") || "system");
  else if (key === "stats") {
    body.innerHTML = panels.statsPanel(S, c, roomSize());
    const sx = drawRidge($("ridge"), c, b);
    wireRidge(c, b, sx);
    drawHourly($("hourly"), S.checkpoints);
    const note = drawSpark($("spark"), S.history);
    if (note) $("sparkNote").textContent = note;
    fillTable(c);
    $("insight").innerHTML = insight(c);
  }
}

function insight(c) {
  if (!c.n) return "아직 표가 없어요. 왼쪽 온도계를 눌러 첫 표를 찍어보세요.";
  if (c.n < 5) return `표가 <strong>${c.n}개</strong>뿐이라 타점이 아직 크게 흔들려요.`;
  if (c.split) return `⚠︎ 의견이 <strong>${fmt(c.split.lo)}°</strong>와 <strong>${fmt(c.split.hi)}°</strong> 두 갈래로 갈렸어요. 평균 하나로 누르면 양쪽 다 불편합니다 — <strong>바람 배분</strong> 패널을 보세요.`;
  if (c.iqr <= 1) return `합의가 잘 됐어요. 가운데 절반이 <strong>${fmt(c.p25)}–${fmt(c.p75)}°</strong>에 모여 ${fmt(c.setpoint)}°면 <strong>${c.inBand}/${c.n}명</strong>이 ±1° 안입니다.`;
  return `${fmt(c.setpoint)}°면 <strong>${c.inBand}/${c.n}명</strong>이 ±1° 안, <strong>${c.unhappy}명</strong>은 1.5° 넘게 아쉬워요. 나머지는 바람으로 메워야 합니다.`;
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
    return `<tr><td class="n">${k}°</td><td class="n">${n}</td><td class="n">${((n / c.n) * 100).toFixed(0)}%</td><td><span class="bar" style="width:${((n / max) * 100).toFixed(1)}%"></span></td></tr>`;
  }).join("");
}

function wireRidge(c, b, sx) {
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
    tip.innerHTML = `<b>${fmt(t)}°</b> · <b>${within}</b>/${c.n}명이 ±1° 안`;
    tip.style.left = `${(sx(t) / P.w) * 100}%`;
    tip.style.top = `${((P.top - 8) / P.h) * 100}%`;
    tip.style.opacity = "1";
  };
  zone.addEventListener("pointermove", move);
  zone.addEventListener("pointerdown", move);
  zone.addEventListener("pointerleave", hide);
}

/* ── 시계 ─────────────────────────────────────────────────────────────── */
function breakState() {
  const until = S.config?.break_until ? Date.parse(S.config.break_until) : 0;
  const left = until - Date.now();
  return left > 0 ? { left, until } : null;
}

let slideTick = 0;
function tickClock() {
  const brk = breakState(), pill = $("clockPill");
  if (brk) {
    pill.textContent = `☕ 쉬는 시간 ${countdownText(brk.left)}`;
    pill.className = "pill onbreak";
    S.breakSeen = brk.until;
  } else {
    if (S.breakSeen) { toast("쉬는 시간 끝 — 자리로 돌아와 주세요 🙌"); S.breakSeen = null; }
    const left = msToNextHour();
    pill.textContent = `${left < 60e3 ? "🔔" : left < 3e5 ? "⏰" : "⏳"} 조절까지 ${countdownText(left)}`;
    pill.className = `pill${left < 60e3 ? " due" : ""}`;
  }

  const hour = startOfHour();
  if (S.lastHour === null) S.lastHour = hour;
  else if (hour !== S.lastHour) { S.lastHour = hour; onHourStruck(); }

  if (S.msg && Date.now() - S.msgAt > CHAT_MS) { S.msg = ""; pushPresence(); paintWorld(); }

  // TV 안내문 — 9초마다 넘어갑니다
  if (++slideTick % 9 === 0) {
    S.slide = (S.slide + 1) % TV_SLIDES.length;
    paintWorld();
  }
}

async function onHourStruck() {
  if (S.panel === "lecture") renderPanel("lecture", summarise(S.votes, band()), band());
  if (!db.configured) return;
  try {
    const row = await db.recordCheckpoint();
    await refresh("all");
    if (row?.created && row.changed) toast(`정각 — ${fmt(row.applied)}° → ${fmt(row.setpoint)}° 로 바꿀 때예요`);
  } catch { /* 다음 정각에 다시 */ }
}

/* ── 채팅 로그 ────────────────────────────────────────────────────────── */
function noteChat(p, mine) {
  if (!p.msg || !p.msgAt) return;
  if (S.seenMsg.get(p.key) === p.msgAt) return;
  S.seenMsg.set(p.key, p.msgAt);
  S.chatlog.push({ nick: p.nick || "익명", cfg: p.cfg, msg: p.msg, at: p.msgAt, mine: !!mine });
  if (S.chatlog.length > 120) S.chatlog.splice(0, S.chatlog.length - 120);
  if (S.panel === "chat") renderPanel("chat", summarise(S.votes, band()), band());
}

/* ── 이벤트 ───────────────────────────────────────────────────────────── */
function wire() {
  // 온도계 — 누른 눈금이 내 희망
  const th = $("thermoSvg");
  const pick = (ev) => {
    const t = yToTemp(ev, th, band());
    if (t !== null) pushVote({ t }, { debounce: true });
  };
  let drag = false;
  th.addEventListener("pointerdown", (e) => { drag = true; th.setPointerCapture?.(e.pointerId); pick(e); });
  th.addEventListener("pointermove", (e) => { if (drag) pick(e); });
  th.addEventListener("pointerup", () => { drag = false; });
  th.addEventListener("pointercancel", () => { drag = false; });

  // 세계
  $("roomWrap").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".person")) return;
    moveTo(pointToPos(e, $("roomWrap")));
  });

  // 채팅 · 리액션
  $("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const msg = input.value.trim().slice(0, 60);
    if (!msg) return;
    S.msg = msg;
    S.msgAt = Date.now();
    pushPresence();
    paintWorld();
    noteChat({ key: S.uid ?? "me", nick: S.me.nick, cfg: myCfg(), msg, msgAt: S.msgAt }, true);
    input.value = "";
  });

  $("reactBar").innerHTML = reactionBarHTML();
  $("reactBar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-react]");
    if (!btn) return;
    db.sendReact(btn.dataset.react, S.uid);
    popReaction($("people"), S.uid ?? "me", btn.dataset.react);
  });

  // 패널
  $("rail").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-panel]");
    if (!btn) return;
    S.panel === btn.dataset.panel ? closePanel() : openPanel(btn.dataset.panel);
  });
  $("sideClose").addEventListener("click", closePanel);
  $("scrim").addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.panel) closePanel(); });

  $("sideBody").addEventListener("click", onPanelClick);
  $("sideBody").addEventListener("input", onPanelInput);
  $("sideBody").addEventListener("change", onPanelChange);

  window.addEventListener("pagehide", () => db.setPresence(null));
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applyTheme(lsGet("roomtemp.theme") || "system");
    bgSig = "";
    render();
  });
}

async function onPanelClick(e) {
  const hit = (s) => e.target.closest(s);
  const again = (k) => renderPanel(k, summarise(S.votes, band()), band());

  const opt = hit("[data-axis]");
  if (opt) { S.me[opt.dataset.axis] = Number(opt.dataset.v); saveMe(); pushPresence(); paintWorld(); return pushVote({}); }
  if (hit("#rerollBtn")) { const { show } = S.me; S.me = { ...randomMe(), show }; saveMe(); pushPresence(); paintWorld(); return pushVote({}); }

  const w = hit("[data-wind]");
  if (w) {
    const on = w.getAttribute("aria-pressed") === "true";
    return pushVote({ wind: on ? null : Number(w.dataset.wind), wind_at: on ? null : new Date().toISOString() });
  }
  for (const k of ["diff", "pace"]) {
    const b = hit(`[data-${k}]`);
    if (b) {
      const on = b.getAttribute("aria-pressed") === "true";
      return pushVote({ [k]: on ? null : Number(b.dataset[k]), lec_at: on ? null : new Date().toISOString() });
    }
  }

  const kind = hit("[data-kind]");
  if (kind) { S.kind = kind.dataset.kind; return again("board"); }
  const filt = hit("[data-filter]");
  if (filt) { S.filter = filt.dataset.filter; return again("board"); }
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
    } catch (err) { toast(err.message?.slice(0, 70) || "처리하지 못했어요"); }
    return;
  }

  if (hit("#triviaNext")) { S.triviaIdx = ((S.triviaIdx ?? 0) + 1) % TRIVIA.length; return again("info"); }

  const g = hit("[data-groups]");
  if (g) {
    const m = toMembers(S.votes);
    if (m.length < 2) return toast("표를 낸 사람이 너무 적어요");
    const n = Number(g.dataset.groups);
    return saveConfig({ draw_groups: { n, at: new Date().toISOString(), groups: makeGroups(m, n) } });
  }
  if (hit("#groupsClear")) return saveConfig({ draw_groups: null });
  if (hit("#pickBtn")) {
    const m = toMembers(S.votes);
    if (!m.length) return toast("아직 표를 낸 사람이 없어요");
    const res = pickOne(m, S.config?.draw_pick?.history ?? []);
    if (!res) return;
    // 후보들을 빠르게 스쳐 지나간 뒤 멈춥니다. 바로 결과만 뜨면 재미가 없어요.
    const box = $("pickBox");
    if (box && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      box.classList.add("rolling");
      const name = box.querySelector(".pickname");
      const slot = box.querySelector("svg");
      for (let i = 0, wait = 55; i < 16; i++, wait *= 1.16) {
        const r = m[Math.floor(Math.random() * m.length)];
        if (name) name.textContent = r.nick;
        if (slot) slot.innerHTML = creature(r.cfg, "happy");
        await new Promise((k) => setTimeout(k, wait));
      }
      box.classList.remove("rolling");
    }
    if (res.wrapped) toast("한 바퀴 다 돌아 새로 시작합니다");
    return saveConfig({ draw_pick: { at: new Date().toISOString(), current: res.picked, history: res.history } });
  }
  if (hit("#pickReset")) return saveConfig({ draw_pick: null });

  if (hit("#applyBtn")) return saveConfig({ applied: summarise(S.votes, band()).setpoint, applied_at: new Date().toISOString() });
  const brk = hit("[data-break]");
  if (brk) {
    const cur = breakState(), mins = Number(brk.dataset.break);
    const until = new Date((cur ? cur.until : Date.now()) + mins * 60e3).toISOString();
    toast(cur ? `쉬는 시간 ${mins}분 연장` : `쉬는 시간 ${mins}분 시작 ☕`);
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
  if (hit("#themeBtn")) {
    const cur = lsGet("roomtemp.theme") || "system";
    const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    lsSet("roomtemp.theme", next);
    applyTheme(next);
    bgSig = "";
    render();
    return again("more");
  }
  if (hit("#qrBtn")) {
    const box = $("qrBox");
    box.innerHTML = `<span class="dim">만드는 중…</span>`;
    try {
      const QR = await import("qrcode");
      const canvas = document.createElement("canvas");
      await QR.toCanvas(canvas, location.origin + location.pathname, { width: 190, margin: 1 });
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
    paintWorld();
    pushVote({ nick: S.me.nick }, { debounce: true });
  } else if (e.target.id === "postText") {
    const c = $("counter");
    if (c) c.textContent = `${e.target.value.length}/300`;
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
  if (!S.me.nick) S.me.nick = randomMe().nick;
  saveMe();

  S.pos = spawnPos();
  S.myZone = zoneAt(S.pos);
  S.lastHour = startOfHour();

  wire();
  render();
  tickClock();
  setInterval(tickClock, 1000);

  fetchWeather(LAT, LON).then((w) => {
    S.weather = w;
    if (S.panel === "info") renderPanel("info", summarise(S.votes, band()), band());
  }).catch(() => {});
  setInterval(() => fetchWeather(LAT, LON).then((w) => { S.weather = w; }).catch(() => {}), 15 * 60e3);

  $("boot").classList.add("gone");
  setTimeout(() => $("boot")?.remove(), 400);

  if (!db.configured) return toast(".env 가 아직 안 채워졌어요");

  try { S.uid = await db.signIn(); }
  catch (err) { console.error(err); return toast(err.message.slice(0, 110)); }

  db.watchPeople((people) => {
    S.people = people;
    S.peers = people.length;
    for (const p of people) if (p.key !== S.uid) noteChat(p, false);
    paintWorld();
  });
  db.onReaction(({ emoji, from }) => { if (from !== S.uid) popReaction($("people"), from, emoji); });

  pushPresence();
  await refresh();
  db.subscribe((scope) => refresh(scope));
  db.recordCheckpoint().then((row) => { if (row?.created) refresh("meta"); }).catch(() => {});

  if (WIDE()) openPanel("lecture");
}

boot();
