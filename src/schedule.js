/**
 * 하루 시간표.
 *
 *   수업   매시 00분 ~ 50분
 *   쉬는   매시 50분 ~ 다음 정각 (10분)
 *   점심   11:50 ~ 13:00
 *   끝     17:50 — 마지막 교시가 끝나면 퇴실
 *
 * 교시가 정각에 시작하니 기존 "정각 리듬"(체크포인트 · 강의 피드백 초기화)이
 * 그대로 교시 경계와 맞아떨어집니다. 따로 맞출 게 없어요.
 */

export const DAY_START = 9;    // 1교시 시작 시각
export const DAY_END = 17;     // 마지막 교시가 시작하는 시각 (17:50 종료)
export const CLASS_MIN = 50;   // 매시 50분에 수업 끝
export const LUNCH_FROM = 11;  // 11:50 부터
export const LUNCH_TO = 13;    // 13:00 까지

/** 교시가 들어 있는 시각들. 12시는 점심이라 빠져 있습니다. */
export const PERIOD_HOURS = [9, 10, 11, 13, 14, 15, 16, 17];
export const PERIODS = PERIOD_HOURS.length;

/** 9시 → 1교시. 교시가 아닌 시각이면 null. */
export const periodOf = (h) => {
  const i = PERIOD_HOURS.indexOf(h);
  return i < 0 ? null : i + 1;
};

/** "23분 뒤 점심". 1분 안쪽이면 초 세는 대신 "곧"으로 뭉갭니다. */
const until = (ms, what) => (ms < 60000 ? `곧 ${what}` : `${Math.ceil(ms / 60000)}분 뒤 ${what}`);

const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * 지금이 수업인지 쉬는 시간인지 점심인지.
 *
 * phase: off | before | class | break | lunch | done
 *   label  헤더 칩에 들어갈 짧은 말
 *   note   온도 탭 띠에 들어갈 한 줄
 *   left   다음 상태까지 남은 밀리초 (없으면 null)
 */
export function scheduleNow(now = Date.now()) {
  const d = new Date(now);
  const at = (hh, mm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const day = d.getDay();

  if (day === 0 || day === 6)
    return { phase: "off", icon: "🛋", label: "수업 없음", short: null, note: "오늘은 수업이 없는 날이에요.", left: null, endsAt: null, period: null };

  const dayStart = at(DAY_START, 0);
  const dayEnd = at(DAY_END, CLASS_MIN);

  if (now < dayStart)
    return { phase: "before", icon: "🌅", label: "수업 전", short: `${hhmm(dayStart)} 에 1교시`,
             note: `첫 교시는 ${hhmm(dayStart)} 에 시작해요.`, left: dayStart - now, endsAt: dayStart, period: null };

  if (now >= dayEnd)
    return { phase: "done", icon: "🏠", label: "퇴실", short: null, note: "오늘 수업 끝 — 퇴실하고 들어가세요.", left: null, endsAt: null, period: null };

  const lunchFrom = at(LUNCH_FROM, CLASS_MIN), lunchTo = at(LUNCH_TO, 0);
  if (now >= lunchFrom && now < lunchTo) {
    const next = periodOf(LUNCH_TO);
    return { phase: "lunch", icon: "🍚", label: "점심", left: lunchTo - now, endsAt: lunchTo, period: null,
             short: until(lunchTo - now, `${next}교시`),
             note: `점심시간 · ${hhmm(lunchTo)} 에 ${next}교시가 시작해요.` };
  }

  const h = d.getHours(), m = d.getMinutes();
  if (m < CLASS_MIN) {
    const ends = at(h, CLASS_MIN), period = periodOf(h);
    // 마지막 교시 뒤에는 쉬는 시간이 아니라 퇴실이고, 11교시 뒤는 점심입니다
    const after = h === DAY_END ? "퇴실" : h === LUNCH_FROM ? "점심" : "쉬는 시간";
    return { phase: "class", icon: "📘", label: period ? `${period}교시` : "수업", left: ends - now, endsAt: ends, period,
             short: until(ends - now, after),
             note: `${period ? `${period}교시` : "수업 중"} · ${mins(ends - now)}분 뒤 ${after} (${hhmm(ends)})` };
  }

  const ends = at(h + 1, 0), next = periodOf(h + 1);
  const nextName = next ? `${next}교시` : "다음 교시";
  return { phase: "break", icon: "☕", label: "쉬는 시간", left: ends - now, endsAt: ends, period: null,
           short: until(ends - now, nextName),
           note: `쉬는 시간 · ${mins(ends - now)}분 뒤 ${nextName} (${hhmm(ends)})` };
}
