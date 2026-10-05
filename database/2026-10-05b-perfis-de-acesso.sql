-- =====================================================================
-- FPSS 2027 — Perfis de acesso (Administrador, Padrão, Voluntário)
-- Data: 2026-10-05 — pode rodar mais de uma vez (seguro).
--
-- Administrador: acesso a tudo (sempre).
-- Padrão e Voluntário: cada um acessa só as telas marcadas na tela
-- Usuários → "Perfis de acesso" (o administrador marca/desmarca).
--
-- ATENÇÃO (só na PRIMEIRA vez que rodar): quem hoje é "padrao" vira
-- "voluntario" — mantém exatamente o acesso que já tinha (Caixa,
-- Retirada e Leitor). Depois é só trocar na tela Usuários quem deve
-- ser Padrão (o novo perfil intermediário).
-- =====================================================================

-- 1º: papéis aceitos em user_profiles.role
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('admin','padrao','voluntario','usuario'));

do $$
begin
  if to_regclass('public.perfis_acesso') is null then

    create table public.perfis_acesso (
      papel          text primary key check (papel in ('padrao','voluntario')),
      paginas        text[] not null default '{}',
      atualizado_em  timestamptz not null default now(),
      atualizado_por text
    );

    -- quem era "padrao" (equipe do caixa) vira "voluntario" — só desta vez
    update public.user_profiles set role = 'voluntario' where role = 'padrao';

  end if;
end $$;

-- telas padrão de cada perfil (só cria se ainda não existir; não apaga o que você marcou)
insert into public.perfis_acesso (papel, paginas) values
  ('padrao',     array['central','dashboard','pedidos','cartelas','blocos','caixa','retirada','leitor']),
  ('voluntario', array['caixa','retirada','leitor'])
on conflict (papel) do nothing;

-- só o servidor (service_role) lê e grava
revoke all on public.perfis_acesso from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.perfis_acesso from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.perfis_acesso from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.perfis_acesso to service_role; end if;
end $$;

-- conferência
select papel, paginas from public.perfis_acesso order by papel;
select role, count(*) from public.user_profiles group by role order by role;
