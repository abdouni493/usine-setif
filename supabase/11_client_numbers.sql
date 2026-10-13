-- =============================================================================
--  11 — N° DES CLIENTS (01, 02, 03 …)
--  Ré-exécutable sans risque. À lancer dans Supabase › SQL editor › Run.
--  Les clients existants sont numérotés dans leur ordre de création ; chaque
--  nouveau client reçoit automatiquement le N° suivant.
-- =============================================================================

alter table public.clients add column if not exists client_no integer;

create sequence if not exists public.clients_client_no_seq owned by public.clients.client_no;

-- numérote les clients qui n'ont pas encore de N°, à la suite des N° existants
with base as (select coalesce(max(client_no), 0) as m from public.clients),
ranked as (
  select id, row_number() over (order by created_at, id) as rn
  from public.clients where client_no is null
)
update public.clients c set client_no = base.m + ranked.rn
from ranked, base where c.id = ranked.id;

select setval('public.clients_client_no_seq',
              greatest((select coalesce(max(client_no), 0) from public.clients), 1),
              (select count(*) > 0 from public.clients where client_no is not null));

alter table public.clients alter column client_no set default nextval('public.clients_client_no_seq');
create unique index if not exists clients_client_no_key on public.clients (client_no);

notify pgrst, 'reload schema';
