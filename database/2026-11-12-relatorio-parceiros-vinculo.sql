-- =====================================================================
-- Relatório de PARCEIROS: vínculo tolerante entre a entrega e o parceiro
--
-- Problema: o relatório só reconhecia que o parceiro recebeu se o texto do
-- campo "Comunidade/Parceiro" da pessoa fosse IDÊNTICO ao nome do parceiro.
-- Ex.: "Guaporé Serv. Elétricos" (entrega) x "Guaporé Serv. Eletrico" (parceiro)
-- ficava "FALTA RECEBER" mesmo com os blocos já entregues.
--
-- Agora o nome é comparado sem acento, sem pontuação, sem espaços e sem
-- diferença de maiúscula/minúscula; também vale quando um nome começa com o
-- outro (mínimo 6 letras), para cobrir abreviações e plural.
--
-- SEGURO DE RODAR: só cria funções de leitura. Pode rodar de novo.
-- No final há uma consulta que lista o que AINDA não casou.
-- =====================================================================

create or replace function public.fpss_norm(t text) returns text
language sql immutable as $$
  select regexp_replace(
           lower(translate(coalesce(t, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
             'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function public.fpss_nome_confere(a text, b text) returns boolean
language sql immutable as $$
  select fpss_norm(a) <> '' and fpss_norm(b) <> '' and (
           fpss_norm(a) = fpss_norm(b)
        or (least(length(fpss_norm(a)), length(fpss_norm(b))) >= 6
            and (fpss_norm(a) like fpss_norm(b) || '%' or fpss_norm(b) like fpss_norm(a) || '%')));
$$;

drop function if exists public.fpss_relatorio_parceiros(text, text, text);
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
             where public.fpss_nome_confere(r.comunidade, p.nome)
          ) e on true
         where (p_ativo is null or p_ativo = '' or (p_ativo = 'sim' and p.ativo) or (p_ativo = 'nao' and not p.ativo))
           and (p_cota is null or p_cota = '' or p.cota = p_cota)) x) y
   where (p_situacao is null or p_situacao = '' or y.situacao_cartela = p_situacao);
  return jsonb_build_object('parceiros', v);
end;
$$;

grant execute on function public.fpss_relatorio_parceiros(text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA: entregas de plano "Parceria" cuja Comunidade/Parceiro
-- ainda NÃO casa com nenhum parceiro cadastrado. Se vier alguma linha,
-- corrija o campo "Comunidade/Parceiro" da pessoa (Editar dados) para o
-- nome do parceiro, ou ajuste o nome em Parceiros.
-- ---------------------------------------------------------------------
select r.id as responsavel_id, r.nome as responsavel, r.comunidade as comunidade_informada,
       count(*) as entregas, sum(en.quantidade_entregue) as cartelas
  from public.blocos_entregas en
  join public.blocos_responsaveis r on r.id = en.responsavel_id
 where en.plano_nome ilike 'Parceria%' and en.status <> 'cancelada' and not en.separada
   and not exists (select 1 from public.parceiros p where public.fpss_nome_confere(r.comunidade, p.nome))
 group by r.id, r.nome, r.comunidade
 order by r.comunidade;
