/**
 * 조 뽑기 · 발표 룰렛
 *
 * 뽑는 대상은 "최근 7일 안에 표를 낸 사람"입니다. 닉네임만 쓰고
 * 실명은 어디에도 안 나와요.
 *
 * 결과는 반드시 서버에 저장해서 모두가 같은 화면을 봐야 합니다.
 * 각자 브라우저에서 돌리면 36명이 36가지 결과를 보게 되니까요.
 */

/** Fisher–Yates. Math.random 이면 교실 제비뽑기엔 충분합니다. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * n개 조로 나눕니다. 딱 안 떨어지면 앞 조부터 한 명씩 더 갑니다
 * (36명 6조면 6명씩, 34명 6조면 6·6·6·6·5·5).
 */
export function makeGroups(members, n) {
  const pool = shuffle(members);
  const groups = Array.from({ length: Math.max(1, n) }, () => []);
  pool.forEach((m, i) => groups[i % groups.length].push(m));
  return groups;
}

/**
 * 한 명 뽑기. 이미 뽑힌 사람은 빼고 고르고,
 * 다 돌면 알아서 한 바퀴 새로 시작합니다.
 */
export function pickOne(members, history = []) {
  const keys = members.map((m) => m.key);
  const done = history.filter((k) => keys.includes(k));
  let pool = members.filter((m) => !done.includes(m.key));

  let wrapped = false;
  if (!pool.length) {
    pool = members;
    wrapped = true;
  }
  if (!pool.length) return null;

  const picked = pool[Math.floor(Math.random() * pool.length)];
  return {
    picked,
    history: wrapped ? [picked.key] : [...done, picked.key],
    wrapped,
    left: pool.length - 1,
  };
}

/**
 * 투표 행을 뽑기 대상으로 바꿉니다.
 * 닉네임이 겹칠 수 있어서 캐릭터 조합까지 key 에 넣습니다.
 */
export function toMembers(votes) {
  return votes
    .filter((v) => Number.isFinite(Number(v.t)))
    .map((v, i) => ({ key: `${v.nick || "익명"}#${i}`, nick: v.nick || "익명" }));
}
