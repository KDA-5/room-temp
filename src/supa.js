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
      realtime: { params: { eventsPerSecond: 4 } },
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

/** 화면에 필요한 걸 한 번에 긁어옵니다. */
export async function readAll() {
  if (!supabase) return null;

  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const sinceDay = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const sinceHour = new Date(Date.now() - 14 * 3600e3).toISOString();

  const [votes, posts, config, history, checkpoints, mine] = await Promise.all([
    supabase.from("votes_public").select("*").gte("updated_at", since),
    supabase.from("posts_public").select("*").order("created_at", { ascending: false }).limit(80),
    supabase.from("config").select("*").eq("id", 1).maybeSingle(),
    supabase.from("history").select("*").gte("d", sinceDay).order("d", { ascending: true }),
    supabase.from("checkpoints").select("*").gte("hour_at", sinceHour).order("hour_at", { ascending: true }),
    uid ? supabase.from("votes").select("*").eq("uid", uid).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const firstError = [votes, posts, config, history, checkpoints].find((r) => r?.error)?.error;
  if (firstError) throw firstError;

  return {
    votes: votes.data ?? [],
    posts: posts.data ?? [],
    config: config.data ?? null,
    history: history.data ?? [],
    checkpoints: checkpoints.data ?? [],
    mine: mine?.data ?? null,
  };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────

/** 내 표. uid 가 기본키라 upsert 한 방이면 끝납니다. */
export async function saveVote(patch) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = await supabase
    .from("votes")
    .upsert({ uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: "uid" });
  if (error) throw error;
  ping();
}

export async function saveConfig(patch) {
  if (!supabase) throw new Error("설정이 안 됐어요");
  const { error } = await supabase
    .from("config")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  ping();
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
  ping();
}

export async function deletePost(id) {
  if (!supabase) return;
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
  ping();
}

export async function setLike(postId, on) {
  if (!supabase || !uid) throw new Error("아직 로그인 전이에요");
  const { error } = on
    ? await supabase.from("post_likes").insert({ post_id: postId, uid })
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("uid", uid);
  // 이미 눌러놓고 또 누른 경우(중복키)는 오류가 아니라 그냥 같은 상태입니다.
  if (error && error.code !== "23505") throw error;
  ping();
}

export async function togglePin(postId) {
  if (!supabase) return;
  const { error } = await supabase.rpc("toggle_pin", { p_id: postId });
  if (error) throw new Error(error.message);
  ping();
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
  if (row?.created) ping();
  return row ?? null;
}

// ── 실시간 ──────────────────────────────────────────────────────────────

let channel = null;
let onChange = () => {};

/** 뭔가 바꿨다고 다른 사람들에게 알립니다. */
function ping() {
  if (!channel) return;
  channel.send({ type: "broadcast", event: "changed", payload: { at: Date.now() } }).catch(() => {});
}

/**
 * 실시간 구독 시작.
 * 브로드캐스트가 즉시 반응을 담당하고, 25초 폴링이 안전망입니다.
 * (탭이 뒤로 가 있는 동안은 폴링을 쉬었다가 돌아오면 바로 한 번 당깁니다.)
 */
export function subscribe(handler) {
  onChange = handler;
  if (!supabase) return () => {};

  channel = supabase.channel("room", { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "changed" }, () => onChange("realtime"));
  channel.subscribe();

  const timer = setInterval(() => {
    if (document.visibilityState === "visible") onChange("poll");
  }, 25000);

  const onVisible = () => {
    if (document.visibilityState === "visible") onChange("visible");
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  };
}
