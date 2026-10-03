'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('..');

function fake(queue, options = {}, config = new sdk.Config('test')) {
  const requests = [];
  const client = new sdk.BillTo(config, {
    fetch: async (url, init) => { requests.push({ url: new URL(url), ...init }); assert.ok(queue.length); return queue.shift(); },
    sleeper: async () => {}, ...options,
  });
  return { client, requests };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('calendar dates keep the chosen day across payment, report and exchange-rate requests', async () => {
  const { client, requests } = fake([json({ data: {} }), json({ data: {} }), json({ summary: {}, groups: [] }), json({ data: [] })]);
  await client.invoices.recordPayment('i', '10.00', { paidAt: '2026-09-10' });
  await client.invoices.markPaid('i', { paidAt: '2026-09-10' });
  await client.reports.profitability('2026-09-10', '2026-09-11');
  await client.exchangeRates.list('EUR', '2026-09-10', '2026-09-09', '2026-09-11');
  assert.equal(JSON.parse(requests[0].body).paid_at, '2026-09-10');
  assert.equal(JSON.parse(requests[1].body).paid_at, '2026-09-10');
  assert.equal(requests[2].url.searchParams.get('from'), '2026-09-10');
  assert.equal(requests[3].url.searchParams.get('date'), '2026-09-10');
});

test('ambiguous timestamps and invalid calendar dates fail before HTTP', () => {
  const { client, requests } = fake([]);
  for (const value of [new Date('2026-09-10T00:00:00+02:00'), '2026-09-10T00:00:00+02:00', '2026-02-30', '2026-13-01', '', 42]) {
    assert.throws(() => client.invoices.markPaid('i', { paidAt: value }), /YYYY-MM-DD/);
  }
  assert.equal(requests.length, 0);
});

test('timestamp endpoints still accept Date and preserve the instant', async () => {
  const { client, requests } = fake([json({ data: {}, meta: { applied: true } })]);
  await client.incomingInvoices.vote('i', 'approved', 'a@example.com', { decidedAt: new Date('2026-09-10T00:00:00+02:00') });
  assert.equal(JSON.parse(requests[0].body).decided_at, '2026-09-09T22:00:00.000Z');
});

test('response observer receives trace headers for retries, successes, downloads and API errors', async () => {
  const seen = [];
  const config = new sdk.Config('test').withCorrelationId('job-123').withMaxRetries(1).identify('test', '1', 'a@example.com');
  const { client, requests } = fake([
    json({}, 503, { 'X-Trace-Id': 'retry' }), json({ data: { id: 'i' } }, 200, { 'X-Trace-Id': 'ok' }),
    new Response('%PDF', { headers: { 'X-Trace-Id': 'pdf' } }), json({}, 422, { 'X-Trace-Id': 'error' }),
  ], { onResponse: async response => { await Promise.resolve(); seen.push(response.header('X-Trace-Id')); } }, config);
  assert.equal((await client.invoices.get('i')).id, 'i');
  assert.equal((await client.invoices.pdf('i')).content.toString(), '%PDF');
  await assert.rejects(client.invoices.create({}), sdk.ValidationError);
  assert.deepEqual(seen, ['retry', 'ok', 'pdf', 'error']);
  assert.ok(requests.every(r => r.headers['X-Correlation-Id'] === 'job-123'));
  assert.equal(config.withCorrelationId(null).correlationId, null);
});

test('observer failure aborts a successful mutation without retrying', async () => {
  const failure = new Error('logger failed');
  const { client, requests } = fake([json({ data: {} })], { onResponse: async () => { throw failure; } });
  await assert.rejects(client.invoices.create({}), error => error === failure);
  assert.equal(requests.length, 1);
});

test('correlation IDs are optional and validated before sending HTTP', async () => {
  for (const value of ['', ' ', 'a\r\nb', 'ą', 42]) assert.throws(() => new sdk.Config('t', { correlationId: value }), /X-Correlation-Id/);
  const { client, requests } = fake([json({ data: {} })]);
  await client.invoices.get('i');
  assert.equal(requests[0].headers['X-Correlation-Id'], undefined);
});

test('entities expose integration fields and tolerate omitted relations', () => {
  const order = new sdk.Order({ source: 'shop', external_id: null, display_number: '#1', integration_warnings: ['missing_email'], buyer: {} });
  assert.equal(order.source, 'shop');
  assert.equal(order.display_number, '#1');
  assert.deepEqual(order.integration_warnings, ['missing_email']);
  assert.equal(order.items, undefined);
  const invoice = new sdk.Invoice({ effective_target: 'ksef', created_at: null });
  assert.equal(invoice.effective_target, 'ksef');
  assert.equal(invoice.created_at, null);
  assert.deepEqual(invoice.items(), []);
  assert.equal(invoice.buyer(), null);
  assert.equal(new sdk.InvoiceParty({ address_line_1: 'Łódź', address_line_2: null }).address_line_1, 'Łódź');
});

test('OSS rates accept a JSON number without coercion', async () => {
  const { client, requests } = fake([json({ data: {} })]);
  await client.orders.markPaid('o', { ossVatType: 19.5 });
  assert.equal(JSON.parse(requests[0].body).oss_vat_type, 19.5);
});
