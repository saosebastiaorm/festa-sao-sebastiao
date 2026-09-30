-- =====================================================================
-- lotes_cartelas — remessas de cartelas (física/digital), preço e
-- ativação independentes por tipo.
--
-- SEGURO DE RODAR: só cria uma tabela nova e insere 4 linhas de
-- histórico (a partir do que já existe hoje: lote "ficticio_teste" e
-- "oficial_2027", cada um com física e digital). Não mexe em nenhuma
-- linha da tabela "cartelas". É idempotente — pode rodar de novo sem
-- problema (não duplica nada).
--
-- IMPORTANTE: esta tabela sozinha não muda nada no site — o backend só
-- passa a USAR ela depois que o código novo (já escrito, aguardando
-- deploy) for publicado no Render. Rodar este SQL antes ou depois da
-- virada manual de lote_ativo/modo_teste não faz diferença.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lotes_cartelas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('fisica', 'digital')),
  descricao text,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  quantidade_total integer,
  ativo boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chave, tipo)
);

-- Garante no banco que só existe 1 lote ATIVO por tipo ao mesmo tempo
-- (física e digital podem ter lotes ativos diferentes entre si).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lotes_cartelas_ativo_por_tipo
  ON public.lotes_cartelas (tipo) WHERE ativo;

ALTER TABLE public.lotes_cartelas ENABLE ROW LEVEL SECURITY;
-- Sem política nenhuma = ninguém acessa via chave anônima/pública, só o
-- backend (que usa a service_role e sempre ignora RLS) — mesmo padrão
-- de segurança já usado em todas as outras tabelas sensíveis do projeto.

-- ===== SEED: reflete o estado real de hoje (2026-09-30) =====
-- Se você AINDA NÃO tiver feito a virada manual de lote_ativo='oficial_2027'
-- e modo_teste='false' na tabela cartelas_config, tudo bem — rode este SQL
-- mesmo assim. Essas 4 linhas não têm efeito nenhum até o deploy do
-- backend novo; quando eu avisar que já publiquei, você ativa os lotes
-- que quiser direto pela tela de Lotes do admin (não precisa editar isso
-- de novo por SQL).
INSERT INTO public.lotes_cartelas (chave, tipo, descricao, valor_centavos, quantidade_total, ativo) VALUES
  ('ficticio_teste', 'fisica',  'Lote de testes (física)',                 1,    230,   false),
  ('ficticio_teste', 'digital', 'Lote de testes (digital)',                1,    230,   false),
  ('oficial_2027',   'fisica',  'Lote oficial 2027 — 1ª remessa física',   2000, 20000, true),
  ('oficial_2027',   'digital', 'Lote oficial 2027 — 1ª remessa digital',  2000, 1000,  true)
ON CONFLICT (chave, tipo) DO NOTHING;
