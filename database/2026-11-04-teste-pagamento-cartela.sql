-- =====================================================================
-- FPSS 2027 — Teste de pagamento de cartela (R$ 0,01 só para o CPF do admin)
--             + registro de vendas canceladas (cartela volta a "disponível")
-- Data: 2026-11-04 — SEGURO: só cria 2 tabelas novas; não mexe em "cartelas".
-- Pode rodar mais de uma vez.
-- =====================================================================

-- Uma única linha (id = 1): qual CPF paga R$ 0,01 e até quando.
create table if not exists public.cartelas_teste_pix (
  id              int primary key default 1 check (id = 1),
  cpf             text,
  valor_centavos  int  not null default 1 check (valor_centavos between 1 and 100),
  valido_ate      timestamptz,
  atualizado_por  text,
  atualizado_em   timestamptz not null default now()
);

-- Quem cancelou o quê (a venda some da cartela, mas fica registrada aqui).
create table if not exists public.cartelas_cancelamentos (
  id               bigint generated always as identity primary key,
  cartela_id       bigint not null,
  numero_chance1   text,
  tipo             text,
  lote             text,
  status_anterior  text,
  nome_comprador   text,
  cpf_comprador    text,
  valor_pago       numeric,
  pix_id           text,
  data_pagamento   timestamptz,
  motivo           text,
  cancelado_por    text,
  cancelado_em     timestamptz not null default now()
);

alter table public.cartelas_teste_pix      enable row level security;
alter table public.cartelas_cancelamentos  enable row level security;
-- sem política = só o servidor (service_role) acessa

grant select, insert, update, delete on public.cartelas_teste_pix     to service_role;
grant select, insert, update, delete on public.cartelas_cancelamentos to service_role;
grant usage, select on all sequences in schema public to service_role;

select 'Teste de pagamento e cancelamento de venda instalados' as resultado;
