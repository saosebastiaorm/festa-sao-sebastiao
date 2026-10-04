-- =====================================================================
-- FPSS 2027 — Número do caixa (Caixa 1, Caixa 2...)
-- Data: 2026-10-04 — rodar DEPOIS do 2026-10-04c-horario-por-produto.sql
-- Seguro para rodar mais de uma vez.
-- =====================================================================

alter table public.caixa_sessoes add column if not exists numero integer;

-- um mesmo número não pode estar aberto em dois lugares ao mesmo tempo
create unique index if not exists caixa_numero_aberto
  on public.caixa_sessoes (numero)
  where status = 'aberto' and numero is not null;

select 'Número do caixa instalado' as resultado;
