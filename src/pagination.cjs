'use strict';
const { UnexpectedResponseError } = require('./core.cjs');
class Page {
  constructor(items, currentPage = 1, lastPage = 1, total = null, perPage = null) { Object.assign(this, { items, currentPage, lastPage, total, perPage }); }
  static fromResponse(response, Type) {
    const meta = response.meta();
    const current = Number(meta.current_page ?? 1), last = Number(meta.last_page ?? 1);
    if (!Number.isInteger(current) || current < 1 || !Number.isInteger(last) || last < 1) throw new UnexpectedResponseError('Invalid pagination metadata.', response);
    return new Page(response.dataList().map(row => new Type(row)), current, last, meta.total ?? null, meta.per_page ?? null);
  }
  hasMorePages() { return this.currentPage < this.lastPage; }
  nextPage() { return this.hasMorePages() ? this.currentPage + 1 : null; }
  isEmpty() { return this.items.length === 0; }
  first() { return this.items[0] ?? null; }
  count() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  toArray() { return this.items.map(item => item.toObject()); }
}
class Paginator {
  constructor(fetchPage, startPage = 1) { this.fetchPage = fetchPage; this.startPage = startPage; }
  async *pages() {
    let number = this.startPage;
    while (number !== null) {
      const page = await this.fetchPage(number);
      const next = page.nextPage();
      if (next !== null && next <= number) throw new Error('API pagination did not advance.');
      yield page;
      number = next;
    }
  }
  async *[Symbol.asyncIterator]() { for await (const page of this.pages()) yield* page.items; }
  async collect() { const items = []; for await (const item of this) items.push(item); return items; }
}
module.exports = { Page, Paginator };
