-- =====================================================================
-- RELATÓRIOS COMPLETOS COM FILTROS (impressão)
-- Rode no SQL Editor do Supabase (depois dos SQLs 2026-10-11*).
-- Datas no horário de Rondônia (America/Porto_Velho). Todos os filtros
-- são opcionais: null = "todos".
-- =====================================================================

create or replace function public.fpss_dia(t timestamptz) returns date
language sql immutable as $$ select (t at time zone 'America/Porto_Velho')::date $$;

-- as versões antigas (sem filtros) saem para não duplicar nome
drop function if exists public.fpss_caixa_linhas(date, date);
drop function if exists public.fpss_relatorio_caixa(date, date);
drop function if exists public.fpss_relatorio_cartelas(date, date);
drop function if exists public.fpss_relatorio_blocos(date, date, boolean);

/* ---------- opções dos filtros (listas das caixinhas) ---------- */
create or replace function public.fpss_relatorio_opcoes() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'operadores', coalesce((select jsonb_agg(x order by x.nome) from (
        select distinct usuario_id::text as id, usuario_nome as nome from public.caixa_sessoes where usuario_id is not null) x), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'nome', nome) order by ordem, nome) from public.produtos), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(x order by x) from (select distinct lote as x from public.cartelas where lote is not null) l), '[]'::jsonb),
    'comunidades', coalesce((select jsonb_agg(x order by x) from (
        select distinct comunidade as x from public.blocos_responsaveis where comunidade is not null and comunidade <> '') c), '[]'::jsonb),
    'responsaveis', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'nome', nome, 'comunidade', comunidade) order by nome) from public.blocos_responsaveis), '[]'::jsonb),
    'distribuidores', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'nome', nome) order by nome) from public.blocos_distribuidores), '[]'::jsonb),
    'origens', coalesce((select jsonb_agg(x order by x) from (
        select distinct origem as x from public.origem_visitas where origem is not null
        union select distinct origem from public.origem_links where origem is not null) o), '[]'::jsonb),
    'entregadores', coalesce((select jsonb_agg(x order by x) from (
        select distinct entregue_por_nome as x from public.pedido_entregas where entregue_por_nome is not null) e), '[]'::jsonb),
    'cotas', coalesce((select jsonb_agg(x order by x) from (select distinct cota as x from public.parceiros where cota is not null and cota <> '') c), '[]'::jsonb)
  );
$$;

/* ---------- CAIXA ---------- */
create or replace function public.fpss_caixa_linhas(p_de date, p_ate date, p_operador text default null, p_status text default null)
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
       and public.fpss_dia(s.aberto_em) between p_de and p_ate
       and (p_operador is null or p_operador = '' or s.usuario_id::text = p_operador)
       and (p_status is null or p_status = '' or s.status = p_status)
  )
  select g.caixa_sessao_id, pp.forma,
         case when v_tem_tipo then (to_jsonb(pp) ->> 'cartao_tipo') end, pp.valor
    from pagos g join public.pedido_pagamentos pp on pp.pedido_id = g.id
  union all
  select g.caixa_sessao_id, g.forma_pagamento, null::text, g.valor_total
    from pagos g where not exists (select 1 from public.pedido_pagamentos x where x.pedido_id = g.id);
end;
$$;

create or replace function public.fpss_relatorio_caixa(p_de date, p_ate date, p_operador text default null, p_status text default null) returns jsonb
language plpgsql as $$
declare v_sessoes jsonb; v_produtos jsonb; v_tot jsonb;
begin
  create temporary table _lin_caixa on commit drop as
    select * from public.fpss_caixa_linhas(p_de, p_ate, p_operador, p_status);

  select coalesce(jsonb_agg(x order by x.aberto_em), '[]'::jsonb) into v_sessoes from (
    select s.id, s.numero, s.usuario_nome as operador, s.status, s.aberto_em, s.fechado_em, s.troco_inicial,
           (select count(*) from public.pedidos p where p.caixa_sessao_id = s.id and p.origem = 'caixa'
               and p.status_pagamento = 'pago' and p.reembolsado_em is null) as vendas,
           coalesce((select sum(l.valor) from _lin_caixa l where l.sessao_id = s.id and l.forma = 'dinheiro'), 0) as dinheiro,
           coalesce((select sum(l.valor) from _lin_caixa l where l.sessao_id = s.id and l.forma = 'pix'), 0) as pix,
           coalesce((select sum(l.valor) from _lin_caixa l where l.sessao_id = s.id and l.forma = 'cartao'), 0) as cartao,
           coalesce((select sum(l.valor) from _lin_caixa l where l.sessao_id = s.id and l.forma = 'cartao' and l.tipo = 'debito'), 0) as cartao_debito,
           coalesce((select sum(l.valor) from _lin_caixa l where l.sessao_id = s.id and l.forma = 'cartao' and l.tipo = 'credito'), 0) as cartao_credito,
           coalesce((select sum(m.valor) from public.caixa_movimentos m where m.sessao_id = s.id and m.tipo = 'sangria'), 0) as sangrias,
           coalesce((select sum(m.valor) from public.caixa_movimentos m where m.sessao_id = s.id and m.tipo = 'suprimento'), 0) as suprimentos,
           s.dinheiro_esperado, s.dinheiro_contado, s.diferenca
      from public.caixa_sessoes s
     where public.fpss_dia(s.aberto_em) between p_de and p_ate
       and (p_operador is null or p_operador = '' or s.usuario_id::text = p_operador)
       and (p_status is null or p_status = '' or s.status = p_status)
  ) x;

  select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb) into v_produtos from (
    select i.produto_nome as nome, sum(i.quantidade) as quantidade, sum(i.quantidade * i.preco_unitario) as valor
      from public.pedido_itens i
      join public.pedidos p on p.id = i.pedido_id
      join public.caixa_sessoes s on s.id = p.caixa_sessao_id
     where p.origem = 'caixa' and p.status_pagamento = 'pago' and p.reembolsado_em is null
       and public.fpss_dia(s.aberto_em) between p_de and p_ate
       and (p_operador is null or p_operador = '' or s.usuario_id::text = p_operador)
       and (p_status is null or p_status = '' or s.status = p_status)
     group by i.produto_nome
  ) x;

  select jsonb_build_object(
    'dinheiro', coalesce(sum(valor) filter (where forma = 'dinheiro'), 0),
    'pix', coalesce(sum(valor) filter (where forma = 'pix'), 0),
    'cartao', coalesce(sum(valor) filter (where forma = 'cartao'), 0),
    'cartao_debito', coalesce(sum(valor) filter (where forma = 'cartao' and tipo = 'debito'), 0),
    'cartao_credito', coalesce(sum(valor) filter (where forma = 'cartao' and tipo = 'credito'), 0),
    'total', coalesce(sum(valor), 0)
  ) into v_tot from _lin_caixa;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'sessoes', v_sessoes, 'produtos', v_produtos, 'totais', v_tot);
end;
$$;

/* ---------- CARTELAS (por situação) ---------- */
create or replace function public.fpss_relatorio_cartelas(p_de date, p_ate date, p_tipo text default null,
  p_status text default 'pago', p_lote text default null, p_via text default null) returns jsonb
language plpgsql stable as $$
declare v_lotes jsonb; v_lista jsonb; v_res jsonb; v_n int; v_status text := coalesce(nullif(p_status, ''), 'pago');
begin
  select coalesce(jsonb_agg(x order by x.lote), '[]'::jsonb) into v_lotes from (
    select lote, tipo, count(*) as total,
           count(*) filter (where status = 'pago') as pagas,
           count(*) filter (where status = 'pendente') as pendentes,
           count(*) filter (where status = 'disponivel') as disponiveis,
           coalesce(sum(valor_pago) filter (where status = 'pago'), 0) as valor
      from public.cartelas
     where (p_tipo is null or p_tipo = '' or tipo = p_tipo) and (p_lote is null or p_lote = '' or lote = p_lote)
     group by lote, tipo
  ) x;

  select count(*) into v_n from public.cartelas c
   where c.status = v_status
     and (p_tipo is null or p_tipo = '' or c.tipo = p_tipo) and (p_lote is null or p_lote = '' or c.lote = p_lote)
     and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
     and (v_status = 'disponivel' or public.fpss_dia(case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end) between p_de and p_ate);

  select coalesce(jsonb_agg(x order by x.data_ref), '[]'::jsonb) into v_lista from (
    select c.numero_chance1 as numero, c.tipo, c.lote, c.status, c.nome_comprador as comprador, c.valor_pago as valor,
           c.data_pagamento, (c.pix_id is not null) as via_pix,
           case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end as data_ref
      from public.cartelas c
     where c.status = v_status
       and (p_tipo is null or p_tipo = '' or c.tipo = p_tipo) and (p_lote is null or p_lote = '' or c.lote = p_lote)
       and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
       and (v_status = 'disponivel' or public.fpss_dia(case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end) between p_de and p_ate)
     order by 9 nulls last, c.numero_chance1 limit 3000
  ) x;

  select jsonb_build_object(
    'qtd', v_n,
    'valor', coalesce((select sum(c.valor_pago) from public.cartelas c where c.status = v_status and v_status = 'pago'
        and (p_tipo is null or p_tipo = '' or c.tipo = p_tipo) and (p_lote is null or p_lote = '' or c.lote = p_lote)
        and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
        and public.fpss_dia(c.data_pagamento) between p_de and p_ate), 0),
    'digitais', (select count(*) from public.cartelas c where c.status = v_status and c.tipo = 'digital'
        and (p_lote is null or p_lote = '' or c.lote = p_lote)
        and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
        and (v_status = 'disponivel' or public.fpss_dia(case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end) between p_de and p_ate)),
    'fisicas', (select count(*) from public.cartelas c where c.status = v_status and c.tipo = 'fisica'
        and (p_lote is null or p_lote = '' or c.lote = p_lote)
        and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
        and (v_status = 'disponivel' or public.fpss_dia(case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end) between p_de and p_ate))
  ) into v_res;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'status', v_status, 'lotes', v_lotes, 'lista', v_lista,
                            'truncada', v_n > 3000, 'resumo', v_res);
end;
$$;

/* ---------- LOTES DE CARTELAS ---------- */
create or replace function public.fpss_relatorio_lotes(p_tipo text default null, p_so_com_disponiveis boolean default false) returns jsonb
language plpgsql stable as $$
declare v_l jsonb;
begin
  select coalesce(jsonb_agg(x order by x.lote), '[]'::jsonb) into v_l from (
    select lote, tipo, count(*) as total,
           count(*) filter (where status = 'pago') as pagas,
           count(*) filter (where status = 'pendente') as pendentes,
           count(*) filter (where status = 'disponivel') as disponiveis,
           count(*) filter (where status = 'cancelado') as canceladas,
           coalesce(sum(valor_pago) filter (where status = 'pago'), 0) as valor,
           min(data_pagamento) filter (where status = 'pago') as primeiro_pagamento,
           max(data_pagamento) filter (where status = 'pago') as ultimo_pagamento
      from public.cartelas
     where (p_tipo is null or p_tipo = '' or tipo = p_tipo)
     group by lote, tipo
    having (not p_so_com_disponiveis) or count(*) filter (where status = 'disponivel') > 0
  ) x;
  return jsonb_build_object('lotes', v_l);
end;
$$;

/* ---------- BLOCOS: prestação de contas ---------- */
create or replace function public.fpss_relatorio_blocos(p_de date, p_ate date, p_so_saldo boolean default false,
  p_comunidade text default null, p_responsavel text default null, p_forma text default null) returns jsonb
language plpgsql stable as $$
declare v_resp jsonb; v_ac jsonb; v_tot jsonb; v_comunidades jsonb;
begin
  select coalesce(jsonb_agg(x order by x.comunidade nulls last, x.nome), '[]'::jsonb) into v_resp from (
    select r.id, r.nome, r.comunidade, r.entregues, r.vendidas, r.devolvidas, r.com_responsavel,
           r.valor_devido, r.valor_pago, r.saldo, r.blocos
      from public.blocos_resumo_responsavel r
     where (r.entregues > 0 or r.valor_pago > 0)
       and (not p_so_saldo or r.saldo > 0)
       and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
       and (p_responsavel is null or p_responsavel = '' or r.id::text = p_responsavel)
  ) x;

  select coalesce(jsonb_agg(x order by x.comunidade nulls last), '[]'::jsonb) into v_comunidades from (
    select r.comunidade, sum(r.entregues) as entregues, sum(r.vendidas) as vendidas, sum(r.devolvidas) as devolvidas,
           sum(r.com_responsavel) as com_responsavel, sum(r.valor_devido) as devido, sum(r.valor_pago) as pago, sum(r.saldo) as saldo
      from public.blocos_resumo_responsavel r
     where r.entregues > 0
       and (not p_so_saldo or r.saldo > 0)
       and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
       and (p_responsavel is null or p_responsavel = '' or r.id::text = p_responsavel)
     group by r.comunidade
  ) x;

  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into v_ac from (
    select a.id, a.created_at, r.nome as responsavel, r.comunidade, a.vendidas, a.devolvidas, a.valor_bruto,
           a.valor_comissao, a.valor_devido, a.valor_pago, a.lancador_nome as lancador,
           coalesce((select jsonb_agg(jsonb_build_object('forma', g.forma, 'valor', g.valor))
                       from public.blocos_acerto_pagamentos g where g.acerto_id = a.id), '[]'::jsonb) as pagamentos
      from public.blocos_acertos a join public.blocos_responsaveis r on r.id = a.responsavel_id
     where not a.desfeito and public.fpss_dia(a.created_at) between p_de and p_ate
       and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
       and (p_responsavel is null or p_responsavel = '' or r.id::text = p_responsavel)
       and (p_forma is null or p_forma = '' or exists (select 1 from public.blocos_acerto_pagamentos g where g.acerto_id = a.id and g.forma = p_forma))
  ) x;

  select jsonb_build_object(
    'entregues', coalesce(sum(r.entregues), 0), 'vendidas', coalesce(sum(r.vendidas), 0),
    'devolvidas', coalesce(sum(r.devolvidas), 0), 'com_responsavel', coalesce(sum(r.com_responsavel), 0),
    'devido', coalesce(sum(r.valor_devido), 0), 'pago', coalesce(sum(r.valor_pago), 0), 'saldo', coalesce(sum(r.saldo), 0)
  ) into v_tot
  from public.blocos_resumo_responsavel r
  where (r.entregues > 0 or r.valor_pago > 0)
    and (not p_so_saldo or r.saldo > 0)
    and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
    and (p_responsavel is null or p_responsavel = '' or r.id::text = p_responsavel);

  v_tot := v_tot || (
    select jsonb_build_object(
      'dinheiro_periodo', coalesce(sum(g.valor) filter (where g.forma = 'dinheiro'), 0),
      'pix_periodo', coalesce(sum(g.valor) filter (where g.forma = 'pix'), 0),
      'debito_periodo', coalesce(sum(g.valor) filter (where g.forma = 'cartao_debito'), 0),
      'credito_periodo', coalesce(sum(g.valor) filter (where g.forma = 'cartao_credito'), 0),
      'pix_site_periodo', coalesce(sum(g.valor) filter (where g.forma = 'pix_site'), 0))
    from public.blocos_acerto_pagamentos g join public.blocos_acertos a on a.id = g.acerto_id
      join public.blocos_responsaveis r on r.id = a.responsavel_id
    where not a.desfeito and public.fpss_dia(a.created_at) between p_de and p_ate
      and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
      and (p_responsavel is null or p_responsavel = '' or r.id::text = p_responsavel)
      and (p_forma is null or p_forma = '' or g.forma = p_forma));

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'responsaveis', v_resp, 'comunidades', v_comunidades,
                            'acertos', v_ac, 'totais', v_tot);
end;
$$;

/* ---------- BLOCOS: distribuição (entregas) ---------- */
create or replace function public.fpss_relatorio_distribuicao(p_de date, p_ate date, p_comunidade text default null,
  p_distribuidor text default null, p_status text default null) returns jsonb
language plpgsql as $$
declare v_lista jsonb; v_dist jsonb; v_tot jsonb;
begin
  create temporary table _ent_dist on commit drop as
    select e.id, coalesce(e.entregue_em, e.created_at) as quando, e.status, e.quantidade_entregue as qtd, e.plano_nome,
           e.preco, e.cobra, e.separada, e.distribuidor_id, coalesce(e.distribuidor_nome, '(sem distribuidor)') as distribuidor,
           r.nome as responsavel, coalesce(r.comunidade, '(sem comunidade)') as comunidade,
           b.sequencial, b.numero_inicial, b.numero_final
      from public.blocos_entregas e
      join public.blocos_responsaveis r on r.id = e.responsavel_id
      left join public.blocos b on b.id = e.bloco_id
     where public.fpss_dia(coalesce(e.entregue_em, e.created_at)) between p_de and p_ate
       and (p_comunidade is null or p_comunidade = '' or r.comunidade = p_comunidade)
       and (p_distribuidor is null or p_distribuidor = '' or e.distribuidor_id::text = p_distribuidor)
       and (p_status is null or p_status = '' or e.status = p_status);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.quando), '[]'::jsonb) into v_lista from (select * from _ent_dist order by quando limit 3000) x;
  select coalesce(jsonb_agg(x order by x.distribuidor), '[]'::jsonb) into v_dist from (
    select distribuidor, count(*) as blocos, sum(qtd) as cartelas,
           count(*) filter (where status = 'cancelada') as cancelados
      from _ent_dist group by distribuidor) x;
  select jsonb_build_object(
    'blocos', count(*) filter (where status <> 'cancelada'),
    'cartelas', coalesce(sum(qtd) filter (where status <> 'cancelada'), 0),
    'cancelados', count(*) filter (where status = 'cancelada'),
    'valor_previsto', coalesce(sum(qtd * preco) filter (where status <> 'cancelada' and cobra), 0)
  ) into v_tot from _ent_dist;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'lista', v_lista, 'distribuidores', v_dist, 'totais', v_tot);
end;
$$;

/* ---------- PEDIDOS (site e caixa) ---------- */
create or replace function public.fpss_relatorio_pedidos(p_de date, p_ate date, p_situacao text default null,
  p_origem text default null, p_forma text default null, p_produto text default null) returns jsonb
language plpgsql as $$
declare v_lista jsonb; v_tot jsonb; v_forma jsonb; v_status jsonb; v_n int;
begin
  create temporary table _ped on commit drop as
    select p.id, p.codigo_pedido as codigo, p.created_at as quando, coalesce(nullif(trim(coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,'')), ''), '(balcão)') as cliente,
           p.origem, p.forma_pagamento as forma, p.valor_total as valor,
           case when p.reembolsado_em is not null then 'reembolsado'
                when p.status_pagamento = 'pago' then 'pago' else 'pendente' end as situacao,
           p.vendedor_nome,
           (select string_agg(i.quantidade || '× ' || i.produto_nome, ', ' order by i.id) from public.pedido_itens i where i.pedido_id = p.id) as itens
      from public.pedidos p
     where public.fpss_dia(p.created_at) between p_de and p_ate
       and (p_origem is null or p_origem = '' or p.origem = p_origem)
       and (p_forma is null or p_forma = '' or p.forma_pagamento = p_forma)
       and (p_produto is null or p_produto = '' or exists (select 1 from public.pedido_itens i where i.pedido_id = p.id and i.produto_id::text = p_produto));
  delete from _ped where p_situacao is not null and p_situacao <> '' and situacao <> p_situacao;

  select count(*) into v_n from _ped;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.quando), '[]'::jsonb) into v_lista from (select * from _ped order by quando limit 3000) x;
  select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb) into v_forma from (
    select coalesce(forma, '—') as forma, count(*) as pedidos, sum(valor) as valor from _ped where situacao = 'pago' group by 1) x;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_status from (
    select situacao, count(*) as pedidos, sum(valor) as valor from _ped group by 1) x;
  select jsonb_build_object(
    'pedidos', v_n,
    'pagos', count(*) filter (where situacao = 'pago'), 'valor_pago', coalesce(sum(valor) filter (where situacao = 'pago'), 0),
    'pendentes', count(*) filter (where situacao = 'pendente'), 'valor_pendente', coalesce(sum(valor) filter (where situacao = 'pendente'), 0),
    'reembolsados', count(*) filter (where situacao = 'reembolsado'), 'valor_reembolsado', coalesce(sum(valor) filter (where situacao = 'reembolsado'), 0),
    'site', coalesce(sum(valor) filter (where situacao = 'pago' and origem = 'site'), 0),
    'caixa', coalesce(sum(valor) filter (where situacao = 'pago' and origem = 'caixa'), 0)
  ) into v_tot from _ped;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'lista', v_lista, 'truncada', v_n > 3000,
                            'por_forma', v_forma, 'por_situacao', v_status, 'totais', v_tot);
end;
$$;

/* ---------- PRODUTOS vendidos / a retirar ---------- */
create or replace function public.fpss_relatorio_produtos(p_de date, p_ate date, p_produto text default null, p_origem text default null) returns jsonb
language plpgsql as $$
declare v_prod jsonb; v_hor jsonb; v_tot jsonb;
begin
  create temporary table _it on commit drop as
    select i.produto_id, i.produto_nome, i.quantidade, coalesce(i.quantidade_entregue, 0) as entregue,
           i.preco_unitario, coalesce(nullif(i.horario_retirada, ''), nullif(p.horario_retirada, '')) as horario, p.origem
      from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
     where p.status_pagamento = 'pago' and p.reembolsado_em is null
       and public.fpss_dia(p.created_at) between p_de and p_ate
       and (p_produto is null or p_produto = '' or i.produto_id::text = p_produto)
       and (p_origem is null or p_origem = '' or p.origem = p_origem);
  select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb) into v_prod from (
    select produto_nome as nome, sum(quantidade) as vendida, sum(entregue) as entregue, sum(quantidade) - sum(entregue) as a_retirar,
           sum(quantidade * preco_unitario) as valor,
           sum(quantidade) filter (where origem = 'site') as site, sum(quantidade) filter (where origem = 'caixa') as caixa
      from _it group by produto_nome) x;
  select coalesce(jsonb_agg(x order by x.horario nulls last), '[]'::jsonb) into v_hor from (
    select coalesce(horario, '(sem horário)') as horario, produto_nome as nome, sum(quantidade) as vendida, sum(quantidade) - sum(entregue) as a_retirar
      from _it group by 1, 2) x;
  select jsonb_build_object('vendida', coalesce(sum(quantidade), 0), 'entregue', coalesce(sum(entregue), 0),
    'a_retirar', coalesce(sum(quantidade) - sum(entregue), 0), 'valor', coalesce(sum(quantidade * preco_unitario), 0)) into v_tot from _it;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'produtos', v_prod, 'horarios', v_hor, 'totais', v_tot);
end;
$$;

/* ---------- RETIRADA (entregas) ---------- */
create or replace function public.fpss_relatorio_retirada(p_de date, p_ate date, p_produto text default null, p_entregador text default null) returns jsonb
language plpgsql as $$
declare v_lista jsonb; v_prod jsonb; v_ent jsonb; v_tot jsonb; v_n int;
begin
  create temporary table _ent on commit drop as
    select d.id, d.entregue_em as quando, d.quantidade, coalesce(d.entregue_por_nome, '(não informado)') as entregador, d.origem,
           i.produto_nome as produto, p.codigo_pedido as codigo,
           coalesce(nullif(trim(coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,'')), ''), '(balcão)') as cliente
      from public.pedido_entregas d
      join public.pedido_itens i on i.id = d.pedido_item_id
      join public.pedidos p on p.id = d.pedido_id
     where public.fpss_dia(d.entregue_em) between p_de and p_ate
       and (p_produto is null or p_produto = '' or i.produto_id::text = p_produto)
       and (p_entregador is null or p_entregador = '' or d.entregue_por_nome = p_entregador);
  select count(*) into v_n from _ent;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.quando), '[]'::jsonb) into v_lista from (select * from _ent order by quando limit 3000) x;
  select coalesce(jsonb_agg(x order by x.quantidade desc), '[]'::jsonb) into v_prod from (select produto, sum(quantidade) as quantidade, count(*) as retiradas from _ent group by 1) x;
  select coalesce(jsonb_agg(x order by x.quantidade desc), '[]'::jsonb) into v_ent from (select entregador, sum(quantidade) as quantidade, count(*) as retiradas from _ent group by 1) x;
  select jsonb_build_object('quantidade', coalesce(sum(quantidade), 0), 'retiradas', count(*),
    'pendentes', (select coalesce(sum(i.quantidade - coalesce(i.quantidade_entregue, 0)), 0)
                    from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
                   where p.status_pagamento = 'pago' and p.reembolsado_em is null
                     and (p_produto is null or p_produto = '' or i.produto_id::text = p_produto))) into v_tot from _ent;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'lista', v_lista, 'truncada', v_n > 3000,
                            'por_produto', v_prod, 'por_entregador', v_ent, 'totais', v_tot);
end;
$$;

/* ---------- ESTOQUE ---------- */
create or replace function public.fpss_relatorio_estoque(p_de date, p_ate date, p_produto text default null, p_tipo text default null) returns jsonb
language plpgsql stable as $$
declare v_est jsonb; v_mov jsonb; v_n int;
begin
  select coalesce(jsonb_agg(x order by x.ordem, x.nome), '[]'::jsonb) into v_est from (
    select id, nome, ativo, preco, estoque as disponivel, estoque_fisico as fisico, estoque_minimo as minimo,
           (estoque_minimo is not null and estoque <= estoque_minimo) as baixo, ordem
      from public.produtos where (p_produto is null or p_produto = '' or id::text = p_produto)) x;
  select count(*) into v_n from public.estoque_movimentos m
   where public.fpss_dia(m.created_at) between p_de and p_ate
     and (p_produto is null or p_produto = '' or m.produto_id::text = p_produto)
     and (p_tipo is null or p_tipo = '' or m.tipo = p_tipo);
  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into v_mov from (
    select m.created_at, pr.nome as produto, m.tipo, m.delta_disponivel, m.delta_fisico, m.motivo, m.usuario_nome as usuario
      from public.estoque_movimentos m left join public.produtos pr on pr.id = m.produto_id
     where public.fpss_dia(m.created_at) between p_de and p_ate
       and (p_produto is null or p_produto = '' or m.produto_id::text = p_produto)
       and (p_tipo is null or p_tipo = '' or m.tipo = p_tipo)
     order by m.created_at limit 3000) x;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'estoque', v_est, 'movimentos', v_mov, 'truncada', v_n > 3000);
end;
$$;

/* ---------- ORIGENS DAS VISITAS ---------- */
create or replace function public.fpss_relatorio_origens(p_de date, p_ate date, p_origem text default null, p_meio text default null) returns jsonb
language plpgsql stable as $$
declare v_o jsonb; v_c jsonb; v_t jsonb;
begin
  select coalesce(jsonb_agg(x order by x.visitas desc), '[]'::jsonb) into v_o from (
    select coalesce(v.origem, '(direto)') as origem, coalesce(v.meio, '—') as meio, coalesce(v.campanha, '—') as campanha,
           sum(v.visitas) as visitas,
           (select count(*) from public.origem_compras c where c.origem is not distinct from v.origem and c.meio is not distinct from v.meio
               and c.campanha is not distinct from v.campanha and public.fpss_dia(c.criado_em) between p_de and p_ate) as compras
      from public.origem_visitas v
     where v.dia between p_de and p_ate
       and (p_origem is null or p_origem = '' or v.origem = p_origem)
       and (p_meio is null or p_meio = '' or v.meio = p_meio)
     group by v.origem, v.meio, v.campanha) x;
  select coalesce(jsonb_agg(x order by x.compras desc), '[]'::jsonb) into v_c from (
    select coalesce(origem, '(direto)') as origem, tipo, count(*) as compras
      from public.origem_compras
     where public.fpss_dia(criado_em) between p_de and p_ate
       and (p_origem is null or p_origem = '' or origem = p_origem) and (p_meio is null or p_meio = '' or meio = p_meio)
     group by origem, tipo) x;
  select jsonb_build_object(
    'visitas', coalesce((select sum(visitas) from public.origem_visitas where dia between p_de and p_ate
        and (p_origem is null or p_origem = '' or origem = p_origem) and (p_meio is null or p_meio = '' or meio = p_meio)), 0),
    'compras', coalesce((select count(*) from public.origem_compras where public.fpss_dia(criado_em) between p_de and p_ate
        and (p_origem is null or p_origem = '' or origem = p_origem) and (p_meio is null or p_meio = '' or meio = p_meio)), 0)) into v_t;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'origens', v_o, 'compras', v_c, 'totais', v_t);
end;
$$;

/* ---------- PARCEIROS ---------- */
create or replace function public.fpss_relatorio_parceiros(p_ativo text default null, p_cota text default null) returns jsonb
language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x order by x.ordem, x.nome), '[]'::jsonb) into v from (
    select nome, cota, link, ativo, ordem, (logo_url is not null and logo_url <> '') as tem_logo
      from public.parceiros
     where (p_ativo is null or p_ativo = '' or (p_ativo = 'sim' and ativo) or (p_ativo = 'nao' and not ativo))
       and (p_cota is null or p_cota = '' or cota = p_cota)) x;
  return jsonb_build_object('parceiros', v);
end;
$$;

/* ---------- USUÁRIOS (só administrador) ---------- */
create or replace function public.fpss_relatorio_usuarios(p_papel text default null) returns jsonb
language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x order by x.nome), '[]'::jsonb) into v from (
    select nome, email, role as papel, created_at, (paginas_personalizadas is not null) as acesso_personalizado
      from public.user_profiles where (p_papel is null or p_papel = '' or role = p_papel)) x;
  return jsonb_build_object('usuarios', v);
end;
$$;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'fpss_relatorio_%' or p.proname in ('fpss_caixa_linhas', 'fpss_dia')) loop
      execute 'grant execute on function ' || f || ' to service_role';
    end loop;
  end if;
end $$;
notify pgrst, 'reload schema';
