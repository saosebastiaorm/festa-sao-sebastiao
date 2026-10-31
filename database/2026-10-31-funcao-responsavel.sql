-- Função (cargo) de quem recebe os blocos: coordenador, tesoureiro, secretário, gerente, proprietário ou texto livre.
-- Seguro rodar mais de uma vez.
alter table public.blocos_responsaveis add column if not exists funcao text;
