-- Personal publication authority. Apply only to the intended isolated application project.
-- Browser roles get no table/RPC access. Verified server actors enter through service-only RPCs.
begin;

create table public.foliage_subjects (
  subject_id text primary key check (subject_id ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  generation bigint not null default 0 check (generation between 0 and 9007199254740991),
  head_revision_id uuid,
  created_at timestamptz not null default now()
);
create index foliage_subjects_owner on public.foliage_subjects(owner_id, subject_id);

create table public.foliage_publication_revisions (
  revision_id uuid primary key,
  subject_id text not null references public.foliage_subjects(subject_id) on delete restrict,
  object_key text not null unique,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_bytes integer not null check (artifact_bytes between 1 and 2097152),
  admission jsonb not null check (jsonb_typeof(admission) = 'object'),
  created_at timestamptz not null default now(),
  unique(subject_id, revision_id)
);
alter table public.foliage_subjects add constraint foliage_head_belongs_to_subject
  foreign key (subject_id, head_revision_id)
  references public.foliage_publication_revisions(subject_id, revision_id) on delete restrict;

create table public.foliage_publication_operations (
  owner_id uuid not null references auth.users(id) on delete restrict,
  operation_id text not null check (operation_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  subject_id text not null references public.foliage_subjects(subject_id) on delete restrict,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  kind text not null check (kind in ('publish', 'withdraw')),
  revision_id uuid,
  generation bigint not null check (generation between 0 and 9007199254740991),
  committed_at timestamptz not null default now(),
  primary key(owner_id, operation_id),
  foreign key(subject_id, revision_id) references public.foliage_publication_revisions(subject_id, revision_id),
  check ((kind = 'publish' and revision_id is not null) or (kind = 'withdraw' and revision_id is null))
);
create table public.foliage_publication_history (
  history_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  operation_id text not null,
  subject_id text not null references public.foliage_subjects(subject_id),
  kind text not null check (kind in ('publish', 'withdraw')),
  from_revision_id uuid,
  to_revision_id uuid,
  from_generation bigint not null,
  to_generation bigint not null,
  recorded_at timestamptz not null default now(),
  unique(owner_id, operation_id),
  foreign key(owner_id, operation_id) references public.foliage_publication_operations(owner_id, operation_id)
);
create index foliage_history_subject on public.foliage_publication_history(subject_id, recorded_at, history_id);
create table public.foliage_publication_outbox (
  event_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  operation_id text not null,
  subject_id text not null references public.foliage_subjects(subject_id),
  kind text not null check (kind in ('publication.committed', 'publication.withdrawn')),
  revision_id uuid,
  generation bigint not null,
  status text not null default 'pending' check (status = 'pending'),
  recorded_at timestamptz not null default now(),
  unique(owner_id, operation_id),
  foreign key(owner_id, operation_id) references public.foliage_publication_operations(owner_id, operation_id)
);
create index foliage_outbox_pending on public.foliage_publication_outbox(recorded_at, event_id) where status = 'pending';

alter table public.foliage_subjects enable row level security;
alter table public.foliage_publication_revisions enable row level security;
alter table public.foliage_publication_operations enable row level security;
alter table public.foliage_publication_history enable row level security;
alter table public.foliage_publication_outbox enable row level security;
revoke all on public.foliage_subjects, public.foliage_publication_revisions,
  public.foliage_publication_operations, public.foliage_publication_history,
  public.foliage_publication_outbox from public, anon, authenticated, service_role;

-- A reservation is permanent; this API never deletes/recycles an identifier or changes its owner.
create function public.foliage_reserve_subject(p_actor uuid, p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.foliage_subjects;
begin
  if p_actor is null or p_subject is null or p_subject !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'foliage_invalid';
  end if;
  if not exists(select 1 from auth.users where id = p_actor) then raise exception 'foliage_forbidden'; end if;
  insert into public.foliage_subjects(subject_id, owner_id) values(p_subject, p_actor) on conflict do nothing;
  select * into s from public.foliage_subjects where subject_id = p_subject;
  if s.owner_id is distinct from p_actor then raise exception 'foliage_forbidden'; end if;
  return jsonb_build_object('subjectId',s.subject_id,'actorId',s.owner_id,'revisionId',s.head_revision_id,
    'generation',s.generation,'visible',s.head_revision_id is not null);
end $$;

-- Internal receipt formatter; callers authorize ownership before invoking it.
create function public.foliage_operation_result(p_actor uuid, p_operation_id text, p_replayed boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('requestHash',o.request_hash,'replayed',p_replayed,
    'receipt',jsonb_build_object('operationId',o.operation_id,'subjectId',o.subject_id,'kind',o.kind,
      'revisionId',o.revision_id,'generation',o.generation,'committedAt',o.committed_at),
    'current',jsonb_build_object('subjectId',s.subject_id,'revisionId',s.head_revision_id,
      'generation',s.generation,'visible',s.head_revision_id is not null))
  from public.foliage_publication_operations o join public.foliage_subjects s using(subject_id)
  where o.owner_id = p_actor and o.operation_id = p_operation_id and s.owner_id = p_actor;
$$;
create function public.foliage_get_operation(p_actor uuid, p_operation_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or p_operation_id is null or p_operation_id !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'foliage_invalid'; end if;
  return public.foliage_operation_result(p_actor,p_operation_id,true);
end $$;

create function public.foliage_commit_publication(
  p_actor uuid, p_operation_id text, p_subject text, p_request_hash text, p_kind text,
  p_expected_revision uuid, p_expected_generation bigint, p_revision uuid, p_object_key text,
  p_artifact_digest text, p_artifact_bytes integer, p_admission jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.foliage_subjects;
  prior public.foliage_publication_operations;
  next_generation bigint;
  at_time timestamptz := clock_timestamp();
begin
  if p_actor is null or p_operation_id is null or p_operation_id !~ '^[a-zA-Z0-9_-]{1,128}$' or
      p_subject is null or p_subject !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' or
      p_request_hash is null or p_request_hash !~ '^sha256:[0-9a-f]{64}$' or
      p_kind is null or p_kind not in ('publish','withdraw') or
      p_expected_generation is null or p_expected_generation < 0 or p_expected_generation >= 9007199254740991 then
    raise exception 'foliage_invalid';
  end if;
  -- Same-operation writers serialize even when malicious input changes its subject.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_operation_id,0));
  select * into prior from public.foliage_publication_operations
    where owner_id = p_actor and operation_id = p_operation_id;
  if found then
    if prior.request_hash <> p_request_hash or prior.subject_id <> p_subject or prior.kind <> p_kind then
      raise exception 'foliage_conflict';
    end if;
    if not exists(select 1 from public.foliage_subjects where subject_id=p_subject and owner_id=p_actor) then
      raise exception 'foliage_forbidden';
    end if;
    return public.foliage_operation_result(p_actor,p_operation_id,true);
  end if;
  select * into s from public.foliage_subjects where subject_id = p_subject for update;
  if not found or s.owner_id is distinct from p_actor then raise exception 'foliage_forbidden'; end if;
  if s.head_revision_id is distinct from p_expected_revision or s.generation <> p_expected_generation then
    raise exception 'foliage_conflict';
  end if;
  if p_kind = 'publish' then
    if p_revision is null or p_object_key is distinct from (p_actor::text || '/' || p_subject || '/' || p_revision::text || '.json') or
        p_artifact_digest is null or p_artifact_digest !~ '^sha256:[0-9a-f]{64}$' or
        p_artifact_bytes is null or p_artifact_bytes not between 1 and 2097152 or
        p_admission is null or jsonb_typeof(p_admission) <> 'object' or
        p_admission->>'actorId' is distinct from p_actor::text or
        p_admission->>'subjectId' is distinct from p_subject or
        p_admission->>'operationId' is distinct from p_operation_id or
        p_admission->>'artifactDigest' is distinct from p_artifact_digest or
        p_admission->>'expectedRevisionId' is distinct from p_expected_revision::text or
        p_admission->>'expectedGeneration' is distinct from p_expected_generation::text or
        coalesce(p_admission->>'policyDigest','') !~ '^sha256:[0-9a-f]{64}$' or
        coalesce(p_admission->>'admissionId','') !~ '^sha256:[0-9a-f]{64}$' or
        coalesce(p_admission->>'consentId','') !~ '^sha256:[0-9a-f]{64}$' then
      raise exception 'foliage_invalid';
    end if;
    insert into public.foliage_publication_revisions(revision_id,subject_id,object_key,artifact_digest,artifact_bytes,admission)
      values(p_revision,p_subject,p_object_key,p_artifact_digest,p_artifact_bytes,p_admission);
  elsif p_revision is not null or p_object_key is not null or p_artifact_digest is not null or
      p_artifact_bytes is not null or p_admission is not null then raise exception 'foliage_invalid';
  end if;
  next_generation := s.generation + 1;
  update public.foliage_subjects set head_revision_id = p_revision,generation = next_generation where subject_id = p_subject;
  insert into public.foliage_publication_operations(owner_id,operation_id,subject_id,request_hash,kind,revision_id,generation,committed_at)
    values(p_actor,p_operation_id,p_subject,p_request_hash,p_kind,p_revision,next_generation,at_time);
  insert into public.foliage_publication_history(owner_id,operation_id,subject_id,kind,from_revision_id,to_revision_id,from_generation,to_generation,recorded_at)
    values(p_actor,p_operation_id,p_subject,p_kind,s.head_revision_id,p_revision,s.generation,next_generation,at_time);
  insert into public.foliage_publication_outbox(owner_id,operation_id,subject_id,kind,revision_id,generation,recorded_at)
    values(p_actor,p_operation_id,p_subject,case when p_kind='publish' then 'publication.committed' else 'publication.withdrawn' end,p_revision,next_generation,at_time);
  return public.foliage_operation_result(p_actor,p_operation_id,false);
end $$;

-- No public SQL role executes this: the server checks authority and proxies private bytes.
create function public.foliage_publication_head(p_subject text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('subjectId',s.subject_id,'revisionId',s.head_revision_id,
    'generation',s.generation,'visible',true,'objectKey',r.object_key,
    'artifactDigest',r.artifact_digest,'artifactBytes',r.artifact_bytes)
  from public.foliage_subjects s join public.foliage_publication_revisions r
    on r.subject_id = s.subject_id and r.revision_id = s.head_revision_id
  where s.subject_id = p_subject;
$$;
create function public.foliage_owned_publications(p_actor uuid, p_after text default null, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or p_limit is null or p_limit not between 1 and 200 then raise exception 'foliage_invalid'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('subjectId',s.subject_id,'actorId',s.owner_id,
    'revisionId',s.head_revision_id,'generation',s.generation,'visible',s.head_revision_id is not null)
    order by s.subject_id),'[]'::jsonb)
    from (select * from public.foliage_subjects where owner_id=p_actor and (p_after is null or subject_id>p_after)
      order by subject_id limit p_limit) s);
end $$;

revoke all on function public.foliage_reserve_subject(uuid,text), public.foliage_operation_result(uuid,text,boolean),
  public.foliage_get_operation(uuid,text), public.foliage_commit_publication(uuid,text,text,text,text,uuid,bigint,uuid,text,text,integer,jsonb),
  public.foliage_publication_head(text), public.foliage_owned_publications(uuid,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.foliage_reserve_subject(uuid,text), public.foliage_get_operation(uuid,text),
  public.foliage_commit_publication(uuid,text,text,text,text,uuid,bigint,uuid,text,text,integer,jsonb),
  public.foliage_publication_head(text), public.foliage_owned_publications(uuid,text,integer) to service_role;

-- Refuse incompatible existing storage rather than silently making previously public objects private.
do $$ begin
  if exists(select 1 from storage.buckets where id='foliage-publications' and public) then
    raise exception 'Existing foliage-publications bucket is public; inspect it before migration';
  end if;
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('foliage-publications','foliage-publications',false,2097152,array['application/json']) on conflict(id) do nothing;
end $$;
-- Restrictive policy also blocks this bucket if another permissive client policy already exists.
create policy foliage_publications_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'foliage-publications') with check (bucket_id <> 'foliage-publications');
commit;
