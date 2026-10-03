'use strict';
const core = require('./core.cjs');
const entities = require('./entities.cjs');
const enums = require('./enums.cjs');
const resources = require('./resources.cjs');
const pagination = require('./pagination.cjs');
class BillTo {
  constructor(tokenOrConfig, options = {}) {
    this.config = tokenOrConfig instanceof core.Config ? tokenOrConfig : new core.Config(tokenOrConfig);
    this.transport = new core.Transport(this.config, options);
    this.invoices = new resources.Invoices(this.transport);
    this.orders = new resources.Orders(this.transport);
    this.contractors = new resources.Contractors(this.transport);
    this.products = new resources.Products(this.transport);
    this.priceGroups = new resources.PriceGroups(this.transport);
    this.incomingInvoices = new resources.IncomingInvoices(this.transport);
    this.warehouse = new resources.Warehouse(this.transport);
    this.reports = new resources.Reports(this.transport);
    this.invoiceSeries = new resources.InvoiceSeries(this.transport);
    this.bankAccounts = new resources.BankAccounts(this.transport);
    this.exchangeRates = new resources.ExchangeRates(this.transport);
  }
  static create(token, options = {}) { return new BillTo(token, options); }
  static fromConfig(config, options = {}) { return new BillTo(config, options); }
  static sandbox(token, options = {}) { return new BillTo(new core.Config(token, { baseUrl: core.SANDBOX_BASE_URL }), options); }
}
const { compact, dateString, isoString, segment, sleep, ...publicCore } = core;
module.exports = { BillTo, ...publicCore, ...entities, ...enums, ...resources, ...pagination };
