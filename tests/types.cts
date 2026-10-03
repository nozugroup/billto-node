import sdk = require('@billto/node');
const client = new sdk.BillTo('test');
const pending: Promise<sdk.Invoice> = client.invoices.get('i');
const rate: string = sdk.VatRate.Rate23;
// @ts-expect-error Paginator is asynchronous.
for (const invoice of client.invoices.all()) { void invoice; }
void pending; void rate;
