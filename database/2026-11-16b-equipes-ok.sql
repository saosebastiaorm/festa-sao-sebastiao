-- Marca "equipe OK" (fechada) para ver rápido quais equipes ainda têm pendência.
-- Rode UMA vez no Supabase (pode rodar de novo sem problema).
alter table public.equipes add column if not exists fechada boolean not null default false;
select count(*) filter (where fechada) as equipes_ok, count(*) as total from public.equipes;
