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
import {
  wheelItems, slotColor, MAX_SLOTS, MIN_SLOTS,
  POLL_PRESETS, MAX_CHOICES, pollTally,
  LADDER_MIN, LADDER_MAX, walkLadder,
  questionOfDay, todaysAnswers, answerText,
} from "./fun.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SHEETS = [
  { key: "board",    icon: "💬", label: "게시판 · 질문함", desc: "잡담 · 요청 · 링크 · 익명 질문" },
  { key: "dailyq",   icon: "🌟", label: "오늘의 질문",     desc: "매일 하나씩 · 익명 한 줄" },
  { key: "poll",     icon: "🗳️", label: "즉석 투표",      desc: "아무 질문이나 · 1인 1표 익명" },
  { key: "roulette", icon: "🎡", label: "점심 룰렛",       desc: "오늘 뭐 먹지 · 다같이 한 판" },
  { key: "ladder",   icon: "🪜", label: "사다리 타기",     desc: "커피 내기 · 당번 정하기" },
  { key: "stats",    icon: "📊", label: "통계",           desc: "분포 · 정각 기록 · 14일 추이" },
  { key: "info",     icon: "🌤️", label: "바깥 · 잡학",    desc: "기온 · 습도 · 불쾌지수" },
  { key: "qr",       icon: "📱", label: "QR 코드",        desc: "폰으로 바로 들어오기" },
  { key: "config",   icon: "⚙️", label: "설정",           desc: "에어컨 · 쉬는 시간 · 계절 · 테마" },
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

/* ── 익명 채팅 (탭으로 올라감) ──────────────────────────────────── */
/**
 * 메신저처럼 깝니다 — 오래된 말이 위, 새 말이 아래, 입력칸은 맨 밑.
 * 목록만 따로 스크롤되고 입력칸은 항상 바닥에 붙어 있어요.
 * (feed 에 margin-top:auto 를 줘서 말이 몇 개 없을 땐 아래로 내려붙습니다)
 */
export function chatView(S) {
  const log = !S.chatlog.length
    ? `<p class="empty">아직 오간 말이 없어요.<br><span class="dim">지금 접속한 사람에게만 보입니다. 창을 닫으면 사라져요.</span></p>`
    : `<div class="feed">` + S.chatlog.slice(-50).map((m) =>
        `<div class="post${m.mine ? " me" : ""}"><div class="who"><i class="dot" style="background:${nickColor(m.nick)}">${esc(nickInitial(m.nick))}</i></div>` +
        `<div class="bubble"><div class="txt">${esc(m.msg)}</div>` +
        `<div class="bmeta"><span>${esc(m.nick)} · ${esc(ago(m.at))}</span></div></div></div>`).join("") + `</div>`;

  return (
    `<div class="chatlog" id="chatLog">${log}</div>` +
    `<div class="card compose chatbar">` +
    `<div class="chatrow">` +
    `<textarea id="chatText" rows="1" maxlength="80" placeholder="한마디 남기기… (익명)"></textarea>` +
    `<button class="btn accent" id="chatSend" type="button">보내기</button></div>` +
    `<p class="hint">닉네임만 보이고 아무것도 저장되지 않아요</p></div>`
  );
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

/* ── 🎡 점심 룰렛 ───────────────────────────────────────────────── */
/**
 * 원판은 CSS transform 으로만 돌립니다. 결과는 미리 정해서 서버에 적고,
 * 그 각도로 돌리는 거라 36명이 같은 걸 봅니다.
 */
export function rouletteSheet(S) {
  const items = wheelItems(S.config);
  const r = S.config?.roulette;
  const n = items.length;
  const slice = 360 / n;

  // 파이 조각 하나 그리기 (반지름 100, 중심 0,0)
  const arc = (i) => {
    const a0 = (i * slice - 90) * (Math.PI / 180);
    const a1 = ((i + 1) * slice - 90) * (Math.PI / 180);
    const big = slice > 180 ? 1 : 0;
    return `M 0 0 L ${(100 * Math.cos(a0)).toFixed(2)} ${(100 * Math.sin(a0)).toFixed(2)} ` +
           `A 100 100 0 ${big} 1 ${(100 * Math.cos(a1)).toFixed(2)} ${(100 * Math.sin(a1)).toFixed(2)} Z`;
  };
  const label = (i) => {
    const a = ((i + 0.5) * slice - 90) * (Math.PI / 180);
    const x = 66 * Math.cos(a), y = 66 * Math.sin(a);
    // 글씨를 반지름 방향으로 누입니다. 그대로 두면 왼쪽 칸이 뒤집힐서,
    // 6시~12시 구간은 180도 더 돌려 바로 읽히게 합니다.
    const deg = (i + 0.5) * slice;
    const rot = deg > 180 ? deg + 90 : deg - 90;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="wl" text-anchor="middle" ` +
           `dominant-baseline="central" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">` +
           `${esc(items[i])}</text>`;
  };

  const wheel =
    `<div class="wheelbox"><div class="needle">▼</div>` +
    `<svg id="wheel" viewBox="-110 -110 220 220" role="img" aria-label="점심 룰렛">` +
    `<g id="wheelSpin">` +
    items.map((_, i) => `<path d="${arc(i)}" fill="${slotColor(i)}" stroke="var(--card)" stroke-width="1"/>`).join("") +
    items.map((_, i) => label(i)).join("") +
    `<circle r="17" fill="var(--card)" stroke="var(--line)" stroke-width="2"/></g></svg></div>`;

  const result = r?.pick != null && items[r.pick]
    ? `<p class="winner" id="wheelWin"><span class="wtag">오늘의 메뉴</span><b>${esc(items[r.pick])}</b></p>`
    : `<p class="empty">돌리면 하나가 정해집니다.</p>`;

  return (
    `<div class="card"><p class="hint">한 명이 돌리면 <b>모두에게 같은 결과</b>가 뜹니다. 따로 돌려서 우기기 없기.</p>` +
    wheel +
    `<div class="row mt" style="justify-content:center">` +
    `<button class="btn accent" id="spinBtn" type="button">🎡 돌리기</button>` +
    `<button class="mini" id="editSlots" type="button">메뉴 고치기</button></div>` +
    result + `</div>` +
    (S.editSlots
      ? `<div class="card"><h3>메뉴 목록</h3><p class="hint">한 줄에 하나씩. ${MIN_SLOTS}~${MAX_SLOTS}개까지요.</p>` +
        `<textarea id="slotText" class="slots">${esc(items.join("\n"))}</textarea>` +
        `<div class="row mt"><button class="btn accent" id="saveSlots" type="button">저장</button>` +
        `<button class="mini" id="resetSlots" type="button">기본값으로</button></div></div>`
      : "")
  );
}

/* ── 🗳️ 즉석 익명 투표 ─────────────────────────────────────────── */
export function pollSheet(S) {
  const poll = S.config?.poll;

  if (!poll?.id || S.newPoll) {
    const presets = POLL_PRESETS.map((p, i) =>
      `<button class="mini" type="button" data-preset="${i}">${esc(p.q)}</button>`).join("");
    return (
      `<div class="card"><h3>새 투표 만들기</h3>` +
      `<p class="hint">누가 뭘 찍었는지는 <b>아무도 못 봅니다.</b> 온도 투표와 같은 구조예요. 한 사람 한 표.</p>` +
      `<input id="pollQ" class="ti" maxlength="60" placeholder="질문 — 예) 에어컨 더 낮출까요?">` +
      `<textarea id="pollOpts" class="slots" placeholder="선택지를 한 줄에 하나씩&#10;네&#10;아니요&#10;상관없음"></textarea>` +
      `<p class="hint">최대 ${MAX_CHOICES}개까지.</p>` +
      `<div class="row mt"><button class="btn accent" id="makePoll" type="button">투표 열기</button>` +
      (poll?.id ? `<button class="mini" id="cancelPoll" type="button">취소</button>` : "") + `</div></div>` +
      `<div class="card"><h3>이런 것도</h3><div class="row mt">${presets}</div></div>`
    );
  }

  const t = pollTally(poll, S.votes);
  const rows = poll.opts.map((o, i) => {
    const on = t.mine === i;
    return `<button type="button" class="pollrow${on ? " on" : ""}${t.lead[i] ? " lead" : ""}" data-pick="${i}" aria-pressed="${on}">` +
      `<span class="pb" style="width:${t.pct[i].toFixed(1)}%"></span>` +
      `<span class="pt">${esc(o)}</span>` +
      `<span class="pn">${t.counts[i]}<i>${Math.round(t.pct[i])}%</i></span></button>`;
  }).join("");

  return (
    `<div class="card"><h3>${esc(poll.q)}</h3>` +
    `<p class="hint">${t.total}명 참여${t.mine === null ? " · 아직 안 찍으셨어요" : " · 다시 누르면 바꿀 수 있어요"}</p>` +
    `<div class="pollbox">${rows}</div></div>` +
    `<div class="card"><div class="row"><button class="mini" id="newPoll" type="button">새 투표 만들기</button>` +
    `<button class="mini" id="closePoll" type="button">이 투표 닫기</button></div>` +
    `<p class="hint">닫으면 결과는 사라집니다. 기록이 필요하면 게시판에 옮겨두세요.</p></div>`
  );
}

/* ── 🪜 사다리 타기 ─────────────────────────────────────────────── */
export function ladderSheet(S) {
  const L = S.config?.ladder;
  if (!L?.ladder) {
    return (
      `<div class="card"><h3>사다리 타기</h3>` +
      `<p class="hint">커피 내기, 청소 당번, 발표 순서… 몇 명인지 정하고 위/아래에 뭘 적을지 채우면 됩니다.</p>` +
      `<label class="fl">참가자 (한 줄에 하나씩)</label>` +
      `<textarea id="ladTop" class="slots" placeholder="민수&#10;지현&#10;태정&#10;보경"></textarea>` +
      `<label class="fl">결과 (같은 개수로)</label>` +
      `<textarea id="ladBot" class="slots" placeholder="커피&#10;꽝&#10;꽝&#10;꽝"></textarea>` +
      `<p class="hint">${LADDER_MIN}~${LADDER_MAX}명까지요.</p>` +
      `<div class="row mt"><button class="btn accent" id="makeLadder" type="button">🪜 사다리 만들기</button></div></div>`
    );
  }

  const { ladder, top, bot } = L;
  const W = 40, H = 26, PAD = 14;
  const x = (c) => PAD + c * W;
  const y = (r) => 30 + r * H;
  const h = y(ladder.rows) + 34;

  const lines = [];
  for (let c = 0; c < ladder.cols; c++)
    lines.push(`<line x1="${x(c)}" y1="30" x2="${x(c)}" y2="${y(ladder.rows)}" class="lrail"/>`);
  for (const b of ladder.bars)
    lines.push(`<line x1="${x(b.x)}" y1="${y(b.y + 1)}" x2="${x(b.x + 1)}" y2="${y(b.y + 1)}" class="lbar"/>`);

  const heads = top.map((t, c) =>
    `<text x="${x(c)}" y="18" class="lcap" text-anchor="middle">${esc(t)}</text>`).join("");
  const feet = bot.map((t, c) =>
    `<text x="${x(c)}" y="${h - 10}" class="lcap foot" text-anchor="middle">${esc(t)}</text>`).join("");

  const picked = L.picked ?? {};
  const buttons = top.map((t, c) => {
    const got = picked[c];
    return `<button class="mini${got != null ? " done" : ""}" type="button" data-climb="${c}">` +
      `${esc(t)}${got != null ? ` → ${esc(bot[got])}` : ""}</button>`;
  }).join("");

  const width = PAD * 2 + (ladder.cols - 1) * W;
  return (
    `<div class="card"><h3>누구부터 탈까요</h3>` +
    `<p class="hint">이름을 누르면 줄을 타고 내려갑니다. 결과는 모두에게 똑같이 남아요.</p>` +
    `<div class="row mt">${buttons}</div>` +
    `<div class="ladderbox"><svg id="ladder" viewBox="0 0 ${width} ${h}" role="img" aria-label="사다리">` +
    lines.join("") + heads + feet +
    `<path id="ladPath" class="ltrace" fill="none"/></svg></div>` +
    `<div class="row mt"><button class="mini" id="resetLadder" type="button">새로 만들기</button></div></div>`
  );
}

/* ── 🌟 오늘의 질문 ─────────────────────────────────────────────── */
export function dailyqSheet(S) {
  const { i, q } = questionOfDay();
  const answers = todaysAnswers(S.posts, i);
  const mine = answers.find((a) => a.is_mine);

  const list = !answers.length
    ? `<p class="empty">아직 아무도 답하지 않았어요.<br><span class="dim">첫 줄을 남겨보세요.</span></p>`
    : `<div class="feed">` + answers.map((a) =>
        `<div class="post"><div class="who"><i class="dot" style="background:${nickColor(a.nick)}">${esc(nickInitial(a.nick))}</i></div>` +
        `<div class="bubble"><div class="txt">${esc(answerText(a.body))}</div>` +
        `<div class="bmeta"><span>${esc(a.nick || "익명")}</span>` +
        (a.is_mine ? `<button class="bact me" data-act="del" data-id="${a.id}">지우기</button>` : "") +
        `</div></div></div>`).join("") + `</div>`;

  return (
    `<div class="card q-of-day"><span class="qtag">🌟 오늘의 질문</span><h3>${esc(q)}</h3>` +
    `<p class="hint">매일 자정에 새 질문으로 바뀝니다. 닉네임만 보여요.</p></div>` +
    (mine
      ? `<div class="card"><p class="hint">이미 답하셨어요. 지우고 다시 쓸 수 있습니다.</p></div>`
      : `<div class="card compose"><textarea id="qaText" maxlength="120" placeholder="한 줄로 답해주세요…"></textarea>` +
        `<div class="row mt"><button class="btn accent" id="qaSend" type="button" style="margin-left:auto">남기기</button></div></div>`) +
    `<p class="hint" style="padding:0 2px">${answers.length}명이 답했어요</p>` + list
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
/** localhost / 127.0.0.1 은 폰에서 찍으면 폰 자기 자신을 가리킵니다. */
const isLocalHost = (h) => /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/.test(h);

export function qrSheet() {
  const warn = !isLocalHost(location.hostname) ? "" :
    `<div class="card warn"><h3>⚠︎ 지금 이 QR 은 폰에서 안 열려요</h3><p class="hint">` +
    `주소가 <b>localhost</b> 라서 그렇습니다. 폰이 이 QR 을 찍으면 내 컴퓨터가 아니라 ` +
    `<b>폰 자기 자신</b>을 찾아가거든요. 그래서 "연결할 수 없음"이 뜹니다.<br><br>` +
    `<b>지금 당장 · 같은 와이파이라면</b><br>` +
    `터미널에 뜬 <code>Network: http://192.168.x.x:5173</code> 주소를 이 컴퓨터 주소창에 넣고 ` +
    `다시 이 QR 을 여세요. 그 주소로 바뀐 QR 은 폰에서 열립니다.<br><br>` +
    `<b>제대로 쓰려면</b><br>` +
    `배포하세요. 그래야 와이파이가 달라도, 데이터로도, 노트북을 꺼도 열립니다.</p></div>`;

  return (
    warn +
    `<div class="card"><h3>익-커 · 폰으로 바로 들어오기</h3>` +
    `<p class="hint"><b>익명 커뮤니티</b>, 줄여서 <b>익-커</b>입니다. ` +
    `강의실 화면에 이 QR 을 띄워두면 다들 찍고 바로 들어와요. ` +
    `가입도 로그인도 없고, 누가 뭘 눌렀는지는 아무도 못 봅니다.</p>` +
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
