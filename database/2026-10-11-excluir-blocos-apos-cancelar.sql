-- =====================================================================
-- Excluir blocos cadastrados: só impede se o bloco estiver EM NOME de alguém.
-- Entrega cancelada (cartelas voltaram ao estoque) não impede mais:
-- o histórico dessas entregas canceladas é apagado junto com o bloco.
-- Rode no SQL Editor do Supabase.
-- =====================================================================
create or replace function public.fpss_blocos_excluir_faixa(
  p_seq_inicio int, p_seq_fim int, p_lancador_id uuid, p_lancador_nome text
) returns jsonb
language plpgsql as $$
declare v_mov int; v_qtd int; v_ids bigint[];
begin
  if p_seq_inicio is null or p_seq_fim is null or p_seq_fim < p_seq_inicio then
    raise exception 'FAIXA_INVALIDA';
  end if;
  select array_agg(id) into v_ids from public.blocos where sequencial between p_seq_inicio and p_seq_fim;
  if v_ids is null then return jsonb_build_object('blocos', 0); end if;

  -- em nome de alguém = alguma cartela fora do estoque, ou entrega ainda ativa/encerrada
  select count(*) into v_mov
    from public.blocos b
    where b.id = any(v_ids)
      and (exists (select 1 from public.blocos_entregas e where e.bloco_id = b.id and e.status <> 'cancelada')
           or exists (select 1 from public.blocos_cartelas c where c.bloco_id = b.id and c.status <> 'estoque'));
  if v_mov > 0 then
    raise exception 'BLOCOS_COM_MOVIMENTO';
  end if;

  -- limpa o histórico de entregas canceladas desses blocos
  delete from public.blocos_acerto_itens where bloco_id = any(v_ids);
  update public.blocos_cartelas set entrega_id = null where bloco_id = any(v_ids);
  delete from public.blocos_entregas where bloco_id = any(v_ids);
  delete from public.blocos where id = any(v_ids);
  get diagnostics v_qtd = row_count;

  insert into public.blocos_historico (acao, descricao, dados, lancador_id, lancador_nome)
  values ('excluir_faixa', format('Excluiu %s blocos (sequencial %s a %s)', v_qtd, p_seq_inicio, p_seq_fim),
          jsonb_build_object('seq_inicio', p_seq_inicio, 'seq_fim', p_seq_fim, 'blocos', v_qtd),
          p_lancador_id, p_lancador_nome);
  return jsonb_build_object('blocos', v_qtd);
end;
$$;
notify pgrst, 'reload schema';
