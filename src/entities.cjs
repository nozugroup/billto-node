'use strict';
const { InvoiceType, InvoiceStatus, OrderStatus, IncomingInvoiceStatus } = require('./enums.cjs');
const enumValue = (values, value) => Object.values(values).includes(value) ? value : null;

const dataStore = new WeakMap();
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
class Entity {
  constructor(attributes) {
    const data = freeze(structuredClone(attributes));
    dataStore.set(this, data);
    for (const key of Object.keys(data)) {
      if (!(key in this)) Object.defineProperty(this, key, { enumerable: true, get: () => data[key] });
    }
    Object.freeze(this);
  }
  get(path, fallback = null) {
    let value = dataStore.get(this);
    for (const key of path.split('.')) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return fallback;
      value = value[key];
    }
    return value;
  }
  has(path) { const missing = Symbol(); return this.get(path, missing) !== missing; }
  amount(path) {
    const value = this.get(path);
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
    const number = Number(value); return Number.isFinite(number) ? number : null;
  }
  date(path) { const value = this.get(path); if (typeof value !== 'string' || !value.trim()) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
  toObject() { return structuredClone(dataStore.get(this)); }
  toJSON() { return this.toObject(); }
  many(path, Type) { const rows = this.get(path); return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map(row => new Type(row)) : []; }
  one(path, Type) { const row = this.get(path); return row && typeof row === 'object' && !Array.isArray(row) ? new Type(row) : null; }
}
class Invoice extends Entity {
  typeEnum() { return enumValue(InvoiceType, this.get('type')); }
  statusEnum() { return enumValue(InvoiceStatus, this.get('status')); }
  isDraft() { return this.get('status') === 'draft'; }
  isPaid() { return this.get('paid_at') !== null; }
  grossTotal() { return this.amount('totals.gross'); }
  remainingAmount() { return this.amount('remaining_amount'); }
  ksefNumber() { return this.get('ksef.number'); }
  items() { return this.many('items', InvoiceItem); }
  payments() { return this.many('payments', InvoicePayment); }
  seller() { return this.one('seller', InvoiceParty); }
  buyer() { return this.one('buyer', InvoiceParty); }
}
class Order extends Entity {
  statusEnum() { return enumValue(OrderStatus, this.get('status')); }
  isCorrecting() { return this.get('corrects_order_id') !== null; }
  grossTotal() { return this.amount('totals.gross'); }
}
class IncomingInvoice extends Entity {
  statusEnum() { return enumValue(IncomingInvoiceStatus, this.get('status')); }
  isPending() { return this.get('status') === 'pending'; }
  isInApprovalFlow() { return Boolean(this.get('approval.in_flow') ?? this.get('in_approval_flow')); }
}
class KsefStatus extends Entity {
  isAssigned() { const value = this.get('ksef_number'); return typeof value === 'string' && value !== ''; }
  isPending() { return Boolean(this.get('sent')) && !this.isAssigned() && !this.hasErrors(); }
  hasErrors() { return Boolean(this.get('has_unresolved_errors')); }
}
class Contractor extends Entity {
  registeredAddress() { return (this.get('addresses') ?? []).find(row => row?.type === 'registered') ?? null; }
  correspondenceAddress() { return (this.get('addresses') ?? []).find(row => row?.type === 'correspondence') ?? null; }
}
class ContractorInsights extends Entity { score() { const score = this.amount('payment_score.score'); return score === null ? null : Math.trunc(score); } }
class Product extends Entity { isService() { return this.get('kind') === 'service'; } }
class InvoiceItem extends Entity {}
class InvoicePayment extends Entity {}
class InvoiceParty extends Entity {}
class BankAccount extends Entity {}
class EmailDelivery extends Entity {}
class ExchangeRate extends Entity {}
class InvoiceSerie extends Entity {}
class PriceGroup extends Entity {}
class ProductPrice extends Entity {}
class ProfitabilityReport extends Entity {}
class PublicLink extends Entity {}
class StockLevel extends Entity {}
class StockMovement extends Entity {}
class StockMovementReceipt extends Entity {}
class WarehouseInfo extends Entity {}
class OrderActionResult {
  constructor(order, meta) { this.order = order; this.meta = freeze(structuredClone(meta)); Object.freeze(this); }
  getMeta(key, fallback = null) { return this.meta[key] ?? fallback; }
  overpaymentGross() { return new Entity(this.meta).amount('overpayment_gross'); }
}
class VoteResult {
  constructor(applied, reason, invoice) { this.applied = applied; this.reason = reason; this.invoice = invoice; Object.freeze(this); }
}
module.exports = { Entity, Invoice, Order, IncomingInvoice, KsefStatus, Contractor, ContractorInsights, Product, InvoiceItem, InvoicePayment, InvoiceParty, BankAccount, EmailDelivery, ExchangeRate, InvoiceSerie, PriceGroup, ProductPrice, ProfitabilityReport, PublicLink, StockLevel, StockMovement, StockMovementReceipt, WarehouseInfo, OrderActionResult, VoteResult };
