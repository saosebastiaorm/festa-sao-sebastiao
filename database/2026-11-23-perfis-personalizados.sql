-- =====================================================================
-- FPSS 2027 — PERFIS DE ACESSO PERSONALIZADOS (criar, editar e excluir)
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo, é seguro).
--
-- Os perfis de fábrica (Padrão, Voluntário, Operador de Caixa, Equipe do
-- Bingo) continuam. Os perfis que você criar na tela Usuários ficam em
-- perfis_acesso com personalizado = true e papel começando por "perfil_".
-- =====================================================================

alter table public.perfis_acesso add column if not exists nome text;
alter table public.perfis_acesso add column if not exists personalizado boolean not null default false;

alter table public.perfis_acesso drop constraint if exists perfis_acesso_papel_check;
alter table public.perfis_acesso add constraint perfis_acesso_papel_check
  check (papel in ('padrao','voluntario','operador_caixa','equipe_bingo') or papel like 'perfil\_%');

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('admin','padrao','voluntario','operador_caixa','equipe_bingo','usuario') or role like 'perfil\_%');

select papel, nome, personalizado from public.perfis_acesso order by papel;
