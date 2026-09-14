-- ═══════════════════════════════════════════════════════════════════════
--  강의실 상태판 — Supabase 스키마
--
--  쓰는 법
--    1) Supabase 대시보드 → Authentication → Sign In / Providers
--       → "Anonymous sign-ins" 를 Enable 로 켜주세요. (꺼져 있으면 로그인이 안 됩니다)
--    2) SQL Editor 를 열고 이 파일을 통째로 붙여넣고 Run.
--    3) 몇 번을 다시 돌려도 안전합니다. 이미 만든 DB 에 다시 돌리면
--       새로 생긴 컬럼만 붙습니다.
--
--  설계 메모
--    · 로그인은 "익명 로그인"입니다. 이메일도 이름도 안 받고, 브라우저마다
--      진짜 계정(auth.users)이 조용히 하나 생깁니다. 그래서 서버가
--      "이 표는 이 사람 것"을 확인할 수 있고, 남의 표를 덮어쓰거나
--      남의 글을 지우는 게 DB 차원에서 막힙니다.
--    · votes 테이블은 본인 행만 읽을 수 있습니다. 남들이 보는 건
--      uid 를 뺀 votes_public 뷰예요. 이렇게 해야 게시판 닉네임과
--      투표 기록을 이어붙여서 "쟤가 몇 도 찍었네" 하는 게 불가능해집니다.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 투표 ────────────────────────────────────────────────────────────────
create table if not exists public.votes (
  uid        uuid primary key references auth.users (id) on delete cascade,
  t          numeric(4, 1) not null check (t between 14 and 34),   -- 희망 온도
  s          smallint check (s between -2 and 2),                  -- 지금 체감 (덥다/춥다)
  s_at       timestamptz,
  nick       text not null default '' check (char_length(nick) <= 12),
  cc         smallint not null default 0,   -- 캐릭터 색 (0-13)
  ce         smallint not null default 0,   -- 머리 (0-7)
  ch         smallint not null default 0,   -- 소품 (0-9)
  cp         smallint not null default 0,   -- 무늬 (0-5)
  ci         smallint not null default 0,   -- 손에 든 것 (0-7)
  show_nick  boolean  not null default false,
  zone       smallint check (zone between 0 and 5),
  diff       smallint check (diff between -2 and 2),   -- 강의 난이도: -2 너무 쉬움 … +2 너무 어려움
  pace       smallint check (pace between -2 and 2),   -- 강의 속도:   -2 너무 느림 … +2 너무 빠름
  lec_at     timestamptz,                              -- 강의 피드백을 누른 시각
  season     text,
  updated_at timestamptz not null default now()
);

-- 이미 만들어 둔 DB 에 다시 돌릴 때를 위해 새 컬럼을 따로 붙입니다.
alter table public.votes add column if not exists cp     smallint not null default 0;
alter table public.votes add column if not exists ci     smallint not null default 0;
alter table public.votes add column if not exists diff   smallint;
alter table public.votes add column if not exists pace   smallint;
alter table public.votes add column if not exists lec_at timestamptz;

-- 캐릭터 옵션이 늘어났으므로 옛 제약을 갈아끼웁니다.
alter table public.votes drop constraint if exists votes_cc_check;
alter table public.votes drop constraint if exists votes_ce_check;
alter table public.votes drop constraint if exists votes_ch_check;
alter table public.votes drop constraint if exists votes_cp_check;
alter table public.votes drop constraint if exists votes_ci_check;
alter table public.votes add constraint votes_cc_check check (cc between 0 and 13);
alter table public.votes add constraint votes_ce_check check (ce between 0 and 7);
alter table public.votes add constraint votes_ch_check check (ch between 0 and 9);
alter table public.votes add constraint votes_cp_check check (cp between 0 and 5);
alter table public.votes add constraint votes_ci_check check (ci between 0 and 7);

alter table public.votes enable row level security;

drop policy if exists votes_select_own on public.votes;
drop policy if exists votes_insert_own on public.votes;
drop policy if exists votes_update_own on public.votes;
drop policy if exists votes_delete_own on public.votes;

create policy votes_select_own on public.votes for select using (auth.uid() = uid);
create policy votes_insert_own on public.votes for insert with check (auth.uid() = uid);
create policy votes_update_own on public.votes for update using (auth.uid() = uid) with check (auth.uid() = uid);
create policy votes_delete_own on public.votes for delete using (auth.uid() = uid);

-- 모두가 읽는 건 uid 를 뺀 이 뷰입니다.
-- security_invoker = off → 뷰 소유자 권한으로 돌아서 위 RLS 를 통과하되,
-- uid 컬럼 자체가 결과에 없습니다. (Supabase 린터가 "security definer view"
-- 경고를 띄우는데, 여기서는 그게 의도된 설계입니다.)
-- is_me 는 "이 행이 당신 것인가"만 알려줍니다. 보는 사람마다 답이 달라지고,
-- 남의 uid 는 여전히 어디에도 안 나옵니다. 그래프에서 내 캐릭터를 찾는 용도예요.
drop view if exists public.votes_public;
create view public.votes_public
with (security_invoker = off) as
  select t, s, s_at, nick, cc, ce, ch, cp, ci, show_nick, zone,
         diff, pace, lec_at, updated_at,
         (uid = auth.uid()) as is_me
  from public.votes;

grant select on public.votes_public to anon, authenticated;


-- ── 게시판 ──────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  kind       text not null default 'chat',
  nick       text not null default '익명' check (char_length(nick) <= 12),
  cc         smallint not null default 0,
  ce         smallint not null default 0,
  ch         smallint not null default 0,
  cp         smallint not null default 0,
  ci         smallint not null default 0,
  pinned     boolean  not null default false,
  pinned_at  timestamptz,
  created_at timestamptz not null default now()
);

alter table public.posts add column if not exists cp smallint not null default 0;
alter table public.posts add column if not exists ci smallint not null default 0;

alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('chat', 'req', 'info'));

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_pinned_idx  on public.posts (pinned) where pinned;

alter table public.posts enable row level security;

drop policy if exists posts_select_all on public.posts;
drop policy if exists posts_insert_own on public.posts;
drop policy if exists posts_update_own on public.posts;
drop policy if exists posts_delete_own on public.posts;

create policy posts_select_all on public.posts for select using (true);
create policy posts_insert_own on public.posts for insert with check (auth.uid() = author);
create policy posts_update_own on public.posts for update using (auth.uid() = author) with check (auth.uid() = author);
create policy posts_delete_own on public.posts for delete using (auth.uid() = author);


-- ── 공감 ("나도요") ─────────────────────────────────────────────────────
create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  uid     uuid not null references auth.users (id)  on delete cascade,
  primary key (post_id, uid)
);

alter table public.post_likes enable row level security;

drop policy if exists likes_select_all on public.post_likes;
drop policy if exists likes_insert_own on public.post_likes;
drop policy if exists likes_delete_own on public.post_likes;

create policy likes_select_all on public.post_likes for select using (true);
create policy likes_insert_own on public.post_likes for insert with check (auth.uid() = uid);
create policy likes_delete_own on public.post_likes for delete using (auth.uid() = uid);

drop view if exists public.posts_public;
create view public.posts_public
with (security_invoker = off) as
  select p.id, p.author, p.body, p.kind, p.nick,
         p.cc, p.ce, p.ch, p.cp, p.ci,
         p.pinned, p.pinned_at, p.created_at,
         (select count(*) from public.post_likes l where l.post_id = p.id)   as likes,
         exists (select 1 from public.post_likes l
                  where l.post_id = p.id and l.uid = auth.uid())             as liked_by_me
  from public.posts p;

grant select on public.posts_public to anon, authenticated;


-- ── 방 설정 (한 줄짜리) ─────────────────────────────────────────────────
create table if not exists public.config (
  id           int primary key default 1 check (id = 1),
  room_size    int  not null default 36,
  season       text not null default 'auto' check (season in ('auto','summer','shoulder','winter')),
  applied      numeric(4, 1),        -- 지금 에어컨에 실제로 맞춰진 온도
  applied_at   timestamptz,
  indoor_t     numeric(4, 1),        -- 실측 실내 온도 (있으면)
  indoor_rh    numeric(4, 1),        -- 실측 실내 습도 (있으면)
  indoor_at    timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.config add column if not exists indoor_t  numeric(4, 1);
alter table public.config add column if not exists indoor_rh numeric(4, 1);
alter table public.config add column if not exists indoor_at timestamptz;
alter table public.config alter column room_size set default 36;

insert into public.config (id) values (1) on conflict (id) do nothing;

alter table public.config enable row level security;

drop policy if exists config_select_all on public.config;
drop policy if exists config_update_any on public.config;

create policy config_select_all on public.config for select using (true);
create policy config_update_any on public.config for update to authenticated using (true) with check (true);


-- ── 일별 기록 (14일 추이 그래프용) ──────────────────────────────────────
create table if not exists public.history (
  d          date primary key,
  setpoint   numeric(4, 1) not null,
  raw        numeric(5, 2),
  n          int,
  med        numeric(5, 2),
  p25        numeric(5, 2),
  p75        numeric(5, 2),
  updated_at timestamptz not null default now()
);

alter table public.history enable row level security;

drop policy if exists history_select_all on public.history;
drop policy if exists history_write_any  on public.history;
drop policy if exists history_update_any on public.history;

create policy history_select_all on public.history for select using (true);
create policy history_write_any  on public.history for insert to authenticated with check (true);
create policy history_update_any on public.history for update to authenticated using (true) with check (true);


-- ── 정각 체크포인트 ─────────────────────────────────────────────────────
-- 매 정각에 "그 시점의 권장값"을 한 줄로 못 박아 둡니다.
-- 투표는 계속 들어오지만, 실제로 리모컨을 만질지 판단하는 건 정각뿐이에요.
-- 강의 피드백(난이도·속도)도 이 시점 기준으로 한 시간치가 마감됩니다.
create table if not exists public.checkpoints (
  hour_at    timestamptz primary key,
  setpoint   numeric(4, 1) not null,
  applied    numeric(4, 1),
  n          int not null default 0,
  changed    boolean not null default false,
  diff_avg   numeric(4, 2),   -- 마감된 그 시간의 강의 난이도 평균
  pace_avg   numeric(4, 2),   -- 마감된 그 시간의 강의 속도 평균
  lec_n      int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.checkpoints add column if not exists diff_avg numeric(4, 2);
alter table public.checkpoints add column if not exists pace_avg numeric(4, 2);
alter table public.checkpoints add column if not exists lec_n    int not null default 0;

create index if not exists checkpoints_hour_idx on public.checkpoints (hour_at desc);

alter table public.checkpoints enable row level security;

drop policy if exists checkpoints_select_all on public.checkpoints;
create policy checkpoints_select_all on public.checkpoints for select using (true);
-- 쓰기는 아래 record_checkpoint() 로만. 직접 insert 는 막아둡니다.


-- ── 20% 절사평균을 SQL 에서 ─────────────────────────────────────────────
-- 클라이언트와 서버가 같은 숫자를 보게 하려고 계산을 DB 에도 둡니다.
-- 최근 7일 안에 갱신된 표만 셉니다.
create or replace function public.trimmed_setpoint()
returns table (raw numeric, n int)
language sql stable as $$
  with fresh as (
    select t from public.votes where updated_at > now() - interval '7 days'
  ),
  ordered as (
    select t,
           row_number() over (order by t) as rn,
           count(*)     over ()           as total
    from fresh
  ),
  bounds as (
    select floor(total * 0.2)::int as cut, total from ordered limit 1
  )
  select round(avg(o.t)::numeric, 2) as raw,
         (select total from bounds)::int as n
  from ordered o, bounds b
  where o.rn > b.cut and o.rn <= b.total - b.cut;
$$;


-- ── 계절 밴드 ───────────────────────────────────────────────────────────
create or replace function public.season_band(p_season text, p_now timestamptz default now())
returns table (key text, lo numeric, hi numeric, def numeric)
language plpgsql stable as $$
declare m int;
        s text := p_season;
begin
  if s is null or s = 'auto' then
    m := extract(month from (p_now at time zone 'Asia/Seoul'))::int;
    if    m between 6 and 9           then s := 'summer';
    elsif m = 12 or m between 1 and 3 then s := 'winter';
    else                                   s := 'shoulder';
    end if;
  end if;

  if s = 'summer' then
    return query select 'summer'::text, 24.0::numeric, 28.0::numeric, 26.0::numeric;
  elsif s = 'winter' then
    return query select 'winter'::text, 19.0::numeric, 23.0::numeric, 21.0::numeric;
  else
    return query select 'shoulder'::text, 21.0::numeric, 26.0::numeric, 23.5::numeric;
  end if;
end $$;


-- ── 정각 체크포인트 기록 ────────────────────────────────────────────────
-- 정각이 되면 페이지를 열어둔 사람 중 누구든 이걸 호출합니다.
-- 이미 그 시간 행이 있으면 아무 일도 안 하고 created=false 를 돌려주므로,
-- 36명이 동시에 호출해도 한 번만 기록되고 알림도 한 번만 나갑니다.
create or replace function public.record_checkpoint()
returns table (created boolean, hour_at timestamptz, setpoint numeric,
               applied numeric, n int, changed boolean,
               diff_avg numeric, pace_avg numeric, lec_n int)
language plpgsql security definer set search_path = public as $$
declare
  v_hour    timestamptz := date_trunc('hour', now());
  v_prev    timestamptz := v_hour - interval '1 hour';
  v_raw     numeric;
  v_n       int;
  v_band    record;
  v_cfg     record;
  v_set     numeric;
  v_changed boolean;
  v_diff    numeric;
  v_pace    numeric;
  v_lecn    int;
  v_ins     int;
begin
  if exists (select 1 from checkpoints c where c.hour_at = v_hour) then
    return query
      select false, c.hour_at, c.setpoint, c.applied, c.n, c.changed,
             c.diff_avg, c.pace_avg, c.lec_n
      from checkpoints c where c.hour_at = v_hour;
    return;
  end if;

  select * into v_cfg  from config where id = 1;
  select * into v_band from season_band(v_cfg.season);
  select ts.raw, ts.n into v_raw, v_n from trimmed_setpoint() ts;

  if v_raw is null then
    v_set := v_band.def;
    v_n   := 0;
  else
    v_set := round(least(greatest(v_raw, v_band.lo), v_band.hi) * 2) / 2;
  end if;

  v_changed := v_cfg.applied is not null and abs(v_set - v_cfg.applied) >= 0.5;

  -- 방금 끝난 한 시간(직전 정각 ~ 지금)의 강의 피드백을 마감합니다.
  select round(avg(diff)::numeric, 2), round(avg(pace)::numeric, 2), count(*)
    into v_diff, v_pace, v_lecn
    from votes
   where lec_at >= v_prev and lec_at < v_hour;

  -- on conflict (hour_at) 로 쓰면 Postgres 가 거부합니다. returns table 의
  -- hour_at 이 함수 안에서 변수로 잡혀서 테이블 컬럼과 헷갈리거든요.
  -- 기본키 제약 이름으로 지목하면 그런 혼동이 없습니다.
  insert into checkpoints (hour_at, setpoint, applied, n, changed, diff_avg, pace_avg, lec_n)
  values (v_hour, v_set, v_cfg.applied, coalesce(v_n, 0), v_changed,
          v_diff, v_pace, coalesce(v_lecn, 0))
  on conflict on constraint checkpoints_pkey do nothing;

  -- 실제로 내가 넣었을 때만 created=true. 두 사람이 같은 순간에 불러도
  -- 한쪽만 true 를 받아서 슬랙 알림이 두 번 나가지 않습니다.
  get diagnostics v_ins = row_count;

  return query
    select (v_ins > 0), c.hour_at, c.setpoint, c.applied, c.n, c.changed,
           c.diff_avg, c.pace_avg, c.lec_n
    from checkpoints c where c.hour_at = v_hour;
end $$;

grant execute on function public.record_checkpoint() to authenticated;
grant execute on function public.trimmed_setpoint() to authenticated, anon;
grant execute on function public.season_band(text, timestamptz) to authenticated, anon;


-- ── 고정 토글 ───────────────────────────────────────────────────────────
-- 최대 5개 제한을 서버에서 강제합니다. 클라이언트에서만 막으면 뚫려요.
create or replace function public.toggle_pin(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare cur boolean; cnt int;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요';
  end if;

  select pinned into cur from posts where id = p_id;
  if cur is null then
    raise exception '이미 지워진 글이에요';
  end if;

  if not cur then
    select count(*) into cnt from posts where pinned;
    if cnt >= 5 then
      raise exception '고정은 최대 5개까지예요. 하나 풀고 다시 해주세요.';
    end if;
  end if;

  update posts
     set pinned    = not cur,
         pinned_at = case when not cur then now() else null end
   where id = p_id;

  return not cur;
end $$;

grant execute on function public.toggle_pin(uuid) to authenticated;


-- ── 오래된 글 정리 (선택) ───────────────────────────────────────────────
-- 고정 안 된 글 중 30일 지난 건 지웁니다. 가끔 수동으로 돌리거나,
-- Supabase 의 pg_cron 확장을 켰다면 스케줄에 걸어두세요.
create or replace function public.prune_old_posts()
returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  delete from posts where not pinned and created_at < now() - interval '30 days';
  get diagnostics cnt = row_count;
  return cnt;
end $$;


-- ═══════════════════════════════════════════════════════════════════════
--  추가분 — 쉬는 시간 타이머 · 익명 질문함
--  (이미 만든 DB 에 이 파일을 다시 돌려도 안전합니다)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 쉬는 시간 ──────────────────────────────────────────────────────────
-- 쉬는 시간은 "언제 끝나는지"만 저장합니다. 남은 시간을 저장하면
-- 나중에 들어온 사람이 처음부터 다시 세게 되거든요. 절대 시각이라야
-- 누가 언제 접속하든 같은 숫자를 봅니다.
alter table public.config add column if not exists break_until  timestamptz;
alter table public.config add column if not exists break_label  text;

-- 환기 기록은 뺐습니다. 창문 없는 강의실이라 누를 일이 없는 버튼이었어요.
alter table public.config drop column if exists vented_at;


-- ── 익명 질문함 ─────────────────────────────────────────────────────────
-- 게시판과 같은 테이블을 씁니다. kind='q' 가 질문이고,
-- answered 로 "이건 답변했음"을 찍습니다.
alter table public.posts add column if not exists answered    boolean not null default false;
alter table public.posts add column if not exists answered_at timestamptz;

alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('chat', 'req', 'info', 'q'));

create index if not exists posts_open_q_idx
  on public.posts (created_at desc) where kind = 'q' and not answered;

-- 뷰에 answered 를 실어 보냅니다
drop view if exists public.posts_public;
create view public.posts_public
with (security_invoker = off) as
  select p.id, p.author, p.body, p.kind, p.nick,
         p.cc, p.ce, p.ch, p.cp, p.ci,
         p.pinned, p.pinned_at, p.answered, p.answered_at, p.created_at,
         (select count(*) from public.post_likes l where l.post_id = p.id)   as likes,
         exists (select 1 from public.post_likes l
                  where l.post_id = p.id and l.uid = auth.uid())             as liked_by_me
  from public.posts p;

grant select on public.posts_public to anon, authenticated;

-- 답변 완료 토글.
-- 질문 글에만 걸리고, 누구나 찍을 수 있습니다 (강사만 찍게 하려면
-- "누가 강사냐"를 정해야 하는데 그러면 익명 구조가 무너져요).
create or replace function public.toggle_answered(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare cur boolean; k text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요';
  end if;

  select answered, kind into cur, k from posts where id = p_id;
  if cur is null then
    raise exception '이미 지워진 글이에요';
  end if;
  if k <> 'q' then
    raise exception '질문 글에만 쓸 수 있어요';
  end if;

  update posts
     set answered    = not cur,
         answered_at = case when not cur then now() else null end
   where id = p_id;

  return not cur;
end $$;

grant execute on function public.toggle_answered(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
--  추가분 — 바람 요청 · 조 뽑기 · 발표 룰렛
-- ═══════════════════════════════════════════════════════════════════════

-- ── 바람 요청 ───────────────────────────────────────────────────────────
-- 창문이 없는 강의실이라 에어컨이 유일한 공기 흐름원입니다.
-- 그래서 "몇 도"보다 "바람"이 문제인 경우가 많아요.
-- -1 약하게 · 0 괜찮음 · +1 세게. 체감처럼 3시간만 유효합니다.
alter table public.votes add column if not exists wind    smallint;
alter table public.votes add column if not exists wind_at timestamptz;

alter table public.votes drop constraint if exists votes_wind_check;
alter table public.votes add constraint votes_wind_check check (wind between -1 and 1);

-- 구역이 4칸으로 줄었습니다 (앞/뒤 × 왼쪽/오른쪽).
-- 옛 6칸 데이터가 남아 있어도 제약에 안 걸리게 범위는 넉넉히 둡니다.
drop view if exists public.votes_public;
create view public.votes_public
with (security_invoker = off) as
  select t, s, s_at, nick, cc, ce, ch, cp, ci, show_nick, zone,
         diff, pace, lec_at, wind, wind_at, updated_at,
         (uid = auth.uid()) as is_me
  from public.votes;

grant select on public.votes_public to anon, authenticated;

-- 구역이 6칸 → 4칸으로 줄었으니, 범위 밖 값은 "안 고름"으로 되돌립니다.
update public.votes set zone = null where zone is not null and zone > 3;


-- ── 조 뽑기 · 발표 룰렛 ─────────────────────────────────────────────────
-- 뽑은 결과를 저장해 둬야 36명이 같은 화면을 봅니다.
-- 각자 브라우저에서 돌리면 전부 다른 결과가 나와서 싸움이 나요.
alter table public.config add column if not exists draw_groups jsonb;   -- {n, at, groups:[[nick,…],…]}
alter table public.config add column if not exists draw_pick   jsonb;   -- {at, current, history:[nick,…]}
