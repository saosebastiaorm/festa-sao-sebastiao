const orderStore = require("../services/order.store");

exports.listarPedidos = (req, res) => {
  const pedidos = orderStore.getOrders();

  res.json({
    total: pedidos.length,
    pedidos
  });
};