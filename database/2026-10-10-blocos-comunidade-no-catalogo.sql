-- =====================================================================
-- FPSS 2027 — Blocos cadastrados: coluna "Comunidade / Parceiro"
-- Data: 2026-10-10 — pode rodar mais de uma vez (seguro).
-- Acrescenta à view blocos_resumo_bloco a comunidade/parceiro de quem
-- está com o bloco (ou para quem foi separado).
-- =====================================================================
create or replace view public.blocos_resumo_bloco as
select b.id, b.sequencial, b.numero_inicial, b.numero_final, b.quantidade,
  count(*) filter (where c.status = 'estoque')         as estoque,
  count(*) filter (where c.status = 'com_responsavel') as com_responsavel,
  count(*) filter (where c.status = 'vendida')         as vendidas,
  count(*) filter (where c.status = 'devolvida')       as devolvidas,
  (select string_agg(distinct r.nome, ', ')
     from public.blocos_entregas e join public.blocos_responsaveis r on r.id = e.responsavel_id
    where e.bloco_id = b.id and e.status <> 'cancelada') as responsaveis,
  (select string_agg(distinct r.comunidade, ', ')
     from public.blocos_entregas e join public.blocos_responsaveis r on r.id = e.responsavel_id
    where e.bloco_id = b.id and e.status <> 'cancelada' and nullif(trim(r.comunidade), '') is not null) as comunidades
from public.blocos b join public.blocos_cartelas c on c.bloco_id = b.id
group by b.id, b.sequencial, b.numero_inicial, b.numero_final, b.quantidade;

-- só o servidor lê (igual às outras tabelas dos blocos)
revoke all on public.blocos_resumo_bloco from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.blocos_resumo_bloco from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.blocos_resumo_bloco from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.blocos_resumo_bloco to service_role; end if;
end $$;
notify pgrst, 'reload schema';

select sequencial, numero_inicial, responsaveis, comunidades from public.blocos_resumo_bloco where comunidades is not null order by sequencial limit 10;
