# BillTo Node.js SDK

[![CI](https://github.com/nozugroup/billto-node/actions/workflows/ci.yml/badge.svg)](https://github.com/nozugroup/billto-node/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Node.js client for the [BillTo](https://billto.pl) invoicing API. Manage invoices,
KSeF submissions, orders, contractors, products, incoming invoices and warehouse operations.

- Node.js **22+**, with no runtime dependencies.
- CommonJS and ES modules, with TypeScript declarations included.
- Asynchronous requests, lazy pagination, typed errors and binary downloads.
- Automatic idempotency keys, bounded retries and response diagnostics.

[API reference](https://billto.pl/api.json/#/) · [PHP SDK](https://github.com/nozugroup/billto-php) · [Python SDK](https://github.com/nozugroup/billto-python)

## Installation

Install from GitHub (requires Git):

```bash
npm install github:nozugroup/billto-node#main
```

For reproducible deployments, replace `main` with a commit SHA. To install a local checkout:

```bash
npm install ../billto-node
```

The import name is `@billto/node`. Installing from GitHub does not require an npm registry release.

## Quick start

Create a token in **BillTo → Settings → API tokens**, with the scopes your integration needs.
Set `BILLTO_TOKEN` in the process environment. Use a sandbox token for this example.
Save it as `example.mjs`, then run `node example.mjs`.

```js
import BillTo from '@billto/node';

const client = BillTo.sandbox(process.env.BILLTO_TOKEN);
const page = await client.invoices.list({ status: 'issued' }, 1, 50);

for (const invoice of page) {
  console.log(invoice.id, invoice.invoice_number, invoice.get('totals.gross'));
}
```

Use `new BillTo(token)` for production. CommonJS uses a named export:

```js
const { BillTo } = require('@billto/node');
const client = BillTo.sandbox(process.env.BILLTO_TOKEN);

async function main() {
  const page = await client.invoices.list();
  console.log(page.total);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
```

The following snippets use `client` from the ES module quick start.

## Create an invoice

This creates a draft. Replace the sample dates and buyer details with your own.
Set `issue: true` and supply an appropriate `series_id` to issue it immediately.

```js
const invoice = await client.invoices.create({
  type: 'VAT',
  issue_date: '2026-10-03',
  payment_method: 'transfer',
  currency: 'PLN',
  amount_entry_mode: 'net',
  buyer: { name: 'ACME sp. z o.o.', tax_type: 'local', tax_number: '5261040828' },
  items: [
    { name: 'Consulting', quantity: 1, unit_price: '150.00', vat_type: '23' },
  ],
});

console.log(invoice.id, invoice.get('totals.gross'));
```

Payloads are ordinary objects with the API's original snake_case field names.
Method names and SDK options use camelCase, for example `paidAt` and `idempotencyKey`.

## Available resources

| Resource | Operations |
| --- | --- |
| `client.invoices` | list, all, get, create, update, delete, issue, sendToKsef, ksefStatus, waitForKsef, pdf, xml, sendEmail, publicLink, recordPayment, markPaid, deletePayment |
| `client.orders` | list, all, get, create, update, delete, confirm, close, cancel, sendConfirmation, pdf, issueAdvance, markPaid, issueCorrection, issueKor |
| `client.contractors` | list, all, get, create, update, delete, findByTaxNumber, insights |
| `client.products` | list, all, get, create, update, delete, price |
| `client.priceGroups` | list |
| `client.incomingInvoices` | list, all, get, updatedSince, xml, accept, reject, vote |
| `client.warehouse` | warehouses, stocks, allStocks, movements, allMovements, move, receive, issue |
| `client.reports` | profitability |
| `client.invoiceSeries` | list, default |
| `client.bankAccounts` | list, default |
| `client.exchangeRates` | list, rate |

Token scopes, plan requirements and payload fields are defined by the API reference.
See [the TypeScript declarations](src/index.d.ts) for method signatures and result types.

## Pagination and entities

`list(filters, page, perPage)` fetches one `Page`. `all(filters, perPage)` returns a lazy
asynchronous paginator; it starts at page 1. Explicit pagination arguments override
`page` and `per_page` entries in filters.

```js
for await (const row of client.invoices.all({ status: 'issued' }, 100)) {
  console.log(row.invoice_number);
}

for await (const page of client.contractors.all().pages()) {
  console.log(page.currentPage, page.lastPage, page.count());
}
```

Use `await paginator.collect()` only when you want all matching records in memory.
Entities preserve response fields, including fields the SDK does not yet declare.
Use `invoice.get('totals.gross')` or `invoice.toObject()` for raw data, and `invoice.items()`
or `invoice.buyer()` for related entities. Fields whose names collide with methods,
such as a payment's `amount`, remain accessible through `get()`.

Optional relations may be absent (`undefined`); nullable fields may contain `null`.
Collection helpers return `[]` when missing, and single-relation helpers return `null`.

## Dates and money

Payment dates, report ranges and exchange-rate dates take **`YYYY-MM-DD` strings**.
These methods reject JavaScript `Date` objects to prevent an implicit time-zone conversion
from changing the intended calendar day. Convert timestamps in your business time zone first.
Timestamp inputs such as `updatedSince` and vote `decidedAt` accept `Date` or ISO 8601 strings.
Raw payload objects are passed through; format their date fields explicitly too.

```js
await client.invoices.recordPayment(invoice.id, '184.50', {
  paidAt: '2026-10-03',
  paymentMethod: 'transfer',
});
```

Use decimal strings when preserving exact monetary values matters. `amount()`,
`grossTotal()` and `remainingAmount()` return JavaScript numbers; use the raw response
string and your decimal arithmetic library for exact calculations.

## Idempotency and retries

POST, PUT and PATCH requests receive an automatic `Idempotency-Key` by default.
The same key and body are reused during retries. Separate method calls get separate keys;
pass a stable key for an external event that may be delivered more than once.

```js
import { IdempotencyKey } from '@billto/node';

// Call after verifying the payment provider's webhook signature and paid state.
const orderId = 'replace-with-order-id';
const eventId = 'payment-event-123';
await client.orders.markPaid(orderId, {
  idempotencyKey: IdempotencyKey.fromOperation(eventId, 'my-shop'),
  sendEmail: false,
});
```

By default, the SDK retries twice after network failures, HTTP 502/503/504, or HTTP 429
with a usable `Retry-After` header. Retry delays are capped by `maxRetryDelay`.
A 429 without a usable retry header is not retried. POST/PUT/PATCH requests without an
idempotency key are not retried. Disable automatic keys with `withAutoIdempotency(false)`.
The API controls the retention period and semantics of replayed responses.

## Configuration and diagnostics

```js
import { Config, SANDBOX_BASE_URL } from '@billto/node';

const config = new Config(process.env.BILLTO_TOKEN, {
  baseUrl: SANDBOX_BASE_URL,
  maxRetries: 2,
  timeout: 30,
  retryBaseDelay: 0.5,
  maxRetryDelay: 10,
}).identify('MyShop', '1.0.0', 'integrations@example.com')
  .withCorrelationId('checkout-123');

const observedClient = new BillTo(config, {
  onResponse(response) {
    console.log(response.status, response.header('X-Trace-Id'));
  },
});
```

Timeouts and delays are in seconds. Configuration is immutable; `with*` methods return
a new configuration. The production base URL is `https://billto.pl/api/v1`.
Identify distributed integrations with your product name, version and contact details.

`onResponse` receives every HTTP response, including failed attempts and binary downloads,
before normal response handling. It may be asynchronous. If it throws or rejects, the operation
aborts without retrying; handle logging failures inside your callback if they should not abort it.
Network failures have no response to observe. `withCorrelationId(null)` removes the header.
Transport options also accept custom `fetch`, `sleeper` and `keyGenerator` functions.

## Errors

```js
import { ApiError, ValidationError, RateLimitError, TransportError } from '@billto/node';

try {
  await client.invoices.get('replace-with-invoice-id');
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.errors, error.first('series_id'));
  } else if (error instanceof RateLimitError) {
    console.error(error.retryAfter, error.isPlanLimit());
  } else if (error instanceof ApiError) {
    console.error(error.status, error.response.header('X-Trace-Id'));
  } else if (error instanceof TransportError) {
    console.error(error.cause);
  } else {
    throw error;
  }
}
```

All SDK errors extend `BillToError`. Status-specific classes also include
`AuthenticationError` (401), `PaymentRequiredError` (402), `ForbiddenError` (403),
`NotFoundError` (404), `ConflictError` (409) and `ServerError` (5xx).
`UnexpectedResponseError` reports an unexpected response shape or redirect.

## KSeF and downloads

For an issued invoice eligible for KSeF, with the required team configuration and token scope:

```js
await client.invoices.sendToKsef(invoice.id);
const status = await client.invoices.waitForKsef(invoice.id, { timeoutSeconds: 120 });

if (status.isAssigned()) {
  await (await client.invoices.xml(invoice.id)).saveTo('invoice.xml');
} else if (status.hasErrors()) {
  console.error(status.errors);
} else {
  console.log('Still pending; poll again later.');
}

await (await client.invoices.pdf(invoice.id)).saveTo('invoice.pdf');
```

Polling returns the last status when its time budget elapses; an in-flight request uses the
HTTP timeout. Binary responses expose `content` (a `Buffer`), `contentType`, `filename`,
`size()`, `saveTo(path)` and `saveIn(directory)`.

## Development

```bash
git clone https://github.com/nozugroup/billto-node.git
cd billto-node
npm test
npm pack --dry-run
```

Tests use fake HTTP responses and a local server; no BillTo token is required.
CI also checks CommonJS/ESM TypeScript declarations on Node.js 22 and 24, on Linux and Windows.
See [examples](examples) for invoice creation, payment webhooks and incremental synchronization.
Report issues at [GitHub Issues](https://github.com/nozugroup/billto-node/issues).

## License

MIT. See [LICENSE](LICENSE).
