-- =====================================================================
-- Vincula às entregas já feitas o NOME CERTO do parceiro (campo
-- "Comunidade/Parceiro" da pessoa), para o relatório de Parceiros
-- reconhecer que eles já receberam as cartelas.
--
-- Rode DEPOIS do 2026-11-12-relatorio-parceiros-vinculo.sql.
-- Só altera as pessoas listadas abaixo (ids do resultado da conferência).
-- Guarda o texto antigo em blocos_responsaveis_comunidade_bak (dá para voltar).
-- Pode rodar de novo sem problema.
-- =====================================================================

create table if not exists public.blocos_responsaveis_comunidade_bak (
  responsavel_id bigint primary key,
  comunidade_antes text,
  salvo_em timestamptz not null default now()
);
alter table public.blocos_responsaveis_comunidade_bak enable row level security;

with mapa(responsavel_id, trecho) as (values
  (76,  'aboca'),            -- BOCA LIVRARIA E PAPELARIA
  (77,  'centenario'),       -- CENTENÁRIO MATERIAIS P/ CONSTRUÇÃO
  (54,  'coman'),            -- COMAM MAQUINAS
  (201, 'crseguranca'),      -- CR Sistema de Segurança
  (46,  'reidopano'),        -- Gerente /rei do pano
  (47,  'vanzin'),           -- Gerente da vanzin
  (42,  'jarri'),            -- Jarri joalheria
  (59,  'laboratorio'),      -- LABORATÓRIO MUNDIAL (parceiro: Laboratório Musial)
  (9,   'maiconjoia'),       -- Maico Joia
  (44,  'oliveira'),         -- Mecânica oliveira
  (60,  'megamarmoraria'),   -- MEGA MORMARARIA
  (57,  'favorito'),         -- O FAVORITO
  (11,  'radioplanalto'),    -- Paceiro rádio planalto
  (83,  'manelao'),          -- POSTO MANELÃO
  (58,  'filebrasil'),       -- RESTAURANTE FILÉ BRASIL
  (66,  'ricart'),           -- SUPERMERCADO RICART
  (10,  'santahelena'),      -- Supermerdado Santa Helena
  (73,  'teixeira')          -- TEIXEIRA MATERIAIS P/ CONSTRUÇÃO
),
alvo as (
  select m.responsavel_id,
         (select p.nome from public.parceiros p
           where public.fpss_norm(p.nome) like '%' || m.trecho || '%'
           order by p.ordem, p.id limit 1) as nome_parceiro
    from mapa m
),
salvar as (
  insert into public.blocos_responsaveis_comunidade_bak (responsavel_id, comunidade_antes)
  select r.id, r.comunidade
    from public.blocos_responsaveis r
    join alvo a on a.responsavel_id = r.id
   where a.nome_parceiro is not null
  on conflict (responsavel_id) do nothing
  returning responsavel_id
)
update public.blocos_responsaveis r
   set comunidade = a.nome_parceiro
  from alvo a
 where r.id = a.responsavel_id and a.nome_parceiro is not null
returning r.id, r.nome as responsavel, r.comunidade as agora_vinculado_a;

-- Se algum id da lista NÃO aparecer no resultado acima, o parceiro não foi
-- encontrado pelo nome (cadastre/renomeie em Parceiros e rode de novo).
