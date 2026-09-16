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
  "사람은 눈을 뜨고 재채기를 할 수 없습니다. 지금 시도해보지 마세요. 다들 봅니다.",
  "위산은 pH 1~2로 면도날도 녹입니다. 그게 안 뚫리는 이유는 위벽이 며칠마다 통째로 새로 만들어지기 때문이에요. 몸이 계속 도배를 다시 하는 중입니다.",
  "새우는 심장이 머리에 있습니다. 그래서 새우깡을 먹을 때 우리는… 아무튼 맛있죠.",
  "문어는 심장이 셋, 피가 파랗고, 다리 하나하나가 따로 생각합니다. 사실상 여덟 명이 한 몸에 들어 있는 셈이에요.",
  "하품은 전염되는데, 친한 사람일수록 더 잘 옮습니다. 옆자리가 하품했는데 안 옮았다면… 생각해볼 문제입니다.",
  "깨어 있는 동안 눈을 깜빡이느라 감고 있는 시간이 하루 중 약 10%입니다. 그 사이를 뇌가 몰래 이어붙여서 우리는 끊긴 걸 눈치도 못 채요.",
  "뇌는 몸무게의 2%인데 에너지의 20%를 씁니다. 공부하고 배고픈 건 핑계가 아니라 명세서예요.",
  "사람의 코는 1조 가지 냄새를 구분할 수 있다는 연구가 있습니다. 그런데 냉장고 안 그 냄새의 정체는 아직도 모르죠.",
  "소름이 돋는 건 털을 세워 몸집을 커 보이게 하던 흔적입니다. 털이 거의 없어진 지금은 그냥 닭살만 남았어요.",
  "손가락이 물에 불어 쭈글해지는 건 불어서가 아니라, 신경이 일부러 주름을 만드는 겁니다. 젖은 걸 잘 잡으라고요. 타이어 트레드랑 같은 원리예요.",
  "사람은 자기 목소리를 녹음으로 들으면 어색해합니다. 평소엔 뼈를 통해 낮게 울리는 소리를 같이 듣거든요. 녹음 속 그 목소리가 남들이 듣는 진짜입니다.",
  "왼쪽 폐가 오른쪽보다 작습니다. 심장한테 자리를 내줘서요.",
  "북극곰의 털은 흰색이 아니라 속이 빈 투명한 털입니다. 게다가 피부는 검정이에요. 흰 곰이 아니라 검은 곰이 투명 옷을 입은 겁니다.",
  "해달은 잠잘 때 떠내려가지 않으려고 서로 손을 잡습니다. 혼자면 미역을 몸에 감고 잡니다.",
  "고양이는 사람한테만 야옹거립니다. 다 큰 고양이끼리는 거의 안 써요. 우리한테 쓰는 전용 언어인 셈입니다.",
  "플라밍고가 분홍인 건 먹이 때문입니다. 새우와 조류의 색소가 쌓인 거예요. 다른 걸 먹이면 하얘집니다.",
  "돌고래는 서로를 부르는 고유한 휘파람 소리가 있습니다. 사실상 이름이에요.",
  "개미는 잠을 하루에 수백 번 나눠서 아주 짧게 잡니다. 여왕개미는 한 번에 9분쯤 자는데, 그게 개미 세계 최고의 호사예요.",
  "펭귄은 마음에 드는 상대에게 예쁜 조약돌을 선물합니다. 좋은 돌을 두고 싸움도 납니다.",
  "쥐는 간지럼을 타면 초음파로 웃습니다. 사람 귀엔 안 들려서 전용 장비로 들어야 해요.",
  "바닷가재는 늙어서 죽지 않습니다. 대부분 껍질 벗다 지쳐서 죽어요.",
  "코알라의 지문은 사람 지문과 너무 비슷해서 범죄 현장에서 헷갈릴 수 있다는 얘기가 있습니다.",
  "꿀은 상하지 않습니다. 3000년 된 이집트 무덤의 꿀도 먹을 수 있었다고 해요. 유통기한이 파라오보다 깁니다.",
  "바나나는 나무가 아니라 풀에서 열립니다. 세상에서 제일 큰 풀이에요. 그리고 딸기는 열매가 아닙니다.",
  "전자레인지는 레이더 연구하던 사람 주머니에서 초콜릿이 녹으면서 발명됐습니다. 세상에서 제일 맛있는 실수예요.",
  "당근이 주황색인 건 원래 그래서가 아닙니다. 옛날엔 보라색이 흔했고, 지금의 주황은 품종 개량의 결과예요.",
  "매운맛은 맛이 아니라 통증입니다. 혀가 '뜨겁다'고 착각하는 거라, 미각이 아니라 통각으로 분류돼요.",
  "아이스크림 먹고 머리가 띵한 건 입천장 혈관이 갑자기 수축했다 풀리면서 뇌가 착각하는 겁니다. 정식 명칭도 있어요.",
  "탄산음료의 톡 쏘는 느낌은 거품이 아니라 산 때문입니다. 탄산이 혀에서 약한 산으로 바뀌면서 나는 거예요.",
  "에펠탑은 여름에 최대 15cm 더 큽니다. 철이 더위에 늘어나서요. 탑도 여름엔 늘어집니다.",
  "종이는 아무리 얇아도 7~8번 넘게 반으로 접기 어렵습니다. 42번 접으면 달에 닿는데, 아무도 성공 못 했어요.",
  "지구에서 달까지 거리에 태양계 행성을 전부 한 줄로 세워 넣을 수 있습니다. 달이 생각보다 멉니다.",
  "번개는 같은 자리에 두 번 안 친다는 말은 완전히 틀렸습니다. 엠파이어 스테이트 빌딩은 한 해에 수십 번 맞아요.",
  "우주는 냄새가 있다고 합니다. 우주 유영을 마치고 온 우주인들이 탄 스테이크나 용접 냄새 같다고 말했어요.",
  "지구에서 가장 흔한 악기는 사람 목소리고, 두 번째는 하모니카라는 얘기가 있습니다. 작고 싸거든요.",
  "QWERTY 자판 배열은 빨리 치라고 만든 게 아니라, 옛날 타자기 활자가 엉키지 않게 일부러 흩어놓은 겁니다. 우리는 아직도 고장 난 기계에 맞춰 타이핑하고 있어요.",
  "'jiffy'는 농담이 아니라 실제 시간 단위입니다. 물리학에서 빛이 1cm 가는 시간이에요. 잠깐만요, 가 진짜 잠깐이네요.",
  "0.1 + 0.2 는 0.3이 아닙니다. 파이썬에서 직접 쳐보세요. 컴퓨터가 2진수로 소수를 저장하면서 생기는 오차라, 거의 모든 언어에서 똑같이 배신합니다.",
  "파이썬 이름은 뱀이 아니라 영국 코미디쇼 '몬티 파이썬'에서 왔습니다. 공식 문서에도 개그가 섞여 있는 이유예요.",
  "'디버깅'을 유명하게 만든 건 진짜 벌레입니다. 1947년 하버드 컴퓨터 안에서 나방이 나왔고, 연구진이 그걸 일지에 테이프로 붙여놨어요. 그 일지는 아직도 박물관에 있습니다.",
  "SQL의 NULL은 0도 빈 문자열도 아닙니다. 심지어 NULL = NULL 도 참이 아니에요. 없는 것끼리는 같은지조차 모른다는 뜻입니다. 철학 같죠.",
  "SQL의 원래 이름은 SEQUEL이었는데 상표가 겹쳐서 줄였습니다. 그래서 지금도 '에스큐엘'파와 '시퀄'파가 싸웁니다.",
  "'컴퓨터 과학에서 어려운 건 딱 둘, 캐시 무효화와 이름 짓기.' 변수 이름 짓다 30분 날린 게 당신만의 일이 아니라는 공식 인증입니다.",
  "배열을 0부터 세는 건 실수가 아닙니다. 인덱스는 '시작점에서 얼마나 떨어져 있나'라서, 첫 칸은 0만큼 떨어져 있는 거예요. 억울해도 어쩔 수 없습니다.",
  "SUM 이나 AVG 는 NULL을 아예 빼고 계산합니다. 평균이 이상하게 높게 나오면 대부분 여기가 범인이에요.",
  "COUNT(*) 와 COUNT(컬럼) 은 다른 숫자를 냅니다. 앞은 행을 세고, 뒤는 그 칸이 비지 않은 행만 셉니다. 면접 단골 문제예요.",
  "한글 한 글자는 UTF-8에서 3바이트, 영어는 1바이트입니다. 같은 글자 수여도 한글 파일이 세 배 무거워요. 세종대왕도 이건 예상 못 하셨을 겁니다.",
  "1KB가 1000이 아니라 1024인 건 2의 10제곱이기 때문입니다. 컴퓨터는 손가락이 2개거든요.",
  "인덱스를 걸면 조회는 빨라지고 입력은 느려집니다. 책 뒤 색인이랑 똑같아요. 찾기는 편한데, 내용 바뀔 때마다 색인도 다시 만들어야 하죠.",
  "가만히 앉아 있는 사람 한 명이 100W 히터입니다. 36명이면 전기난로 두 대. 사람이 다 차면 방이 진짜로 더워지는 게 기분 탓이 아니에요.",
  "졸음의 진범은 온도가 아니라 이산화탄소입니다. 사람 꽉 찬 방은 한 시간이면 CO₂가 1500ppm을 넘고 거기서부터 머리가 안 돌아가요. 쉬는 시간에 문 여는 게 에어컨보다 셉니다.",
  "'18도로 확 낮추면 빨리 시원해진다'는 완전한 착각입니다. 에어컨 힘은 설정 온도와 무관하게 일정해서, 도달 속도는 똑같고 전기만 더 씁니다. 지금까지 헛수고하신 거예요.",
  "여성이 남성보다 평균 2~3도 높은 실내온도를 선호합니다. 사무실 온도 기준이 1960년대 성인 남성 기준으로 만들어졌기 때문이라는 연구가 네이처에 실렸어요. 60년째 누군가는 춥습니다.",
  "ASHRAE 기준으로 '전원 만족'은 애초에 목표가 아닙니다. 80% 만족이 최선이고 20%는 항상 불만인 게 정상이에요. 이 앱이 존재하는 이유이기도 합니다.",
  "선풍기를 같이 돌리면 체감이 2도 내려갑니다. 에어컨 2도 올리고 선풍기 켜는 게 전기요금엔 훨씬 착해요.",
  "손발이 찬 사람은 진짜로 같은 방에서 더 춥게 느낍니다. 말단 혈류 차이로 체감이 최대 3도까지 벌어져요. 엄살 아닙니다.",
  "에어컨 바람이 직접 닿으면 실제보다 2~3도 낮게 느껴집니다. 온도를 올리기 전에 풍향부터 돌려보세요.",
  "밥 먹고 나면 소화에 피가 쏠려 체온 조절이 잠깐 헐거워집니다. 점심 직후 유난히 춥고 졸린 게 과학적으로 변명 가능합니다.",
  "습도가 10% 오르면 체감이 0.5도 올라갑니다. 장마철 26도가 유난히 찐득한 이유예요.",
  "20% 절사평균은 올림픽 체조 점수에서 최고·최저를 빼는 거랑 똑같은 원리입니다. 장난표 하나가 전체를 끌고 가지 못하게요.",
  "에어컨 필터가 막히면 냉방 효율이 15%까지 떨어집니다. 아무리 낮춰도 안 시원하면 온도 탓이 아니라 먼지 탓일 수 있어요.",
  "배운 걸 그냥 두면 하루 만에 절반 넘게 날아갑니다. 에빙하우스가 100년 전에 증명했는데 우리는 아직도 벼락치기를 합니다.",
  "남에게 설명해보면 이해도가 확 올라갑니다. 파인만이 쓰던 방법이에요. 옆자리를 붙잡고 설명하다 보면 내가 뭘 모르는지가 먼저 튀어나옵니다.",
  "낮잠은 20분 넘기면 오히려 더 피곤합니다. 깊은 잠에 들어간 뒤 깨면 좀비가 돼요.",
  "카페인은 절반 빠지는 데만 5~6시간 걸립니다. 오후 3시 커피가 밤 9시에도 반이나 남아 있다는 뜻이에요. 잠이 안 오는 게 당연합니다.",
  "눈이 뻑뻑하면 20-20-20 — 20분마다, 20피트(6m) 떨어진 곳을, 20초간. 창문 없으면 제일 먼 벽이라도요.",
  "앉아 있을 때가 서 있을 때보다 허리에 가해지는 압력이 큽니다. 쉬는 시간에 일어나는 게 생각보다 중요해요.",
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
