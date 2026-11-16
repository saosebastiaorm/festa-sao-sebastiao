-- =====================================================================
-- Equipes: quando a equipe tem FUNÇÕES, o previsto (e os disponíveis) da
-- equipe é a SOMA das funções (todo integrante tem uma função).
-- Rode UMA vez no Supabase (substitui o 2026-11-18, se você ainda não rodou).
-- =====================================================================

-- ajusta as equipes que já têm funções
update public.equipes e
   set previsto = s.p, disponivel = s.d
  from (select equipe_id, sum(previsto) as p, sum(disponivel) as d from public.equipes_grupos group by equipe_id) s
 where e.id = s.equipe_id;

create or replace function public.fpss_relatorio_equipes(p_ativa text default null) returns jsonb
language plpgsql stable as $$
declare hoje date := (now() at time zone 'America/Porto_Velho')::date; v_eq jsonb; v_me jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem_u, x.nome), '[]'::jsonb) into v_eq from (
    -- linha "sem função": só existe quando a equipe NÃO tem funções (ou tem gente cadastrada sem função)
    select 'e' || e.id as unidade, e.id as equipe_id, null::bigint as grupo_id,
           e.nome || case when exists (select 1 from public.equipes_grupos g where g.equipe_id = e.id) then ' (sem função)' else '' end as nome,
           e.lider_nome, e.lider_telefone,
           case when exists (select 1 from public.equipes_grupos g where g.equipe_id = e.id) then 0 else e.previsto end as previsto,
           case when exists (select 1 from public.equipes_grupos g where g.equipe_id = e.id) then 0 else e.disponivel end as disponivel,
           e.proibe_menor, e.ativo, e.fechada, e.ordem * 100 as ordem_u
      from public.equipes e
     where (p_ativa is null or p_ativa = '' or (p_ativa = 'sim' and e.ativo) or (p_ativa = 'nao' and not e.ativo))
       and (not exists (select 1 from public.equipes_grupos g where g.equipe_id = e.id)
            or exists (select 1 from public.equipes_membros m where m.equipe_id = e.id and m.grupo_id is null))
    union all
    select 'g' || g.id, e.id, g.id, e.nome || ' — ' || g.nome, e.lider_nome, e.lider_telefone, g.previsto, g.disponivel,
           e.proibe_menor, e.ativo, e.fechada, e.ordem * 100 + g.ordem + 1
      from public.equipes_grupos g join public.equipes e on e.id = g.equipe_id
     where p_ativa is null or p_ativa = '' or (p_ativa = 'sim' and e.ativo) or (p_ativa = 'nao' and not e.ativo)) x;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.equipe_nome, m.nome), '[]'::jsonb) into v_me from (
    select p.id, p.equipe_id,
           case when p.grupo_id is null then 'e' || p.equipe_id else 'g' || p.grupo_id end as unidade,
           e.nome || coalesce(' — ' || g.nome, '') as equipe_nome,
           p.nome, p.telefone, p.endereco, p.data_nascimento,
           extract(year from age(hoje, p.data_nascimento))::int as idade, p.tamanho_camiseta
      from public.equipes_membros p
      join public.equipes e on e.id = p.equipe_id
      left join public.equipes_grupos g on g.id = p.grupo_id
     where p_ativa is null or p_ativa = '' or (p_ativa = 'sim' and e.ativo) or (p_ativa = 'nao' and not e.ativo)) m;
  return jsonb_build_object('equipes', v_eq, 'membros', v_me);
end;
$$;
grant execute on function public.fpss_relatorio_equipes(text) to service_role;
select 'ok' as resultado;
