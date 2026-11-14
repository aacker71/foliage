-- Owner-only notifications. No recipients or permission inherit through company hierarchy.
begin;
alter table public.foliage_publication_outbox add column notifications_expanded_at timestamptz;
create index foliage_outbox_unexpanded on public.foliage_publication_outbox(recorded_at,event_id)
  where notifications_expanded_at is null;
create table public.foliage_notification_preferences (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  inbox boolean not null default true,
  email boolean not null default false,
  sms boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.foliage_notification_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.foliage_publication_outbox(event_id),
  recipient_id uuid not null references auth.users(id) on delete restrict,
  channel text not null check(channel in ('inbox','email','sms')),
  state text not null default 'pending' check(state in ('pending','leased','dispatching','accepted','unknown','rejected','cancelled')),
  reason text,
  expires_at timestamptz not null,
  lease_id uuid,
  lease_until timestamptz,
  dispatch_hash text check(dispatch_hash ~ '^sha256:[0-9a-f]{64}$'),
  workflow_id text,
  dispatched_at timestamptz,
  acknowledged_at timestamptz,
  unique(event_id,recipient_id,channel)
);
create index foliage_notification_ready on public.foliage_notification_attempts(expires_at,attempt_id)
  where state in ('pending','leased','dispatching');
alter table public.foliage_notification_preferences enable row level security;
alter table public.foliage_notification_attempts enable row level security;
revoke all on public.foliage_notification_preferences, public.foliage_notification_attempts
  from public,anon,authenticated,service_role;

create function public.foliage_notification_preferences(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor) then raise exception 'foliage_forbidden'; end if;
  return coalesce((select jsonb_build_object('inbox',inbox,'email',email,'sms',sms)
    from public.foliage_notification_preferences where owner_id=p_actor),
    jsonb_build_object('inbox',true,'email',false,'sms',false));
end $$;
create function public.foliage_set_notification_preferences(p_actor uuid,p_inbox boolean,p_email boolean,p_sms boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_inbox is null or p_email is null or p_sms is null then raise exception 'foliage_invalid'; end if;
  perform public.foliage_notification_preferences(p_actor);
  insert into public.foliage_notification_preferences(owner_id,inbox,email,sms) values(p_actor,p_inbox,p_email,p_sms)
  on conflict(owner_id) do update set inbox=excluded.inbox,email=excluded.email,sms=excluded.sms,updated_at=clock_timestamp();
  return public.foliage_notification_preferences(p_actor);
end $$;

-- Internal predicate: exact current event generation, current owner and current preference.
create function public.foliage_notification_allowed(p_attempt uuid)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.foliage_notification_attempts a
    join public.foliage_publication_outbox e using(event_id)
    join public.foliage_subjects s on s.subject_id=e.subject_id
    left join public.foliage_notification_preferences p on p.owner_id=e.owner_id
    where a.attempt_id=p_attempt and a.recipient_id=e.owner_id and s.owner_id=e.owner_id
      and a.expires_at>clock_timestamp() and s.generation=e.generation
      and s.head_revision_id is not distinct from e.revision_id
      and case a.channel when 'inbox' then coalesce(p.inbox,true)
        when 'email' then coalesce(p.email,false) else coalesce(p.sms,false) end);
$$;

create function public.foliage_claim_notifications(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.foliage_publication_outbox; a public.foliage_notification_attempts;
  picked jsonb:='[]'::jsonb; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'foliage_invalid'; end if;
  for e in select * from public.foliage_publication_outbox where notifications_expanded_at is null
    order by recorded_at,event_id for update skip locked limit p_limit loop
    insert into public.foliage_notification_attempts(event_id,recipient_id,channel,expires_at)
      select e.event_id,e.owner_id,c,e.recorded_at+interval '24 hours' from unnest(array['inbox','email','sms']) c
      on conflict do nothing;
    update public.foliage_publication_outbox set notifications_expanded_at=clock_timestamp() where event_id=e.event_id;
  end loop;
  -- A process may have sent after persisting the dispatch marker. Never re-lease those rows.
  update public.foliage_notification_attempts set state='unknown',reason='dispatch_acknowledgement_lost'
    where state='dispatching' and lease_until<=clock_timestamp();
  for a in select * from public.foliage_notification_attempts
    where state='pending' or (state='leased' and lease_until<=clock_timestamp())
    order by expires_at,attempt_id for update skip locked limit p_limit loop
    if not public.foliage_notification_allowed(a.attempt_id) then
      update public.foliage_notification_attempts set state='cancelled',reason='expired_or_authority_or_preference_changed',
        lease_id=null,lease_until=null where attempt_id=a.attempt_id;
    else
      token:=gen_random_uuid();
      update public.foliage_notification_attempts set state='leased',lease_id=token,
        lease_until=clock_timestamp()+interval '60 seconds' where attempt_id=a.attempt_id;
      picked:=picked||jsonb_build_array(jsonb_build_object('attemptId',a.attempt_id,'eventId',a.event_id,
        'recipientId',a.recipient_id,'channel',a.channel,'leaseId',token));
    end if;
  end loop;
  return picked;
end $$;

create function public.foliage_begin_notification(p_attempt uuid,p_lease uuid,p_hash text,p_workflow text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.foliage_notification_attempts;
begin
  if p_hash is null or p_hash !~ '^sha256:[0-9a-f]{64}$' or p_workflow is null or p_workflow !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'foliage_invalid'; end if;
  select * into a from public.foliage_notification_attempts where attempt_id=p_attempt for update;
  if not found or a.state<>'leased' or a.lease_id is distinct from p_lease or a.lease_until<=clock_timestamp() then return false; end if;
  -- Serialize this authorization point with publication/withdrawal. The external send is later.
  perform 1 from public.foliage_subjects s join public.foliage_publication_outbox e on e.subject_id=s.subject_id
    where e.event_id=a.event_id for share of s;
  if not public.foliage_notification_allowed(p_attempt) then
    update public.foliage_notification_attempts set state='cancelled',reason='expired_or_authority_or_preference_changed'
      where attempt_id=p_attempt;
    return false;
  end if;
  update public.foliage_notification_attempts set state='dispatching',dispatch_hash=p_hash,
    workflow_id=p_workflow,dispatched_at=clock_timestamp() where attempt_id=p_attempt;
  return true;
end $$;

create function public.foliage_finish_notification(p_attempt uuid,p_lease uuid,p_state text,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare a public.foliage_notification_attempts;
begin
  if p_state is null or p_state not in ('accepted','unknown','rejected','cancelled') or p_reason is null or
    p_reason !~ '^[a-z_]{1,80}$' then raise exception 'foliage_invalid'; end if;
  select * into a from public.foliage_notification_attempts where attempt_id=p_attempt for update;
  if not found or a.lease_id is distinct from p_lease then raise exception 'foliage_conflict'; end if;
  if a.state=p_state then return a.state; end if;
  if (a.state='leased' and p_state in ('cancelled','rejected')) or
     (a.state in ('dispatching','unknown') and p_state in ('accepted','unknown','rejected')) then
    update public.foliage_notification_attempts set state=p_state,reason=p_reason,
      acknowledged_at=case when p_state='accepted' then clock_timestamp() else acknowledged_at end
      where attempt_id=p_attempt;
    return p_state;
  end if;
  raise exception 'foliage_conflict';
end $$;

revoke all on function public.foliage_notification_preferences(uuid),public.foliage_set_notification_preferences(uuid,boolean,boolean,boolean),
  public.foliage_notification_allowed(uuid),public.foliage_claim_notifications(integer),
  public.foliage_begin_notification(uuid,uuid,text,text),public.foliage_finish_notification(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.foliage_notification_preferences(uuid),public.foliage_set_notification_preferences(uuid,boolean,boolean,boolean),
  public.foliage_claim_notifications(integer),public.foliage_begin_notification(uuid,uuid,text,text),
  public.foliage_finish_notification(uuid,uuid,text,text) to service_role;
commit;
