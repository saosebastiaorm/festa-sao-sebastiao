-- Caixa: cartão de débito ou crédito em cada parte do pagamento
alter table public.pedido_pagamentos add column if not exists cartao_tipo text
  check (cartao_tipo in ('debito','credito'));
notify pgrst, 'reload schema';
