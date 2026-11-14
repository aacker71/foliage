-- One account reserves at most 3 portfolio addresses through the service RPC. Reservations
-- stay permanent, so addresses taken offline still count; an address the account already
-- owns stays reachable at the cap. Keep the literal equal to MAX_ADDRESSES_PER_ACCOUNT in
-- apps/canopy/src/hostedStore.ts (its test compares them). An operator raises one account's
-- allowance by inserting the requested foliage_subjects row directly, outside this RPC.
begin;
create or replace function public.foliage_reserve_subject(p_actor uuid, p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.foliage_subjects;
begin
  if p_actor is null or p_subject is null or p_subject !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'foliage_invalid';
  end if;
  -- The actor row lock counts one account's concurrent reservations one at a time.
  perform 1 from public.foliage_actors where id = p_actor for no key update;
  if not found then raise exception 'foliage_forbidden'; end if;
  select * into s from public.foliage_subjects where subject_id = p_subject;
  if not found then
    if (select count(*) from public.foliage_subjects where owner_id = p_actor) >= 3 then
      raise exception 'foliage_address_limit';
    end if;
    insert into public.foliage_subjects(subject_id, owner_id) values(p_subject, p_actor) on conflict do nothing;
    select * into s from public.foliage_subjects where subject_id = p_subject;
  end if;
  if s.owner_id is distinct from p_actor then raise exception 'foliage_forbidden'; end if;
  return jsonb_build_object('subjectId',s.subject_id,'actorId',s.owner_id,'revisionId',s.head_revision_id,
    'generation',s.generation,'visible',s.head_revision_id is not null);
end $$;
revoke all on function public.foliage_reserve_subject(uuid,text) from public, anon, authenticated;
grant execute on function public.foliage_reserve_subject(uuid,text) to service_role;
commit;
