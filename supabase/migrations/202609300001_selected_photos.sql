-- Selected images remain in the same private, service-only bucket. The artifact digest
-- commits the closed image manifest (source/rendition digests, size/container, selected text).
-- Stage images under owner/subject/revision before the existing publication transaction.
-- No separate media authority: current publication generation governs every image request.
do $$ begin
  if to_regclass('storage.buckets') is null then raise exception 'foliage_storage_bucket_table_required'; end if;
  update storage.buckets set allowed_mime_types = array['application/json','image/jpeg','image/png','image/gif']
    where id = 'foliage-publications' and public = false;
  if not found then raise exception 'foliage_private_publication_bucket_required'; end if;
end $$;
