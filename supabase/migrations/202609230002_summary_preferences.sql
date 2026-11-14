-- Cadence preferences only. No backfill, summary generation or email dispatch.
begin;
alter table public.foliage_notification_preferences
  add column weekly_summary boolean not null default true,
  add column daily_digest boolean not null default false;

create or replace function public.foliage_notification_preferences(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null or not exists(select 1 from public.foliage_actors where id=p_actor) then raise exception 'foliage_forbidden'; end if;
  return coalesce((select jsonb_build_object('inbox',inbox,'email',email,'sms',sms,
      'weeklySummary',weekly_summary,'dailyDigest',daily_digest)
    from public.foliage_notification_preferences where owner_id=p_actor),
    jsonb_build_object('inbox',true,'email',false,'sms',false,'weeklySummary',true,'dailyDigest',false));
end $$;

-- Preserve the four-argument setter for older channel-only callers: it leaves cadence intact.
create function public.foliage_set_notification_preferences(
  p_actor uuid,p_inbox boolean,p_email boolean,p_sms boolean,p_weekly_summary boolean,p_daily_digest boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_inbox is null or p_email is null or p_sms is null or p_weekly_summary is null or p_daily_digest is null then raise exception 'foliage_invalid'; end if;
  perform public.foliage_notification_preferences(p_actor);
  insert into public.foliage_notification_preferences(owner_id,inbox,email,sms,weekly_summary,daily_digest)
    values(p_actor,p_inbox,p_email,p_sms,p_weekly_summary,p_daily_digest)
  on conflict(owner_id) do update set inbox=excluded.inbox,email=excluded.email,sms=excluded.sms,
    weekly_summary=excluded.weekly_summary,daily_digest=excluded.daily_digest,updated_at=clock_timestamp();
  return public.foliage_notification_preferences(p_actor);
end $$;

revoke all on function public.foliage_set_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.foliage_set_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean)
  to service_role;
commit;
