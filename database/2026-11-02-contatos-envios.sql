-- Controle de envio de avisos pelo WhatsApp (tela Contatos → "Enviar aviso um a um").
-- Guarda quem já recebeu cada aviso, para não repetir e para retomar de onde parou.
-- Seguro rodar mais de uma vez.
create table if not exists public.contatos_envios (
  campanha     text        not null,
  telefone     text        not null,
  enviado_em   timestamptz not null default now(),
  enviado_por  text,
  primary key (campanha, telefone)
);
alter table public.contatos_envios enable row level security;  -- só o servidor (service_role) acessa
