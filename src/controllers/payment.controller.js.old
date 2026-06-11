const orderStore = require("../services/order.store");

exports.confirmarPagamento = (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "orderId obrigatório"
    });
  }

  const order = orderStore.updateOrderStatus(orderId, "PAGO");

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Pedido não encontrado"
    });
  }

  return res.json({
    success: true,
    message: "Pagamento confirmado",
    data: order
  });
};