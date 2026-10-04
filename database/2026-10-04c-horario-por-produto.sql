-- =====================================================================
-- FPSS 2027 — Horário previsto de retirada POR PRODUTO
-- (cada produto com "horário de retirada" tem o seu próprio horário)
-- Data: 2026-10-04 — rodar DEPOIS do 2026-10-04b-pagamento-dividido.sql
-- Seguro para rodar mais de uma vez.
-- =====================================================================

alter table public.pedido_itens add column if not exists horario_retirada text;

-- pedidos antigos: copia o horário do pedido para os itens que exigem horário
update public.pedido_itens i
set horario_retirada = p.horario_retirada
from public.pedidos p
where p.id = i.pedido_id
  and i.exige_horario = true
  and i.horario_retirada is null
  and p.horario_retirada is not null;

create or replace function public.fpss_criar_pedido(p_pedido jsonb, p_itens jsonb, p_prefixo text, p_pagamentos jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
  v_codigo text;
  v_item jsonb;
  v_pag jsonb;
begin
  insert into public.pedidos (
    nome, sobrenome, cpf, telefone, email, produto_tipo, quantidade, valor_unitario,
    horario_retirada, valor_total, txid, pix_copia_cola, status_pagamento, status_retirada,
    status, origem, forma_pagamento, valor_recebido, troco, termo_aceito_em, termo_versao,
    vendedor_id, vendedor_nome, caixa_sessao_id, data_pagamento
  ) values (
    p_pedido->>'nome', coalesce(p_pedido->>'sobrenome',''), p_pedido->>'cpf', p_pedido->>'telefone',
    p_pedido->>'email', p_pedido->>'produto_tipo', (p_pedido->>'quantidade')::bigint,
    (p_pedido->>'valor_unitario')::numeric, p_pedido->>'horario_retirada',
    (p_pedido->>'valor_total')::numeric, p_pedido->>'txid', p_pedido->>'pix_copia_cola',
    coalesce(p_pedido->>'status_pagamento','pendente'), coalesce(p_pedido->>'status_retirada','pendente'),
    coalesce(p_pedido->>'status','pendente'), coalesce(p_pedido->>'origem','site'),
    p_pedido->>'forma_pagamento', (p_pedido->>'valor_recebido')::numeric, (p_pedido->>'troco')::numeric,
    (p_pedido->>'termo_aceito_em')::timestamptz, p_pedido->>'termo_versao',
    (p_pedido->>'vendedor_id')::uuid, p_pedido->>'vendedor_nome', (p_pedido->>'caixa_sessao_id')::bigint,
    (p_pedido->>'data_pagamento')::timestamp
  ) returning id into v_id;

  v_codigo := 'FPSS-2027-' || coalesce(nullif(p_prefixo,''),'P') || '-' || lpad(v_id::text, 6, '0');
  update public.pedidos set codigo_pedido = v_codigo where id = v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into public.pedido_itens (pedido_id, produto_id, produto_codigo, produto_nome, preco_unitario, quantidade, exige_horario, horario_retirada)
    values (
      v_id, (v_item->>'produto_id')::bigint, v_item->>'produto_codigo', v_item->>'produto_nome',
      (v_item->>'preco_unitario')::numeric, (v_item->>'quantidade')::int,
      coalesce((v_item->>'exige_horario')::boolean, false),
      nullif(v_item->>'horario_retirada', '')
    );
  end loop;

  for v_pag in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) loop
    insert into public.pedido_pagamentos (pedido_id, forma, valor, valor_recebido, troco)
    values (
      v_id, v_pag->>'forma', (v_pag->>'valor')::numeric,
      (v_pag->>'valor_recebido')::numeric, (v_pag->>'troco')::numeric
    );
  end loop;

  return jsonb_build_object('id', v_id, 'codigo_pedido', v_codigo);
end;
$$;

revoke all on function public.fpss_criar_pedido(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.fpss_criar_pedido(jsonb, jsonb, text, jsonb) to service_role;

select 'Horário por produto instalado' as resultado;
