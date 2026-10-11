-- =====================================================================
-- RELATÓRIOS PARA IMPRESSÃO: caixa, cartelas e blocos
-- Rode no SQL Editor do Supabase (depois dos SQLs 11b e 11c).
-- Datas no horário de Rondônia (America/Porto_Velho).
-- =====================================================================

/* ---------- CAIXA: por sessão (caixa aberto/fechado) no período ---------- */
-- linhas de pagamento das vendas pagas do caixa no período (cada parte na sua forma)
create or replace function public.fpss_caixa_linhas(p_de date, p_ate date)
returns table (sessao_id bigint, forma text, tipo text, valor numeric)
language plpgsql stable as $$
declare v_tem_tipo boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pedido_pagamentos' and column_name = 'cartao_tipo')
    into v_tem_tipo;
  return query
  with pagos as (
    select p.id, p.caixa_sessao_id, p.valor_total, p.forma_pagamento
      from public.pedidos p
      join public.caixa_sessoes s on s.id = p.caixa_sessao_id
     where p.origem = 'caixa' and p.status_pagamento = 'pago' and p.reembolsado_em is null
       and (s.aberto_em at time zone 'America/Porto_Velho')::date between p_de and p_ate
  )
  select g.caixa_sessao_id, pp.forma,
         case when v_tem_tipo then (to_jsonb(pp) ->> 'cartao_tipo') end, pp.valor
    from pagos g join public.pedido_pagamentos pp on pp.pedido_id = g.id
  union all
  select g.caixa_sessao_id, g.forma_pagamento, null::text, g.valor_total
    from pagos g where not exists (select 1 from public.pedido_pagamentos x where x.pedido_id = g.id);
end;
$$;

create or replace function public.fpss_relatorio_caixa(p_de date, p_ate date) returns jsonb
language plpgsql stable as $$
declare v_sessoes jsonb; v_produtos jsonb; v_tot jsonb;
begin
  select coalesce(jsonb_agg(x order by x.aberto_em), '[]'::jsonb) into v_sessoes from (
    select s.id, s.numero, s.usuario_nome as operador, s.status, s.aberto_em, s.fechado_em, s.troco_inicial,
           (select count(*) from public.pedidos p where p.caixa_sessao_id = s.id and p.origem = 'caixa'
               and p.status_pagamento = 'pago' and p.reembolsado_em is null) as vendas,
           coalesce((select sum(l.valor) from public.fpss_caixa_linhas(p_de, p_ate) l where l.sessao_id = s.id and l.forma = 'dinheiro'), 0) as dinheiro,
           coalesce((select sum(l.valor) from public.fpss_caixa_linhas(p_de, p_ate) l where l.sessao_id = s.id and l.forma = 'pix'), 0) as pix,
           coalesce((select sum(l.valor) from public.fpss_caixa_linhas(p_de, p_ate) l where l.sessao_id = s.id and l.forma = 'cartao'), 0) as cartao,
           coalesce((select sum(l.valor) from public.fpss_caixa_linhas(p_de, p_ate) l where l.sessao_id = s.id and l.forma = 'cartao' and l.tipo = 'debito'), 0) as cartao_debito,
           coalesce((select sum(l.valor) from public.fpss_caixa_linhas(p_de, p_ate) l where l.sessao_id = s.id and l.forma = 'cartao' and l.tipo = 'credito'), 0) as cartao_credito,
           coalesce((select sum(m.valor) from public.caixa_movimentos m where m.sessao_id = s.id and m.tipo = 'sangria'), 0) as sangrias,
           coalesce((select sum(m.valor) from public.caixa_movimentos m where m.sessao_id = s.id and m.tipo = 'suprimento'), 0) as suprimentos,
           s.dinheiro_esperado, s.dinheiro_contado, s.diferenca
      from public.caixa_sessoes s
     where (s.aberto_em at time zone 'America/Porto_Velho')::date between p_de and p_ate
  ) x;

  select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb) into v_produtos from (
    select i.produto_nome as nome, sum(i.quantidade) as quantidade, sum(i.quantidade * i.preco_unitario) as valor
      from public.pedido_itens i
      join public.pedidos p on p.id = i.pedido_id
      join public.caixa_sessoes s on s.id = p.caixa_sessao_id
     where p.origem = 'caixa' and p.status_pagamento = 'pago' and p.reembolsado_em is null
       and (s.aberto_em at time zone 'America/Porto_Velho')::date between p_de and p_ate
     group by i.produto_nome
  ) x;

  select jsonb_build_object(
    'dinheiro', coalesce(sum(valor) filter (where forma = 'dinheiro'), 0),
    'pix', coalesce(sum(valor) filter (where forma = 'pix'), 0),
    'cartao', coalesce(sum(valor) filter (where forma = 'cartao'), 0),
    'cartao_debito', coalesce(sum(valor) filter (where forma = 'cartao' and tipo = 'debito'), 0),
    'cartao_credito', coalesce(sum(valor) filter (where forma = 'cartao' and tipo = 'credito'), 0),
    'total', coalesce(sum(valor), 0)
  ) into v_tot from public.fpss_caixa_linhas(p_de, p_ate);

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'sessoes', v_sessoes, 'produtos', v_produtos, 'totais', v_tot);
end;
$$;

/* ---------- CARTELAS: resumo por lote + pagas no período ---------- */
create or replace function public.fpss_relatorio_cartelas(p_de date, p_ate date) returns jsonb
language plpgsql stable as $$
declare v_lotes jsonb; v_pagas jsonb; v_res jsonb; v_trunc boolean; v_n int;
begin
  select coalesce(jsonb_agg(x order by x.lote), '[]'::jsonb) into v_lotes from (
    select lote, tipo, count(*) as total,
           count(*) filter (where status = 'pago') as pagas,
           count(*) filter (where status = 'pendente') as pendentes,
           count(*) filter (where status = 'disponivel') as disponiveis,
           coalesce(sum(valor_pago) filter (where status = 'pago'), 0) as valor
      from public.cartelas group by lote, tipo
  ) x;

  select count(*) into v_n from public.cartelas
   where status = 'pago' and (data_pagamento at time zone 'America/Porto_Velho')::date between p_de and p_ate;
  v_trunc := v_n > 3000;

  select coalesce(jsonb_agg(x order by x.data_pagamento), '[]'::jsonb) into v_pagas from (
    select numero_chance1 as numero, tipo, lote, nome_comprador as comprador, valor_pago as valor, data_pagamento,
           (pix_id is not null) as via_pix
      from public.cartelas
     where status = 'pago' and (data_pagamento at time zone 'America/Porto_Velho')::date between p_de and p_ate
     order by data_pagamento limit 3000
  ) x;

  select jsonb_build_object(
    'pagas_periodo', v_n,
    'valor_periodo', coalesce((select sum(valor_pago) from public.cartelas where status = 'pago'
        and (data_pagamento at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0),
    'digitais_periodo', (select count(*) from public.cartelas where status = 'pago' and tipo = 'digital'
        and (data_pagamento at time zone 'America/Porto_Velho')::date between p_de and p_ate),
    'fisicas_periodo', (select count(*) from public.cartelas where status = 'pago' and tipo = 'fisica'
        and (data_pagamento at time zone 'America/Porto_Velho')::date between p_de and p_ate)
  ) into v_res;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'lotes', v_lotes, 'pagas', v_pagas, 'truncada', v_trunc, 'resumo', v_res);
end;
$$;

/* ---------- BLOCOS: situação por responsável + acertos do período ---------- */
create or replace function public.fpss_relatorio_blocos(p_de date, p_ate date, p_so_saldo boolean default false) returns jsonb
language plpgsql stable as $$
declare v_resp jsonb; v_ac jsonb; v_tot jsonb; v_comunidades jsonb;
begin
  select coalesce(jsonb_agg(x order by x.comunidade nulls last, x.nome), '[]'::jsonb) into v_resp from (
    select r.id, r.nome, r.comunidade, r.entregues, r.vendidas, r.devolvidas, r.com_responsavel,
           r.valor_devido, r.valor_pago, r.saldo, r.blocos
      from public.blocos_resumo_responsavel r
     where (r.entregues > 0 or r.valor_pago > 0)
       and (not p_so_saldo or r.saldo > 0)
  ) x;

  select coalesce(jsonb_agg(x order by x.comunidade nulls last), '[]'::jsonb) into v_comunidades from (
    select r.comunidade, sum(r.entregues) as entregues, sum(r.vendidas) as vendidas, sum(r.devolvidas) as devolvidas,
           sum(r.com_responsavel) as com_responsavel, sum(r.valor_devido) as devido, sum(r.valor_pago) as pago, sum(r.saldo) as saldo
      from public.blocos_resumo_responsavel r
     where r.entregues > 0 group by r.comunidade
  ) x;

  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into v_ac from (
    select a.id, a.created_at, r.nome as responsavel, r.comunidade, a.vendidas, a.devolvidas, a.valor_bruto,
           a.valor_comissao, a.valor_devido, a.valor_pago, a.lancador_nome as lancador,
           coalesce((select jsonb_agg(jsonb_build_object('forma', g.forma, 'valor', g.valor))
                       from public.blocos_acerto_pagamentos g where g.acerto_id = a.id), '[]'::jsonb) as pagamentos
      from public.blocos_acertos a join public.blocos_responsaveis r on r.id = a.responsavel_id
     where not a.desfeito and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate
  ) x;

  select jsonb_build_object(
    'entregues', coalesce(sum(r.entregues), 0), 'vendidas', coalesce(sum(r.vendidas), 0),
    'devolvidas', coalesce(sum(r.devolvidas), 0), 'com_responsavel', coalesce(sum(r.com_responsavel), 0),
    'devido', coalesce(sum(r.valor_devido), 0), 'pago', coalesce(sum(r.valor_pago), 0), 'saldo', coalesce(sum(r.saldo), 0),
    'dinheiro_periodo', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
        where not a.desfeito and g.forma = 'dinheiro' and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0),
    'pix_periodo', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
        where not a.desfeito and g.forma = 'pix' and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0),
    'debito_periodo', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
        where not a.desfeito and g.forma = 'cartao_debito' and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0),
    'credito_periodo', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
        where not a.desfeito and g.forma = 'cartao_credito' and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0),
    'pix_site_periodo', coalesce((select sum(g.valor) from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
        where not a.desfeito and g.forma = 'pix_site' and (a.created_at at time zone 'America/Porto_Velho')::date between p_de and p_ate), 0)
  ) into v_tot
  from public.blocos_resumo_responsavel r where (r.entregues > 0 or r.valor_pago > 0);

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'responsaveis', v_resp, 'comunidades', v_comunidades,
                            'acertos', v_ac, 'totais', v_tot);
end;
$$;

grant execute on function public.fpss_caixa_linhas(date, date) to service_role;
grant execute on function public.fpss_relatorio_caixa(date, date) to service_role;
grant execute on function public.fpss_relatorio_cartelas(date, date) to service_role;
grant execute on function public.fpss_relatorio_blocos(date, date, boolean) to service_role;
notify pgrst, 'reload schema';
