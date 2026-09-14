/**
 * 자유게시판 — 말풍선 목록.
 *
 * 링크를 붙여넣으면 바로 눌러서 들어갈 수 있게 자동으로 링크가 됩니다.
 * 다만 글은 다른 사람이 쓴 "남의 입력"이라, HTML 로 먼저 이스케이프한 다음
 * http/https 로 시작하는 것만 <a> 로 바꿉니다. javascript: 같은 건 아예 안 걸려요.
 */

import { creatureSVG } from "./creature.js";

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

export function hasLink(raw) {
  URL_RE.lastIndex = 0;
  return URL_RE.test(raw);
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

const KIND = {
  chat: { tag: "", cls: "" },
  req:  { tag: "🙋 요청", cls: "req" },
  info: { tag: "🔗 정보", cls: "info" },
};

export const MAX_PIN = 5;

/**
 * 피드 HTML 을 만듭니다.
 * @param {object[]} posts posts_public 행들
 * @param {string}   uid   내 uid (내 글에만 삭제 버튼)
 */
export function feedHTML(posts, uid) {
  if (!posts.length) {
    return `<p class="empty">아직 글이 없어요. 첫 말풍선을 띄워보세요 💬<br>
      <span class="dim">링크를 붙여넣으면 자동으로 눌러서 들어갈 수 있게 됩니다.</span></p>`;
  }

  const sorted = posts.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });

  return sorted
    .map((p) => {
      const cfg = { cc: p.cc, ce: p.ce, ch: p.ch, cp: p.cp, ci: p.ci };
      const mine = p.author === uid;
      const kind = KIND[p.kind] ?? KIND.chat;
      const likes = Number(p.likes) || 0;

      return (
        `<article class="post">` +
          `<div class="who">${creatureSVG(cfg, "happy")}<span>${esc(p.nick || "익명")}</span></div>` +
          `<div class="bubble ${p.pinned ? "pin" : ""} ${kind.cls}">` +
            (kind.tag ? `<span class="tag">${kind.tag}</span> ` : "") +
            (p.pinned ? `<span class="tag pinned">📌 고정</span> ` : "") +
            `<div class="txt">${linkify(p.body)}</div>` +
            `<div class="bmeta">` +
              `<span>${esc(timeAgo(p.created_at))}</span>` +
              `<button class="bact ${p.liked_by_me ? "on" : ""}" data-act="like" data-id="${esc(p.id)}" ` +
                `aria-pressed="${!!p.liked_by_me}">${p.liked_by_me ? "💛" : "🤍"} 나도${likes ? ` ${likes}` : ""}</button>` +
              `<button class="bact ${p.pinned ? "on" : ""}" data-act="pin" data-id="${esc(p.id)}" ` +
                `aria-pressed="${!!p.pinned}">📌 ${p.pinned ? "고정 해제" : "고정"}</button>` +
              (mine ? `<button class="bact me" data-act="del" data-id="${esc(p.id)}">삭제</button>` : "") +
            `</div>` +
          `</div>` +
        `</article>`
      );
    })
    .join("");
}
