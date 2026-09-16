/**
 * 자리 구역 여섯 칸.
 *
 * 실제 자리표 그대로 왼쪽 블록(3열)과 오른쪽 블록(2열)을 앞·중·뒤로 나눈 것입니다.
 * 한 칸에 5~6명이 들어가니 누가 누군지는 안 보이고 "왼쪽 뒤가 춥다"만 남아요.
 * 정확한 책상을 찍게 하면 자리표에 이름이 적혀 있어서 바로 들킵니다.
 *
 * 자리를 묻는 이유는 하나뿐입니다 — 온도 하나로는 36명을 절대 못 맞추니까,
 * 남는 차이를 **어느 쪽에 바람을 더/덜 보낼지**로 메우려고요.
 */

export const ZONES = [
  { i: 0, name: "왼쪽 · 앞",     short: "왼·앞" },
  { i: 1, name: "왼쪽 · 가운데", short: "왼·중" },
  { i: 2, name: "왼쪽 · 뒤",     short: "왼·뒤" },
  { i: 3, name: "오른쪽 · 앞",     short: "오·앞" },
  { i: 4, name: "오른쪽 · 가운데", short: "오·중" },
  { i: 5, name: "오른쪽 · 뒤",     short: "오·뒤" },
];

/** 이보다 적게 모인 구역은 평균을 안 보여줍니다. 역추적이 되니까요. */
export const ZONE_MIN = 4;

export const zoneName = (i) => ZONES[i]?.name ?? "";

/**
 * 닉네임에서 색을 뽑습니다. 캐릭터를 없앴으니 사람 구분은 이 점 하나로 합니다.
 * 같은 닉네임이면 항상 같은 색이 나와야 해서 해시를 씁니다.
 */
const DOT = ["#e8734f", "#3f9e6a", "#4a7fc1", "#c9683f", "#7b5ea8", "#c05d86", "#2f8f8f", "#a08236"];
export function nickColor(nick) {
  let h = 0;
  for (let i = 0; i < String(nick).length; i++) h = (h * 31 + String(nick).charCodeAt(i)) >>> 0;
  return DOT[h % DOT.length];
}

/** 닉네임 앞 한 글자 — 아바타 대용. */
export const nickInitial = (nick) => (String(nick || "익").trim()[0] ?? "익");
