'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sdk = require('..');
const contracts = require('./contracts.json');

function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } }); }
function fake(queue, config = new sdk.Config('test-token')) {
  const requests = [], delays = [];
  const client = new sdk.BillTo(config, {
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), ...options });
      assert.ok(queue.length, 'Unexpected extra HTTP request');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleeper: async seconds => { delays.push(seconds); },
    keyGenerator: () => 'generated-key',
  });
  return { client, requests, delays };
}

for (const scenario of contracts) {
  test(`PHP contract: ${scenario.name}`, async () => {
    const { client, requests } = fake([scenario.verb === 'DELETE' ? new Response(null, { status: 204 }) : json(scenario.response)]);
    const args = [...scenario.args];
    if (scenario.options) args.push(scenario.options);
    let result = client[scenario.resource][scenario.method](...args);
    result = scenario.collect ? await result.collect() : await result;
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.method, scenario.verb);
    assert.equal(request.url.pathname, '/api/v1/' + scenario.path);
    assert.deepEqual(Object.fromEntries(request.url.searchParams), scenario.query);
    assert.deepEqual(request.body === undefined ? null : JSON.parse(request.body), scenario.body);
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    if (scenario.result) assert.ok(result instanceof sdk[scenario.result]);
    if (scenario.args.includes('event') || scenario.options?.idempotencyKey) assert.equal(request.headers['Idempotency-Key'], 'event');
  });
}

test('retries preserve body and key; successive operations use new keys', async () => {
  const { client, requests, delays } = fake([json({}, 503), new TypeError('network'), json({ data: { id: 'i1' } })]);
  await client.invoices.create({ name: 'Zażółć' });
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(r => r.headers['Idempotency-Key'])).size, 1);
  assert.equal(new Set(requests.map(r => r.body)).size, 1);
  assert.equal(delays.length, 2);
  const keys = [];
  const realKeys = new sdk.BillTo('test-token', { fetch: async (url, options) => { keys.push(options.headers['Idempotency-Key']); return json({ data: {} }); } });
  await realKeys.invoices.create({}); await realKeys.invoices.create({});
  assert.notEqual(keys[0], keys[1]);
});
test('unkeyed mutation never retries; explicit key restores safe retries', async () => {
  const config = new sdk.Config('test', { autoIdempotency: false });
  const first = fake([json({}, 503)], config);
  await assert.rejects(first.client.invoices.create({}), sdk.ServerError);
  assert.equal(first.requests.length, 1);
  const second = fake([json({}, 503), json({ data: {} })], config);
  await second.client.invoices.create({}, 'event');
  assert.equal(second.requests.length, 2);
});
test('throttling retries are capped; plan quota is not retried', async () => {
  const transient = fake([json({}, 429, { 'Retry-After': '100' }), json({ data: {} })]);
  await transient.client.invoices.get('i1');
  assert.deepEqual(transient.delays, [10]);
  const quota = fake([json({ usage: { used: 100, limit: 100 }, upgrade_url: 'https://example.test' }, 429)]);
  await assert.rejects(quota.client.invoices.get('i1'), error => error instanceof sdk.RateLimitError && error.isPlanLimit() && error.usage.used === 100);
  assert.equal(quota.requests.length, 1);
});
test('HTTP-date Retry-After and malformed headers', () => {
  const future = new Date(Date.now() + 60000).toUTCString();
  const error = new sdk.RateLimitError('wait', new sdk.ApiResponse(429, '{}', { 'Retry-After': future }));
  assert.ok(error.retryAfter > 0 && error.retryAfter <= 60);
  for (const header of ['bad', '-5']) assert.equal(new sdk.RateLimitError('wait', new sdk.ApiResponse(429, '{}', { 'retry-after': header })).retryAfter, null);
});
test('all HTTP statuses map to typed errors, malformed error bodies remain available', async () => {
  for (const [status, Type] of [[400,sdk.ApiError],[401,sdk.AuthenticationError],[402,sdk.PaymentRequiredError],[403,sdk.ForbiddenError],[404,sdk.NotFoundError],[409,sdk.ConflictError],[422,sdk.ValidationError],[429,sdk.RateLimitError],[500,sdk.ServerError],[502,sdk.ServerError],[503,sdk.ServerError],[504,sdk.ServerError]]) {
    const { client } = fake([new Response('not json', { status })], new sdk.Config('test', { maxRetries: 0 }));
    await assert.rejects(client.invoices.get('i1'), error => error instanceof Type && error.status === status && error.response.body.toString() === 'not json');
  }
});
test('validation, scope, conflict and plan helpers', async () => {
  const { client } = fake([json({ message: 'Invalid', errors: { 'items.0.name': ['Required'], buyer: 'Missing' } }, 422)]);
  await assert.rejects(client.invoices.create({}), error => error.has('buyer') && error.first('items.0.name') === 'Required' && error.messages().length === 2);
  const response = new sdk.ApiResponse(403, '{"code":"nip_conflict","upgrade_url":"u","data":{"id":"i"}}');
  assert.ok(new sdk.ForbiddenError('scope missing', response).isInsufficientScope());
  assert.ok(new sdk.ForbiddenError('', response).isNipConflict());
  assert.equal(new sdk.PaymentRequiredError('', response).upgradeUrl(), 'u');
  assert.deepEqual(new sdk.ConflictError('', response).data(), { id: 'i' });
});
test('network failures exhaust retries and retain cause', async () => {
  const cause = new Error('offline');
  const { client, requests } = fake([cause, cause, cause]);
  await assert.rejects(client.invoices.get('i'), error => error instanceof sdk.TransportError && error.cause === cause);
  assert.equal(requests.length, 3);
});
test('rejects malformed success payloads and redirects', async () => {
  for (const data of [{}, { data: null }, { data: [] }, { data: 'bad' }]) {
    const { client } = fake([json(data)]);
    await assert.rejects(client.invoices.get('i'), sdk.UnexpectedResponseError);
  }
  for (const data of [{ data: {} }, { data: [3] }, { data: [null] }]) {
    const { client } = fake([json(data)]);
    await assert.rejects(client.invoices.list(), sdk.UnexpectedResponseError);
  }
  const redirect = fake([new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } })]);
  await assert.rejects(redirect.client.invoices.get('i'), sdk.UnexpectedResponseError);
  assert.equal(redirect.requests[0].redirect, 'manual');
});
test('lazy pagination advances even when filters contain page; early exit makes no extra calls', async () => {
  const { client, requests } = fake([json({ data: [{ id: '1' }], meta: { current_page: 1, last_page: 2 } }), json({ data: [{ id: '2' }], meta: { current_page: 2, last_page: 2 } })]);
  const paginator = client.invoices.all({ page: 1, per_page: 1 }, 5);
  assert.equal(requests.length, 0);
  assert.deepEqual((await paginator.collect()).map(row => row.id), ['1', '2']);
  assert.deepEqual(requests.map(r => r.url.searchParams.get('page')), ['1','2']);
  const early = fake([json({ data: [{ id: '1' }], meta: { current_page: 1, last_page: 2 } })]);
  for await (const item of early.client.invoices.all()) { assert.equal(item.id, '1'); break; }
  assert.equal(early.requests.length, 1);
});
test('pagination guards against stuck server pages', async () => {
  const page = () => json({ data: [], meta: { current_page: 1, last_page: 3 } });
  const { client } = fake([page(), page()]);
  await assert.rejects(client.invoices.all().collect(), /did not advance/);
});
test('query booleans, nulls, nested arrays, dates and escaped IDs', async () => {
  const { client, requests } = fake([json({ data: [] }), json({ data: {} })]);
  await client.products.list({ active_only: false, missing: null, tags: ['a','b'], since: new Date('2026-09-01T00:00:00Z') });
  assert.equal(requests[0].url.searchParams.get('active_only'), '0');
  assert.equal(requests[0].url.searchParams.get('tags[1]'), 'b');
  assert.equal(requests[0].url.searchParams.has('missing'), false);
  assert.equal(requests[0].url.searchParams.get('since'), '2026-09-01T00:00:00.000Z');
  await client.invoices.get('a/b?#');
  assert.equal(requests[1].url.pathname, '/api/v1/invoices/a%2Fb%3F%23');
  assert.throws(() => client.invoices.get('..'), /Resource ID/);
});
test('KSeF polling completes, reports errors, and returns last status on deadline', async () => {
  for (const terminal of [{ ksef_number: 'K1' }, { has_unresolved_errors: true }]) {
    const { client } = fake([json({ data: { sent: true } }), json({ data: terminal })]);
    let now = 0;
    const result = await client.invoices.waitForKsef('i', { timeoutSeconds: 10, intervalSeconds: 2, clock: () => now, sleeper: async delay => { now += delay; } });
    assert.ok(result.isAssigned() || result.hasErrors()); assert.equal(now, 2);
  }
  const { client, requests } = fake([json({ data: { sent: true } })]);
  let now = 0;
  assert.ok((await client.invoices.waitForKsef('i', { timeoutSeconds: 1, clock: () => now, sleeper: async delay => { now += delay; } })).isPending());
  assert.equal(requests.length, 1); assert.equal(now, 1);
});
test('binary endpoints preserve bytes, metadata and safe filenames', async () => {
  for (const [resource, method, args, expected] of [['invoices','pdf',['i'],'invoices/i/pdf'], ['invoices','xml',['i',2],'invoices/i/xml'], ['orders','pdf',['o'],'orders/o/pdf'], ['incomingInvoices','xml',['i'],'incoming-invoices/i/xml']]) {
    const bytes = Buffer.from([0,255,1,2]);
    const { client, requests } = fake([new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''..%2FZa%C5%BC%C3%B3%C5%82%C4%87.pdf" } })]);
    const file = await client[resource][method](...args);
    assert.deepEqual(file.content, bytes); assert.equal(file.filename, 'Zażółć.pdf');
    assert.equal(requests[0].headers.Accept, '*/*'); assert.equal(requests[0].url.pathname, '/api/v1/'+expected);
    if (args.length === 2) assert.equal(requests[0].url.searchParams.get('version'), '2');
    const directory = await mkdtemp(path.join(tmpdir(), 'billto-node-test-'));
    try { const saved = await file.saveIn(directory); assert.equal(path.dirname(saved), directory); assert.deepEqual(await readFile(saved), bytes); }
    finally { await rm(directory, { recursive: true }); }
  }
});
test('entities preserve fields, nested helpers and immutability', () => {
  const invoice = new sdk.Invoice({ id: 'i', status: 'draft', paid_at: null, totals: { gross: '123.45' }, remaining_amount: '23.45', items: [{name:'X'}], payments: [{amount:'1.00'}], buyer: {name:'ACME'}, ksef:{number:'K'} });
  assert.ok(invoice.isDraft()); assert.equal(invoice.isPaid(), false); assert.equal(invoice.grossTotal(),123.45);
  assert.equal(invoice.statusEnum(), sdk.InvoiceStatus.Draft); assert.equal(invoice.typeEnum(), null);
  assert.equal(new sdk.Invoice({type:'VAT'}).typeEnum(), sdk.InvoiceType.VAT);
  assert.equal(new sdk.Order({status:'confirmed'}).statusEnum(), sdk.OrderStatus.Confirmed);
  assert.equal(new sdk.IncomingInvoice({status:'pending'}).statusEnum(), sdk.IncomingInvoiceStatus.Pending);
  assert.equal(invoice.items()[0].name,'X'); assert.equal(invoice.buyer().name,'ACME');
  assert.equal(invoice.payments()[0].get('amount'),'1.00'); assert.equal(invoice.ksefNumber(),'K');
  assert.equal(invoice.get('items.0.name'),'X'); assert.ok(invoice.has('paid_at')); assert.equal(invoice.has('missing'),false);
  assert.throws(() => { invoice.totals.gross = '0'; }, TypeError);
  const copy = invoice.toObject(); copy.totals.gross = '0'; assert.equal(invoice.grossTotal(),123.45);
  assert.equal(new sdk.Entity({amount: '', paid: false}).amount('amount'),null);
});
test('config is immutable, sanitized and hides token', () => {
  const config = new sdk.Config('secret');
  assert.equal(config.withMaxRetries(4).maxRetries,4); assert.equal(config.maxRetries,2);
  assert.equal(config.identify('ERP','2.1','a@example.test').userAgent, 'ERP/2.1 (+a@example.test; compat=2026-09-15) billto-node/1.0.0');
  assert.equal(JSON.stringify(config).includes('secret'),false);
  for (const options of [{maxRetries:-1},{timeout:0},{baseUrl:'file:///tmp'},{baseUrl:'https://user:pass@example.test'},{userAgent:'bad\nheader'}]) assert.throws(() => new sdk.Config('test',options));
  assert.throws(() => config.identify('!!!','1','x'));
  assert.equal(sdk.BillTo.sandbox('test').config.baseUrl,sdk.SANDBOX_BASE_URL);
});
test('idempotency key UUID and stable hash match the PHP namespace when requested', () => {
  assert.match(sdk.IdempotencyKey.generate(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(sdk.IdempotencyKey.fromOperation('event','billto-php'), require('node:crypto').createHash('sha256').update('billto-php|event').digest('hex'));
});
test('ESM and CommonJS expose the same client and constants', async () => {
  const esm = await import('../src/index.mjs');
  assert.equal(esm.default,sdk.BillTo); assert.equal(esm.BillTo,sdk.BillTo); assert.equal(esm.PaymentMethod.Card,'card');
});
test('real fetch sends HTTP requests, blocks redirects and applies timeout', async () => {
  let leaked = false;
  const server = http.createServer((req,res) => {
    if (req.url.endsWith('/slow')) return;
    if (req.url.endsWith('/redirect')) { res.writeHead(302,{location:'/leak'}); res.end(); return; }
    if (req.url === '/leak') leaked = true;
    assert.equal(req.headers.authorization,'Bearer test-token');
    res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"data":{"id":"live"}}');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const client = new sdk.BillTo(new sdk.Config('test-token',{baseUrl:`http://127.0.0.1:${server.address().port}/api/v1`,maxRetries:0,timeout:0.1}));
    assert.equal((await client.invoices.get('live')).id,'live');
    await assert.rejects(client.invoices.get('redirect'),sdk.UnexpectedResponseError);
    await assert.rejects(client.invoices.get('slow'),sdk.TransportError);
    assert.equal(leaked,false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
