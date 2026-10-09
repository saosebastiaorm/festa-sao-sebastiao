-- =====================================================================
-- FPSS 2027 — Blocos: escolher em cada plano se manda as cartas
-- Data: 2026-10-09 — pode rodar mais de uma vez (seguro).
-- Na primeira vez, deixa marcado só o plano "Comunidade da paróquia"
-- (que já era o único com cartas). Depois é só marcar/desmarcar em
-- Blocos → Planos e configuração → coluna "Carta?".
-- =====================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'blocos_planos' and column_name = 'envia_carta') then
    alter table public.blocos_planos add column envia_carta boolean not null default false;
    update public.blocos_planos set envia_carta = true where nome ilike 'comunidade%';
  end if;
end $$;

select nome, comissao_pct, cobra, envia_carta, ativo from public.blocos_planos order by ordem, id;
