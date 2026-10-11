-- =====================================================================
-- BUSCA POR CLIENTE (nome, CPF ou telefone) nos relatórios com compras:
-- Pedidos, Cartelas e Retiradas. Rode no SQL Editor do Supabase DEPOIS do
-- 2026-10-12-relatorios-completos.sql.
-- =====================================================================
drop function if exists public.fpss_relatorio_pedidos(date, date, text, text, text, text);
drop function if exists public.fpss_relatorio_cartelas(date, date, text, text, text, text);
drop function if exists public.fpss_relatorio_retirada(date, date, text, text);

create or replace function public.fpss_busca_cliente(p_busca text, p_nome text, p_cpf text, p_tel text) returns boolean
language sql immutable as $$
  select nullif(btrim(coalesce(p_busca, '')), '') is null
      or coalesce(p_nome, '') ilike '%' || replace(replace(btrim(p_busca), '%', ''), '_', '') || '%'
      or (regexp_replace(p_busca, '\D', '', 'g') <> ''
          and (regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'
            or regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'));
$$;

create or replace function public.fpss_relatorio_pedidos(p_de date, p_ate date, p_situacao text default null,
  p_origem text default null, p_forma text default null, p_produto text default null, p_busca text default null) returns jsonb
language plpgsql as $$
declare v_lista jsonb; v_tot jsonb; v_forma jsonb; v_status jsonb; v_n int;
begin
  create temporary table _ped on commit drop as
    select p.id, p.codigo_pedido as codigo, p.created_at as quando, coalesce(nullif(trim(coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,'')), ''), '(balcão)') as cliente,
           p.origem, p.forma_pagamento as forma, p.valor_total as valor,
           case when p.reembolsado_em is not null then 'reembolsado'
                when p.status_pagamento = 'pago' then 'pago' else 'pendente' end as situacao,
           p.vendedor_nome, p.cpf, p.telefone,
           (select string_agg(i.quantidade || '× ' || i.produto_nome, ', ' order by i.id) from public.pedido_itens i where i.pedido_id = p.id) as itens
      from public.pedidos p
     where public.fpss_dia(p.created_at) between p_de and p_ate
       and public.fpss_busca_cliente(p_busca, coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,''), p.cpf, p.telefone)
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
create or replace function public.fpss_relatorio_cartelas(p_de date, p_ate date, p_tipo text default null,
  p_status text default 'pago', p_lote text default null, p_via text default null, p_busca text default null) returns jsonb
language plpgsql as $$
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

  create temporary table _cart on commit drop as
    select c.numero_chance1 as numero, c.tipo, c.lote, c.status, c.nome_comprador as comprador, c.cpf_comprador as cpf,
           c.whatsapp_comprador as telefone, c.valor_pago as valor, c.data_pagamento, (c.pix_id is not null) as via_pix,
           case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end as data_ref
      from public.cartelas c
     where c.status = v_status
       and (p_tipo is null or p_tipo = '' or c.tipo = p_tipo) and (p_lote is null or p_lote = '' or c.lote = p_lote)
       and (p_via is null or p_via = '' or (p_via = 'pix' and c.pix_id is not null) or (p_via = 'baixa' and c.pix_id is null))
       and public.fpss_busca_cliente(p_busca, c.nome_comprador, c.cpf_comprador, c.whatsapp_comprador)
       and (v_status = 'disponivel' or public.fpss_dia(case when v_status = 'pago' then c.data_pagamento else c.atualizado_em end) between p_de and p_ate);

  select count(*) into v_n from _cart;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data_ref nulls last, x.numero), '[]'::jsonb) into v_lista
    from (select * from _cart order by data_ref nulls last, numero limit 3000) x;
  select jsonb_build_object('qtd', v_n, 'valor', coalesce(sum(valor), 0),
    'digitais', count(*) filter (where tipo = 'digital'), 'fisicas', count(*) filter (where tipo = 'fisica')) into v_res from _cart;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'status', v_status, 'lotes', v_lotes, 'lista', v_lista,
                            'truncada', v_n > 3000, 'resumo', v_res);
end;
$$;

create or replace function public.fpss_relatorio_retirada(p_de date, p_ate date, p_produto text default null, p_entregador text default null, p_busca text default null) returns jsonb
language plpgsql as $$
declare v_lista jsonb; v_prod jsonb; v_ent jsonb; v_tot jsonb; v_n int;
begin
  create temporary table _ent on commit drop as
    select d.id, d.entregue_em as quando, d.quantidade, coalesce(d.entregue_por_nome, '(não informado)') as entregador, d.origem,
           i.produto_nome as produto, p.codigo_pedido as codigo, p.telefone,
           coalesce(nullif(trim(coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,'')), ''), '(balcão)') as cliente
      from public.pedido_entregas d
      join public.pedido_itens i on i.id = d.pedido_item_id
      join public.pedidos p on p.id = d.pedido_id
     where public.fpss_dia(d.entregue_em) between p_de and p_ate
       and public.fpss_busca_cliente(p_busca, coalesce(p.nome,'') || ' ' || coalesce(p.sobrenome,''), p.cpf, p.telefone)
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
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'fpss_relatorio_%' or p.proname = 'fpss_busca_cliente') loop
      execute 'grant execute on function ' || f || ' to service_role';
    end loop;
  end if;
end $$;
notify pgrst, 'reload schema';
