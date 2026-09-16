/**
 * 계절 · 날씨 · 습도 · 잡학
 *
 * 여기 있는 계절 밴드가 이 앱에서 제일 중요한 "현실 제약"입니다.
 * 같은 사람이 여름엔 26도, 겨울엔 22도가 쾌적합니다. 취향이 아니라
 * 옷 두께(clo) 차이 때문이에요. 그래서 투표는 자유롭게 받되,
 * 최종 설정온도만 계절 밴드로 자릅니다.
 */

export const SEASONS = {
  summer:   { key: "summer",   name: "여름 · 냉방", short: "여름",   min: 22, max: 30, lo: 24, hi: 28, def: 26.0 },
  shoulder: { key: "shoulder", name: "간절기",      short: "간절기", min: 19, max: 28, lo: 21, hi: 26, def: 23.5 },
  winter:   { key: "winter",   name: "겨울 · 난방", short: "겨울",   min: 17, max: 26, lo: 19, hi: 23, def: 21.0 },
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
  if (n < ZONE_MIN) return `자리를 고른 사람이 ${n}명이에요. ${ZONE_MIN}명 넘게 모인 구역부터 바람 배분이 나옵니다.`;
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
  "졸음의 진짜 주범은 온도보다 이산화탄소입니다. 사람이 꽉 찬 강의실은 한 시간이면 CO₂가 1500ppm을 넘고 이때부터 집중력이 떨어져요. 창문이 없는 방이라면 쉬는 시간에 문을 열어두거나 복도에 잠깐 나갔다 오는 게 온도 조절보다 효과가 큽니다.",
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
];

export function triviaOfToday(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d - start) / 86400000);
  return TRIVIA[day % TRIVIA.length];
}

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

/** 23:41 형식의 카운트다운. */
export function countdownText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
