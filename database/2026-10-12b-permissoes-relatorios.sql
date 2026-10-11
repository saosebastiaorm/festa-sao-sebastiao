-- =====================================================================
-- PERMISSÕES DOS RELATÓRIOS: cada relatório vira uma "tela" nos Perfis de
-- acesso (Usuários → Perfis de acesso), que pode ser ligada/desligada.
-- Para começar, cada perfil e cada usuário com acesso personalizado ganha
-- os relatórios das telas que JÁ tem liberadas. Rode uma vez.
-- =====================================================================
create or replace function public.fpss_chaves_relatorio(p text[]) returns text[]
language sql immutable as $$
  select coalesce(array(select distinct k from unnest(
    array_remove(coalesce(p, '{}'::text[]), 'relatorios')
    || case when 'caixa' = any(p) or 'caixas' = any(p) then array['rel_caixa'] else '{}'::text[] end
    || case when 'pedidos' = any(p) then array['rel_pedidos', 'rel_produtos'] else '{}'::text[] end
    || case when 'produtos' = any(p) then array['rel_produtos', 'rel_estoque'] else '{}'::text[] end
    || case when 'retirada' = any(p) or 'leitor' = any(p) then array['rel_retirada'] else '{}'::text[] end
    || case when 'cartelas' = any(p) then array['rel_cartelas'] else '{}'::text[] end
    || case when 'lotes' = any(p) then array['rel_lotes'] else '{}'::text[] end
    || case when 'blocos' = any(p) then array['rel_blocos', 'rel_distribuicao'] else '{}'::text[] end
    || case when 'origens' = any(p) then array['rel_origens'] else '{}'::text[] end
    || case when 'parceiros' = any(p) then array['rel_parceiros'] else '{}'::text[] end
    || case when 'relatorios' = any(p) then array['rel_caixa','rel_pedidos','rel_produtos','rel_retirada','rel_estoque',
         'rel_cartelas','rel_lotes','rel_blocos','rel_distribuicao','rel_origens','rel_parceiros'] else '{}'::text[] end
  ) k), '{}'::text[]);
$$;

update public.perfis_acesso set paginas = public.fpss_chaves_relatorio(paginas);
update public.user_profiles set paginas_personalizadas = public.fpss_chaves_relatorio(paginas_personalizadas)
 where paginas_personalizadas is not null;

select papel, paginas from public.perfis_acesso order by papel;
