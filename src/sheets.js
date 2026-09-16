/**
 * 더보기 안에 들어가는 화면들.
 *
 * 매일 쓰는 건 온도 탭과 강의 탭 둘뿐입니다. 나머지는 가끔 열어보는
 * 것들이라 전부 여기로 밀어넣었어요. 화면 하나에 하나씩, 뒤로 가기로 나갑니다.
 */

import { fmt, toHalf } from "./stats.js";
import { ZONES, ZONE_MIN, nickColor, nickInitial } from "./zones.js";
import {
  weatherLabel, discomfortIndex, discomfortLabel, adaptiveComfort,
  humidityAdvice, SEASONS,
} from "./climate.js";
import { feedHTML, openQuestions, KINDS, MAX_PIN } from "./board.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SHEETS = [
  { key: "board",  icon: "💬", label: "게시판 · 질문함", desc: "잡담 · 요청 · 링크 · 익명 질문" },
  { key: "stats",  icon: "📊", label: "통계",           desc: "분포 · 정각 기록 · 14일 추이" },
  { key: "chat",   icon: "🗨️", label: "대화",           desc: "지금 접속한 사람들끼리 한마디" },
  { key: "draw",   icon: "🎲", label: "조 뽑기 · 순서",  desc: "랜덤 조 편성 · 발표 순서" },
  { key: "info",   icon: "🌤️", label: "바깥 · 잡학",    desc: "기온 · 습도 · 불쾌지수" },
  { key: "qr",     icon: "📱", label: "QR 코드",        desc: "폰으로 바로 들어오기" },
  { key: "config", icon: "⚙️", label: "설정",           desc: "에어컨 · 쉬는 시간 · 계절 · 테마" },
];

export const TITLES = Object.fromEntries(SHEETS.map((s) => [s.key, `${s.icon} ${s.label}`]));

export function menuHTML(S) {
  const open = openQuestions(S.posts);
  return SHEETS.map((s) => {
    const cnt = s.key === "board" && open ? `<span class="cnt">답변 대기 ${open}</span>` : "";
    return (
      `<button type="button" data-sheet="${s.key}"><em>${s.icon}</em>` +
      `<span><span class="ml">${esc(s.label)}</span><br><span class="md">${esc(s.desc)}</span></span>` +
      (cnt || `<span class="arrow">›</span>`) + `</button>`
    );
  }).join("");
}

/* ── 게시판 ─────────────────────────────────────────────────────── */
export function boardSheet(S) {
  const count = (k) => (k === "all" ? S.posts.length : S.posts.filter((p) => p.kind === k).length);
  const filters = KINDS.map((k) =>
    `<button type="button" data-filter="${k.key}" aria-pressed="${S.filter === k.key}">${esc(k.label)}<span class="n">${count(k.key)}</span></button>`).join("");
  const pinned = S.posts.filter((p) => p.pinned).length;

  return (
    `<div class="card compose">` +
    `<textarea id="postText" maxlength="300" placeholder="예) 창가쪽 너무 추워요&#10;예) 방금 join 설명 다시 한 번만…&#10;예) 실습 자료 https://... 여기요"></textarea>` +
    `<div class="row mt"><div class="kindseg" id="kindSeg">` +
    ["chat", "q", "req", "info"].map((k) =>
      `<button type="button" data-kind="${k}" aria-pressed="${S.kind === k}">${esc(KINDS.find((x) => x.key === k)?.label ?? k)}</button>`).join("") +
    `</div><button class="btn accent" id="postBtn" type="button" style="margin-left:auto">올리기</button></div>` +
    `<p class="hint">고정 ${pinned}/${MAX_PIN} · 답변 대기 ${openQuestions(S.posts)}개 · 링크는 자동으로 눌러집니다.</p></div>` +
    `<div class="filters" id="filters">${filters}</div>` +
    `<div class="feed" id="feed">${feedHTML(S.posts, S.uid, S.filter)}</div>`
  );
}

/* ── 통계 ───────────────────────────────────────────────────────── */
export function statsSheet(S, c, size) {
  let word, col;
  if (!c.n) { word = "—"; col = "var(--ink-3)"; }
  else if (c.iqr <= 1) { word = "좁게 모임"; col = "var(--good)"; }
  else if (c.iqr <= 2) { word = "보통"; col = "var(--ink-3)"; }
  else { word = "의견 갈림"; col = "var(--warn)"; }
  const tile = (l, v, n, sm) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v${sm ? " sm" : ""}">${v}</div><div class="n">${esc(n)}</div></div>`;

  return (
    `<div class="grid2">` +
    tile("참여", `${c.n}<span class="dim" style="font-size:13px"> / ${size}</span>`, c.n ? `${Math.round((c.n / size) * 100)}% · 7일 지난 표는 빠져요` : "아직 아무도 안 찍었어요") +
    tile("합의도", `<span class="dotstate" style="background:${col}"></span>${word}`, c.n ? `가운데 절반이 ${fmt(c.iqr)}°C 폭` : "표가 모이면 계산돼요", true) +
    tile("중앙값", c.n ? fmt(c.median) : "—", c.n ? `절사평균과 ${fmt(Math.abs(c.median - c.raw))}°C 차이` : "절반이 이 아래") +
    tile("많이 아쉬움", c.n ? String(c.unhappy) : "—", c.n ? `${c.inBand}명은 ±1°C 안` : "1.5°C 넘게 벌어진 사람") +
    `</div>` +
    `<div class="card"><h3>희망 온도 분포</h3><div class="chartbox"><svg id="ridge" viewBox="0 0 760 392" role="img" aria-label="희망 온도 분포"></svg></div>` +
    `<p class="insight" id="insight"></p></div>` +
    `<div class="card"><h3>오늘의 정각 기록</h3><p class="hint">매 정각에 찍힌 도장. 주황은 실제로 바꾼 시간이에요.</p>` +
    `<svg class="spark" id="hourly" viewBox="0 0 360 92" role="img" aria-label="정각별 권장 온도"></svg></div>` +
    `<div class="card"><h3>14일 추이</h3>` +
    `<svg class="spark" id="spark" viewBox="0 0 320 96" role="img" aria-label="14일 권장 온도"></svg>` +
    `<p class="hint" id="sparkNote"></p></div>` +
    `<div class="card"><h3>0.5°C 구간별</h3>` +
    `<table><thead><tr><th>온도</th><th>표</th><th>%</th><th style="width:34%"></th></tr></thead><tbody id="tbody"></tbody></table></div>` +
    `<div class="card"><h3>왜 20% 절사평균인가</h3><p class="hint">` +
    `양 끝 20%씩(${size}명이면 위아래 ${Math.floor(size * 0.2)}명씩) 빼고 가운데만 평균 냅니다. ` +
    `장난표 하나가 전체를 못 끌고 가면서도, 표가 움직이면 타점이 계단이 아니라 부드럽게 따라와요. ` +
    `그다음 계절 밴드로 자르고, 실제로 리모컨을 만질지는 매 정각에만 판단합니다.</p></div>`
  );
}

/* ── 대화 ───────────────────────────────────────────────────────── */
export function chatSheet(S) {
  const log = !S.chatlog.length
    ? `<p class="empty">아직 오간 말이 없어요.<br><span class="dim">지금 접속한 사람에게만 보이고, 창을 닫으면 사라집니다.</span></p>`
    : `<div class="feed">` + S.chatlog.slice(-50).reverse().map((m) =>
        `<div class="post"><div class="who"><i class="dot" style="background:${nickColor(m.nick)}">${esc(nickInitial(m.nick))}</i></div>` +
        `<div class="bubble"><div class="txt">${esc(m.msg)}</div>` +
        `<div class="bmeta"><span>${esc(m.nick)} · ${esc(ago(m.at))}</span></div></div></div>`).join("") + `</div>`;

  return (
    `<div class="card compose"><textarea id="chatText" maxlength="80" placeholder="지금 접속한 사람들에게 한마디…"></textarea>` +
    `<div class="row mt"><button class="btn accent" id="chatSend" type="button" style="margin-left:auto">보내기</button></div>` +
    `<p class="hint">저장되지 않습니다. 남기려면 게시판을 쓰세요.</p></div>` + log
  );
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

/* ── 뽑기 ───────────────────────────────────────────────────────── */
export function drawSheet(S, members) {
  const g = S.config?.draw_groups;
  const groups = g?.groups?.length
    ? `<div class="groups">` + g.groups.map((grp, i) =>
        `<div class="group" style="animation-delay:${(i * .07).toFixed(2)}s"><h4>${i + 1}조 · ${grp.length}명</h4>` +
        grp.map((m) => `<div>${esc(m.nick)}</div>`).join("") + `</div>`).join("") + `</div>`
    : `<p class="empty">위에서 조 개수를 누르면 결과가 나옵니다.</p>`;

  const pk = S.config?.draw_pick;
  const pick = pk?.current
    ? `<div class="pickbox" id="pickBox"><div class="pickname">${esc(pk.current.nick)}</div></div>`
    : `<p class="empty">🎯 뽑기를 누르면 한 명이 나옵니다.</p>`;
  const done = members.filter((m) => (pk?.history ?? []).includes(m.key));

  return (
    `<p class="hint">최근 7일 안에 표를 낸 <b>${members.length}명</b> 중에서 뽑습니다. 닉네임만 나와요.</p>` +
    `<div class="card"><h3>조 뽑기</h3><div class="row mt">` +
    [3, 4, 5, 6].map((n) => `<button class="mini" type="button" data-groups="${n}">${n}조</button>`).join("") +
    `<button class="mini" id="groupsClear" type="button">지우기</button></div>${groups}</div>` +
    `<div class="card"><h3>발표 순서</h3><p class="hint">뽑힌 사람은 빼고 고릅니다. 한 바퀴 돌면 초기화돼요.</p>` +
    `<div class="row mt"><button class="btn accent" id="pickBtn" type="button">🎯 뽑기</button>` +
    `<button class="mini" id="pickReset" type="button">기록 지우기</button>` +
    `<span class="dim" style="font-size:12px">${done.length}/${members.length}</span></div>${pick}` +
    `<div class="picklist">${done.map((m) => `<span>${esc(m.nick)}</span>`).join("")}</div></div>`
  );
}

/* ── 날씨 · 잡학 ────────────────────────────────────────────────── */
export function infoSheet(S, b, trivia) {
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
    const cell = (k, v, tone) => `<div class="wcell ${tone || ""}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
    cells = `<div class="wcells">` + cell(hasIn ? "실내 습도" : "실외 습도", `${Math.round(hasIn ? inRh : w.rh)}%`, hum?.tone) +
      cell("불쾌지수", di ? di.toFixed(0) : "—", diL?.tone) + cell("적응 쾌적", adapt ? `${fmt(adapt)}°` : "범위 밖") + `</div>`;
    const bits = [];
    if (hum) bits.push(hum.text);
    if (diL) bits.push(`불쾌지수 ${di.toFixed(0)} — ${diL.text}.`);
    if (adapt) bits.push(`실외 ${fmt(w.t)}°면 적응 쾌적 모델로는 ${fmt(adapt)}°가 기준이에요.`);
    if (!hasIn) bits.push("온습도계가 있으면 설정에서 실내 값을 넣어주세요.");
    note = `<p class="insight">${bits.map(esc).join(" ")}</p>`;
  }
  return `<div class="card">${head}${cells}${note}</div>` +
    `<div class="card"><h3>오늘의 잡학</h3><p class="trivia">${esc(trivia)}</p>` +
    `<div class="row mt"><button class="mini" id="triviaNext" type="button">다른 거 ↻</button></div></div>`;
}

/* ── QR ─────────────────────────────────────────────────────────── */
export function qrSheet() {
  return (
    `<div class="card"><h3>폰으로 바로 들어오기</h3>` +
    `<p class="hint">강의실 화면에 이 QR 을 띄워두면 다들 찍고 바로 들어옵니다. ` +
    `가입도 로그인도 없어요 — 열자마자 바로 투표할 수 있습니다.</p>` +
    `<div class="qrbox" id="qrBox"><span class="dim">만드는 중…</span></div>` +
    `<code class="urltext" id="urlText"></code>` +
    `<div class="row mt"><button class="btn" id="copyUrl" type="button">주소 복사</button></div></div>` +
    `<div class="card"><h3>홈 화면에 추가하면</h3><p class="hint">` +
    `폰 브라우저 메뉴에서 <b>홈 화면에 추가</b>를 누르면 앱처럼 아이콘이 생깁니다. ` +
    `그러면 주소를 칠 필요 없이 한 번에 열려요.</p></div>`
  );
}

/* ── 설정 ───────────────────────────────────────────────────────── */
export function configSheet(S, c, b, theme) {
  const applied = Number.isFinite(Number(S.config?.applied)) ? Number(S.config.applied) : null;
  const need = applied !== null && Math.abs(c.setpoint - applied) >= 0.5;
  const seasons = ["auto", ...Object.keys(SEASONS)].map((k) =>
    `<button type="button" data-season="${k}" aria-pressed="${(S.config?.season || "auto") === k}">${esc(k === "auto" ? "자동" : SEASONS[k].short)}</button>`).join("");

  return (
    `<div class="card"><h3>에어컨 실제 설정</h3>` +
    `<p class="insight">${applied === null ? "지금 에어컨이 몇 도로 맞춰져 있나요? 한 번 알려주면 바뀔 때만 알려드려요."
      : need ? `🔧 바꿀 때가 됐어요 — <strong>${fmt(applied)}°C</strong> → <strong>${fmt(c.setpoint)}°C</strong>`
      : `✓ 지금 설정 <strong>${fmt(applied)}°C</strong> 유지 — 계산값과 0.5°C 안이에요.`}</p>` +
    `<div class="row mt"><button class="btn accent" id="applyBtn" type="button">${fmt(c.setpoint)}°C로 맞췄어요</button></div></div>` +

    `<div class="card"><h3>쉬는 시간</h3><p class="hint">아무나 시작할 수 있고, 모두의 화면에 같은 카운트다운이 뜹니다.</p>` +
    `<div class="row mt">` + [5, 10, 15, 20].map((m) => `<button class="mini" type="button" data-break="${m}">${m}분</button>`).join("") +
    `<button class="mini" id="breakEnd" type="button">끝내기</button></div></div>` +

    `<div class="card"><h3>계절</h3>` +
    `<p class="hint">같은 사람도 여름엔 26도, 겨울엔 22도가 쾌적합니다. 옷 두께 차이예요. 투표는 자유롭게 받되 최종 온도만 밴드로 자릅니다.</p>` +
    `<div class="kindseg" id="seasonSeg" style="margin-top:8px;width:fit-content">${seasons}</div>` +
    `<p class="hint">지금: <b>${esc(b.name)}</b> · 권장 ${b.lo}–${b.hi}°C</p></div>` +

    `<div class="card"><h3>실내 온습도</h3><p class="hint">온습도계가 있으면 넣어주세요. 실외값보다 훨씬 정확합니다.</p>` +
    `<div class="row mt"><label class="dim" style="font-size:12px">온도 <input type="number" id="indoorT" step="0.1" value="${S.config?.indoor_t ?? ""}" style="width:72px;padding:8px;border-radius:9px;border:1px solid var(--line-2);background:var(--card);color:var(--ink);font:inherit"></label>` +
    `<label class="dim" style="font-size:12px">습도 <input type="number" id="indoorRh" step="1" value="${S.config?.indoor_rh ?? ""}" style="width:72px;padding:8px;border-radius:9px;border:1px solid var(--line-2);background:var(--card);color:var(--ink);font:inherit"></label>` +
    `<button class="mini" id="indoorSave" type="button">저장</button><button class="mini" id="indoorClear" type="button">지우기</button></div></div>` +

    `<div class="card"><h3>내 닉네임</h3><p class="hint">게시판·대화에만 쓰입니다. 온도 투표에는 안 붙어요.</p>` +
    `<div class="row mt"><input type="text" id="nickIn" maxlength="12" value="${esc(S.me.nick || "")}" placeholder="닉네임" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--line-2);background:var(--card);color:var(--ink);font:inherit">` +
    `<button class="mini" id="rerollBtn" type="button">🎲 랜덤</button></div></div>` +

    `<div class="card"><h3>화면</h3><div class="row mt">` +
    `<button class="mini" id="themeBtn" type="button">테마: ${theme === "system" ? "시스템" : theme === "light" ? "밝게" : "어둡게"}</button></div></div>` +

    `<div class="card"><h3>익명성</h3><p class="hint">` +
    `이름도 이메일도 받지 않습니다. 브라우저마다 익명 계정 하나가 조용히 생길 뿐이에요.<br>` +
    `투표 테이블은 <b>본인 행만</b> 읽을 수 있고, 남들이 보는 건 계정 번호를 뺀 목록입니다. ` +
    `그래서 게시판 닉네임과 온도 투표를 이어붙이는 게 구조적으로 불가능합니다.<br>` +
    `자리 구역 평균은 <b>${ZONE_MIN}명 이상</b> 모였을 때만 공개돼요.</p></div>`
  );
}
