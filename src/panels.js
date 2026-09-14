/**
 * 패널 — 아래에서 올라오는 화면들.
 *
 * 메인 화면은 온도바 + 세계 + 채팅바 세 층으로 끝냅니다. 통계·게시판·강의
 * 같은 건 전부 여기로 밀어넣어서, 평소엔 안 보이고 누를 때만 올라오게 했어요.
 *
 * 각 함수는 HTML 문자열만 돌려줍니다. 이벤트는 main.js 가
 * #panelBody 한 곳에서 위임으로 받습니다.
 */

import { fmt, toHalf } from "./stats.js";
import { creatureSVG, AXES, colorOf, MOOD_WORD, moodOf, DEFAULT_CFG } from "./creature.js";
import { ZONES, ZONE_MIN } from "./world.js";
import {
  weatherLabel, discomfortIndex, discomfortLabel, adaptiveComfort,
  humidityAdvice, windSummary, SEASONS,
} from "./climate.js";
import { feedHTML, openQuestions, KINDS, MAX_PIN } from "./board.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TITLES = {
  me: "🙂 내 캐릭터",
  wind: "🌬️ 바람 어때요",
  stats: "📊 통계",
  board: "💬 게시판 · 질문함",
  lecture: "🎓 이번 시간 강의",
  info: "🌤️ 바깥 사정 · 잡학",
  draw: "🎲 조 뽑기 · 발표 순서",
  more: "⚙️ 설정",
};

/* ── 나 ──────────────────────────────────────────────────────────────── */
export function mePanel(S, c) {
  const mood = Number.isFinite(S.mine?.t) ? moodOf(Number(S.mine.t), c.setpoint) : "happy";

  const axes = AXES.map((ax) => {
    const opts = ax.list
      .map((item, i) => {
        const on = (S.me[ax.key] | 0) === i;
        const name = ax.swatch ? item.n : item;
        const inner = ax.swatch
          ? `<i style="background:${colorOf(i)}"></i>`
          : creatureSVG({ ...DEFAULT_CFG, ...S.me, [ax.key]: i }, "happy");
        return `<button class="opt ${ax.swatch ? "sw" : ""}" type="button" data-axis="${ax.key}" data-v="${i}" aria-pressed="${on}" title="${esc(name)}" aria-label="${esc(ax.label)} ${esc(name)}">${inner}</button>`;
      })
      .join("");
    return `<div class="optrow"><div class="olabel">${esc(ax.label)}</div><div class="opts">${opts}</div></div>`;
  }).join("");

  return (
    `<div class="mehead">${creatureSVG(S.me, mood)}` +
    `<div style="flex:1;min-width:0">` +
    `<div class="mename"><input type="text" id="nickIn" maxlength="12" value="${esc(S.me.nick || "")}" placeholder="닉네임" aria-label="닉네임" autocomplete="off">` +
    `<button class="dice" id="rerollBtn" type="button" aria-label="전부 랜덤">🎲</button></div>` +
    `<p class="hint">${esc(MOOD_WORD[mood])} · 표정은 못 고릅니다. 합의 타점에서 멀수록 힘들어져요.</p></div></div>` +
    `<p class="hint" style="margin-top:10px">닉네임만 쓰니까 실명은 아무도 모릅니다. 조합은 53,760가지예요.</p>` +
    axes +
    `<label class="toggle"><input type="checkbox" id="showNickIn" ${S.me.show ? "checked" : ""}> 통계 화면에서 내 닉네임 보여주기 <span class="dim">(꺼두면 완전 익명)</span></label>`
  );
}

/* ── 바람 ────────────────────────────────────────────────────────────── */
export function windPanel(S, c, zb) {
  const live = S.mine?.wind_at && Date.now() - Date.parse(S.mine.wind_at) < 3 * 3600e3;
  const btn = (v, em, lab) =>
    `<button class="choice" type="button" data-wind="${v}" aria-pressed="${live && String(S.mine?.wind) === String(v)}"><em>${em}</em>${lab}</button>`;

  const w = windSummary(S.votes);
  let head;
  if (w.n < 2) head = `최근 3시간 바람 요청이 ${w.n}개예요. 온도는 괜찮은데 바람이 문제일 때 눌러주세요.`;
  else if (Math.abs(w.avg) < 0.3) head = `지금 바람 세기는 <strong>대체로 괜찮다</strong>는 쪽이에요 (${w.n}명).`;
  else if (w.avg < 0) head = `<strong>${w.down}명</strong>이 바람을 약하게 해달라고 합니다 (${w.n}명 중).`;
  else head = `<strong>${w.up}명</strong>이 바람을 세게 해달라고 합니다 (${w.n}명 중).`;

  const tail = zb.blasted
    ? ` 특히 <strong>${esc(zb.blasted.name)}</strong>(${esc(zb.blasted.acName)})에서 소리가 나와요 — 온도를 올리기 전에 그 유닛 풍향부터 돌려보세요.`
    : "";

  const zoneNow = S.myZone;
  const where =
    zoneNow === null || zoneNow === undefined
      ? `<p class="hint">지금 강의실 구역 밖에 서 있어요. 강의실에서 내 자리 쪽에 서면 그 구역 이름으로 집계됩니다.</p>`
      : `<p class="hint">지금 <b>${esc(ZONES[zoneNow]?.name ?? "")}</b>(${esc(ZONES[zoneNow]?.acName ?? "")})에 서 있어요. 이 구역으로 집계됩니다.</p>`;

  return (
    `<p class="hint">창문이 없어서 에어컨이 유일한 공기 흐름이에요. 온도 말고 <b>바람</b>이 문제일 때 씁니다. 3시간만 반영돼요.</p>` +
    `<div class="choices">${btn(-1, "🍃", "약하게")}${btn(0, "👌", "지금 딱 좋아요")}${btn(1, "💨", "세게")}</div>` +
    where +
    `<p class="insight">${head}${tail}</p>` +
    zoneCardsHTML(zb, c)
  );
}

function zoneCardsHTML(zb, c) {
  const overall = c.n ? c.raw : 24;
  const cards = zb.rows
    .map((z) => {
      let cls = "", val = "—", sub = `${z.n}명`;
      if (z.shown) {
        val = `${fmt(z.avg)}°`;
        const d = z.avg - overall;
        if (Math.abs(d) >= 0.5) cls = d > 0 ? "cold" : "hot";
        if (z.windN >= 2 && z.windAvg <= -0.5) sub += " · 💨 바람 셈";
      } else if (!z.n) {
        sub = "아무도 없음";
      } else {
        sub = `${z.n}명 (${ZONE_MIN}명부터 공개)`;
      }
      return `<div class="zcard ${cls}"><span class="zt">${z.ac} ${esc(z.name)}</span><span class="zv">${val}</span><span class="zs">${esc(sub)}</span></div>`;
    })
    .join("");

  const note = zb.spread
    ? `<strong>${esc(zb.spread.hi.name)}</strong>가 <strong>${esc(zb.spread.lo.name)}</strong>보다 <strong>${fmt(zb.spread.gap)}°C</strong> 높은 온도를 원합니다. 그쪽이 그만큼 춥다는 뜻이에요.`
    : `구역 간 차이가 크지 않아요. 자리 문제는 아닌 것 같습니다.`;

  return `<hr class="rule"><h3>자리별</h3><p class="hint">강의실에서 서 있는 구역으로 자동 집계됩니다. ${ZONE_MIN}명 이상 모인 구역만 공개돼요.</p>` +
    `<div class="zonegrid">${cards}</div><p class="insight">${note}</p>`;
}

/* ── 통계 ────────────────────────────────────────────────────────────── */
export function statsPanel(S, c, size) {
  let word, col;
  if (!c.n) { word = "—"; col = "var(--ink-3)"; }
  else if (c.iqr <= 1) { word = "좁게 모임"; col = "var(--good)"; }
  else if (c.iqr <= 2) { word = "보통"; col = "var(--ink-3)"; }
  else { word = "의견 갈림"; col = "var(--warn)"; }

  const tiles =
    `<div class="grid2">` +
    tile("참여", `${c.n}<span class="dim" style="font-size:14px"> / ${size}</span>`, c.n ? `${Math.round((c.n / size) * 100)}% · 7일 지난 표는 빠져요` : "아직 아무도 안 찍었어요") +
    tile("합의도", `<span class="dotstate" style="background:${col}"></span>${word}`, c.n ? `가운데 절반이 ${fmt(c.iqr)}°C 폭 안에` : "표가 모이면 계산돼요", true) +
    tile("중앙값", c.n ? fmt(c.median) : "—", c.n ? `절사평균과 ${fmt(Math.abs(c.median - c.raw))}°C 차이` : "절반이 이 아래, 절반이 위") +
    tile("덜덜+땀뻘뻘", c.n ? String(c.unhappy) : "—", c.n ? `${c.inBand}명은 ±1°C 안` : "희망과 1.5°C 넘게 벌어진 사람") +
    `</div>`;

  return (
    tiles +
    `<div class="chartbox"><svg id="ridge" viewBox="0 0 760 392" role="img" aria-label="희망 온도 분포"></svg><div class="tip" id="tip"></div></div>` +
    `<p class="insight" id="insight"></p>` +
    `<hr class="rule"><h3>오늘의 정각 기록</h3>` +
    `<p class="hint">매 정각에 찍힌 도장. 주황은 실제로 바꾼 시간이에요.</p>` +
    `<svg class="spark" id="hourly" viewBox="0 0 360 92" role="img" aria-label="정각별 권장 온도"></svg>` +
    `<hr class="rule"><h3>14일 추이</h3>` +
    `<svg class="spark" id="spark" viewBox="0 0 320 96" role="img" aria-label="14일 권장 온도"></svg>` +
    `<p class="hint" id="sparkNote"></p>` +
    `<hr class="rule"><h3>0.5°C 구간별</h3>` +
    `<table><thead><tr><th>희망 온도</th><th>표</th><th>비중</th><th style="width:38%"></th></tr></thead><tbody id="tbody"></tbody></table>` +
    `<hr class="rule"><h3>타점은 이렇게 정해집니다</h3>` +
    `<p class="hint">양 끝 20%씩(${size}명이면 위아래 ${Math.floor(size * 0.2)}명씩) 빼고 가운데만 평균 냅니다. 장난표 하나가 전체를 못 끌고 가면서도, 표가 움직이면 타점이 계단이 아니라 부드럽게 따라와요. 그다음 계절 밴드로 자르고, 실제로 리모컨을 만질지는 매 정각에만 판단합니다.</p>`
  );
}

const tile = (lab, val, note, sm = false) =>
  `<div class="tile"><span class="lab">${esc(lab)}</span><span class="val${sm ? " sm" : ""}">${val}</span><span class="note">${esc(note)}</span></div>`;

/* ── 게시판 ──────────────────────────────────────────────────────────── */
export function boardPanel(S) {
  const count = (k) => (k === "all" ? S.posts.length : S.posts.filter((p) => p.kind === k).length);
  const filters = KINDS.map(
    (k) => `<button type="button" data-filter="${k.key}" aria-pressed="${S.filter === k.key}">${esc(k.label)}<span class="n">${count(k.key)}</span></button>`
  ).join("");
  const pinned = S.posts.filter((p) => p.pinned).length;

  return (
    `<div class="compose">` +
    `<textarea id="postText" maxlength="300" placeholder="예) 창가쪽 너무 추워요 🥲&#10;예) 방금 join 설명 다시 한 번만…&#10;예) 실습 자료 https://... 여기 있어요"></textarea>` +
    `<div class="row"><div class="kindseg" id="kindSeg">` +
    ["chat", "q", "req", "info"]
      .map((k) => {
        const lab = KINDS.find((x) => x.key === k)?.label ?? k;
        return `<button type="button" data-kind="${k}" aria-pressed="${S.kind === k}">${esc(lab)}</button>`;
      })
      .join("") +
    `</div><span class="dim" id="counter">0/300</span>` +
    `<button class="btn accent" id="postBtn" type="button" style="margin-left:auto">올리기</button></div></div>` +
    `<p class="hint">고정 ${pinned}/${MAX_PIN} · 답변 대기 ${openQuestions(S.posts)}개 · 링크는 자동으로 눌러 들어갈 수 있게 됩니다.</p>` +
    `<div class="filters" id="filters">${filters}</div>` +
    `<div class="feed" id="feed">${feedHTML(S.posts, S.uid, S.filter)}</div>`
  );
}

/* ── 강의 ────────────────────────────────────────────────────────────── */
export function lecturePanel(S, lec) {
  const row = (key, items) =>
    `<div class="choices" data-lecrow="${key}">` +
    items
      .map(([v, em, lab]) => `<button class="choice" type="button" data-${key}="${v}" aria-pressed="${String(lec.mine[key]) === String(v)}"><em>${em}</em>${lab}</button>`)
      .join("") +
    `</div>`;

  return (
    `<p class="hint">익명입니다. <b>정각마다 싹 초기화</b>되니 매 시간 편하게 눌러주세요. 지금은 ${lec.hour}시 집계 · ${lec.n}명.</p>` +
    `<hr class="rule"><h3>난이도</h3>` +
    row("diff", [[-2, "🥱", "너무 쉬움"], [-1, "🙂", "좀 쉬움"], [0, "👌", "딱 좋음"], [1, "😵‍💫", "좀 어려움"], [2, "🆘", "너무 어려움"]]) +
    `<div id="diffGauge"></div>` +
    `<hr class="rule"><h3>속도</h3>` +
    row("pace", [[-2, "🐢", "너무 느림"], [-1, "🚶", "좀 느림"], [0, "👌", "딱 좋음"], [1, "🏃", "좀 빠름"], [2, "🚀", "너무 빠름"]]) +
    `<div id="paceGauge"></div>` +
    `<p class="insight" id="lecInsight">${lec.summary}</p>` +
    `<hr class="rule"><h3>오늘 시간별 추이</h3>` +
    `<p class="hint">정각마다 마감된 값이 쌓입니다. 어느 교시가 힘들었는지 보여요.</p>` +
    `<svg class="spark" id="lecTrend" viewBox="0 0 360 116" role="img" aria-label="시간별 강의 피드백"></svg>`
  );
}

/* ── 날씨 · 잡학 ─────────────────────────────────────────────────────── */
export function infoPanel(S, b, trivia) {
  const w = S.weather;
  const inT = Number(S.config?.indoor_t);
  const inRh = Number(S.config?.indoor_rh);
  const hasIn = Number.isFinite(inT) && Number.isFinite(inRh);

  let head = `<p class="hint">날씨를 불러오는 중…</p>`;
  let cells = "";
  let note = "";

  if (w) {
    const [desc, icon] = weatherLabel(w.code);
    head =
      `<div class="wrow"><span class="wicon">${icon}</span><div>` +
      `<div class="wtemp">${fmt(w.t)}°</div>` +
      `<div class="hint">${esc(desc)} · 체감 ${fmt(w.feels)}° · 오늘 ${fmt(w.min)}~${fmt(w.max)}°</div></div></div>`;

    const di = discomfortIndex(hasIn ? inT : w.t, hasIn ? inRh : w.rh);
    const diL = discomfortLabel(di);
    const adapt = adaptiveComfort(w.t);
    const hum = humidityAdvice(hasIn ? inRh : w.rh, hasIn);

    cells =
      `<div class="wcells">` +
      cell(hasIn ? "실내 습도" : "실외 습도", `${Math.round(hasIn ? inRh : w.rh)}%`, hum?.tone) +
      cell("불쾌지수", di ? di.toFixed(0) : "—", diL?.tone) +
      cell("적응 쾌적", adapt ? `${fmt(adapt)}°` : "범위 밖") +
      `</div>`;

    const bits = [];
    if (hum) bits.push(hum.text);
    if (diL) bits.push(`불쾌지수 ${di.toFixed(0)} — ${diL.text}.`);
    if (adapt) bits.push(`실외 ${fmt(w.t)}°면 적응 쾌적 모델(0.31×실외+17.8)로는 ${fmt(adapt)}°가 기준이에요.`);
    else bits.push("실외가 10°C 아래라 적응 쾌적 모델은 적용 범위 밖입니다.");
    if (!hasIn) bits.push("온습도계가 있으면 설정에서 실내 값을 넣어주세요. 훨씬 정확해집니다.");
    note = `<p class="insight">${bits.map(esc).join(" ")}</p>`;
  }

  return head + cells + note + `<hr class="rule"><h3>오늘의 잡학</h3><p class="trivia" id="triviaText">${esc(trivia)}</p>` +
    `<div class="row mt"><button class="mini" id="triviaNext" type="button">다른 거 ↻</button></div>`;
}

const cell = (k, v, tone) =>
  `<div class="wcell ${tone || ""}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;

/* ── 뽑기 ────────────────────────────────────────────────────────────── */
export function drawPanel(S, members) {
  const g = S.config?.draw_groups;
  const groups = g?.groups?.length
    ? `<div class="groups">` +
      g.groups
        .map((grp, i) => `<div class="group"><h4>${i + 1}조 · ${grp.length}명</h4>` + grp.map((m) => `<div class="member">${creatureSVG(m.cfg, "happy")}<span>${esc(m.nick)}</span></div>`).join("") + `</div>`)
        .join("") +
      `</div>`
    : `<p class="empty">위에서 조 개수를 누르면 결과가 나옵니다.</p>`;

  const pk = S.config?.draw_pick;
  const pick = pk?.current
    ? `<div class="pickbox" id="pickBox">${creatureSVG(pk.current.cfg, "happy")}<div class="pickname">${esc(pk.current.nick)}</div></div>`
    : `<p class="empty">🎯 뽑기를 누르면 한 명이 나옵니다.</p>`;

  const hist = pk?.history ?? [];
  const done = members.filter((m) => hist.includes(m.key));

  return (
    `<p class="hint">최근 7일 안에 표를 낸 <b>${members.length}명</b> 중에서 뽑습니다. 실명은 안 쓰고 닉네임·캐릭터로만 나와요.</p>` +
    `<hr class="rule"><h3>조 뽑기</h3>` +
    `<div class="row"><span class="dim">몇 조로?</span>` +
    [3, 4, 5, 6].map((n) => `<button class="mini" type="button" data-groups="${n}">${n}조</button>`).join("") +
    `<button class="mini" id="groupsClear" type="button">지우기</button></div>` +
    groups +
    `<hr class="rule"><h3>발표 순서 룰렛</h3>` +
    `<p class="hint">이미 뽑힌 사람은 빼고 고릅니다. 한 바퀴 다 돌면 초기화돼요.</p>` +
    `<div class="row"><button class="btn accent" id="pickBtn" type="button">🎯 뽑기</button>` +
    `<button class="mini" id="pickReset" type="button">기록 지우기</button>` +
    `<span class="dim">${done.length} / ${members.length}명 뽑음</span></div>` +
    pick +
    `<div class="picklist">${done.map((m) => `<span>${esc(m.nick)}</span>`).join("")}</div>`
  );
}

/* ── 설정 ────────────────────────────────────────────────────────────── */
export function morePanel(S, c, b, theme) {
  const applied = Number.isFinite(Number(S.config?.applied)) ? Number(S.config.applied) : null;
  const need = applied !== null && Math.abs(c.setpoint - applied) >= 0.5;

  const seasons = ["auto", ...Object.keys(SEASONS)]
    .map((k) => {
      const lab = k === "auto" ? "자동" : SEASONS[k].short;
      return `<button type="button" data-season="${k}" aria-pressed="${(S.config?.season || "auto") === k}">${esc(lab)}</button>`;
    })
    .join("");

  return (
    `<h3>에어컨 실제 설정</h3>` +
    `<p class="insight">${
      applied === null
        ? "지금 에어컨이 몇 도로 맞춰져 있나요? 한 번 알려주면 바뀔 때만 알려드릴게요."
        : need
          ? `🔧 바꿀 때가 됐어요 — <strong>${fmt(applied)}°C</strong> → <strong>${fmt(c.setpoint)}°C</strong>`
          : `✓ 지금 설정 <strong>${fmt(applied)}°C</strong> 유지 — 계산값과 0.5°C 안이라 안 건드려도 돼요.`
    }</p>` +
    `<div class="row mt"><button class="btn primary" id="applyBtn" type="button">${fmt(c.setpoint)}°C로 맞췄어요</button></div>` +

    `<hr class="rule"><h3>쉬는 시간</h3>` +
    `<p class="hint">아무나 시작할 수 있고, 모두의 화면에 같은 카운트다운이 뜹니다.</p>` +
    `<div class="row mt">` +
    [5, 10, 15, 20].map((m) => `<button class="mini" type="button" data-break="${m}">${m}분</button>`).join("") +
    `<button class="mini" id="breakEnd" type="button">끝내기</button></div>` +

    `<hr class="rule"><h3>계절</h3>` +
    `<p class="hint">같은 사람도 여름엔 26도, 겨울엔 22도가 쾌적합니다. 옷 두께 차이예요. 투표는 자유롭게 받되 최종 설정온도만 밴드로 자릅니다.</p>` +
    `<div class="kindseg" id="seasonSeg" style="margin-top:8px;width:fit-content">${seasons}</div>` +
    `<p class="hint">지금: <b>${esc(b.name)}</b> · 권장 ${b.lo}–${b.hi}°C</p>` +

    `<hr class="rule"><h3>실내 온습도 실측</h3>` +
    `<p class="hint">온습도계가 있으면 넣어주세요. 실외값보다 훨씬 정확한 불쾌지수가 나옵니다.</p>` +
    `<div class="row mt"><label class="dim">온도 <input type="number" id="indoorT" step="0.1" min="10" max="40" value="${S.config?.indoor_t ?? ""}" style="width:80px"> °C</label>` +
    `<label class="dim">습도 <input type="number" id="indoorRh" step="1" min="0" max="100" value="${S.config?.indoor_rh ?? ""}" style="width:80px"> %</label>` +
    `<button class="mini" id="indoorSave" type="button">저장</button>` +
    `<button class="mini" id="indoorClear" type="button">지우기</button></div>` +

    `<hr class="rule"><h3>화면</h3>` +
    `<div class="row mt"><button class="mini" id="themeBtn" type="button">테마: ${theme === "system" ? "시스템 따라감" : theme === "light" ? "밝게" : "어둡게"}</button>` +
    `<button class="mini" id="qrBtn" type="button">📱 QR 코드</button></div>` +
    `<div id="qrBox" class="row mt"></div>` +

    `<hr class="rule"><p class="hint">이름도 이메일도 받지 않습니다. 브라우저마다 익명 계정 하나가 생기고, 투표 기록에는 닉네임·캐릭터 말고 아무것도 안 붙어요. 마당과 강의실에서의 위치는 저장되지 않고, 창을 닫으면 사라집니다.</p>`
  );
}
