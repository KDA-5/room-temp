-- ═══════════════════════════════════════════════════════════════════════
-- 익-커 · 악성 글 대응
--   🚨 신고 버튼 · 🛡 관리자 삭제 권한
--
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 한 번.
-- 여러 번 돌려도 안전합니다.
--
-- ⚠️ 아래 __ADMIN_KEY__ 자리에 진짜 열쇠말이 들어간 버전을 쓰세요.
--    저장소에 올라가는 이 파일에는 일부러 자리표시자만 남겨둡니다.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. 열쇠말은 서버에만 둡니다 ────────────────────────────────────────
-- RLS 를 켜고 정책을 하나도 안 만들면, 클라이언트는 이 표를 아예 못 읽습니다.
-- 아래 함수들만 (security definer 라서) 읽을 수 있어요.
create table if not exists public.admin_secret (
  id  int primary key default 1 check (id = 1),
  key text not null
);

alter table public.admin_secret enable row level security;
revoke all on public.admin_secret from anon, authenticated;

insert into public.admin_secret (id, key) values (1, '__ADMIN_KEY__')
on conflict (id) do update set key = excluded.key;


-- ── 2. 신고 ────────────────────────────────────────────────────────────
-- 좋아요와 같은 구조입니다. 한 사람이 같은 글을 두 번 신고할 수 없어요.
create table if not exists public.post_reports (
  post_id uuid not null references public.posts (id) on delete cascade,
  uid     uuid not null references auth.users (id)  on delete cascade,
  at      timestamptz not null default now(),
  primary key (post_id, uid)
);

alter table public.post_reports enable row level security;

drop policy if exists reports_select_all on public.post_reports;
drop policy if exists reports_insert_own on public.post_reports;
drop policy if exists reports_delete_own on public.post_reports;

-- 누가 신고했는지는 본인만 압니다. 개수만 아래 뷰로 공개돼요.
create policy reports_select_own on public.post_reports for select using (auth.uid() = uid);
create policy reports_insert_own on public.post_reports for insert with check (auth.uid() = uid);
create policy reports_delete_own on public.post_reports for delete using (auth.uid() = uid);

grant select, insert, delete on public.post_reports to authenticated;


-- ── 3. 게시판 공개 뷰에 신고 수를 얹습니다 ─────────────────────────────
-- 2건 넘게 신고된 글은 hidden = true 로 내려가고, 화면에서 접힙니다.
drop view if exists public.posts_public;
create view public.posts_public
with (security_invoker = off) as
  select p.id, p.author, p.body, p.kind, p.nick,
         p.cc, p.ce, p.ch, p.cp, p.ci,
         p.pinned, p.pinned_at, p.created_at,
         (select count(*) from public.post_likes l where l.post_id = p.id)     as likes,
         exists (select 1 from public.post_likes l
                  where l.post_id = p.id and l.uid = auth.uid())               as liked_by_me,
         (select count(*) from public.post_reports r where r.post_id = p.id)   as reports,
         exists (select 1 from public.post_reports r
                  where r.post_id = p.id and r.uid = auth.uid())               as reported_by_me,
         ((select count(*) from public.post_reports r where r.post_id = p.id) >= 2) as hidden
  from public.posts p;

grant select on public.posts_public to anon, authenticated;


-- ── 4. 관리자 삭제 ─────────────────────────────────────────────────────
-- 열쇠말을 **서버에서** 확인합니다. 브라우저 개발자 도구로 화면을 바꿔봐야
-- 열쇠말 없이는 남의 글이 지워지지 않아요.
create or replace function public.admin_delete_post(p_key text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  select (key = p_key) into v_ok from public.admin_secret where id = 1;
  if not coalesce(v_ok, false) then
    raise exception '열쇠말이 다릅니다';
  end if;

  delete from public.posts where id = p_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_post(text, uuid) from public;
grant execute on function public.admin_delete_post(text, uuid) to authenticated;


-- ── 5. 열쇠말이 맞는지만 물어보는 함수 ─────────────────────────────────
-- 화면에서 "관리 버튼 켜기" 를 누를 때 씁니다. 맞는지 여부만 돌려주고
-- 열쇠말 자체는 절대 밖으로 안 나갑니다.
create or replace function public.admin_check(p_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select key = p_key from public.admin_secret where id = 1), false);
$$;

revoke all on function public.admin_check(text) from public;
grant execute on function public.admin_check(text) to authenticated;



-- ── 7. 누적 신고 · 글쓰기 잠금 ──────────────────────────────────────────
-- 신고가 10건 쌓이면 그 계정은 글을 못 씁니다. 읽기와 온도 투표는 그대로예요.
-- 여기서도 계정은 무작위 UUID 라, 관리자도 "누구인지"는 알 수 없습니다.
-- 알 수 있는 건 "이 계정이 몇 번 신고당했는가" 뿐이에요.
create table if not exists public.strikes (
  uid        uuid primary key references auth.users (id) on delete cascade,
  reports    int  not null default 0,
  blocked    boolean not null default false,
  blocked_at timestamptz,
  note       text
);

alter table public.strikes enable row level security;
drop policy if exists strikes_select_own on public.strikes;
-- 본인만 자기 상태를 봅니다 ("나 잠겼구나"를 알아야 하니까)
create policy strikes_select_own on public.strikes for select using (auth.uid() = uid);
grant select on public.strikes to authenticated;

create or replace function public.block_limit() returns int
language sql immutable as $$ select 10 $$;

-- 신고가 들어오거나 취소될 때마다 그 글 작성자의 누적을 다시 셉니다.
create or replace function public.sync_strikes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_n int;
begin
  select author into v_author from public.posts
   where id = coalesce(new.post_id, old.post_id);
  if v_author is null then return null; end if;

  select count(*) into v_n
    from public.post_reports r
    join public.posts p on p.id = r.post_id
   where p.author = v_author;

  insert into public.strikes (uid, reports, blocked, blocked_at)
  values (v_author, v_n, v_n >= public.block_limit(),
          case when v_n >= public.block_limit() then now() end)
  on conflict (uid) do update
    set reports    = excluded.reports,
        -- 관리자가 푼 계정은 다시 10건이 쌓여야 잠깁니다
        blocked    = strikes.blocked or excluded.reports >= public.block_limit(),
        blocked_at = case when strikes.blocked then strikes.blocked_at else excluded.blocked_at end;
  return null;
end;
$$;

drop trigger if exists trg_strikes_ins on public.post_reports;
drop trigger if exists trg_strikes_del on public.post_reports;
create trigger trg_strikes_ins after insert on public.post_reports
  for each row execute function public.sync_strikes();
create trigger trg_strikes_del after delete on public.post_reports
  for each row execute function public.sync_strikes();


-- ── 8. 잠긴 계정은 글을 못 올립니다 ────────────────────────────────────
-- 화면만 가리는 게 아니라 데이터베이스가 직접 막습니다.
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert
  with check (
    auth.uid() = author
    and not exists (
      select 1 from public.strikes s
       where s.uid = auth.uid() and s.blocked
    )
  );


-- ── 9. 관리자용 — 잠긴 계정 보기 / 풀기 ────────────────────────────────
create or replace function public.admin_blocked(p_key text)
returns table (uid uuid, reports int, blocked_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(p_key) then raise exception '열쇠말이 다릅니다'; end if;
  return query
    select s.uid, s.reports, s.blocked_at
      from public.strikes s
     where s.blocked
     order by s.blocked_at desc nulls last;
end;
$$;

create or replace function public.admin_unblock(p_key text, p_uid uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(p_key) then raise exception '열쇠말이 다릅니다'; end if;

  -- 잠금을 풀면서 그동안의 신고도 지웁니다. 안 그러면 바로 다시 잠겨요.
  delete from public.post_reports r
   using public.posts p
   where r.post_id = p.id and p.author = p_uid;

  update public.strikes
     set blocked = false, blocked_at = null, reports = 0
   where uid = p_uid;
  return found;
end;
$$;

revoke all on function public.admin_blocked(text) from public;
revoke all on function public.admin_unblock(text, uuid) from public;
grant execute on function public.admin_blocked(text) to authenticated;
grant execute on function public.admin_unblock(text, uuid) to authenticated;


-- ── 10. 본인 글도 스스로 지울 수 없습니다 ──────────────────────────────
-- 욕을 쓰고 신고당한 뒤 증거를 지워버리면 대응할 방법이 없어집니다.
-- 그래서 직접 삭제 권한을 아예 회수하고, 위의 admin_delete_post 만 남깁니다.
-- (그 함수는 security definer 라 RLS 를 넘어서 지울 수 있어요)
drop policy if exists posts_delete_own on public.posts;
revoke delete on public.posts from authenticated, anon;

-- ── 6. 확인 ────────────────────────────────────────────────────────────
-- true 가 나오면 열쇠말이 잘 들어간 겁니다.
select public.admin_check('__ADMIN_KEY__') as 열쇠말_확인,
       public.block_limit()                     as 잠금_기준_신고수;
