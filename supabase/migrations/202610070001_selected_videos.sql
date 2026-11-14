-- Reviewed H.264 demos use the existing private publication bucket and revision-scoped
-- object keys. Current publication authority governs every clip request; storage never
-- becomes public and no direct signed video URL is issued.
do $$ begin
  if to_regclass('storage.buckets') is null then raise exception 'foliage_storage_bucket_table_required'; end if;
  update storage.buckets
    set allowed_mime_types = array['application/json','image/jpeg','image/png','image/gif','video/mp4']
    where id = 'foliage-publications' and public = false;
  if not found then raise exception 'foliage_private_publication_bucket_required'; end if;
end $$;
