/**
 * 통계 — 이 파일에 담긴 게 "타점을 어디에 찍을지"의 전부입니다.
 *
 * 핵심은 trimmedMean 하나예요. 왜 절사평균이냐면:
 *   · 평균   → 33명 중 한 명이 장난으로 18도를 찍으면 전체가 0.2도 끌려갑니다.
 *   · 최빈값 → 33명 표본에서 너무 불안정해서 0.5도 칸 하나 차이로 튑니다.
 *   · 중앙값 → 극단값엔 완전히 면역이지만, 17번째 사람의 값을 그대로 쓰기 때문에
 *              계단식으로 점프합니다. "부드럽게 움직이는 타점"이 안 나와요.
 *   · 절사평균 → 양 끝을 버려서 극단값에 면역이면서, 가운데 표가 움직이면
 *                타점도 연속적으로 따라 움직입니다.
 *
 * 수학적으로는 Σ|희망 − 설정| 을 최소화하면 중앙값, Σ(희망 − 설정)² 를
 * 최소화하면 평균이 나옵니다. 절사평균은 정확히 그 둘 사이예요.
 */

export const TRIM = 0.2; // 양쪽 20%씩 (33명이면 위아래 6명씩 빼고 가운데 21명)

const asc = (xs) => xs.slice().sort((a, b) => a - b);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const toHalf = (v) => Math.round(v * 2) / 2;
export const r1 = (v) => Math.round(v * 10) / 10;

/**
 * 화면에 찍을 한 자리 소수. Postgres 의 numeric 이 문자열("26.0")로 넘어오는
 * 경로가 있어서 먼저 숫자로 바꿉니다. 숫자가 아니면 "—".
 */
export const fmt = (v) => {
  if (v === null || v === undefined || v === "") return "—"; // Number(null) 은 0 이라 먼저 걸러냅니다
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "—";
};

export function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 선형 보간 분위수. q=0.5 면 중앙값. */
export function quantile(xs, q) {
  const a = asc(xs);
  if (!a.length) return NaN;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export const median = (xs) => quantile(xs, 0.5);

/** 양 끝 frac 씩 버리고 가운데만 평균. 전부 잘려나가면 그냥 전체 평균. */
export function trimmedMean(xs, frac = TRIM) {
  const a = asc(xs);
  if (!a.length) return NaN;
  const cut = Math.floor(a.length * frac);
  const core = a.slice(cut, a.length - cut);
  return mean(core.length ? core : a);
}

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * 밀도 곡선(KDE)의 띠 너비. Silverman 경험식을 쓰되,
 * 0.5도 단위 투표라 너무 뾰족하거나 너무 뭉개지지 않게 위아래를 막았습니다.
 */
export function bandwidth(xs) {
  if (xs.length < 2) return 0.6;
  const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
  const sd = stdev(xs);
  const a = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
  return clamp(1.06 * a * Math.pow(xs.length, -0.2), 0.42, 1.15);
}

/** 가우시안 KDE. grid 위의 각 점에서의 밀도를 돌려줍니다. */
export function kde(xs, grid, bw) {
  const norm = xs.length * bw * Math.sqrt(2 * Math.PI);
  return grid.map((g) => {
    if (!xs.length) return 0;
    let s = 0;
    for (const x of xs) {
      const z = (g - x) / bw;
      s += Math.exp(-0.5 * z * z);
    }
    return s / norm;
  });
}

/** 밀도 곡선의 봉우리들을 높은 순으로. 의견이 갈렸는지 볼 때 씁니다. */
export function findPeaks(grid, dens) {
  const out = [];
  for (let i = 1; i < dens.length - 1; i++) {
    if (dens[i] > dens[i - 1] && dens[i] >= dens[i + 1]) out.push({ x: grid[i], y: dens[i] });
  }
  return out.sort((a, b) => b.y - a.y);
}

/**
 * 봉우리가 둘로 갈렸는지 판정.
 * 1.5도 넘게 떨어져 있고, 작은 쪽이 큰 쪽의 55% 이상일 때만 "갈렸다"고 봅니다.
 * 이게 뜨면 보통 온도가 아니라 자리 문제예요.
 */
export function detectSplit(peaks) {
  if (peaks.length < 2) return null;
  const [a, b] = peaks;
  if (Math.abs(a.x - b.x) < 1.5) return null;
  if (b.y < a.y * 0.55) return null;
  return { lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) };
}

/**
 * 표 뭉치 하나를 받아 화면에 필요한 숫자를 전부 계산합니다.
 * band 는 { lo, hi, def } 형태의 계절 밴드.
 */
export function summarise(votes, band) {
  const xs = votes.map((v) => v.t).filter(Number.isFinite);
  const n = xs.length;

  if (!n) {
    return {
      n: 0, xs: [], votes: [],
      raw: band.def, setpoint: band.def, median: band.def,
      p25: band.def, p75: band.def, iqr: 0,
      unhappy: 0, inBand: 0, peaks: [], split: null, clamped: false,
    };
  }

  const raw = trimmedMean(xs);
  const clamped = raw < band.lo - 1e-9 || raw > band.hi + 1e-9;
  const setpoint = toHalf(clamp(raw, band.lo, band.hi));

  const grid = [];
  for (let t = band.min; t <= band.max + 1e-9; t += 0.1) grid.push(r1(t));
  const peaks = n >= 3 ? findPeaks(grid, kde(xs, grid, bandwidth(xs))) : [];

  const p25 = quantile(xs, 0.25);
  const p75 = quantile(xs, 0.75);

  return {
    n, xs, votes,
    raw, setpoint, clamped,
    median: median(xs),
    p25, p75, iqr: p75 - p25,
    unhappy: xs.filter((x) => Math.abs(x - setpoint) > 1.5).length,
    inBand: xs.filter((x) => Math.abs(x - setpoint) <= 1.0).length,
    peaks,
    split: detectSplit(peaks),
  };
}
