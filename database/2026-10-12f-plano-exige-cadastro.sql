-- Planos de blocos que exigem cadastro de vendedor (2026-10-12)
-- RODAR DEPOIS de 2026-10-12e-vendedores-cartela.sql. Pode rodar mais de uma vez.
-- Em Blocos → Planos e configuração aparece a coluna "Cadastro?": se marcada, só dá para
-- entregar blocos nesse plano a quem estiver em Vendedores de cartela.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'blocos_planos' and column_name = 'exige_cadastro') then
    alter table public.blocos_planos add column exige_cadastro boolean not null default false;
    -- na primeira vez, já marca o plano de ambulantes (era o motivo do cadastro)
    update public.blocos_planos set exige_cadastro = true where nome ilike 'ambulante%';
  end if;
end $$;

alter table public.blocos_responsaveis
  add column if not exists vendedor_id bigint references public.vendedores_cartela(id) on delete set null;
create unique index if not exists blocos_resp_vendedor_uq on public.blocos_responsaveis (vendedor_id) where vendedor_id is not null;

select nome, comissao_pct, cobra, exige_cadastro, ativo from public.blocos_planos order by ordem, id;
