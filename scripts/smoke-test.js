#!/usr/bin/env node
/* =====================================================================
   SMOKE TEST — verificações básicas contra a API em produção

   Não substitui uma suite de testes de verdade (o projeto não tem
   nenhuma ainda — ver auditoria enterprise de 2026-09-29). Isso aqui só
   confirma que as rotas públicas mais importantes continuam
   respondendo com o formato esperado depois de um deploy — um primeiro
   degrau, não uma rede de segurança completa.

   Uso:
     node scripts/smoke-test.js
     node scripts/smoke-test.js https://outra-url-de-teste.com

   Sai com código 0 se tudo passou, 1 se algo falhou (dá pra usar num
   passo de CI/CD no futuro).
===================================================================== */

const BASE = process.argv[2] || "https://api.festasaosebastiao.com.br";

let falhas = 0;
let total = 0;

async function checar(nome, fn) {
  total++;
  try {
    await fn();
    console.log(`✅ ${nome}`);
  } catch (erro) {
    falhas++;
    console.error(`❌ ${nome} — ${erro.message}`);
  }
}

function assert(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

async function main() {
  console.log(`Rodando smoke test contra ${BASE}\n`);

  await checar("GET / responde online", async () => {
    const r = await fetch(`${BASE}/`);
    const j = await r.json();
    assert(r.status === 200, `esperava 200, veio ${r.status}`);
    assert(j.status === "online", "campo status não é 'online'");
  });

  await checar("GET /rota-inexistente devolve 404 em JSON", async () => {
    const r = await fetch(`${BASE}/rota-que-nao-deveria-existir-${Date.now()}`);
    const j = await r.json();
    assert(r.status === 404, `esperava 404, veio ${r.status}`);
    assert(j.sucesso === false, "esperava sucesso:false no 404");
  });

  await checar("GET /admin/cartelas sem token devolve 401", async () => {
    const r = await fetch(`${BASE}/admin/cartelas`);
    const j = await r.json();
    assert(r.status === 401, `esperava 401, veio ${r.status}`);
    assert(j.sucesso === false, "esperava sucesso:false");
  });

  await checar("POST /cartelas/validar-numero com número inexistente", async () => {
    const r = await fetch(`${BASE}/cartelas/validar-numero`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: "00000-00" })
    });
    const j = await r.json();
    assert(j.sucesso === false, "esperava sucesso:false pra número inexistente");
    assert(j.valido === false, "esperava valido:false");
  });

  await checar("Headers de segurança presentes (Helmet)", async () => {
    const r = await fetch(`${BASE}/`);
    assert(r.headers.get("x-content-type-options") === "nosniff", "faltou x-content-type-options");
    assert(r.headers.get("x-frame-options"), "faltou x-frame-options");
    assert(!r.headers.get("x-powered-by"), "x-powered-by ainda está exposto");
  });

  await checar("CORS bloqueia origem não autorizada", async () => {
    const r = await fetch(`${BASE}/`, {
      headers: { Origin: "https://site-nao-autorizado-teste.vercel.app" }
    });
    const permitido = r.headers.get("access-control-allow-origin");
    assert(!permitido, `CORS deveria bloquear essa origem, mas devolveu: ${permitido}`);
  });

  await checar("Rate limit em /cliente-login responde 400/404 pra dado inválido (não trava)", async () => {
    const r = await fetch(`${BASE}/cliente-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: "000.000.000-00", telefone: "00000000000" })
    });
    assert([400, 404].includes(r.status), `esperava 400 ou 404, veio ${r.status}`);
  });

  console.log(`\n${total - falhas}/${total} verificações passaram.`);
  if (falhas > 0) {
    console.error(`${falhas} falharam.`);
    process.exit(1);
  }
}

main().catch((erro) => {
  console.error("Erro inesperado rodando o smoke test:", erro);
  process.exit(1);
});
