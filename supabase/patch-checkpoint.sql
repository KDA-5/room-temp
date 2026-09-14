-- record_checkpoint() 만 고친 패치입니다. SQL Editor 에 붙여넣고 Run 하세요.

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
