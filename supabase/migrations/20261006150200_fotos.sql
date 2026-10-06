-- RotaFibra - Fase 2 - passo 3/4: bucket privado para as fotos e politicas equivalentes as das tabelas.
-- Caminho do arquivo: <owner_id>/<foto_id>.jpg  (a primeira pasta e o dono: e isso que a politica confere)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 3145728, array['image/jpeg'])      -- ate 3 MB; so JPEG (o app envia ~0,2-0,4 MB)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Leitura: qualquer perfil ativo (tecnico le a rede toda; o painel usa URLs assinadas).
create policy fotos_read on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.my_role() is not null);

-- Escrita: so na propria pasta, so tecnico/admin, e so com o nome <uuid>/<uuid>.jpg.
create policy fotos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos'
    and public.my_role() in ('tecnico', 'admin')
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

-- Reenvio da mesma foto (nova tentativa com upsert) so na propria pasta.
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.my_role() in ('tecnico', 'admin') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Sem politica de delete: a foto "excluida" continua no bucket; o registro em public.photos marca deleted = true.

-- fim: fotos
