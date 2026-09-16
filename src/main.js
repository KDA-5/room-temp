/**
 * 전부 엮는 곳.
 *
 * 화면은 탭 셋입니다.
 *   🌡️ 온도   지금 맞춰야 할 온도 + 추워요/딱좋음/더워요 + 내 자리 + 바람 배분
 *   🎓 강의   난이도 · 속도
 *   ⋯ 더보기  게시판 · 통계 · 대화 · 뽑기 · 날씨 · QR · 설정
 *
 * 하루에 하는 일은 버튼 하나 누르는 것뿐이라, 그게 폰 첫 화면에서
 * 바로 눌리게 만드는 게 전부입니다.
 *
 * 🥶/🥵 는 내 희망 온도를 ±0.5도 밀어줍니다. 그래서 한 번만 눌러도
 * 기존 20% 절사평균 계산이 그대로 돌아가요.
 *
 * 이 앱의 결론은 "몇 도"가 아니라 **"어느 쪽에 바람을 더/덜 보낼까"** 입니다.
 * 36명의 희망은 절대 하나로 안 모이니까요.
 */

import "./style.css";

import * as db from "./supa.js";
import { summarise, clamp, toHalf, r1, fmt } from "./stats.js";
import { ZONES, ZONE_MIN } from "./zones.js";
import {
  resolveSeason, zoneBreakdown, airflow, airflowText,
  fetchWeather, triviaOfToday, TRIVIA, msToNextHour, countdownText,
} from "./climate.js";
import { drawRidge, drawSpark, drawHourly, P } from "./chart.js";
import { openQuestions } from "./board.js";
import { makeGroups, pickOne, toMembers } from "./draw.js";
import * as sh from "./sheets.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ENV_SIZE = Number(import.meta.env.VITE_ROOM_SIZE) || 36;
const LAT = Number(import.meta.env.VITE_LAT) || 37.5665;
const LON = Number(import.meta.env.VITE_LON) || 126.978;
const FEEL_MS = 3 * 3600e3;

const ADJ = ["졸린", "신난", "느긋한", "반짝이는", "포근한", "산뜻한", "조용한", "부지런한", "엉뚱한", "말랑한"];
const ANI = ["수달", "펭귄", "너구리", "알파카", "다람쥐", "올빼미", "코알라", "여우", "토끼", "판다"];
const randomNick = () => `${ADJ[(Math.random() * ADJ.length) | 0]} ${ANI[(Math.random() * ANI.length) | 0]}`;

const S = {
  votes: [], posts: [], config: null, history: [], checkpoints: [],
  mine: null, me: null, uid: null, weather: null,
  peers: 0, chatlog: [], seenMsg: new Map(),
  tab: "temp", sheet: null, filter: "all", kind: "chat",
  triviaIdx: null, barOpen: false, lastHour: null, breakSeen: null,
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 */ } };
const saveMe = () => lsSet("roomtemp.me", JSON.stringify(S.me));

const band = () => resolveSeason(S.config?.season);
const roomSize = () => S.config?.room_size || ENV_SIZE;
const startOfHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime(); };
const myTemp = () => (Number.isFinite(Number(S.mine?.t)) ? Number(S.mine.t) : null);

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
      Object.assign(S, data);
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
  renderFeel(c);
  renderSeats(af);
  renderFlow(af);
  renderLecture();

  const open = openQuestions(S.posts);
  $("qBadge").hidden = open === 0;
  $("qBadge").textContent = String(open);
  $("peerChip").hidden = S.peers < 2;
  $("peerChip").querySelector("b").textContent = String(S.peers);

  if (S.tab === "more" && !S.sheet) $("moreMenu").innerHTML = sh.menuHTML(S);
  if (S.sheet) renderSheet(S.sheet, c, b);
}

function renderHero(c) {
  $("setpoint").textContent = c.n ? fmt(c.setpoint) : "–";
  const applied = Number.isFinite(Number(S.config?.applied)) ? Number(S.config.applied) : null;
  const act = $("heroAct");

  if (!c.n) {
    act.className = "heroact";
    act.textContent = "아직 표가 없어요. 아래 버튼을 눌러주세요.";
  } else if (applied === null) {
    act.className = "heroact";
    act.innerHTML = `${c.n}명이 모아서 정한 온도예요`;
  } else if (Math.abs(c.setpoint - applied) >= 0.5) {
    act.className = "heroact move";
    act.innerHTML = `🔧 지금 <b>${fmt(applied)}°</b> → <b>${fmt(c.setpoint)}°</b> 로 바꿔주세요`;
  } else {
    act.className = "heroact keep";
    act.innerHTML = `✓ 지금 설정 <b>${fmt(applied)}°</b> 그대로 두면 돼요`;
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

function renderSeats(af) {
  const mine = S.mine?.zone;
  $("seats").innerHTML = ZONES.map((z) => {
    const r = af.byZone.get(z.i);
    const cls = r?.dir < 0 ? "less" : r?.dir > 0 ? "more" : "";
    let sub = r?.n ? `${r.n}명` : "빈 자리";
    if (r?.shown) sub = r.dir < 0 ? `바람 ↓ · ${fmt(r.avg)}°` : r.dir > 0 ? `바람 ↑ · ${fmt(r.avg)}°` : `${fmt(r.avg)}°`;
    return `<button type="button" data-zone="${z.i}" class="${cls}" aria-pressed="${mine === z.i}">` +
      `<span class="sn">${esc(z.short)}</span><span class="sm">${esc(sub)}</span></button>`;
  }).join("");
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
           dAvg: avg(d), pAvg: avg(p), dN: d.length, pN: p.length, tip };
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

function renderLecture() {
  const lec = lectureState();
  $("lecNote").innerHTML = `익명입니다. <b>정각마다 초기화</b>되니 매 시간 편하게 눌러주세요. 지금은 <b>${lec.hour}시</b> 집계 · ${lec.n}명.`;
  for (const [row, key, mine] of [["diffRow", "diff", lec.mine.diff], ["paceRow", "pace", lec.mine.pace]]) {
    document.querySelectorAll(`#${row} button`).forEach((el) => {
      el.setAttribute("aria-pressed", String(mine !== null && String(mine) === el.dataset[key]));
    });
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

/** 🥶/🥵 한 번이 내 희망 온도를 0.5도 밀어줍니다. */
function nudge(dir) {
  const b = band(), c = summarise(S.votes, b);
  const base = myTemp() ?? c.setpoint ?? b.def;
  const t = dir === 0 ? toHalf(c.setpoint) : clamp(toHalf(base + dir * 0.5), b.min, b.max);
  pushVote({ t, s: dir, s_at: new Date().toISOString() });
  toast(dir === 0 ? `딱 좋음 — 내 희망 ${fmt(t)}°` : `내 희망 ${fmt(t)}° 로 ${dir > 0 ? "올렸" : "내렸"}어요`);
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

/* ── 탭 · 시트 ────────────────────────────────────────────────────────── */
function setTab(tab) {
  S.tab = tab;
  for (const [k, id] of [["temp", "viewTemp"], ["lecture", "viewLecture"], ["more", "viewMore"]]) {
    $(id).hidden = k !== tab;
  }
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  if (tab === "more" && !S.sheet) $("moreMenu").innerHTML = sh.menuHTML(S);
  $("main").scrollTop = 0;
}

function openSheet(key) {
  S.sheet = key;
  $("sheetTitle").textContent = sh.TITLES[key] ?? "";
  $("sheet").hidden = false;
  renderSheet(key, summarise(S.votes, band()), band());
  $("sheetBody").scrollTop = 0;
}

function closeSheet() {
  S.sheet = null;
  $("sheet").hidden = true;
  $("moreMenu").innerHTML = sh.menuHTML(S);
}

function renderSheet(key, c, b) {
  const body = $("sheetBody");
  if (key === "board") body.innerHTML = sh.boardSheet(S);
  else if (key === "chat") body.innerHTML = sh.chatSheet(S);
  else if (key === "draw") body.innerHTML = sh.drawSheet(S, toMembers(S.votes));
  else if (key === "info") body.innerHTML = sh.infoSheet(S, b, S.triviaIdx === null ? triviaOfToday() : TRIVIA[S.triviaIdx % TRIVIA.length]);
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

function tickClock() {
  const brk = breakState(), chip = $("clockChip");
  if (brk) {
    chip.textContent = `☕ ${countdownText(brk.left)}`;
    chip.className = "chip live";
    S.breakSeen = brk.until;
  } else {
    if (S.breakSeen) { toast("쉬는 시간 끝 — 자리로 돌아와 주세요"); S.breakSeen = null; }
    const left = msToNextHour();
    chip.textContent = `⏱ ${countdownText(left)}`;
    chip.className = `chip${left < 60e3 ? " due" : ""}`;
  }
  const hour = startOfHour();
  if (S.lastHour === null) S.lastHour = hour;
  else if (hour !== S.lastHour) { S.lastHour = hour; onHourStruck(); }
}

async function onHourStruck() {
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
    if (b) nudge(Number(b.dataset.feel));
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
    pushVote({ zone: S.mine?.zone === z ? null : z });
  });

  for (const [row, key] of [["diffRow", "diff"], ["paceRow", "pace"]]) {
    $(row).addEventListener("click", (e) => {
      const b = e.target.closest(`[data-${key}]`);
      if (!b) return;
      const on = b.getAttribute("aria-pressed") === "true";
      pushVote({ [key]: on ? null : Number(b.dataset[key]), lec_at: on ? null : new Date().toISOString() });
    });
  }

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

  // 대화
  if (hit("#chatSend")) {
    const ta = $("chatText"), msg = ta.value.trim().slice(0, 80);
    if (!msg) return ta.focus();
    const at = Date.now();
    db.setPresence({ nick: S.me.nick || "익명", msg, msgAt: at });
    S.chatlog.push({ nick: S.me.nick || "익명", msg, at, mine: true });
    ta.value = "";
    return again("chat");
  }

  if (hit("#triviaNext")) { S.triviaIdx = ((S.triviaIdx ?? 0) + 1) % TRIVIA.length; return again("info"); }

  // 뽑기
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
    // 후보를 점점 느리게 스쳐 지나간 뒤 멈춥니다. 바로 결과만 뜨면 재미가 없어요.
    const box = $("pickBox");
    if (box && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      box.classList.add("rolling");
      const name = box.querySelector(".pickname");
      for (let i = 0, wait = 50; i < 16; i++, wait *= 1.17) {
        if (name) name.textContent = m[(Math.random() * m.length) | 0].nick;
        await new Promise((k) => setTimeout(k, wait));
      }
      box.classList.remove("rolling");
    }
    if (res.wrapped) toast("한 바퀴 다 돌아 새로 시작합니다");
    return saveConfig({ draw_pick: { at: new Date().toISOString(), current: res.picked, history: res.history } });
  }
  if (hit("#pickReset")) return saveConfig({ draw_pick: null });

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

  fetchWeather(LAT, LON).then((w) => {
    S.weather = w;
    if (S.sheet === "info") renderSheet("info", summarise(S.votes, band()), band());
  }).catch(() => {});
  setInterval(() => fetchWeather(LAT, LON).then((w) => { S.weather = w; }).catch(() => {}), 15 * 60e3);

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
      if (S.chatlog.length > 120) S.chatlog.splice(0, S.chatlog.length - 120);
      if (S.sheet === "chat") renderSheet("chat", summarise(S.votes, band()), band());
    }
    $("peerChip").hidden = S.peers < 2;
    $("peerChip").querySelector("b").textContent = String(S.peers);
  });

  db.setPresence({ nick: S.me.nick || "익명", msg: "", msgAt: 0 });
  await refresh();
  db.subscribe((scope) => refresh(scope));
  db.recordCheckpoint().then((row) => { if (row?.created) refresh("meta"); }).catch(() => {});
}

boot();
