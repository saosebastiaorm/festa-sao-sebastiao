-- =====================================================================
-- FPSS 2027 — Liberação de cartelas expiradas com folga de 15 minutos
-- Data: 2026-10-04 — pode rodar a qualquer momento, quantas vezes quiser.
--
-- POR QUE: o Pix da cartela vale 1 hora. Se o cliente paga no último
-- minuto e fecha a tela, a conferência automática do servidor (a cada
-- 2 min) precisa de alguns minutos para ver o pagamento na Sicredi.
-- Liberando só depois de 1h15, nenhuma cartela paga é devolvida ao
-- estoque antes de ser confirmada.
-- Também passa a limpar o endereço do comprador anterior.
-- =====================================================================

create or replace function public.liberar_cartelas_expiradas()
returns void
language plpgsql
as $function$
begin
  update cartelas
  set status = 'disponivel',
      nome_comprador = null,
      cpf_comprador = null,
      whatsapp_comprador = null,
      vai_na_festa = null,
      valor_pago = null,
      pix_id = null,
      reservado_em = null,
      cep = null,
      cidade = null,
      bairro = null,
      rua = null,
      numero_endereco = null
  where status = 'pendente'
    and reservado_em is not null
    and reservado_em < now() - interval '75 minutes';
end;
$function$;

select 'Liberação de cartelas com folga instalada' as resultado;
