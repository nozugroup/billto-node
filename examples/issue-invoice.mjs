// Node.js 22+. Run: node examples/issue-invoice.mjs
// Set BILLTO_TOKEN to a sandbox team token. This creates an invoice in the sandbox.
import { BillTo, InvoiceType, PaymentMethod, VatRate, ValidationError } from '@billto/node';

const client = BillTo.sandbox(process.env.BILLTO_TOKEN ?? '');
const series = await client.invoiceSeries.default(InvoiceType.VAT);
if (!series) throw new Error('Configure a default VAT series in the sandbox first.');

try {
  const invoice = await client.invoices.create({
    type: InvoiceType.VAT,
    series_id: series.id,
    issue: true,
    issue_date: new Date().toISOString().slice(0, 10),
    payment_method: PaymentMethod.Transfer,
    currency: 'PLN',
    amount_entry_mode: 'net',
    buyer: { name: 'ACME sp. z o.o.', tax_type: 'local', tax_number: '5261040828' },
    items: [{ name: 'Usługa konsultingowa', quantity: 10, unit_price: '150.00', vat_type: VatRate.Rate23 }],
  });
  console.log(invoice.invoice_number, invoice.get('totals.gross'));
  await (await client.invoices.pdf(invoice.id)).saveTo('invoice.pdf');
} catch (error) {
  if (error instanceof ValidationError) console.error(error.errors);
  throw error;
}
