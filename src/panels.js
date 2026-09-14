/**
 * 패널 — 오른쪽 세로 칸에 들어가는 화면들.
 *
 * 제일 자주 보는 건 **강의**와 **바람** 둘입니다. 그래서 이 둘은
 * 숫자표가 아니라 큼직한 버튼과 한 줄 결론으로 짰어요.
 * 나머지(통계·게시판·뽑기·날씨·설정)는 그 아래 순서입니다.
 *
 * 각 함수는 HTML 문자열만 돌려줍니다. 이벤트는 main.js 가
 * #sideBody 한 곳에서 위임으로 받아요.
 */

import { fmt, toHalf } from "./stats.js";
import { creatureSVG, AXES, colorOf, MOOD_WORD, moodOf, DEFAULT_CFG } from "./creature.js";
import { ZONES, ZONE_MIN, airflowText, weatherLabel, discomfortIndex, discomfortLabel,
         adaptiveComfort, humidityAdvice, windSummary, SEASONS } from "./climate.js";
import { feedHTML, openQuestions, KINDS, MAX_PIN } from "./board.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TITLES = {
  lecture: "🎓 이번 시간 강의",
  wind: "🌬️ 바람 배분",
  chat: "🗨️ 대화",
  board: "💬 게시판 · 질문함",
  stats: "📊 통계",
  me: "🙂 내 캐릭터",
  draw: "🎲 조 뽑기 · 순서",
  info: "🌤️ 바깥 · 잡학",
  more: "⚙️ 설정",
};

/* ═══ 강의 — 제일 자주 보는 화면 ═══════════════════════════════════════ */
//
// 5개 버튼을 큼직하게, 그 아래 "지금 결론"을 한 줄로. 게이지 눈금을
// 읽게 하지 않고 글자로 바로 말해줍니다. 숫자는 보조일 뿐이에요.

const DIFF = [[-2, "🥱", "너무 쉬움"], [-1, "🙂", "좀 쉬움"], [0, "👌", "딱 좋음"], [1, "😵‍💫", "좀 어려움"], [2, "🆘", "너무 어려움"]];
const PACE = [[-2, "🐢", "너무 느림"], [-1, "🚶", "좀 느림"], [0, "👌", "딱 좋음"], [1, "🏃", "좀 빠름"], [2, "🚀", "너무 빠름"]];

function lecRow(key, items, mine) {
  return `<div class="lecbig">` + items.map(([v, em, lab]) =>
    `<button type="button" data-${key}="${v}" aria-pressed="${String(mine) === String(v)}">` +
    `<em>${em}</em>${esc(lab)}</button>`).join("") + `</div>`;
}

function verdict(avg, n, lowWord, highWord, emLow, emHigh) {
  if (n < 2) {
    return `<div class="verdict"><span class="vnum">–</span><div>` +
      `<div class="vtxt">아직 ${n}명</div><div class="vsub">2명만 넘으면 결론이 나와요</div></div></div>`;
  }
  const a = Math.abs(avg);
  let tone = "good", face = "👌", txt = "딱 좋아요";
  if (a >= 1.1) { tone = "warn"; face = avg > 0 ? emHigh : emLow; txt = `많이 ${avg > 0 ? highWord : lowWord}`; }
  else if (a >= 0.45) { tone = ""; face = avg > 0 ? emHigh : emLow; txt = `살짝 ${avg > 0 ? highWord : lowWord}`; }

  const pos = ((avg + 2) / 4) * 100;
  return (
    `<div class="verdict ${tone}"><span class="vnum">${face}</span><div style="flex:1">` +
    `<div class="vtxt">${esc(txt)}</div><div class="vsub">${n}명 응답 · 평균 ${avg > 0 ? "+" : ""}${avg.toFixed(1)}</div>` +
    `<div class="meter"><i style="left:calc(${pos.toFixed(1)}% - 2px)"></i></div>` +
    `<div class="meterlab"><span>${esc(lowWord)}</span><span>딱 좋음</span><span>${esc(highWord)}</span></div>` +
    `</div></div>`
  );
}

export function lecturePanel(S, lec) {
  return (
    `<p class="hint">익명입니다. <b>정각마다 싹 초기화</b>되니 매 시간 편하게 눌러주세요.<br>` +
    `지금은 <b>${lec.hour}시</b> 집계 · ${lec.n}명 응답 중.</p>` +
    `<hr class="rule"><h3>난이도</h3>` +
    lecRow("diff", DIFF, lec.mine.diff) +
    verdict(lec.dAvg, lec.dN, "쉬움", "어려움", "🥱", "🆘") +
    `<hr class="rule"><h3>속도</h3>` +
    lecRow("pace", PACE, lec.mine.pace) +
    verdict(lec.pAvg, lec.pN, "느림", "빠름", "🐢", "🚀") +
    (lec.tip ? `<p class="insight">💡 ${lec.tip}</p>` : "") +
    `<hr class="rule"><h3>오늘 시간별</h3>` +
    `<svg class="spark" id="lecTrend" viewBox="0 0 360 116" role="img" aria-label="시간별 강의 피드백"></svg>`
  );
}

/* ═══ 바람 — 이 앱의 진짜 결론 ═════════════════════════════════════════ */
//
// 온도 하나로 36명을 다 맞추는 건 불가능합니다. 남는 차이를 바람으로
// 메우는 게 목적이라, 결론("어디 바람을 줄이고 어디를 늘려라")을 맨 위에 둡니다.

export function windPanel(S, c, af, zoned) {
  // Boolean 으로 감싸야 합니다. live 가 undefined 면 aria-pressed="undefined" 가 찍혀요.
  const live = Boolean(S.mine?.wind_at) && Date.now() - Date.parse(S.mine.wind_at) < 3 * 3600e3;
  const btn = (v, em, lab) =>
    `<button class="choice" type="button" data-wind="${v}" aria-pressed="${live && String(S.mine?.wind) === String(v)}"><em>${em}</em>${lab}</button>`;

  const cards = af.rows.map((z) => {
    const cls = z.dir < 0 ? "less" : z.dir > 0 ? "more" : "";
    const val = z.dir < 0 ? "↓" : z.dir > 0 ? "↑" : z.shown ? "👌" : "–";
    const sub = z.shown ? `${fmt(z.avg)}° · ${z.n}명` : z.n ? `${z.n}명` : "빈 자리";
    return `<div class="zcard ${cls}"><span class="zt">${esc(z.short)}</span><span class="zv">${val}</span><span class="zs">${esc(sub)}</span></div>`;
  }).join("");

  const zoneNow = S.myZone;
  const where = zoneNow === null || zoneNow === undefined
    ? `<p class="hint">지금 구역 밖에 서 있어요. 강의실에서 <b>내 자리 쪽 러그</b>를 밟으면 그 구역으로 집계됩니다.</p>`
    : `<p class="hint">지금 <b>${esc(ZONES[zoneNow]?.name ?? "")}</b>에 서 있어요. 이 구역으로 집계됩니다.</p>`;

  const w = windSummary(S.votes);

  return (
    `<div class="flowcard">${airflowText(af, zoned)}</div>` +
    `<div class="zonegrid">${cards}</div>` +
    `<p class="hint">↓ 바람 줄이기 · ↑ 바람 더 · 👌 그대로. ${ZONE_MIN}명 이상 모인 구역만 나옵니다.</p>` +
    `<hr class="rule"><h3>내 자리 바람은?</h3>` +
    `<p class="hint">온도 말고 <b>바람</b>이 문제일 때 눌러주세요. 3시간만 반영됩니다.</p>` +
    `<div class="choices">${btn(-1, "🍃", "약하게")}${btn(0, "👌", "딱 좋아요")}${btn(1, "💨", "세게")}</div>` +
    where +
    (w.n >= 2 ? `<p class="insight">최근 3시간 바람 요청 ${w.n}건 — 줄여달라 ${w.down} · 늘려달라 ${w.up}</p>` : "")
  );
}

/* ═══ 대화 로그 ═══════════════════════════════════════════════════════ */
export function chatPanel(S) {
  if (!S.chatlog.length) {
    return `<p class="empty">아직 오간 말이 없어요.<br><span class="dim">아래 칸에 쓰면 머리 위 말풍선으로 뜨고, 여기에도 쌓입니다.</span></p>`;
  }
  const lines = S.chatlog.slice(-60).reverse().map((m) =>
    `<div class="chatline ${m.mine ? "me" : ""}">${creatureSVG(m.cfg, "happy")}` +
    `<div class="cb"><div class="cn">${esc(m.nick)} · ${esc(ago(m.at))}</div>` +
    `<div class="cm">${esc(m.msg)}</div></div></div>`
  ).join("");
  return `<div class="chatlog">${lines}</div>`;
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

/* ═══ 나 ══════════════════════════════════════════════════════════════ */
export function mePanel(S, c) {
  const mood = Number.isFinite(Number(S.mine?.t)) ? moodOf(Number(S.mine.t), c.setpoint) : "happy";
  const axes = AXES.map((ax) => {
    const opts = ax.list.map((item, i) => {
      const on = (S.me[ax.key] | 0) === i;
      const name = ax.swatch ? item.n : item;
      const inner = ax.swatch ? `<i style="background:${colorOf(i)}"></i>`
        : creatureSVG({ ...DEFAULT_CFG, ...S.me, [ax.key]: i }, "happy");
      return `<button class="opt ${ax.swatch ? "sw" : ""}" type="button" data-axis="${ax.key}" data-v="${i}" aria-pressed="${on}" title="${esc(name)}" aria-label="${esc(ax.label)} ${esc(name)}">${inner}</button>`;
    }).join("");
    return `<div class="optrow"><div class="olabel">${esc(ax.label)}</div><div class="opts">${opts}</div></div>`;
  }).join("");

  return (
    `<div class="mehead">${creatureSVG(S.me, mood)}<div style="flex:1;min-width:0">` +
    `<div class="mename"><input type="text" id="nickIn" maxlength="12" value="${esc(S.me.nick || "")}" placeholder="닉네임" aria-label="닉네임" autocomplete="off">` +
    `<button class="dice" id="rerollBtn" type="button" aria-label="전부 랜덤">🎲</button></div>` +
    `<p class="hint">${esc(MOOD_WORD[mood])}<br>표정은 못 골라요. 합의 타점에서 멀수록 힘들어집니다.</p></div></div>` +
    `<p class="hint">닉네임만 쓰니까 실명은 아무도 모릅니다. 조합은 53,760가지.</p>` +
    axes +
    `<label class="toggle"><input type="checkbox" id="showNickIn" ${S.me.show ? "checked" : ""}> 통계에서 내 닉네임 보여주기</label>`
  );
}

/* ═══ 통계 ════════════════════════════════════════════════════════════ */
export function statsPanel(S, c, size) {
  let word, col;
  if (!c.n) { word = "—"; col = "var(--ink-3)"; }
  else if (c.iqr <= 1) { word = "좁게 모임"; col = "var(--good)"; }
  else if (c.iqr <= 2) { word = "보통"; col = "var(--ink-3)"; }
  else { word = "의견 갈림"; col = "var(--warn)"; }
  const tile = (l, v, n, sm) => `<div class="tile"><span class="lab">${esc(l)}</span><span class="val${sm ? " sm" : ""}">${v}</span><span class="note">${esc(n)}</span></div>`;

  return (
    `<div class="grid2">` +
    tile("참여", `${c.n}<span class="dim" style="font-size:13px"> / ${size}</span>`, c.n ? `${Math.round((c.n / size) * 100)}% · 7일 지난 표는 빠져요` : "아직 아무도 안 찍었어요") +
    tile("합의도", `<span class="dotstate" style="background:${col}"></span>${word}`, c.n ? `가운데 절반이 ${fmt(c.iqr)}°C 폭` : "표가 모이면 계산돼요", true) +
    tile("중앙값", c.n ? fmt(c.median) : "—", c.n ? `절사평균과 ${fmt(Math.abs(c.median - c.raw))}°C 차이` : "절반이 이 아래") +
    tile("많이 아쉬움", c.n ? String(c.unhappy) : "—", c.n ? `${c.inBand}명은 ±1°C 안` : "1.5°C 넘게 벌어진 사람") +
    `</div>` +
    `<div class="chartbox"><svg id="ridge" viewBox="0 0 760 392" role="img" aria-label="희망 온도 분포"></svg><div class="tip" id="tip"></div></div>` +
    `<p class="insight" id="insight"></p>` +
    `<hr class="rule"><h3>오늘의 정각 기록</h3>` +
    `<svg class="spark" id="hourly" viewBox="0 0 360 92" role="img" aria-label="정각별 권장 온도"></svg>` +
    `<hr class="rule"><h3>14일 추이</h3>` +
    `<svg class="spark" id="spark" viewBox="0 0 320 96" role="img" aria-label="14일 권장 온도"></svg>` +
    `<p class="hint" id="sparkNote"></p>` +
    `<hr class="rule"><h3>0.5°C 구간별</h3>` +
    `<table><thead><tr><th>온도</th><th>표</th><th>%</th><th style="width:34%"></th></tr></thead><tbody id="tbody"></tbody></table>` +
    `<hr class="rule"><p class="hint"><b>왜 20% 절사평균인가</b><br>` +
    `양 끝 20%씩(${size}명이면 위아래 ${Math.floor(size * 0.2)}명씩) 빼고 가운데만 평균 냅니다. ` +
    `장난표 하나가 전체를 못 끌고 가면서도, 표가 움직이면 타점이 계단이 아니라 부드럽게 따라와요. ` +
    `그다음 계절 밴드로 자르고, 실제로 리모컨을 만질지는 매 정각에만 판단합니다.</p>`
  );
}

/* ═══ 게시판 ══════════════════════════════════════════════════════════ */
export function boardPanel(S) {
  const count = (k) => (k === "all" ? S.posts.length : S.posts.filter((p) => p.kind === k).length);
  const filters = KINDS.map((k) =>
    `<button type="button" data-filter="${k.key}" aria-pressed="${S.filter === k.key}">${esc(k.label)}<span class="n">${count(k.key)}</span></button>`).join("");
  const pinned = S.posts.filter((p) => p.pinned).length;

  return (
    `<div class="compose">` +
    `<textarea id="postText" maxlength="300" placeholder="예) 창가쪽 너무 추워요 🥲&#10;예) 방금 join 설명 다시 한 번만…&#10;예) 실습 자료 https://... 여기요"></textarea>` +
    `<div class="row"><div class="kindseg" id="kindSeg">` +
    ["chat", "q", "req", "info"].map((k) =>
      `<button type="button" data-kind="${k}" aria-pressed="${S.kind === k}">${esc(KINDS.find((x) => x.key === k)?.label ?? k)}</button>`).join("") +
    `</div></div>` +
    `<div class="row"><span class="dim" id="counter">0/300</span>` +
    `<button class="btn accent" id="postBtn" type="button" style="margin-left:auto">올리기</button></div></div>` +
    `<p class="hint">고정 ${pinned}/${MAX_PIN} · 답변 대기 ${openQuestions(S.posts)}개 · 링크는 자동으로 눌러집니다.</p>` +
    `<div class="filters" id="filters">${filters}</div>` +
    `<div class="feed" id="feed">${feedHTML(S.posts, S.uid, S.filter)}</div>`
  );
}

/* ═══ 뽑기 ════════════════════════════════════════════════════════════ */
export function drawPanel(S, members) {
  const g = S.config?.draw_groups;
  const groups = g?.groups?.length
    ? `<div class="groups">` + g.groups.map((grp, i) =>
        `<div class="group"><h4>${i + 1}조 · ${grp.length}명</h4>` +
        grp.map((m) => `<div class="member">${creatureSVG(m.cfg, "happy")}<span>${esc(m.nick)}</span></div>`).join("") + `</div>`).join("") + `</div>`
    : `<p class="empty">위에서 조 개수를 누르면 결과가 나옵니다.</p>`;

  const pk = S.config?.draw_pick;
  const pick = pk?.current
    ? `<div class="pickbox" id="pickBox">${creatureSVG(pk.current.cfg, "happy")}<div class="pickname">${esc(pk.current.nick)}</div></div>`
    : `<p class="empty">🎯 뽑기를 누르면 한 명이 나옵니다.</p>`;
  const done = members.filter((m) => (pk?.history ?? []).includes(m.key));

  return (
    `<p class="hint">최근 7일 안에 표를 낸 <b>${members.length}명</b> 중에서 뽑습니다. 닉네임·캐릭터로만 나와요.</p>` +
    `<hr class="rule"><h3>조 뽑기</h3><div class="row mt">` +
    [3, 4, 5, 6].map((n) => `<button class="mini" type="button" data-groups="${n}">${n}조</button>`).join("") +
    `<button class="mini" id="groupsClear" type="button">지우기</button></div>` + groups +
    `<hr class="rule"><h3>발표 순서</h3>` +
    `<p class="hint">뽑힌 사람은 빼고 고릅니다. 한 바퀴 돌면 초기화돼요.</p>` +
    `<div class="row mt"><button class="btn accent" id="pickBtn" type="button">🎯 뽑기</button>` +
    `<button class="mini" id="pickReset" type="button">기록 지우기</button>` +
    `<span class="dim">${done.length}/${members.length}</span></div>` + pick +
    `<div class="picklist">${done.map((m) => `<span>${esc(m.nick)}</span>`).join("")}</div>`
  );
}

/* ═══ 날씨 · 잡학 ═════════════════════════════════════════════════════ */
export function infoPanel(S, b, trivia) {
  const w = S.weather;
  const inT = Number(S.config?.indoor_t), inRh = Number(S.config?.indoor_rh);
  const hasIn = Number.isFinite(inT) && Number.isFinite(inRh);
  let head = `<p class="hint">날씨를 불러오는 중…</p>`, cells = "", note = "";

  if (w) {
    const [desc, icon] = weatherLabel(w.code);
    head = `<div class="wrow"><span class="wicon">${icon}</span><div>` +
      `<div class="wtemp">${fmt(w.t)}°</div><div class="hint">${esc(desc)} · 체감 ${fmt(w.feels)}° · 오늘 ${fmt(w.min)}~${fmt(w.max)}°</div></div></div>`;
    const di = discomfortIndex(hasIn ? inT : w.t, hasIn ? inRh : w.rh);
    const diL = discomfortLabel(di), adapt = adaptiveComfort(w.t);
    const hum = humidityAdvice(hasIn ? inRh : w.rh, hasIn);
    const cell = (k, v, tone) => `<div class="wcell ${tone || ""}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
    cells = `<div class="wcells">` + cell(hasIn ? "실내 습도" : "실외 습도", `${Math.round(hasIn ? inRh : w.rh)}%`, hum?.tone) +
      cell("불쾌지수", di ? di.toFixed(0) : "—", diL?.tone) + cell("적응 쾌적", adapt ? `${fmt(adapt)}°` : "범위 밖") + `</div>`;
    const bits = [];
    if (hum) bits.push(hum.text);
    if (diL) bits.push(`불쾌지수 ${di.toFixed(0)} — ${diL.text}.`);
    if (adapt) bits.push(`실외 ${fmt(w.t)}°면 적응 쾌적 모델로는 ${fmt(adapt)}°가 기준이에요.`);
    if (!hasIn) bits.push("온습도계가 있으면 설정에서 실내 값을 넣어주세요.");
    note = `<p class="insight">${bits.map(esc).join(" ")}</p>`;
  }
  return head + cells + note + `<hr class="rule"><h3>오늘의 잡학</h3><p class="trivia">${esc(trivia)}</p>` +
    `<div class="row mt"><button class="mini" id="triviaNext" type="button">다른 거 ↻</button></div>`;
}

/* ═══ 설정 ════════════════════════════════════════════════════════════ */
export function morePanel(S, c, b, theme) {
  const applied = Number.isFinite(Number(S.config?.applied)) ? Number(S.config.applied) : null;
  const need = applied !== null && Math.abs(c.setpoint - applied) >= 0.5;
  const seasons = ["auto", ...Object.keys(SEASONS)].map((k) =>
    `<button type="button" data-season="${k}" aria-pressed="${(S.config?.season || "auto") === k}">${esc(k === "auto" ? "자동" : SEASONS[k].short)}</button>`).join("");

  return (
    `<h3>에어컨 실제 설정</h3>` +
    `<p class="insight">${applied === null ? "지금 에어컨이 몇 도로 맞춰져 있나요? 한 번 알려주면 바뀔 때만 알려드려요."
      : need ? `🔧 바꿀 때가 됐어요 — <strong>${fmt(applied)}°C</strong> → <strong>${fmt(c.setpoint)}°C</strong>`
      : `✓ 지금 설정 <strong>${fmt(applied)}°C</strong> 유지 — 계산값과 0.5°C 안이에요.`}</p>` +
    `<div class="row mt"><button class="btn accent" id="applyBtn" type="button">${fmt(c.setpoint)}°C로 맞췄어요</button></div>` +
    `<hr class="rule"><h3>쉬는 시간</h3>` +
    `<p class="hint">아무나 시작할 수 있고, 모두의 화면에 같은 카운트다운이 뜹니다.</p>` +
    `<div class="row mt">` + [5, 10, 15, 20].map((m) => `<button class="mini" type="button" data-break="${m}">${m}분</button>`).join("") +
    `<button class="mini" id="breakEnd" type="button">끝내기</button></div>` +
    `<hr class="rule"><h3>계절</h3>` +
    `<p class="hint">같은 사람도 여름엔 26도, 겨울엔 22도가 쾌적합니다. 옷 두께 차이예요.</p>` +
    `<div class="kindseg" id="seasonSeg" style="margin-top:8px;width:fit-content">${seasons}</div>` +
    `<p class="hint">지금: <b>${esc(b.name)}</b> · 권장 ${b.lo}–${b.hi}°C</p>` +
    `<hr class="rule"><h3>실내 온습도</h3>` +
    `<div class="row mt"><label class="dim">온도 <input type="number" id="indoorT" step="0.1" value="${S.config?.indoor_t ?? ""}" style="width:70px;padding:8px;border-radius:10px;border:2px solid var(--line-2);background:var(--panel);color:var(--ink)"></label>` +
    `<label class="dim">습도 <input type="number" id="indoorRh" step="1" value="${S.config?.indoor_rh ?? ""}" style="width:70px;padding:8px;border-radius:10px;border:2px solid var(--line-2);background:var(--panel);color:var(--ink)"></label>` +
    `<button class="mini" id="indoorSave" type="button">저장</button><button class="mini" id="indoorClear" type="button">지우기</button></div>` +
    `<hr class="rule"><h3>화면</h3><div class="row mt">` +
    `<button class="mini" id="themeBtn" type="button">테마: ${theme === "system" ? "시스템" : theme === "light" ? "밝게" : "어둡게"}</button>` +
    `<button class="mini" id="qrBtn" type="button">📱 QR</button></div><div id="qrBox" class="row mt"></div>` +
    `<hr class="rule"><p class="hint">이름도 이메일도 받지 않습니다. 브라우저마다 익명 계정 하나가 생기고, 투표 기록엔 닉네임·캐릭터 말고 아무것도 안 붙어요. 강의실·마당에서의 위치는 저장되지 않고 창을 닫으면 사라집니다.</p>`
  );
}
