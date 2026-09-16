/**
 * 계절 · 날씨 · 습도 · 잡학
 *
 * 여기 있는 계절 밴드가 이 앱에서 제일 중요한 "현실 제약"입니다.
 * 같은 사람이 여름엔 26도, 겨울엔 22도가 쾌적합니다. 취향이 아니라
 * 옷 두께(clo) 차이 때문이에요. 그래서 투표는 자유롭게 받되,
 * 최종 설정온도만 계절 밴드로 자릅니다.
 */

export const SEASONS = {
  // min~max 는 "내가 고를 수 있는 폭", lo~hi 는 "합의 타점이 머무는 폭"입니다.
  // 고르는 건 18~30 로 다 열어두고, 실제 리모컨 값만 계절 밴드 안으로 잡아요.
  summer:   { key: "summer",   name: "여름 · 냉방", short: "여름",   min: 18, max: 30, lo: 24, hi: 28, def: 26.0 },
  shoulder: { key: "shoulder", name: "간절기",      short: "간절기", min: 18, max: 30, lo: 21, hi: 26, def: 23.5 },
  winter:   { key: "winter",   name: "겨울 · 난방", short: "겨울",   min: 18, max: 30, lo: 19, hi: 23, def: 21.0 },
};

export function seasonForMonth(m) {
  if (m >= 6 && m <= 9) return "summer";
  if (m === 12 || m <= 3) return "winter";
  return "shoulder";
}

/** config.season 이 'auto' 면 이번 달로 판단합니다. */
export function resolveSeason(key) {
  let k = key || "auto";
  if (k === "auto" || !SEASONS[k]) k = seasonForMonth(new Date().getMonth() + 1);
  return SEASONS[k];
}

// ── 자리 구역 · 바람 배분 ────────────────────────────────────────────────
//
// 이 앱의 진짜 결론은 "몇 도"가 아니라 "어느 쪽에 바람을 더/덜 보낼까"입니다.
//
// 36명의 희망 온도는 절대 하나로 안 모입니다. 누구는 덥고 누구는 춥고,
// ASHRAE 기준으로도 최선이 80% 만족이에요. 그래서 온도는 하나로 정하고,
// **남는 차이를 바람으로 메웁니다.**
//
//   구역 평균이 합의보다 높다  = 그 구역이 춥다  → 바람 줄이기 / 풍향 돌리기
//   구역 평균이 합의보다 낮다  = 그 구역이 덥다  → 바람 더 보내기
//
// 온도를 1도 올리는 것보다 풍향을 한 번 돌리는 게 보통 더 효과가 큽니다.
// 에어컨 바람이 직접 닿으면 실제 온도보다 2~3도 낮게 느껴지거든요.

import { ZONES, ZONE_MIN } from "./zones.js";
export { ZONES, ZONE_MIN };

export const WIND_MS = 3 * 3600e3;

/** 구역별 평균 희망 온도와 바람 요청. 4명 미만은 역추적이 되므로 감춥니다. */
export function zoneBreakdown(votes) {
  const now = Date.now();
  const rows = ZONES.map((z) => {
    const inZone = votes.filter((v) => v.zone === z.i);
    const xs = inZone.map((v) => Number(v.t)).filter(Number.isFinite);
    const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    const winds = inZone
      .filter((v) => v.wind !== null && v.wind !== undefined && v.wind_at && now - Date.parse(v.wind_at) < WIND_MS)
      .map((v) => Number(v.wind));
    const windAvg = winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null;

    return { ...z, n: xs.length, avg, shown: xs.length >= ZONE_MIN, windN: winds.length, windAvg };
  });

  const shown = rows.filter((r) => r.shown);
  let spread = null;
  if (shown.length >= 2) {
    const hi = shown.reduce((a, b) => (b.avg > a.avg ? b : a));
    const lo = shown.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (hi.avg - lo.avg >= 0.8) spread = { hi, lo, gap: hi.avg - lo.avg };
  }
  return { rows, spread };
}

/**
 * 구역별 바람 지시.
 *   dir  -1 줄이기 · 0 그대로 · +1 더 보내기
 *   src  무엇을 보고 정했는지 ("요청" 이면 직접 눌러준 것, "온도" 면 희망 온도 차이)
 */
export function airflow(zb, setpoint) {
  const rows = zb.rows.map((z) => {
    let dir = 0, src = null, gap = null;

    if (z.shown && Number.isFinite(setpoint)) {
      gap = z.avg - setpoint;                 // + 면 더 따뜻하길 원함 = 여기가 춥다
      if (gap >= 0.6) { dir = -1; src = "온도"; }
      else if (gap <= -0.6) { dir = 1; src = "온도"; }
    }
    // 직접 누른 바람 요청이 있으면 그게 우선입니다. 본인이 제일 잘 알아요.
    if (z.windN >= 2) {
      if (z.windAvg <= -0.5) { dir = -1; src = "요청"; }
      else if (z.windAvg >= 0.5) { dir = 1; src = "요청"; }
    }
    return { ...z, dir, src, gap };
  });

  const less = rows.filter((r) => r.dir < 0);
  const more = rows.filter((r) => r.dir > 0);

  const byZone = new Map(rows.map((r) => [r.i, r]));
  return { rows, byZone, less, more, balanced: !less.length && !more.length };
}

/** 전체 바람 요청 요약 — 최근 3시간. */
export function windSummary(votes) {
  const now = Date.now();
  const vals = votes
    .filter((v) => v.wind !== null && v.wind !== undefined && v.wind_at && now - Date.parse(v.wind_at) < WIND_MS)
    .map((v) => Number(v.wind));
  if (!vals.length) return { n: 0, avg: 0, up: 0, down: 0 };
  return {
    n: vals.length,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    up: vals.filter((v) => v > 0).length,
    down: vals.filter((v) => v < 0).length,
  };
}

/** 화면에 그대로 쓸 한 줄 지시문. */
export function airflowText(af, n) {
  if (n < ZONE_MIN) return `자리를 고른 사람이 ${n}명이에요. 한 구역에 ${ZONE_MIN}명부터 바람 배분이 나옵니다.`;
  if (af.balanced) return "지금은 구역 간 차이가 크지 않아요. 바람을 따로 돌릴 필요 없습니다.";

  const parts = [];
  if (af.less.length) parts.push(`<b class="less">${af.less.map((r) => r.name).join(" · ")}</b> 쪽 바람을 <b>줄이거나 풍향을 돌려</b>주세요`);
  if (af.more.length) parts.push(`<b class="more">${af.more.map((r) => r.name).join(" · ")}</b> 쪽으로 바람을 <b>더 보내</b>주세요`);
  return parts.join("<br>") + "<br><span class=\"dim\">온도를 1도 바꾸는 것보다 풍향 한 번 돌리는 게 보통 더 셉니다.</span>";
}

// ── 날씨 · 습도 ──────────────────────────────────────────────────────────
// Open-Meteo 는 API 키가 필요 없고 CORS 도 열려 있어서 브라우저에서 바로 부릅니다.
const WMO = {
  0: ["맑음", "☀️"], 1: ["대체로 맑음", "🌤️"], 2: ["구름 조금", "⛅"], 3: ["흐림", "☁️"],
  45: ["안개", "🌫️"], 48: ["짙은 안개", "🌫️"],
  51: ["이슬비", "🌦️"], 53: ["이슬비", "🌦️"], 55: ["이슬비", "🌦️"],
  61: ["비", "🌧️"], 63: ["비", "🌧️"], 65: ["강한 비", "🌧️"],
  66: ["언 비", "🌨️"], 67: ["언 비", "🌨️"],
  71: ["눈", "🌨️"], 73: ["눈", "🌨️"], 75: ["강한 눈", "❄️"], 77: ["싸락눈", "🌨️"],
  80: ["소나기", "🌦️"], 81: ["소나기", "🌧️"], 82: ["강한 소나기", "⛈️"],
  85: ["소낙눈", "🌨️"], 86: ["소낙눈", "❄️"],
  95: ["천둥번개", "⛈️"], 96: ["우박 동반", "⛈️"], 99: ["우박 동반", "⛈️"],
};

export function weatherLabel(code) {
  return WMO[code] || ["—", "🌡️"];
}

export async function fetchWeather(lat, lon, signal) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    "&timezone=Asia%2FSeoul&forecast_days=1";

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`날씨 조회 실패 (${res.status})`);
  const j = await res.json();
  const c = j.current || {};
  const d = j.daily || {};

  return {
    t: c.temperature_2m,
    rh: c.relative_humidity_2m,
    feels: c.apparent_temperature,
    wind: c.wind_speed_10m,
    code: c.weather_code,
    max: d.temperature_2m_max?.[0],
    min: d.temperature_2m_min?.[0],
    at: Date.now(),
  };
}

/**
 * 불쾌지수 (Discomfort Index). 기상청에서도 쓰는 식입니다.
 *   DI = 0.81T + 0.01·RH·(0.99T − 14.3) + 46.3
 */
export function discomfortIndex(t, rh) {
  if (!Number.isFinite(t) || !Number.isFinite(rh)) return null;
  return 0.81 * t + 0.01 * rh * (0.99 * t - 14.3) + 46.3;
}

export function discomfortLabel(di) {
  if (di == null) return null;
  if (di < 68) return { text: "쾌적", tone: "good" };
  if (di < 75) return { text: "약간 불쾌", tone: "warn" };
  if (di < 80) return { text: "절반쯤 불쾌", tone: "warn" };
  return { text: "대부분 불쾌", tone: "bad" };
}

/**
 * ASHRAE 55 적응 쾌적 모델. 바깥이 더우면 사람도 더운 데 적응합니다.
 *   쾌적온도 = 0.31 × 실외 평균기온 + 17.8   (실외 10~33.5도에서만 유효)
 * 난방기에는 식 자체가 적용 범위 밖이라 null 을 돌려줍니다.
 */
export function adaptiveComfort(outdoorMean) {
  if (!Number.isFinite(outdoorMean)) return null;
  if (outdoorMean < 10 || outdoorMean > 33.5) return null;
  return 0.31 * outdoorMean + 17.8;
}

/**
 * 습도 보정 제안.
 * 실내 습도를 직접 재서 넣었으면 그걸, 없으면 실외 습도를 참고값으로 씁니다.
 * (냉방 중 실내는 실외보다 건조하므로 실외값은 어디까지나 눈대중이에요.)
 */
export function humidityAdvice(rh, indoor) {
  if (!Number.isFinite(rh)) return null;
  const src = indoor ? "실내" : "실외 기준";
  if (rh >= 70) return { delta: -1.0, text: `${src} 습도 ${Math.round(rh)}% — 끈적해서 같은 온도도 덥게 느껴져요. 0.5~1도 낮추거나 제습을 켜보세요.`, tone: "warn" };
  if (rh >= 60) return { delta: -0.5, text: `${src} 습도 ${Math.round(rh)}% — 조금 높습니다. 제습 모드가 온도 낮추기보다 효과적일 수 있어요.`, tone: "warn" };
  if (rh <= 30) return { delta: +0.5, text: `${src} 습도 ${Math.round(rh)}% — 건조합니다. 건조하면 같은 온도도 춥게 느껴지고 목이 아파요. 가습이 답.`, tone: "warn" };
  return { delta: 0, text: `${src} 습도 ${Math.round(rh)}% — 권장 범위(40~60%) 안입니다.`, tone: "good" };
}

// ── 오늘의 잡학 ──────────────────────────────────────────────────────────
// 날짜로 돌아가면서 하루에 하나씩 보여줍니다.
export const TRIVIA = [
  "냉방 설정을 1도 올리면 소비 전력이 약 7% 줄어듭니다. 36명이 하루 8시간 쓰는 강의실이면 무시 못 할 차이예요.",
  "가만히 앉아 있는 사람 한 명이 약 100W의 열을 냅니다. 36명이면 전기난로 두 대를 켜 둔 셈이에요. 사람이 다 들어차면 방이 실제로 더워집니다.",
  "습도가 10% 오르면 체감 온도는 약 0.5도 올라갑니다. 장마철에 같은 26도가 유난히 더운 이유입니다.",
  "실내 권장 습도는 40~60%입니다. 이보다 낮으면 바이러스가 공기 중에 오래 살아남고, 높으면 곰팡이와 집먼지진드기가 늘어요.",
  "ASHRAE 기준으로 '전원 만족'은 애초에 목표가 아닙니다. 80% 만족이 최선이에요. 20%는 항상 불만인 게 정상입니다.",
  "에어컨 바람이 직접 닿으면 실제 온도보다 2~3도 낮게 느껴집니다. 온도를 올리는 것보다 풍향을 돌리는 게 먼저인 이유.",
  "졸음의 진짜 주범은 온도보다 이산화탄소입니다. 사람이 꽉 찬 강의실은 한 시간이면 CO₂가 1500ppm을 넘고 이때부터 집중력이 떨어져요. 쉬는 시간에 문을 열어두는 게 온도 조절보다 효과가 큽니다.",
  "여성이 남성보다 평균 2~3도 높은 실내온도를 선호합니다. 사무실 온도 기준이 1960년대 성인 남성의 대사율로 만들어졌기 때문이라는 연구가 2015년 네이처에 실렸어요.",
  "에어컨을 껐다 켰다 하는 것보다 켜 두는 게 전기를 덜 씁니다. 인버터 방식은 설정 온도에 도달하면 알아서 힘을 빼거든요.",
  "'18도로 확 낮추면 빨리 시원해진다'는 착각입니다. 에어컨의 냉방 능력은 설정 온도와 무관하게 일정해서, 도달 속도는 똑같고 전기만 더 씁니다.",
  "선풍기를 같이 돌리면 체감 온도가 2도쯤 내려갑니다. 에어컨 설정을 2도 올리고 선풍기를 켜는 쪽이 훨씬 쌉니다.",
  "창가 자리는 한여름 직사광선을 받으면 실내 다른 자리보다 3도 이상 높게 느껴집니다. 블라인드 한 장이 에어컨 1도보다 효과가 큽니다.",
  "사람은 온도 자체보다 '온도 변화'에 훨씬 민감합니다. 26도로 계속 두는 게 24도와 28도를 오가는 것보다 덜 불편해요.",
  "손발이 찬 사람은 실제로 같은 방에서 더 춥게 느낍니다. 말단 혈류량이 적어서 체감 차이가 최대 3도까지 납니다. 엄살이 아니에요.",
  "겨울 실내 적정 온도가 18~20도로 낮게 잡히는 건, 겨울엔 다들 두꺼운 옷을 입기 때문입니다. 반팔로 지낼 거면 애초에 계산이 어긋나요.",
  "밥을 먹고 나면 소화에 혈류가 쏠려서 체온 조절 능력이 잠깐 떨어집니다. 점심 직후에 유난히 춥거나 졸린 게 기분 탓만은 아니에요.",
  "에어컨 필터가 막히면 냉방 효율이 최대 15%까지 떨어집니다. 온도를 아무리 낮춰도 안 시원하면 필터부터 의심해 보세요.",
  "정부 권장 실내 온도는 여름 26도 이상, 겨울 20도 이하입니다. 공공기관은 여름 28도가 기준이에요.",
  "체감온도를 계산하는 공식은 여름과 겨울이 아예 다릅니다. 여름엔 습도(열지수), 겨울엔 바람(풍속냉각)이 주인공이에요.",
  "20% 절사평균은 통계학에서 '로버스트 추정량'이라고 부릅니다. 올림픽 체조 점수에서 최고점·최저점을 빼는 것과 똑같은 원리예요.",
  "사람의 열 쾌적감에 영향을 주는 요소는 6가지입니다 — 온도, 복사온도, 습도, 풍속, 착의량, 활동량. 온도는 그중 하나일 뿐이에요.",
  "에어컨 실외기 주변이 막혀 있으면 냉방 능력이 급감합니다. 실외기가 뜨거운 공기를 다시 빨아들이기 때문이에요.",
  "SQL의 NULL은 '값이 없음'이지 0이나 빈 문자열이 아닙니다. 그래서 NULL = NULL 도 참이 아니라 NULL이에요. 비교하려면 IS NULL 을 써야 합니다.",
  "COUNT(*) 와 COUNT(컬럼) 은 다릅니다. 앞은 행 수를 세고, 뒤는 그 컬럼이 NULL이 아닌 행만 셉니다. 숫자가 안 맞으면 여기부터 보세요.",
  "SUM, AVG 같은 집계 함수는 NULL을 아예 빼고 계산합니다. 평균이 예상보다 높게 나오는 가장 흔한 이유예요.",
  "SQL의 원래 이름은 SEQUEL이었습니다. 이미 같은 상표가 있어서 SQL로 줄였고, 그래서 지금도 '에스큐엘'과 '시퀄'을 둘 다 씁니다.",
  "인덱스를 걸면 조회는 빨라지지만 입력·수정은 느려집니다. 책 뒤 색인을 만들어두면 찾기는 쉬운데 내용이 바뀔 때마다 색인도 고쳐야 하는 것과 같아요.",
  "LEFT JOIN 에서 ON 과 WHERE 는 결과가 다릅니다. ON 은 '붙이는 조건', WHERE 는 '붙인 뒤에 거르는 조건'이라서, WHERE 에 오른쪽 테이블 조건을 쓰면 LEFT JOIN 이 INNER JOIN 처럼 변해요.",
  "GROUP BY 를 쓰면 SELECT 에는 그룹 기준 컬럼이나 집계 함수만 올 수 있습니다. 나머지는 '여러 행 중 어느 걸 보여줘야 하지?'가 정해지지 않으니까요.",
  "WHERE 는 묶기 전에 거르고, HAVING 은 묶은 뒤에 거릅니다. 그래서 HAVING 에서만 COUNT(*) 같은 집계 결과로 조건을 걸 수 있어요.",
  "SELECT * 이 편해 보여도 실무에서 피하는 이유 — 컬럼이 추가되면 결과가 조용히 바뀌고, 안 쓰는 데이터까지 네트워크로 실어 나릅니다.",
  "DELETE 와 TRUNCATE 는 결과는 비슷해도 속이 다릅니다. DELETE 는 한 줄씩 지우며 기록을 남기고, TRUNCATE 는 테이블을 통째로 비워서 훨씬 빠르지만 되돌리기 어려워요.",
  "DISTINCT 는 공짜가 아닙니다. 중복을 지우려면 전체를 정렬하거나 해시로 훑어야 해서, 습관적으로 붙이면 느려집니다.",
  "SQL은 '어떻게 가져올지'가 아니라 '무엇을 원하는지'만 적는 선언형 언어입니다. 실제 순서는 데이터베이스가 알아서 정해요.",
  "파이썬에서 0.1 + 0.2 == 0.3 은 False 입니다. 컴퓨터가 소수를 2진수로 저장하며 생기는 오차라, 거의 모든 언어에서 똑같이 나와요.",
  "파이썬 이름은 뱀이 아니라 영국 코미디쇼 '몬티 파이썬'에서 왔습니다. 만든 사람이 팬이었어요.",
  "파이썬의 들여쓰기는 취향이 아니라 문법입니다. 다른 언어에서 중괄호가 하는 일을 공백이 대신해요.",
  "b = a 로는 리스트가 복사되지 않습니다. 같은 걸 가리키는 이름이 하나 더 생길 뿐이라 b를 고치면 a도 바뀌어요.",
  "배열을 0부터 세는 건 실수가 아닙니다. 인덱스는 원래 '시작점에서 얼마나 떨어져 있나'를 뜻해서, 첫 칸은 0만큼 떨어져 있는 거예요.",
  "1KB가 1000이 아니라 1024바이트인 건 2의 10제곱이기 때문입니다. 컴퓨터가 2진수로 세니까요.",
  "비교로 정렬하는 한 n log n 보다 빠를 수 없습니다. 구현을 잘 못해서가 아니라 수학적으로 증명된 한계예요.",
  "'디버깅'을 유명하게 만든 사건 — 1947년 하버드 마크 II 안에서 실제로 나방이 나왔고, 연구진이 그걸 일지에 테이프로 붙여놨습니다. 그 일지는 지금도 남아 있어요.",
  "한글 한 글자는 UTF-8에서 3바이트를 씁니다. 영어는 1바이트라 같은 글자 수여도 한글 쪽이 세 배 무거워요.",
  "UTF-8이 세계 표준이 된 비결 중 하나는 앞 128글자를 아스키와 똑같이 맞춰둔 것입니다. 영어권 기존 파일을 하나도 안 고쳐도 됐거든요.",
  "'컴퓨터 과학에서 어려운 건 딱 둘, 캐시 무효화와 이름 짓기.' 변수 이름 짓다 30분 날린 게 당신만의 일이 아니라는 뜻입니다.",
  "코드는 쓰는 시간보다 읽히는 시간이 훨씬 깁니다. 그래서 '나중의 내가 읽을 수 있게' 쓰는 게 짧게 쓰는 것보다 중요해요.",
  "뇌는 몸무게의 2%인데 에너지의 20%를 씁니다. 공부하고 나면 배고픈 게 착각만은 아니에요.",
  "집중력은 보통 45분쯤 지나면 눈에 띄게 떨어집니다. 수업이 50분인 데는 이유가 있어요.",
  "오후 1~3시에 졸린 건 밥 때문만이 아닙니다. 사람 생체 리듬 자체에 그 시간대 각성도가 떨어지는 구간이 있어요.",
  "낮잠은 20분을 넘기면 오히려 더 피곤해집니다. 깊은 잠에 들어간 뒤 깨면 한동안 멍하거든요.",
  "체중의 1~2%만 수분이 부족해도 집중력과 단기 기억이 떨어집니다. 목마르다고 느낄 땐 이미 늦은 거예요.",
  "카페인은 몸에서 절반 빠지는 데만 5~6시간 걸립니다. 오후 3시 커피가 밤 9시에도 절반 남아 있는 셈이에요.",
  "배운 걸 그냥 두면 하루 만에 절반 넘게 잊습니다. 에빙하우스의 망각 곡선이에요. 그래서 '언제 복습하냐'가 '얼마나 오래 보냐'보다 중요합니다.",
  "남에게 설명해보면 이해도가 확 올라갑니다. 물리학자 파인만이 쓰던 방법이라 '파인만 기법'이라고 불려요.",
  "손으로 필기한 쪽이 노트북으로 친 쪽보다 개념 이해 점수가 높다는 연구가 있습니다. 느려서 요약할 수밖에 없는 게 오히려 도움이 된대요.",
  "눈이 뻑뻑하면 20-20-20 — 20분마다, 20피트(약 6m) 떨어진 곳을, 20초간 봅니다.",
  "앉아 있을 때가 서 있을 때보다 허리에 가해지는 압력이 큽니다. 쉬는 시간에 일어나는 게 생각보다 중요해요.",
  "하품이 옮는 건 공감 능력과 관련 있다는 연구가 많습니다. 친한 사람일수록 더 잘 옮아요.",
  "꿀은 상하지 않습니다. 3000년 된 이집트 무덤에서 나온 꿀도 먹을 수 있는 상태였다고 해요.",
  "바나나는 나무가 아니라 풀에서 열립니다. 세상에서 제일 큰 풀이에요.",
  "문어는 심장이 셋이고 피가 파랗습니다. 산소를 나르는 데 철 대신 구리를 써서 그래요.",
  "에펠탑은 여름에 더 큽니다. 철이 열로 늘어나서 최대 15cm까지 자라요.",
  "종이는 아무리 얇아도 7~8번 넘게 반으로 접기 어렵습니다. 접을 때마다 두께가 2배씩 늘어나거든요.",
  "위산은 pH 1~2로 금속도 녹일 만큼 강합니다. 위벽이 며칠에 한 번씩 새로 만들어져서 버티는 거예요.",
  "북극곰의 털은 흰색이 아니라 속이 빈 투명한 털입니다. 빛이 안에서 여러 번 튕기면서 하얗게 보여요.",
  "전자레인지는 레이더를 연구하던 기술자가 주머니 속 초콜릿이 녹은 걸 보고 발명했습니다.",
  "지구에서 달까지의 거리에 태양계 행성을 전부 한 줄로 세워 넣을 수 있습니다. 달이 그만큼 멀어요.",
  "새우의 심장은 머리 쪽에 있습니다.",
  "깨어 있는 동안 눈을 깜빡이느라 감고 있는 시간이 약 10%입니다. 그 사이를 뇌가 이어붙여서 끊긴 걸 못 느껴요.",
  "번개는 같은 자리에 두 번 안 친다는 말은 틀렸습니다. 높은 건물은 한 해에도 수십 번 맞아요.",
];

/**
 * 정각마다 한 칸씩 넘어갑니다.
 *
 * 1970년부터 지금까지의 "시간 수"를 목록 길이로 나눈 나머지라, 매시간
 * 인덱스가 정확히 1씩 올라가요. 그래서 목록을 한 바퀴(= TRIVIA.length 시간)
 * 다 돌기 전에는 같은 게 절대 두 번 안 나옵니다.
 * 접속한 모든 사람이 같은 시간에 같은 걸 보는 것도 덤입니다.
 */
export function triviaIndexOfNow(now = Date.now()) {
  const hours = Math.floor(now / 3600000);
  return ((hours % TRIVIA.length) + TRIVIA.length) % TRIVIA.length;
}

export const triviaOfNow = (now = Date.now()) => TRIVIA[triviaIndexOfNow(now)];

// ── 정각 리듬 ────────────────────────────────────────────────────────────
// 투표는 아무 때나 받지만, 실제로 리모컨을 만질지 판단하는 건 매 정각입니다.
// 매 분 들여다볼 수는 없으니까요.

/** 다음 정각까지 남은 밀리초. */
export function msToNextHour(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0, 0);
  return next - d;
}

/** 12:34 형식. */
export function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 23:41 형식의 카운트다운. 한 시간이 넘으면 1:10:00 으로 늘립니다(점심시간). */
export function countdownText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const mm = String(h ? m : Math.floor(total / 60)).padStart(2, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
