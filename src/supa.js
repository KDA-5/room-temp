/**
 * 데이터 계층 — Supabase 로 나가는 길은 전부 여기를 지나갑니다.
 *
 * 로그인은 "익명 로그인"입니다. 이메일도 비밀번호도 안 받고,
 * 브라우저마다 계정 하나가 조용히 생겨요. 덕분에
 *   · 이름·이메일 같은 개인정보가 애초에 DB 에 없고
 *   · 그러면서도 서버가 "이 표는 이 사람 것"을 확인할 수 있어서
 *     남의 표를 덮어쓰거나 남의 글을 지우는 게 막힙니다.
 *
 * 실시간 갱신은 브로드캐스트 + 주기적 재조회로 굴립니다.
 * votes 테이블은 RLS 로 본인 행만 보이게 잠겨 있어서
 * postgres_changes 로는 남의 변경이 안 오거든요. 그래서
 * 글을 쓴 쪽이 "바뀌었다"고 한마디 외치고, 모두가 다시 읽어옵니다.
 */

import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL && KEY && !URL.includes("xxxxx"));

export const supabase = configured
  ? createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 12 } },
    })
  : null;

let uid = null;
export const myUid = () => uid;

/** 익명 로그인. 이미 로그인돼 있으면 그대로 씁니다. */
export async function signIn() {
  if (!supabase) return null;

  const { data: got } = await supabase.auth.getSession();
  if (got?.session?.user) {
    uid = got.session.user.id;
    return uid;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // 익명 로그인이 대시보드에서 꺼져 있으면 여기로 떨어집니다.
    throw new Error(
      "익명 로그인에 실패했어요. Supabase 대시보드 → Authentication → " +
      "Sign In / Providers 에서 'Anonymous sign-ins' 를 켜주세요. " +
      `(원래 메시지: ${error.message})`
    );
  }
  uid = data.user?.id ?? null;
  return uid;
}

// ── 읽기 ────────────────────────────────────────────────────────────────
//
// 무료 요금제의 병목은 저장 공간이 아니라 **전송량**(월 5GB)입니다.
// 그래서 "무조건 전부 다시 읽기"를 하지 않습니다. 브로드캐스트가
// 무엇이 바뀌었는지 알려주고, 그 부분만 다시 읽어요.
//   투표 한 번 바뀜  → votes 만 (7KB)
//   글 하나 올라옴   → posts 만 (28KB)
//   정각 도장       → meta 만 (5KB)
// 전부 읽는 건 첫 접속 때와 15분에 한 번뿐입니다.

const FRESH_DAYS = 7;
const POST_LIMIT = 30;   // 게시판이 제일 무거운 조각이라 짧게 끊습니다

function throwIf(...results) {
  const bad = results.find((r) => r?.error)?.error;
  if (bad) throw bad;
}

/** 투표 + 내 행. 제일 자주 읽는 조각이라 제일 작게 유지합니다. */
export async function readVotes() {
  if (!supabase) return {};
  const since = new Date(Date.now() - FRESH_DAYS * 864e5).toISOString();
  const [votes, mine] = await Promise.all([
    supabase.from("votes_public").select("*").gte("updated_at", since),
    uid ? supabase.from("votes").select("*").eq("uid", uid).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  throwIf(votes);
  return { votes: votes.data ?? [], mine: mine?.data ?? null };
}

/** 게시판. 제일 무거운 조각이라 글이 올라왔을 때만 읽습니다. */
export async function readPosts() {
  if (!supabase) return {};
  const posts = await supabase
    .from("posts_public")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(POST_LIMIT);
  throwIf(posts);
  return { posts: posts.data ?? [] };
}

/** 설정 · 일별 기록 · 정각 기록. 거의 안 바뀝니다. */
export async function readMeta() {
  if (!supabase) return {};
  const sinceDay = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const sinceHour = new Date(Date.now() - 14 * 3600e3).toISOString();

  const [config, history, checkpoints] = await Promise.all([
    supabase.from("config").select("*").eq("id", 1).maybeSingle(),
    supabase.from("history").select("d,setpoint,n").gte("d", sinceDay).order("d", { ascending: true }),
    supabase.from("checkpoints").select("*").gte("hour_at", sinceHour).order("hour_at", { ascending: true }),
  ]);
  throwIf(history, checkpoints);
  return {
    config: config.data ?? null,
    history: history.data ?? [],
    checkpoints: checkpoints.data ?? [],
  };
}

/** 설정 한 줄. 0.5KB 도 안 되는데 쉬는 시간·환기가 여기 있어서 자주 봐야 합니다. */
export async function readConfig() {
  if (!supabase) return {};
  const config = await supabase.from("config").select("*").eq("id", 1).maybeSingle();
  return { config: config.data ?? null };
}

/**
 * 평상시 폴링용 — 투표 + 설정.
 * 쉬는 시간 타이머가 설정에 들어 있어서, 브로드캐스트를 놓친 사람도
 * 늦어도 3분 안엔 보게 됩니다. (meta 전체를 기다리면 30분이 걸려요.)
 */
export async function readLive() {
  if (!supabase) return {};
  const [v, c] = await Promise.all([readVotes(), readConfig()]);
  return { ...v, ...c };
}

/** 첫 접속용 — 셋을 한 번에. */
export async function readAll() {
  if (!supabase) return null;
  const [v, p, m] = await Promise.all([readVotes(), readPosts(), readMeta()]);
  return { ...v, ...p, ...m };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────

/** 내 표. uid 가 기본키라 upsert 한 방이면 끝납니다. */
export async function saveVote(patch) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = await supabase
    .from("votes")
    .upsert({ uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: "uid" });
  if (error) throw error;
  ping("votes");
}

/** 퇴실. 집에 간 사람 표가 남은 사람 에어컨을 정하면 안 되니까 아예 지웁니다. */
export async function clearVote() {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = await supabase.from("votes").delete().eq("uid", uid);
  if (error) throw error;
  ping("votes");
}

export async function saveConfig(patch) {
  if (!supabase) throw new Error("설정이 안 됐어요");
  const { error } = await supabase
    .from("config")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  ping("meta");
}

export async function saveHistory(row) {
  if (!supabase) return;
  const { error } = await supabase
    .from("history")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "d" });
  if (error) throw error;
}

export async function addPost(row) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = await supabase.from("posts").insert({ author: uid, ...row });
  if (error) throw error;
  ping("posts");
}

/** 신고 넣기/빼기. 같은 글은 한 번만 신고됩니다 (기본키가 막아줘요). */
export async function setReport(postId, on) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = on
    ? await supabase.from("post_reports").insert({ post_id: postId, uid })
    : await supabase.from("post_reports").delete().eq("post_id", postId).eq("uid", uid);
  if (error && error.code !== "23505") throw error;   // 이미 신고한 건 그냥 넘어갑니다
  ping("posts");
}

/** 열쇠말이 맞는지 서버에 물어봅니다. 열쇠말 자체는 돌아오지 않아요. */
export async function adminCheck(key) {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("admin_check", { p_key: key });
  if (error) throw error;
  return data === true;
}

/** 관리자 삭제. 열쇠말 검증이 서버에서 일어납니다. */
export async function adminDeletePost(key, id) {
  if (!supabase) throw new Error("설정이 안 됐어요");
  const { error } = await supabase.rpc("admin_delete_post", { p_key: key, p_id: id });
  if (error) throw error;
  ping("posts");
}

/** 잠긴 계정 목록. uid 는 무작위라 누구인지는 여기서도 알 수 없습니다. */
export async function adminBlocked(key) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_blocked", { p_key: key });
  if (error) throw error;
  return data ?? [];
}

export async function adminUnblock(key, targetUid) {
  if (!supabase) throw new Error("설정이 안 됐어요");
  const { error } = await supabase.rpc("admin_unblock", { p_key: key, p_uid: targetUid });
  if (error) throw error;
  ping("posts");
}

/** 내가 글쓰기 잠김 상태인지. 본인 행만 읽을 수 있습니다. */
export async function myStrikes() {
  if (!supabase || !uid) return null;
  const { data } = await supabase.from("strikes").select("reports,blocked").eq("uid", uid).maybeSingle();
  return data ?? null;
}

export async function deletePost(id) {
  if (!supabase) return;
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
  ping("posts");
}

export async function setLike(postId, on) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = on
    ? await supabase.from("post_likes").insert({ post_id: postId, uid })
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("uid", uid);
  // 이미 눌러놓고 또 누른 경우(중복키)는 오류가 아니라 그냥 같은 상태입니다.
  if (error && error.code !== "23505") throw error;
  ping("posts");
}

/** 질문 글의 "답변 완료" 토글. 서버에서 kind='q' 인지 확인합니다. */
export async function toggleAnswered(postId) {
  if (!supabase) return;
  const { error } = await supabase.rpc("toggle_answered", { p_id: postId });
  if (error) throw new Error(error.message);
  ping("posts");
}

export async function togglePin(postId) {
  if (!supabase) return;
  const { error } = await supabase.rpc("toggle_pin", { p_id: postId });
  if (error) throw new Error(error.message);
  ping("posts");
}

/**
 * 정각 도장 찍기. 이미 그 시간 행이 있으면 created=false 가 돌아옵니다.
 * 36명이 동시에 불러도 DB 가 한 번만 기록해요.
 */
export async function recordCheckpoint() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("record_checkpoint");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.created) ping("meta");
  return row ?? null;
}

// ── 실시간 ──────────────────────────────────────────────────────────────

let channel = null;
let onChange = () => {};
let onPeers = () => {};
let onYard = () => {};
let onReact = () => {};
let myState = null;   // 지금 내 위치·방·한마디. 없으면 세계에 안 나타납니다

/**
 * 지금 같이 보고 있는 사람 — 접속 수와 한마디를 실시간으로 주고받습니다.
 *
 * DB 에 저장하지 않습니다. presence(접속 상태)에만 얹어서 창을 닫으면
 * 사라져요. 저장되는 건 "어느 구역"뿐이고, 그것도 votes 테이블에
 * 구역 번호 하나로만 들어갑니다.
 */
export function setPresence(state) {
  myState = state;
  if (channel) channel.track({ at: Date.now(), me: myState }).catch(() => {});
}
export function watchPeople(handler) { onYard = handler; }

/** 리액션 — 지나가기만 하고 아무 데도 안 남습니다. */
export function sendReact(emoji, from) {
  if (!channel) return;
  channel.send({ type: "broadcast", event: "react", payload: { emoji, from } }).catch(() => {});
}
export function onReaction(handler) { onReact = handler; }

/** 지금 같은 페이지를 보고 있는 사람 수. 브로드캐스트 채널에 얹어 가는 거라
 *  전송량은 사실상 안 씁니다. */
export function watchPeers(handler) {
  onPeers = handler;
}

/**
 * 뭔가 바꿨다고 다른 사람들에게 알립니다.
 * scope 를 실어 보내서, 받는 쪽이 바뀐 조각만 다시 읽게 합니다.
 * 브로드캐스트 자체는 몇십 바이트라 전송량에 잡히지 않아요.
 */
function ping(scope) {
  if (!channel) return;
  channel.send({ type: "broadcast", event: "changed", payload: { scope } }).catch(() => {});
}

const POLL_MS  = 180000;   // 평상시 폴링: 3분. 투표 조각만 읽습니다
const FULL_MS  = 1800000;  // 전체 재동기화: 30분에 한 번
const COALESCE_MS = 1500;  // 동시에 여러 명이 바꿔도 한 번만 다시 읽기

/**
 * 실시간 구독 시작.
 * 즉시 반응은 브로드캐스트가, 놓친 것 줍기는 폴링이 담당합니다.
 * 탭이 뒤로 가 있으면 아무것도 안 하고, 돌아오면 한 번 당깁니다.
 */
export function subscribe(handler) {
  onChange = handler;
  if (!supabase) return () => {};

  // 같은 순간에 여러 명이 슬라이더를 움직이면 알림이 우르르 오는데,
  // 그때마다 다시 읽으면 전송량만 낭비됩니다. 1.5초 동안 모았다 한 번에 처리해요.
  let pending = null;
  let burst = null;
  const coalesce = (scope) => {
    pending = pending && pending !== scope ? "all" : scope;
    if (burst) return;
    burst = setTimeout(() => {
      const s = pending;
      pending = null;
      burst = null;
      onChange(s);
    }, COALESCE_MS);
  };

  channel = supabase.channel("room", {
    config: { broadcast: { self: false }, presence: { key: uid || crypto.randomUUID() } },
  });
  channel.on("broadcast", { event: "changed" }, (msg) => {
    coalesce(msg?.payload?.scope || "all");
  });
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState() || {};
    onPeers(Object.keys(state).length);
    // 각 사람의 최신 presence 만 추려서 마당에 넘깁니다
    const people = [];
    for (const [key, metas] of Object.entries(state)) {
      const m = metas[metas.length - 1];
      if (m?.me) people.push({ key, ...m.me });
    }
    onYard(people);
  });
  channel.on("broadcast", { event: "react" }, (msg) => {
    if (msg?.payload) onReact(msg.payload);
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") channel.track({ at: Date.now(), me: myState }).catch(() => {});
  });

  let lastFull = Date.now();
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastFull >= FULL_MS) {
      lastFull = Date.now();
      onChange("all");
    } else {
      onChange("live");
    }
  }, POLL_MS);

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    lastFull = Date.now();
    onChange("all");   // 돌아왔을 땐 그동안 놓친 게 있을 수 있으니 한 번 전부
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  };
}
