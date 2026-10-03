import BillTo, { Config, InvoiceType, PaymentMethod, type Invoice, type Page } from '@billto/node';
const client = new BillTo(new Config('test').withMaxRetries(4));
const page: Page<Invoice> = await client.invoices.list({ status: 'issued' });
const invoice = await client.orders.markPaid('o', { sendEmail: false, idempotencyKey: 'event' });
const id: string = invoice.id;
const items = invoice.items();
const name: string | undefined = items[0]?.name;
await client.invoices.markPaid(id, { paymentMethod: PaymentMethod.Card });
await client.invoiceSeries.default(InvoiceType.VAT);
for await (const row of client.invoices.all()) { const id: string = row.id; void id; }
// @ts-expect-error Resource IDs must be strings.
await client.invoices.get(123);
// @ts-expect-error Incoming invoices cannot be created through this SDK.
await client.incomingInvoices.create({});
// @ts-expect-error Unknown order payment option.
await client.orders.markPaid('o', { invalid: true });
void page; void name;

const diagnostics = new BillTo(new Config('test').withCorrelationId('job'), {
  onResponse: async response => { const trace: string | null = response.header('X-Trace-Id'); void trace; },
});
await diagnostics.invoices.markPaid('i', { paidAt: '2026-09-10' });
// @ts-expect-error A calendar date needs an explicit day, not an instant.
await diagnostics.invoices.markPaid('i', { paidAt: new Date() });
await diagnostics.orders.markPaid('o', { ossVatType: 19.5 });
const order = await diagnostics.orders.get('o');
const warnings: string[] = order.integration_warnings;
const external: string | null = order.external_id;
const buyer = order.buyer;
const lines: Record<string, unknown>[] | undefined = order.items;
const timestamp: string | null = invoice.created_at;
const target: string = invoice.effective_target;
const corrections: Record<string, unknown>[] | undefined = invoice.corrections;
const address: string | null | undefined = invoice.buyer()?.address_line_1;
// @ts-expect-error Relations can be absent from a list response.
const requiredLines: Record<string, unknown>[] = order.items;
// @ts-expect-error Timestamps may be null.
const requiredTimestamp: string = invoice.created_at;
void warnings; void external; void buyer; void lines; void timestamp; void target; void corrections; void address;
