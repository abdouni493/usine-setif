-- =============================================================================
--  10 — IMAGES DES PRODUITS DU STOCK
--  Ré-exécutable sans risque. À lancer dans Supabase › SQL editor › Run.
-- =============================================================================

-- colonne de l'image d'un produit (déjà présente sur une installation récente)
alter table public.products add column if not exists image_url text;

-- bucket public des images de produits
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- lecture publique, écriture par l'admin ou un employé ayant le module stock / achats / production
drop policy if exists "papeterie public read" on storage.objects;
drop policy if exists "papeterie product-images write" on storage.objects;
drop policy if exists "papeterie product-images update" on storage.objects;
drop policy if exists "papeterie product-images delete" on storage.objects;

create policy "papeterie public read" on storage.objects for select to anon, authenticated
  using (bucket_id in ('store-assets', 'product-images'));
create policy "papeterie product-images write" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images'
              and public.has_any_perm(array['stock','purchase','production'], 'create'));
create policy "papeterie product-images update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images'
         and public.has_any_perm(array['stock','purchase','production'], 'edit'));
create policy "papeterie product-images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_any_perm(array['stock'], 'delete'));

notify pgrst, 'reload schema';
