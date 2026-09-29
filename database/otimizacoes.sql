-- =====================================================================
-- FPSS 2027 — OTIMIZAÇÕES DE BANCO (Supabase/PostgreSQL)
-- Gerado pela auditoria enterprise de 2026-09-29 (não executado
-- automaticamente — revisar e rodar manualmente no SQL Editor do
-- Supabase, ou via psql, depois de conferir cada item).
--
-- Todos os comandos abaixo são idempotentes (IF NOT EXISTS / CONCURRENTLY
-- quando aplicável) — seguros de rodar mais de uma vez sem duplicar nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) CONSTRAINT ÚNICA em cartelas.numero_chance1 / numero_chance2
--
-- Achado CRÍTICO da auditoria: hoje a garantia de não vender a mesma
-- cartela duas vezes depende 100% da lógica da aplicação (RPC
-- reservar_cartela_digital + script de carga), sem nenhuma rede de
-- segurança no próprio banco. Já confirmado nas 21.230 linhas atuais
-- que NÃO existe nenhuma duplicata hoje — a constraint abaixo só passa
-- a impedir que uma duplicata futura seja inserida, não afeta nada que
-- já está gravado.
-- ---------------------------------------------------------------------
-- Postgres não aceita "ADD CONSTRAINT IF NOT EXISTS" — o bloco DO abaixo
-- é o jeito padrão de tornar isso idempotente (roda de novo sem erro se
-- a constraint já existir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_cartelas_numero_chance1'
  ) THEN
    ALTER TABLE public.cartelas
      ADD CONSTRAINT uq_cartelas_numero_chance1 UNIQUE (numero_chance1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_cartelas_numero_chance2'
  ) THEN
    ALTER TABLE public.cartelas
      ADD CONSTRAINT uq_cartelas_numero_chance2 UNIQUE (numero_chance2);
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 2) ÍNDICES em pedidos — hoje só existe índice em id (PK) e
--    codigo_pedido (UNIQUE). As colunas abaixo são usadas em buscas
--    frequentes (retirada, confirmação de pagamento, painel do
--    cliente) e não têm nenhum índice de apoio.
--
--    CONCURRENTLY evita travar a tabela inteira durante a criação —
--    mais lento, mas não derruba escritas em produção enquanto roda.
--    Não pode rodar dentro de uma transação/bloco BEGIN...COMMIT nem
--    dentro do SQL Editor do Supabase em alguns casos — se der erro
--    "cannot run inside a transaction block", rode cada CREATE INDEX
--    abaixo separado, fora de uma transação (ou remova CONCURRENTLY
--    se for rodar num horário de baixo tráfego).
-- ---------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_txid
  ON public.pedidos (txid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_cpf
  ON public.pedidos (cpf);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_status_pagamento
  ON public.pedidos (status_pagamento);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_status_retirada
  ON public.pedidos (status_retirada);


-- ---------------------------------------------------------------------
-- 3) ÍNDICE COMPOSTO em cartelas — os filtros mais usados no admin
--    (lote + status + tipo, juntos) hoje combinam 3 índices simples via
--    bitmap scan; um índice composto deixa essa consulta específica
--    ainda mais rápida à medida que o volume cresce (21 mil hoje, até
--    31 mil com a carga completa de físicas).
--    Opcional/melhoria futura — não é um problema hoje, só otimização.
-- ---------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartelas_lote_status_tipo
  ON public.cartelas (lote, status, tipo);


-- ---------------------------------------------------------------------
-- COMO CONFERIR ANTES DE RODAR
-- ---------------------------------------------------------------------
-- Antes do item (1), confirme de novo que não há duplicatas (a
-- auditoria já confirmou isso em 2026-09-29, mas dados mudam):
--
--   SELECT numero_chance1, count(*) FROM public.cartelas
--     WHERE numero_chance1 IS NOT NULL
--     GROUP BY numero_chance1 HAVING count(*) > 1;
--
--   SELECT numero_chance2, count(*) FROM public.cartelas
--     WHERE numero_chance2 IS NOT NULL
--     GROUP BY numero_chance2 HAVING count(*) > 1;
--
-- Se qualquer uma dessas duas consultas devolver alguma linha, PARE e
-- resolva a duplicata manualmente antes de rodar o item (1) — a
-- constraint vai falhar (e é isso mesmo que deve acontecer, para não
-- mascarar o problema).
