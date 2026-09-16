/**
 * 자유게시판 + 익명 질문함 — 말풍선 목록.
 *
 * 게시판과 질문함은 같은 테이블을 씁니다. kind 로만 갈라요.
 *   💬 잡담 · 🙋 요청 · 🔗 정보 · ❓ 질문
 * 질문만 "답변 완료" 도장을 찍을 수 있고, 안 찍힌 질문은 위로 올라옵니다.
 *
 * 링크를 붙여넣으면 바로 눌러 들어갈 수 있게 자동으로 링크가 됩니다.
 * 다만 글은 다른 사람이 쓴 "남의 입력"이라, HTML 로 먼저 이스케이프한 다음
 * http/https 로 시작하는 것만 <a> 로 바꿉니다. javascript: 같은 건 아예 안 걸려요.
 */

import { nickColor, nickInitial } from "./zones.js";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

/** 주소를 짧게. 도메인 + 경로 앞부분만 보여줍니다. */
function prettyUrl(raw) {
  try {
    const u = new URL(raw);
    const tail = (u.pathname + u.search).replace(/\/$/, "");
    const short = tail.length > 22 ? tail.slice(0, 21) + "…" : tail;
    return u.host.replace(/^www\./, "") + short;
  } catch {
    return raw.length > 40 ? raw.slice(0, 39) + "…" : raw;
  }
}

/** 이스케이프 먼저, 링크는 그 다음. 순서가 바뀌면 구멍이 납니다. */
export function linkify(raw) {
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;

  while ((m = URL_RE.exec(raw)) !== null) {
    out.push(esc(raw.slice(last, m.index)));

    // 문장 끝의 마침표·괄호까지 주소로 먹지 않게 떼어냅니다.
    const trimmed = m[0].replace(/[.,!?)\]}>]+$/, "");
    const tail = m[0].slice(trimmed.length);

    out.push(
      `<a href="${esc(trimmed)}" target="_blank" rel="noopener noreferrer nofollow">` +
        `🔗 ${esc(prettyUrl(trimmed))}</a>`
    );
    if (tail) out.push(esc(tail));
    last = m.index + m[0].length;
  }
  out.push(esc(raw.slice(last)));
  return out.join("");
}

function timeAgo(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export const KINDS = [
  { key: "all", label: "전체" },
  { key: "q", label: "❓ 질문", tag: "❓ 질문", cls: "q" },
  { key: "req", label: "🙋 요청", tag: "🙋 요청", cls: "req" },
  { key: "info", label: "🔗 정보", tag: "🔗 정보", cls: "info" },
  { key: "chat", label: "💬 잡담", tag: "", cls: "" },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

export const MAX_PIN = 5;

/** 아직 답변 안 된 질문 수 — 상단 배지에 씁니다. */
export const openQuestions = (posts) => posts.filter((p) => p.kind === "q" && !p.answered).length;

/**
 * 피드 HTML.
 * @param {object[]} posts  posts_public 행들
 * @param {string}   uid    내 uid (내 글에만 삭제 버튼)
 * @param {string}   filter "all" | "q" | "req" | "info" | "chat"
 */
export function feedHTML(posts, uid, filter = "all", admin = false) {
  const list = filter === "all" ? posts : posts.filter((p) => p.kind === filter);

  if (!list.length) {
    const msg =
      filter === "q"
        ? "아직 질문이 없어요. 손 들기 어려운 질문일수록 여기가 편합니다 ❓"
        : filter === "all"
          ? "아직 글이 없어요. 첫 말풍선을 띄워보세요 💬"
          : "이 갈래엔 아직 글이 없어요.";
    return `<p class="empty">${msg}<br>
      <span class="dim">링크를 붙여넣으면 자동으로 눌러 들어갈 수 있게 됩니다.</span></p>`;
  }

  // 고정 → 답변 안 된 질문 → 최신순
  const sorted = list.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const aOpen = a.kind === "q" && !a.answered;
    const bOpen = b.kind === "q" && !b.answered;
    if (aOpen !== bOpen) return bOpen ? 1 : -1;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });

  return sorted
    .map((p) => {
      const mine = p.author === uid;
      const kind = KIND[p.kind] ?? KIND.chat;
      const likes = Number(p.likes) || 0;
      const isQ = p.kind === "q";

      return (
        `<article class="post">` +
          `<div class="who"><i class="dot" style="background:${nickColor(p.nick)}">${esc(nickInitial(p.nick))}</i>` +
          `<span>${esc(p.nick || "익명")}</span></div>` +
          `<div class="bubble ${p.pinned ? "pin" : ""} ${kind.cls} ${isQ && p.answered ? "done" : ""}${p.hidden ? " hid" : ""}">` +
            (kind.tag ? `<span class="tag">${kind.tag}</span> ` : "") +
            (p.pinned ? `<span class="tag pinned">📌 고정</span> ` : "") +
            (isQ && p.answered ? `<span class="tag done">✅ 답변 완료</span> ` : "") +
            // 신고가 쌓인 글은 접어둡니다. 눌러야 펴지니 지나가다 안 보게 돼요.
            (p.hidden
              ? `<details class="hidwrap"><summary>🚨 신고 ${p.reports}건 — 눌러야 보입니다</summary>` +
                `<div class="txt">${linkify(p.body)}</div></details>`
              : `<div class="txt">${linkify(p.body)}</div>`) +
            `<div class="bmeta">` +
              `<span>${esc(timeAgo(p.created_at))}</span>` +
              `<button class="bact ${p.liked_by_me ? "on" : ""}" data-act="like" data-id="${esc(p.id)}" ` +
                `aria-pressed="${!!p.liked_by_me}">${p.liked_by_me ? "💛" : "🤍"} ` +
                `${isQ ? "나도 궁금" : "나도"}${likes ? ` ${likes}` : ""}</button>` +
              (isQ
                ? `<button class="bact ${p.answered ? "on" : ""}" data-act="ans" data-id="${esc(p.id)}" ` +
                  `aria-pressed="${!!p.answered}">✅ ${p.answered ? "답변 취소" : "답변 완료"}</button>`
                : "") +
              `<button class="bact ${p.pinned ? "on" : ""}" data-act="pin" data-id="${esc(p.id)}" ` +
                `aria-pressed="${!!p.pinned}">📌 ${p.pinned ? "고정 해제" : "고정"}</button>` +
              (mine
                ? `<span class="bact me dim">내 글</span>`
                : `<button class="bact ${p.reported_by_me ? "on" : ""}" data-act="rep" data-id="${esc(p.id)}" ` +
                  `aria-pressed="${!!p.reported_by_me}">🚨 ${p.reported_by_me ? "신고함" : "신고"}` +
                  `${p.reports ? ` ${p.reports}` : ""}</button>`) +
              (admin ? `<button class="bact danger" data-act="del" data-id="${esc(p.id)}">🛡 삭제</button>` : "") +
            `</div>` +
          `</div>` +
        `</article>`
      );
    })
    .join("");
}
