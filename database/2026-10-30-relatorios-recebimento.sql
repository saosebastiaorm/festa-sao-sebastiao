-- =====================================================================
-- Relatórios: quem JÁ RECEBEU cartela (blocos) e quem ainda FALTA receber
--   - Parceiros: cada parceiro ganha situação (recebeu / separado / falta receber),
--     nº de blocos, cartelas e data da última entrega; novo filtro de situação.
--   - Comunidades (novo, dentro de "Blocos · entregas"): idem para cada
--     comunidade da paróquia, com o planejado x entregue.
-- Regra: "recebeu" = existe entrega FEITA (não cancelada e não só separada)
-- para um responsável daquele parceiro/comunidade. "separado" = blocos
-- reservados que ainda não foram entregues.
-- O vínculo do parceiro é pelo NOME (campo Comunidade/Parceiro da entrega);
-- o da comunidade é pelo cadastro (comunidade_id) ou pelo nome.
-- SEGURO DE RODAR: só cria/atualiza funções de leitura. Pode rodar de novo.
-- =====================================================================

drop function if exists public.fpss_relatorio_parceiros(text, text);

create or replace function public.fpss_relatorio_parceiros(
  p_ativo text default null, p_cota text default null, p_situacao text default null) returns jsonb
language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(y) order by y.ordem, y.nome), '[]'::jsonb) into v from (
    select x.*,
           case when x.blocos_entregues > 0 then 'recebeu'
                when x.blocos_separados > 0 then 'separado'
                else 'nao_recebeu' end as situacao_cartela
      from (
        select p.nome, p.cota, p.link, p.ativo, p.ordem,
               (p.logo_url is not null and p.logo_url <> '') as tem_logo,
               coalesce(e.blocos_entregues, 0) as blocos_entregues,
               coalesce(e.cartelas_entregues, 0) as cartelas_entregues,
               coalesce(e.blocos_separados, 0) as blocos_separados,
               e.ultima_entrega
          from public.parceiros p
          left join lateral (
            select count(*) filter (where not en.separada and en.status <> 'cancelada') as blocos_entregues,
                   coalesce(sum(en.quantidade_entregue) filter (where not en.separada and en.status <> 'cancelada'), 0) as cartelas_entregues,
                   count(*) filter (where en.separada and en.status = 'ativa') as blocos_separados,
                   max(coalesce(en.entregue_em, en.created_at)) filter (where not en.separada and en.status <> 'cancelada') as ultima_entrega
              from public.blocos_responsaveis r
              join public.blocos_entregas en on en.responsavel_id = r.id
             where lower(btrim(r.comunidade)) = lower(btrim(p.nome))
          ) e on true
         where (p_ativo is null or p_ativo = '' or (p_ativo = 'sim' and p.ativo) or (p_ativo = 'nao' and not p.ativo))
           and (p_cota is null or p_cota = '' or p.cota = p_cota)) x) y
   where (p_situacao is null or p_situacao = '' or y.situacao_cartela = p_situacao);
  return jsonb_build_object('parceiros', v);
end;
$$;

create or replace function public.fpss_relatorio_comunidades(
  p_ativa text default null, p_situacao text default null) returns jsonb
language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(y) order by y.ordem), '[]'::jsonb) into v from (
    select x.*,
           case when x.blocos_entregues > 0 then 'recebeu'
                when x.blocos_separados > 0 then 'separado'
                else 'nao_recebeu' end as situacao_cartela
      from (
        select c.ordem, c.nome, c.local, c.forma, c.ativa, c.planejado,
               coalesce(e.blocos_entregues, 0) as blocos_entregues,
               coalesce(e.cartelas_entregues, 0) as cartelas_entregues,
               coalesce(e.blocos_separados, 0) as blocos_separados,
               e.ultima_entrega, e.responsaveis
          from public.blocos_comunidades c
          left join lateral (
            select count(*) filter (where not en.separada and en.status <> 'cancelada') as blocos_entregues,
                   coalesce(sum(en.quantidade_entregue) filter (where not en.separada and en.status <> 'cancelada'), 0) as cartelas_entregues,
                   count(*) filter (where en.separada and en.status = 'ativa') as blocos_separados,
                   max(coalesce(en.entregue_em, en.created_at)) filter (where not en.separada and en.status <> 'cancelada') as ultima_entrega,
                   string_agg(distinct r.nome, ', ') filter (where not r.provisorio) as responsaveis
              from public.blocos_responsaveis r
              join public.blocos_entregas en on en.responsavel_id = r.id
             where r.comunidade_id = c.id or lower(btrim(r.comunidade)) = lower(btrim(c.nome))
          ) e on true
         where (p_ativa is null or p_ativa = '' or (p_ativa = 'sim' and c.ativa) or (p_ativa = 'nao' and not c.ativa))) x) y
   where (p_situacao is null or p_situacao = '' or y.situacao_cartela = p_situacao);
  return jsonb_build_object('comunidades', v);
end;
$$;
