const orders = [];

function createOrder(order) {
  orders.push(order);
  return order;
}

function getOrders() {
  return orders;
}

function updateOrderStatus(orderId, status) {
  const order = orders.find(o => o.orderId === orderId);
  if (order) {
    order.status = status;
  }
  return order;
}

function findOrder(orderId) {
  return orders.find(o => o.orderId === orderId);
}

module.exports = {
  createOrder,
  getOrders,
  updateOrderStatus,
  findOrder
};

function updateOrderStatus(orderId, status) {
  const order = orders.find(o => o.orderId === orderId);

  if (!order) {
    return null;
  }

  order.status = status;
  order.updatedAt = new Date();

  return order;
}

module.exports = {
  createOrder,
  getOrders,
  updateOrderStatus,
  findOrder
};