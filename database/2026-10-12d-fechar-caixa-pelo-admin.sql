-- Fechamento de caixa pelo administrador (2026-10-12)
-- Guarda quem fechou quando não foi o próprio operador.
alter table public.caixa_sessoes add column if not exists fechado_por_admin_nome  text;
alter table public.caixa_sessoes add column if not exists fechado_por_admin_email text;
