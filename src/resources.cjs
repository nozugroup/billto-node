'use strict';
const E = require('./entities.cjs');
const { Page, Paginator } = require('./pagination.cjs');
const { compact, dateString, isoString, segment, sleep, UnexpectedResponseError } = require('./core.cjs');

class Resource {
  constructor(transport) { this.transport = transport; }
  async entity(response, Type) { return new Type((await response).dataObject()); }
  async entities(response, Type) { return (await response).dataList().map(row => new Type(row)); }
  async page(path, filters, Type, page = 1, perPage = 15) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1) throw new TypeError('Page and perPage must be positive integers.');
    return Page.fromResponse(await this.transport.get(path, { ...filters, page, per_page: perPage }), Type);
  }
  paginate(path, filters, Type, perPage = 100) { const snapshot = structuredClone(filters); return new Paginator(page => this.page(path, snapshot, Type, page, perPage)); }
}
class ReadableResource extends Resource {
  list(filters = {}, page = 1, perPage = 15) { return this.page(this.path, filters, this.Type, page, perPage); }
  all(filters = {}, perPage = 100) { return this.paginate(this.path, filters, this.Type, perPage); }
  get(id) { return this.entity(this.transport.get(`${this.path}/${segment(id)}`), this.Type); }
}
class CrudResource extends ReadableResource {
  create(data, idempotencyKey = null) { return this.entity(this.transport.post(this.path, data, idempotencyKey), this.Type); }
  update(id, data, idempotencyKey = null) { return this.entity(this.transport.put(`${this.path}/${segment(id)}`, data, idempotencyKey), this.Type); }
  async delete(id) { await this.transport.delete(`${this.path}/${segment(id)}`); }
}
class Invoices extends CrudResource {
  constructor(transport) { super(transport); this.path = 'invoices'; this.Type = E.Invoice; }
  issue(id, key = null) { return this.entity(this.transport.post(`invoices/${segment(id)}/issue`, {}, key), E.Invoice); }
  sendToKsef(id, key = null) { return this.entity(this.transport.post(`invoices/${segment(id)}/ksef`, {}, key), E.KsefStatus); }
  ksefStatus(id) { return this.entity(this.transport.get(`invoices/${segment(id)}/ksef`), E.KsefStatus); }
  async waitForKsef(id, { timeoutSeconds = 120, intervalSeconds = 5, sleeper = sleep, clock = () => performance.now() / 1000 } = {}) {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new TypeError('Invalid polling timeout or interval.');
    const deadline = clock() + timeoutSeconds;
    while (true) {
      const status = await this.ksefStatus(id);
      const remaining = deadline - clock();
      if (status.isAssigned() || status.hasErrors() || remaining <= 0) return status;
      await sleeper(Math.min(intervalSeconds, remaining));
      if (clock() >= deadline) return status;
    }
  }
  pdf(id) { return this.transport.download(`invoices/${segment(id)}/pdf`, {}, `${id}.pdf`); }
  xml(id, version = null) { return this.transport.download(`invoices/${segment(id)}/xml`, compact({ version }), `${id}.xml`); }
  sendEmail(id, email = null, key = null) { return this.entity(this.transport.post(`invoices/${segment(id)}/send-email`, compact({ email }), key), E.EmailDelivery); }
  publicLink(id, key = null) { return this.entity(this.transport.post(`invoices/${segment(id)}/public-link`, {}, key), E.PublicLink); }
  recordPayment(id, amount, { paidAt = null, paymentMethod = null, note = null, idempotencyKey = null } = {}) {
    return this.entity(this.transport.post(`invoices/${segment(id)}/payments`, compact({ amount, paid_at: dateString(paidAt), payment_method: paymentMethod, note }), idempotencyKey), E.Invoice);
  }
  markPaid(id, { paidAt = null, paymentMethod = null, idempotencyKey = null } = {}) {
    return this.entity(this.transport.post(`invoices/${segment(id)}/mark-paid`, compact({ paid_at: dateString(paidAt), payment_method: paymentMethod }), idempotencyKey), E.Invoice);
  }
  async deletePayment(id, paymentId) { await this.transport.delete(`invoices/${segment(id)}/payments/${segment(paymentId)}`); }
}
class Orders extends CrudResource {
  constructor(transport) { super(transport); this.path = 'orders'; this.Type = E.Order; }
  confirm(id, key = null) { return this.entity(this.transport.post(`orders/${segment(id)}/confirm`, {}, key), E.Order); }
  async action(response) { const result = await response; return new E.OrderActionResult(new E.Order(result.dataObject()), result.meta()); }
  close(id, key = null) { return this.action(this.transport.post(`orders/${segment(id)}/close`, {}, key)); }
  cancel(id, key = null) { return this.action(this.transport.post(`orders/${segment(id)}/cancel`, {}, key)); }
  sendConfirmation(id, email = null, key = null) { return this.entity(this.transport.post(`orders/${segment(id)}/send-confirmation`, compact({ email }), key), E.Order); }
  pdf(id) { return this.transport.download(`orders/${segment(id)}/pdf`, {}, `${id}.pdf`); }
  issueAdvance(id, options = {}, key = null) { return this.entity(this.transport.post(`orders/${segment(id)}/issue-advance`, options, key), E.Invoice); }
  markPaid(id, { idempotencyKey = null, sendEmail = true, seriesId = null, invoiceType = null, ossVatType = null, markPaid = true } = {}) {
    const data = compact({ send_email: sendEmail ? null : false, mark_paid: markPaid ? null : false, series_id: seriesId, invoice_type: invoiceType, oss_vat_type: ossVatType });
    return this.entity(this.transport.post(`orders/${segment(id)}/mark-paid`, data, idempotencyKey), E.Invoice);
  }
  issueCorrection(id, lines, reason = null, key = null) { return this.action(this.transport.post(`orders/${segment(id)}/issue-correction`, compact({ lines, reason }), key)); }
  issueKor(id, { seriesId = null, idempotencyKey = null, sendEmail = true } = {}) {
    return this.entity(this.transport.post(`orders/${segment(id)}/issue-kor`, compact({ series_id: seriesId, send_email: sendEmail ? null : false }), idempotencyKey), E.Invoice);
  }
}
class Contractors extends CrudResource {
  constructor(transport) { super(transport); this.path = 'contractors'; this.Type = E.Contractor; }
  async findByTaxNumber(taxNumber) {
    const normalized = taxNumber.replace(/[\s-]/g, '');
    for await (const contractor of this.all({ search: normalized }, 50)) if (contractor.tax_number === normalized) return contractor;
    return null;
  }
  insights(id) { return this.entity(this.transport.get(`contractors/${segment(id)}/insights`), E.ContractorInsights); }
}
class Products extends CrudResource {
  constructor(transport) { super(transport); this.path = 'products'; this.Type = E.Product; }
  price(id, contractorId = null, priceGroupId = null) { return this.entity(this.transport.get(`products/${segment(id)}/price`, compact({ contractor_id: contractorId, price_group_id: priceGroupId })), E.ProductPrice); }
}
class PriceGroups extends Resource { list() { return this.entities(this.transport.get('price-groups'), E.PriceGroup); } }
class IncomingInvoices extends ReadableResource {
  constructor(transport) { super(transport); this.path = 'incoming-invoices'; this.Type = E.IncomingInvoice; }
  list(filters = {}, page = 1, perPage = 50) { return super.list(filters, page, perPage); }
  all(filters = {}, perPage = 200) { return super.all(filters, perPage); }
  updatedSince(since, status = null, perPage = 200) { return this.all(compact({ updated_since: isoString(since), status }), perPage); }
  xml(id) { return this.transport.download(`incoming-invoices/${segment(id)}/xml`, {}, `${id}.xml`); }
  accept(id, key = null) { return this.entity(this.transport.post(`incoming-invoices/${segment(id)}/accept`, {}, key), E.IncomingInvoice); }
  reject(id, reason = null, key = null) { return this.entity(this.transport.post(`incoming-invoices/${segment(id)}/reject`, compact({ reason }), key), E.IncomingInvoice); }
  async vote(id, decision, email, { name = null, decidedAt = null, ksefNumber = null, idempotencyKey = null } = {}) {
    const response = await this.transport.post(`incoming-invoices/${segment(id)}/vote`, compact({ decision, email, name, decided_at: isoString(decidedAt), ksef_number: ksefNumber }), idempotencyKey);
    const invoice = new E.IncomingInvoice(response.dataObject());
    const json = response.json();
    return new E.VoteResult(Boolean(json.applied), json.reason ?? null, invoice);
  }
}
class Warehouse extends Resource {
  warehouses() { return this.entities(this.transport.get('warehouse/warehouses'), E.WarehouseInfo); }
  stocks(filters = {}, page = 1, perPage = 15) { return this.page('warehouse/stocks', filters, E.StockLevel, page, perPage); }
  allStocks(filters = {}, perPage = 100) { return this.paginate('warehouse/stocks', filters, E.StockLevel, perPage); }
  movements(filters = {}, page = 1, perPage = 15) { return this.page('warehouse/movements', filters, E.StockMovement, page, perPage); }
  allMovements(filters = {}, perPage = 100) { return this.paginate('warehouse/movements', filters, E.StockMovement, perPage); }
  move(type, quantity, options = {}, key = null) { return this.entity(this.transport.post('warehouse/movements', { ...options, type, quantity }, key), E.StockMovementReceipt); }
  receive(quantity, options = {}, key = null) { return this.move('pz', quantity, options, key); }
  issue(quantity, options = {}, key = null) { return this.move('wz', quantity, options, key); }
}
class Reports extends Resource {
  async profitability(from = null, to = null, groupBy = null) {
    const response = await this.transport.get('reports/profitability', compact({ from: dateString(from), to: dateString(to), group_by: groupBy }));
    const json = response.json();
    if (!json || !json.summary) throw new UnexpectedResponseError('Expected a profitability report.', response);
    return new E.ProfitabilityReport(json);
  }
}
class InvoiceSeries extends Resource {
  list(type = null) { return this.entities(this.transport.get('invoice-series', compact({ type })), E.InvoiceSerie); }
  async default(type = 'VAT') { return (await this.list(type)).find(row => row.is_default) ?? null; }
}
class BankAccounts extends Resource {
  list(activeOnly = true) { return this.entities(this.transport.get('bank-accounts', { active_only: activeOnly }), E.BankAccount); }
  async default() { return (await this.list()).find(row => row.is_default) ?? null; }
}
class ExchangeRates extends Resource {
  list(currency = null, date = null, dateFrom = null, dateTo = null) {
    return this.entities(this.transport.get('exchange-rates', compact({ currency: currency?.toUpperCase(), date: dateString(date), date_from: dateString(dateFrom), date_to: dateString(dateTo) })), E.ExchangeRate);
  }
  async rate(currency, date = null) { return (await this.list(currency, date))[0] ?? null; }
}
module.exports = { Invoices, Orders, Contractors, Products, PriceGroups, IncomingInvoices, Warehouse, Reports, InvoiceSeries, BankAccounts, ExchangeRates };
