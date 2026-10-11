-- =====================================================================
-- DASHBOARD GERAL: caixa (dinheiro/pix/cartão), cartelas e blocos
-- Rode no SQL Editor do Supabase (depois dos SQLs 11b e 11c).
-- =====================================================================
create or replace function public.fpss_dashboard_geral() returns jsonb
language plpgsql stable as $$
declare
  v_caixa jsonb; v_site jsonb; v_cart jsonb; v_blocos jsonb;
  v_tem_tipo boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pedido_pagamentos' and column_name = 'cartao_tipo')
    into v_tem_tipo;

  /* ---------- CAIXA: cada parte do pagamento na sua forma ---------- */
  with pagos as (
    select p.id, p.valor_total, p.forma_pagamento
      from public.pedidos p
     where p.origem = 'caixa' and p.status_pagamento = 'pago' and p.reembolsado_em is null
  ),
  linhas as (
    select pp.pedido_id, pp.forma, pp.valor,
           case when v_tem_tipo then (to_jsonb(pp) ->> 'cartao_tipo') end as tipo
      from public.pedido_pagamentos pp where pp.pedido_id in (select id from pagos)
    union all
    select g.id, g.forma_pagamento, g.valor_total, null
      from pagos g where not exists (select 1 from public.pedido_pagamentos x where x.pedido_id = g.id)
  )
  select jsonb_build_object(
    'vendas',       (select count(*) from pagos),
    'itens',        coalesce((select sum(i.quantidade) from public.pedido_itens i where i.pedido_id in (select id from pagos)), 0),
    'total',        coalesce((select sum(valor) from linhas), 0),
    'dinheiro',     coalesce((select sum(valor) from linhas where forma = 'dinheiro'), 0),
    'pix',          coalesce((select sum(valor) from linhas where forma = 'pix'), 0),
    'cartao',       coalesce((select sum(valor) from linhas where forma = 'cartao'), 0),
    'cartao_debito',  coalesce((select sum(valor) from linhas where forma = 'cartao' and tipo = 'debito'), 0),
    'cartao_credito', coalesce((select sum(valor) from linhas where forma = 'cartao' and tipo = 'credito'), 0),
    'cartao_sem_tipo', coalesce((select sum(valor) from linhas where forma = 'cartao' and coalesce(tipo, '') not in ('debito', 'credito')), 0),
    'caixas_abertos', (select count(*) from public.caixa_sessoes where status = 'aberto'),
    'caixas_total',   (select count(*) from public.caixa_sessoes)
  ) into v_caixa;

  /* ---------- SITE (pedidos online) ---------- */
  select jsonb_build_object(
    'pedidos',  count(*),
    'pagos',    count(*) filter (where status_pagamento = 'pago' and reembolsado_em is null),
    'receita',  coalesce(sum(valor_total) filter (where status_pagamento = 'pago' and reembolsado_em is null), 0)
  ) into v_site from public.pedidos where coalesce(origem, 'site') <> 'caixa';

  /* ---------- CARTELAS (site: digitais e físicas) ---------- */
  select jsonb_build_object(
    'total', count(*),
    'pagas', count(*) filter (where status = 'pago'),
    'pendentes', count(*) filter (where status = 'pendente'),
    'disponiveis', count(*) filter (where status = 'disponivel'),
    'digitais_pagas', count(*) filter (where status = 'pago' and tipo = 'digital'),
    'fisicas_pagas', count(*) filter (where status = 'pago' and tipo = 'fisica'),
    'valor_pago', coalesce(sum(valor_pago) filter (where status = 'pago'), 0)
  ) into v_cart from public.cartelas;

  /* ---------- BLOCOS (distribuição e prestação de contas) ---------- */
  select jsonb_build_object(
    'blocos', (select count(*) from public.blocos),
    'cartelas', (select count(*) from public.blocos_cartelas),
    'estoque', (select count(*) from public.blocos_cartelas where status = 'estoque'),
    'com_responsavel', (select count(*) from public.blocos_cartelas where status = 'com_responsavel'),
    'vendidas', (select count(*) from public.blocos_cartelas where status = 'vendida'),
    'devolvidas', (select count(*) from public.blocos_cartelas where status = 'devolvida'),
    'bruto', coalesce((select sum(valor_bruto) from public.blocos_acertos where not desfeito), 0),
    'comissao', coalesce((select sum(valor_comissao) from public.blocos_acertos where not desfeito), 0),
    'devido', coalesce((select sum(valor_devido) from public.blocos_acertos where not desfeito), 0),
    'recebido', coalesce((select sum(valor_pago) from public.blocos_acertos where not desfeito), 0),
    'dinheiro', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id where not a.desfeito and g.forma = 'dinheiro'), 0),
    'pix', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id where not a.desfeito and g.forma = 'pix'), 0),
    'cartao_debito', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id where not a.desfeito and g.forma = 'cartao_debito'), 0),
    'cartao_credito', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id where not a.desfeito and g.forma = 'cartao_credito'), 0),
    'pix_site', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id where not a.desfeito and g.forma = 'pix_site'), 0),
    'responsaveis_com_saldo', (select count(*) from public.blocos_resumo_responsavel where saldo > 0)
  ) into v_blocos;

  return jsonb_build_object('caixa', v_caixa, 'site', v_site, 'cartelas', v_cart, 'blocos', v_blocos);
end;
$$;
grant execute on function public.fpss_dashboard_geral() to service_role;
notify pgrst, 'reload schema';
