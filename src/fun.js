/**
 * 재미로 쓰는 것들 — 점심 룰렛 · 즉석 익명 투표 · 사다리 타기 · 오늘의 질문.
 *
 * 공통 규칙이 하나 있습니다: **결과는 서버에 저장하고 모두가 같은 걸 봅니다.**
 * 각자 자기 폰에서 따로 돌리면 "나는 치킨 나왔는데?" 가 돼서 아무 소용이 없어요.
 * 그래서 돌리는 사람은 결과를 config 에 적고, 나머지는 그 결과를 받아 같은
 * 애니메이션을 봅니다.
 *
 * 투표만 예외로 votes 테이블에 붙습니다. uid 가 기본키라 1인 1표가 저절로
 * 지켜지고, votes_public 뷰가 uid 를 빼고 내보내서 누가 뭘 찍었는지는
 * 온도 투표와 똑같이 아무도 못 봅니다.
 */

/* ── 점심 룰렛 ────────────────────────────────────────────────────────── */

/** 성수동 기본값. 한 번 고치면 config 에 저장돼서 다음부터 그걸 씁니다. */
export const LUNCH_DEFAULT = [
  "국밥", "김치찌개", "부대찌개", "돈까스", "국수", "덮밥",
  "중식", "쌀국수", "햄버거", "샐러드",
];

export const MAX_SLOTS = 12;
export const MIN_SLOTS = 2;

export const wheelItems = (cfg) => {
  const xs = cfg?.roulette?.items;
  return Array.isArray(xs) && xs.length >= MIN_SLOTS ? xs.slice(0, MAX_SLOTS) : LUNCH_DEFAULT;
};

/** 룰렛 칸 색. 인접한 칸이 안 겹치게 길이와 서로소인 간격으로 건너뜁니다. */
const WHEEL = ["#e8734f", "#3f9e6a", "#4a7fc1", "#c9683f", "#7b5ea8", "#c05d86", "#2f8f8f", "#a08236"];
export const slotColor = (i) => WHEEL[(i * 3) % WHEEL.length];

/**
 * 바늘이 12시를 가리킵니다. i 번 칸의 한가운데가 바늘에 오려면
 * 원판을 그만큼 되돌려 놓고, 보기 좋게 몇 바퀴를 더 얹습니다.
 */
export function spinAngle(i, n, turns = 6) {
  const slice = 360 / n;
  return turns * 360 - (i * slice + slice / 2);
}

/* ── 즉석 익명 투표 ───────────────────────────────────────────────────── */

export const MAX_CHOICES = 10;

export const POLL_PRESETS = [
  { q: "에어컨 더 낮출까요?", opts: ["네, 더워요", "아니요, 추워요", "지금 딱 좋아요"] },
  { q: "오늘 점심 뭐 먹죠?", opts: ["한식", "분식", "중식", "양식", "아무거나"] },
  { q: "쉬는 시간 더 필요해요?", opts: ["네", "괜찮아요"] },
  { q: "진도 어떻게 할까요?", opts: ["복습 한 번 더", "그냥 나가요"] },
];

export const makePoll = (q, opts) => ({
  id: `p${Date.now().toString(36)}`,
  q: String(q).slice(0, 60),
  opts: opts.map((o) => String(o).slice(0, 20)).slice(0, MAX_CHOICES),
  at: new Date().toISOString(),
});

/**
 * 표를 셉니다. 지금 열린 투표(poll.id)에 찍은 표만 셉니다 — 예전 투표의
 * 답이 votes 행에 남아 있어도 id 가 달라서 자동으로 걸러져요.
 */
export function pollTally(poll, votes) {
  const n = poll?.opts?.length ?? 0;
  const counts = Array(n).fill(0);
  let total = 0, mine = null;

  for (const v of votes) {
    if (v.poll_id !== poll?.id) continue;
    const k = Number(v.poll_pick);
    if (!Number.isInteger(k) || k < 0 || k >= n) continue;
    counts[k]++;
    total++;
    if (v.is_me) mine = k;
  }

  const max = Math.max(0, ...counts);
  return {
    counts, total, mine,
    pct: counts.map((c) => (total ? (c / total) * 100 : 0)),
    lead: counts.map((c) => c > 0 && c === max),
  };
}

/* ── 사다리 타기 ──────────────────────────────────────────────────────── */

export const LADDER_MIN = 2;
export const LADDER_MAX = 8;

/**
 * 가로줄을 놓습니다. 같은 높이에서 이웃한 두 칸이 동시에 이어지면 길이
 * 꼬이니까, 한 줄에 한 다리씩만 놓고 겹치지 않게 자리를 고릅니다.
 */
export function makeLadder(n, rows = 0) {
  const cols = Math.max(LADDER_MIN, Math.min(LADDER_MAX, n));
  const h = rows || cols * 3;
  const bars = [];
  for (let y = 0; y < h; y++) {
    // 각 줄에 다리를 놓을지 말지, 놓는다면 어디에
    if (Math.random() < 0.55) {
      const x = Math.floor(Math.random() * (cols - 1));
      const last = bars[bars.length - 1];
      if (last && last.y === y - 1 && last.x === x) continue; // 바로 위와 같은 자리는 건너뜀
      bars.push({ y, x });
    }
  }
  return { cols, rows: h, bars };
}

/** 한 칸에서 출발해 내려가며 만나는 다리마다 옆으로 건너갑니다. */
export function walkLadder(ladder, start) {
  let x = start;
  const path = [{ y: 0, x }];
  for (let y = 0; y < ladder.rows; y++) {
    const right = ladder.bars.find((b) => b.y === y && b.x === x);
    const left = ladder.bars.find((b) => b.y === y && b.x === x - 1);
    if (right) x += 1;
    else if (left) x -= 1;
    else continue;
    path.push({ y: y + 1, x });
  }
  return { end: x, path };
}

/* ── 오늘의 질문 ──────────────────────────────────────────────────────── */

/**
 * 하루에 하나씩 돌아갑니다. 잡학과 달리 날짜 기준이라 하루 종일 같은 질문이
 * 걸려 있고, 목록을 한 바퀴 돌기 전엔 같은 게 두 번 안 나옵니다.
 */
export const QUESTIONS = [
  "인생 라면 하나만 고른다면?",
  "지금 제일 배우고 싶은 거 하나는?",
  "요즘 무한반복 중인 노래는?",
  "부트캠프 끝나면 제일 먼저 하고 싶은 일?",
  "오늘 컨디션을 한 단어로?",
  "인생 영화 한 편 추천한다면?",
  "아침형 인간 vs 저녁형 인간, 본인은?",
  "코딩하다 제일 많이 만나는 에러는?",
  "성수동에서 발견한 맛집 있나요?",
  "커피 vs 에너지드링크 vs 물, 오늘의 선택은?",
  "타임머신이 있다면 1년 전 나에게 한마디?",
  "제일 자신 있는 요리는?",
  "주말에 하루가 통째로 비면 뭐 하세요?",
  "최근에 산 것 중 제일 잘 산 물건은?",
  "지금 가장 가고 싶은 여행지는?",
  "스트레스 풀리는 나만의 방법은?",
  "SQL 과 파이썬 중 더 정든 쪽은?",
  "어릴 때 장래희망이 뭐였나요?",
  "하루 세 끼 중 절대 못 거르는 끼니는?",
  "요즘 빠져 있는 게 있다면?",
  "인생 드라마 한 편만 고른다면?",
  "치킨은 뼈? 순살?",
  "메모는 손글씨파 vs 디지털파?",
  "지금 제일 듣고 싶은 말은?",
  "겨울 vs 여름, 굳이 하나 고르면?",
  "최근에 제일 크게 웃었던 순간은?",
  "나만 아는 꿀팁 하나 풀어주세요",
  "부먹 vs 찍먹",
  "지금 책상 위에 있는 물건 하나만 말해주세요",
  "10년 뒤 나는 뭘 하고 있을까요?",
];

export function questionOfDay(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d - start) / 86400000);
  return { i: day % QUESTIONS.length, q: QUESTIONS[day % QUESTIONS.length] };
}

/** 오늘 질문에 달린 답만 추립니다. 어제 답이 섞이면 안 되니까요. */
export function todaysAnswers(posts, qi) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return posts.filter(
    (p) => p.kind === "qa" && Date.parse(p.created_at) >= dayStart.getTime() && p.body?.startsWith(`${qi}|`),
  );
}

export const answerBody = (qi, text) => `${qi}|${String(text).slice(0, 120)}`;
export const answerText = (body) => String(body).slice(String(body).indexOf("|") + 1);
