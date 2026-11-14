-- Foreground, one-time delivery receipts in the existing authority database.
-- No autonomous queue/retry: an interrupted dispatch becomes unknown, never re-leased.
begin;
create table public.foliage_distribution_operations (
  owner_id uuid not null references public.foliage_actors(id) on delete restrict,
  operation_id uuid not null,
  subject_id text not null references public.foliage_subjects(subject_id) on delete restrict,
  revision_id uuid not null references public.foliage_publication_revisions(revision_id),
  generation bigint not null check (generation >= 0),
  adapter_key text not null check (length(adapter_key) between 1 and 256),
  connection_id text not null check (connection_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  candidate_id uuid not null,
  candidate_name text not null check (length(candidate_name) between 1 and 500),
  payload_digest text not null check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text not null default 'prepared' check(status in ('prepared','sending','accepted','rejected','unknown','cancelled')),
  dispatch_id uuid,
  authorized_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  provider_reference uuid,
  reason text,
  primary key(owner_id,operation_id)
);
alter table public.foliage_distribution_operations enable row level security;
revoke all on public.foliage_distribution_operations from public,anon,authenticated,service_role;
create index foliage_distribution_subject on public.foliage_distribution_operations(owner_id,subject_id,updated_at desc);

create function public.foliage_distribution_result(p_actor uuid,p_operation uuid)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('operationId',o.operation_id,'subjectId',o.subject_id,'revisionId',o.revision_id,
    'generation',o.generation,'adapterKey',o.adapter_key,'connectionId',o.connection_id,
    'candidateId',o.candidate_id,'candidateName',o.candidate_name,'payloadDigest',o.payload_digest,
    'status',case when o.status='sending' and o.updated_at < clock_timestamp()-interval '60 seconds' then 'unknown' else o.status end,
    'providerReference',o.provider_reference,'reason',o.reason,'updatedAt',o.updated_at,
    'current',coalesce(s.head_revision_id=o.revision_id and s.generation=o.generation,false),
    'visible',s.head_revision_id is not null)
  from public.foliage_distribution_operations o join public.foliage_subjects s using(subject_id)
  where o.owner_id=p_actor and o.operation_id=p_operation and s.owner_id=p_actor;
$$;
create function public.foliage_distribution_read(p_actor uuid,p_operation uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.foliage_distribution_result(p_actor,p_operation);
$$;
create function public.foliage_distribution_list(p_actor uuid,p_subject text)
returns jsonb language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.foliage_distribution_result(p_actor,r.operation_id) order by r.updated_at desc),'[]'::jsonb)
    from (select o.operation_id,o.updated_at from public.foliage_distribution_operations o
      join public.foliage_subjects s using(subject_id)
      where o.owner_id=p_actor and s.owner_id=p_actor and o.subject_id=p_subject
      order by o.updated_at desc limit 50) r;
$$;
create function public.foliage_distribution_prepare(p_actor uuid,p_operation uuid,p_subject text,p_revision uuid,
  p_generation bigint,p_adapter text,p_connection text,p_candidate uuid,p_name text,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.foliage_subjects; prior public.foliage_distribution_operations;
begin
  if p_actor is null or p_operation is null or p_revision is null or p_candidate is null or
    p_generation is null or p_generation < 0 or p_adapter is null or length(p_adapter) not between 1 and 256 or
    p_connection is null or p_connection !~ '^[A-Za-z0-9_-]{1,128}$' or p_name is null or length(p_name) not between 1 and 500 or
    p_digest is null or p_digest !~ '^sha256:[0-9a-f]{64}$' then raise exception 'foliage_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':distribution:'||p_operation::text,0));
  select * into prior from public.foliage_distribution_operations where owner_id=p_actor and operation_id=p_operation;
  if found then
    if prior.subject_id is distinct from p_subject or prior.revision_id is distinct from p_revision or
      prior.generation is distinct from p_generation or prior.adapter_key is distinct from p_adapter or
      prior.connection_id is distinct from p_connection or prior.candidate_id is distinct from p_candidate or
      prior.candidate_name is distinct from p_name or prior.payload_digest is distinct from p_digest then raise exception 'foliage_conflict'; end if;
    return public.foliage_distribution_result(p_actor,p_operation);
  end if;
  select * into s from public.foliage_subjects where subject_id=p_subject for update;
  if not found or s.owner_id is distinct from p_actor then raise exception 'foliage_forbidden'; end if;
  if s.head_revision_id is distinct from p_revision or s.generation is distinct from p_generation then raise exception 'foliage_conflict'; end if;
  insert into public.foliage_distribution_operations(owner_id,operation_id,subject_id,revision_id,generation,adapter_key,connection_id,candidate_id,candidate_name,payload_digest)
    values(p_actor,p_operation,p_subject,p_revision,p_generation,p_adapter,p_connection,p_candidate,p_name,p_digest);
  return public.foliage_distribution_result(p_actor,p_operation);
end $$;
create function public.foliage_distribution_start(p_actor uuid,p_operation uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.foliage_distribution_operations; s public.foliage_subjects; fence uuid;
begin
  -- Publication changes and dispatch authorization share the subject row lock.
  select s0.* into s from public.foliage_subjects s0 join public.foliage_distribution_operations o0 using(subject_id)
    where o0.owner_id=p_actor and o0.operation_id=p_operation and s0.owner_id=p_actor for update of s0;
  if not found then raise exception 'foliage_forbidden'; end if;
  select * into o from public.foliage_distribution_operations where owner_id=p_actor and operation_id=p_operation for update;
  if o.payload_digest is distinct from p_digest then raise exception 'foliage_conflict'; end if;
  if o.status <> 'prepared' then return jsonb_build_object('dispatchId',null,'receipt',public.foliage_distribution_result(p_actor,p_operation)); end if;
  if s.head_revision_id is distinct from o.revision_id or s.generation is distinct from o.generation then raise exception 'foliage_conflict'; end if;
  fence:=gen_random_uuid();
  update public.foliage_distribution_operations set status='sending',dispatch_id=fence,authorized_at=clock_timestamp(),updated_at=clock_timestamp()
    where owner_id=p_actor and operation_id=p_operation;
  return jsonb_build_object('dispatchId',fence,'receipt',public.foliage_distribution_result(p_actor,p_operation));
end $$;
create function public.foliage_distribution_finish(p_actor uuid,p_operation uuid,p_dispatch uuid,p_status text,p_reference uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.foliage_distribution_operations;
begin
  if p_status is null or p_status not in ('accepted','rejected','unknown') or
    (p_status='accepted') is distinct from (p_reference is not null) or
    (p_reason is not null and p_reason not in ('provider-refused','rate-limited','write-not-confirmed','authority-changed','destination-unavailable')) then raise exception 'foliage_invalid'; end if;
  select * into o from public.foliage_distribution_operations where owner_id=p_actor and operation_id=p_operation for update;
  if not found or o.dispatch_id is distinct from p_dispatch or p_dispatch is null then raise exception 'foliage_forbidden'; end if;
  if o.status not in ('sending','unknown') then return public.foliage_distribution_result(p_actor,p_operation); end if;
  update public.foliage_distribution_operations set status=p_status,provider_reference=p_reference,reason=p_reason,updated_at=clock_timestamp()
    where owner_id=p_actor and operation_id=p_operation;
  return public.foliage_distribution_result(p_actor,p_operation);
end $$;
create function public.foliage_distribution_reconcile(p_actor uuid,p_operation uuid,p_reference uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.foliage_distribution_operations;
begin
  select * into o from public.foliage_distribution_operations where owner_id=p_actor and operation_id=p_operation for update;
  if not found then raise exception 'foliage_forbidden'; end if;
  if p_reference is null or not (o.status='unknown' or o.status='sending' and o.updated_at < clock_timestamp()-interval '60 seconds') then raise exception 'foliage_conflict'; end if;
  update public.foliage_distribution_operations set status='accepted',provider_reference=p_reference,reason=null,updated_at=clock_timestamp()
    where owner_id=p_actor and operation_id=p_operation;
  return public.foliage_distribution_result(p_actor,p_operation);
end $$;
create function public.foliage_distribution_cancel(p_actor uuid,p_operation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  update public.foliage_distribution_operations set status='cancelled',updated_at=clock_timestamp()
    where owner_id=p_actor and operation_id=p_operation and status='prepared';
  if not found and not exists(select 1 from public.foliage_distribution_operations where owner_id=p_actor and operation_id=p_operation and status='cancelled') then raise exception 'foliage_conflict'; end if;
  return public.foliage_distribution_result(p_actor,p_operation);
end $$;
revoke all on function public.foliage_distribution_result(uuid,uuid),public.foliage_distribution_read(uuid,uuid),
  public.foliage_distribution_list(uuid,text),public.foliage_distribution_prepare(uuid,uuid,text,uuid,bigint,text,text,uuid,text,text),
  public.foliage_distribution_start(uuid,uuid,text),public.foliage_distribution_finish(uuid,uuid,uuid,text,uuid,text),
  public.foliage_distribution_reconcile(uuid,uuid,uuid),public.foliage_distribution_cancel(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.foliage_distribution_read(uuid,uuid),public.foliage_distribution_list(uuid,text),
  public.foliage_distribution_prepare(uuid,uuid,text,uuid,bigint,text,text,uuid,text,text),public.foliage_distribution_start(uuid,uuid,text),
  public.foliage_distribution_finish(uuid,uuid,uuid,text,uuid,text),public.foliage_distribution_reconcile(uuid,uuid,uuid),
  public.foliage_distribution_cancel(uuid,uuid) to service_role;
-- A replacement/withdrawal invalidates every unsent preview in the same transaction.
create function public.foliage_distribution_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.foliage_distribution_operations set status='cancelled',reason='authority-changed',updated_at=clock_timestamp()
    where subject_id=new.subject_id and status='prepared' and
      (revision_id is distinct from new.head_revision_id or generation is distinct from new.generation);
  return new;
end $$;
revoke all on function public.foliage_distribution_invalidate() from public,anon,authenticated,service_role;
create trigger foliage_distribution_invalidate after update of head_revision_id,generation on public.foliage_subjects
  for each row execute function public.foliage_distribution_invalidate();
commit;
