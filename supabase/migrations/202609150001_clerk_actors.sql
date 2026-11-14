-- Clerk identity is separate from provider-independent portfolio ownership.
begin;
create table public.foliage_actors (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  unique(issuer, subject)
);
alter table public.foliage_actors enable row level security;
revoke all on public.foliage_actors from public, anon, authenticated, service_role;
-- Keep every existing UUID and its ownership; never merge providers by email.
insert into public.foliage_actors(id, issuer, subject)
  select id, 'legacy:supabase-auth', id::text from auth.users;
alter table public.foliage_subjects drop constraint foliage_subjects_owner_id_fkey;
alter table public.foliage_subjects add constraint foliage_subjects_owner_id_fkey foreign key (owner_id) references public.foliage_actors(id) on delete restrict;
alter table public.foliage_publication_operations drop constraint foliage_publication_operations_owner_id_fkey;
alter table public.foliage_publication_operations add constraint foliage_publication_operations_owner_id_fkey foreign key (owner_id) references public.foliage_actors(id) on delete restrict;
alter table public.foliage_notification_preferences drop constraint foliage_notification_preferences_owner_id_fkey;
alter table public.foliage_notification_preferences add constraint foliage_notification_preferences_owner_id_fkey foreign key (owner_id) references public.foliage_actors(id) on delete restrict;
alter table public.foliage_notification_attempts drop constraint foliage_notification_attempts_recipient_id_fkey;
alter table public.foliage_notification_attempts add constraint foliage_notification_attempts_recipient_id_fkey foreign key (recipient_id) references public.foliage_actors(id) on delete restrict;

create function public.foliage_resolve_actor(p_issuer text, p_subject text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if p_issuer is null or p_issuer !~ '^https://[a-z0-9.-]+$' or length(p_issuer)>255
    or p_subject is null or p_subject !~ '^user_[A-Za-z0-9]+$' or length(p_subject)>255
    then raise exception 'foliage_invalid'; end if;
  insert into public.foliage_actors(issuer,subject) values(p_issuer,p_subject) on conflict do nothing;
  select id into actor from public.foliage_actors where issuer=p_issuer and subject=p_subject;
  return actor;
end $$;
revoke all on function public.foliage_resolve_actor(text,text) from public, anon, authenticated;
grant execute on function public.foliage_resolve_actor(text,text) to service_role;
create or replace function public.foliage_reserve_subject(p_actor uuid, p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.foliage_subjects;
begin
  if p_actor is null or p_subject is null or p_subject !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'foliage_invalid';
  end if;
  if not exists(select 1 from public.foliage_actors where id = p_actor) then raise exception 'foliage_forbidden'; end if;
  insert into public.foliage_subjects(subject_id, owner_id) values(p_subject, p_actor) on conflict do nothing;
  select * into s from public.foliage_subjects where subject_id = p_subject;
  if s.owner_id is distinct from p_actor then raise exception 'foliage_forbidden'; end if;
  return jsonb_build_object('subjectId',s.subject_id,'actorId',s.owner_id,'revisionId',s.head_revision_id,
    'generation',s.generation,'visible',s.head_revision_id is not null);
end $$;

create or replace function public.foliage_notification_preferences(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null or not exists(select 1 from public.foliage_actors where id=p_actor) then raise exception 'foliage_forbidden'; end if;
  return coalesce((select jsonb_build_object('inbox',inbox,'email',email,'sms',sms)
    from public.foliage_notification_preferences where owner_id=p_actor),
    jsonb_build_object('inbox',true,'email',false,'sms',false));
end $$;
commit;
