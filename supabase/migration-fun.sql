-- ═══════════════════════════════════════════════════════════════════════
-- 익-커 · 재미 기능 4종을 위한 칸 추가
--   🎡 점심 룰렛 · 🗳️ 즉석 익명 투표 · 🪜 사다리 타기 · 🌟 오늘의 질문
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 한 번이면 끝입니다.
-- 여러 번 돌려도 안전해요 (전부 "없으면 만들기" 방식).
-- 기존 데이터는 하나도 안 건드립니다.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. 설정 테이블에 새 칸 ─────────────────────────────────────────────
-- 36명이 같은 화면을 봐야 하니 룰렛 목록·투표 질문·사다리 판을 여기 둡니다.
alter table public.config add column if not exists roulette jsonb;
alter table public.config add column if not exists poll     jsonb;
alter table public.config add column if not exists ladder   jsonb;
alter table public.config add column if not exists dailyq   jsonb;


-- ── 2. 즉석 투표는 votes 테이블에 붙입니다 ─────────────────────────────
-- votes 는 uid 가 기본키라, 여기 붙이면 "1인 1표"가 저절로 보장됩니다.
-- 그리고 아래 votes_public 뷰가 uid 를 빼고 내보내므로 누가 뭘 찍었는지는
-- 여전히 아무도 못 봅니다. 온도 투표와 똑같은 구조예요.
alter table public.votes add column if not exists poll_id   text;
alter table public.votes add column if not exists poll_pick smallint;
alter table public.votes add column if not exists poll_at   timestamptz;

alter table public.votes drop constraint if exists votes_poll_pick_check;
alter table public.votes add constraint votes_poll_pick_check
  check (poll_pick is null or poll_pick between 0 and 9);


-- ── 3. 공개 뷰를 다시 만듭니다 (uid 는 여전히 뺍니다) ──────────────────
drop view if exists public.votes_public;
create view public.votes_public
with (security_invoker = off) as
  select t, s, s_at, nick, cc, ce, ch, cp, ci, show_nick, zone,
         diff, pace, lec_at, wind, wind_at,
         poll_id, poll_pick, poll_at, updated_at,
         (uid = auth.uid()) as is_me
  from public.votes;

grant select on public.votes_public to anon, authenticated;


-- ── 4. 오늘의 질문 답변은 게시판 테이블을 같이 씁니다 ──────────────────
-- kind 에 'qa'(오늘의 질문 답변) 를 허용합니다.
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('chat', 'req', 'info', 'q', 'qa'));


-- ── 5. 확인 ────────────────────────────────────────────────────────────
-- 아래가 4줄 나오면 성공입니다.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'config'
  and column_name in ('roulette', 'poll', 'ladder', 'dailyq')
order by column_name;
