// Run: node examples/sync-incoming-invoices.mjs 2026-09-01T00:00:00Z
// Persist the returned cursor only after saving all processed rows successfully.
import { BillTo } from '@billto/node';

const client = new BillTo(process.env.BILLTO_TOKEN ?? '');
const since = process.argv[2];
if (!since) throw new Error('Pass the timestamp of the previous successful sync.');
const nextCursor = new Date().toISOString();

for await (const invoice of client.incomingInvoices.updatedSince(since)) {
  console.log(JSON.stringify(invoice.toObject())); // Upsert by invoice.id in your database.
}
console.log('Next sync cursor:', nextCursor);
