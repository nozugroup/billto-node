// Call only after verifying your payment provider's webhook signature and paid state.
// npm install C:/Users/Dominik/Herd/billto-node
const { BillTo, Config, IdempotencyKey } = require('@billto/node');

async function handleVerifiedPayment({ token, eventId, orderId }) {
  const config = new Config(token).identify('MyShop', '1.0.0', 'integrations@example.com');
  const client = new BillTo(config);
  return client.orders.markPaid(orderId, {
    idempotencyKey: IdempotencyKey.fromOperation(eventId, 'my-shop'),
    sendEmail: false,
  });
}

module.exports = { handleVerifiedPayment };
