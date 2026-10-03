import type { Buffer } from 'node:buffer';

export type Payload = Record<string, unknown>;
export type DateInput = string | Date | null;
/** Calendar date in YYYY-MM-DD format, without time-zone conversion. */
export type CalendarDateInput = string | null;
export interface ConfigOptions {
  baseUrl?: string;
  maxRetries?: number;
  autoIdempotency?: boolean;
  retryBaseDelay?: number;
  maxRetryDelay?: number;
  /** Timeout for a complete HTTP attempt, in seconds. */
  timeout?: number;
  userAgent?: string;
  correlationId?: string | null;
}
export interface TransportOptions {
  fetch?: typeof globalThis.fetch;
  sleeper?: (seconds: number) => void | Promise<void>;
  keyGenerator?: () => string;
  /** Called for each HTTP response, including retries and binary downloads. Exceptions abort the operation without a retry. */
  onResponse?: (response: ApiResponse) => void | Promise<void>;
}
export const VERSION: string;
export const API_COMPAT: string;
export const DEFAULT_BASE_URL: string;
export const SANDBOX_BASE_URL: string;
export const DEFAULT_USER_AGENT: string;
export class Config {
  constructor(token: string, options?: ConfigOptions);
  readonly token: string;
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly autoIdempotency: boolean;
  readonly retryBaseDelay: number;
  readonly maxRetryDelay: number;
  readonly timeout: number;
  readonly userAgent: string;
  readonly correlationId: string | null;
  withCorrelationId(correlationId: string | null): Config;
  withBaseUrl(url: string): Config;
  withMaxRetries(retries: number): Config;
  withAutoIdempotency(enabled: boolean): Config;
  withUserAgent(userAgent: string): Config;
  identify(product: string, version: string, contact: string, compat?: string | null): Config;
  normalizedBaseUrl(): string;
}
export class BillToError extends Error {}
export class TransportError extends BillToError {}
export class UnexpectedResponseError extends BillToError {
  constructor(message: string, response: ApiResponse);
  readonly response: ApiResponse;
}
export class ApiError extends BillToError {
  constructor(message: string, response: ApiResponse);
  readonly status: number;
  readonly response: ApiResponse;
  body(): Payload | null;
  get(key: string): unknown;
  isClientError(): boolean;
  isServerError(): boolean;
}
export class AuthenticationError extends ApiError {}
export class PaymentRequiredError extends ApiError { upgradeUrl(): string | null; }
export class ForbiddenError extends ApiError { isInsufficientScope(): boolean; isNipConflict(): boolean; }
export class NotFoundError extends ApiError {}
export class ConflictError extends ApiError { data(): Payload | null; }
export class ServerError extends ApiError {}
export class ValidationError extends ApiError {
  readonly errors: Record<string, string[]>;
  has(field: string): boolean;
  first(field: string): string | null;
  messages(): string[];
}
export class RateLimitError extends ApiError {
  readonly retryAfter: number | null;
  readonly usage: { used: number; limit: number | null } | null;
  readonly upgradeUrl: string | null;
  isPlanLimit(): boolean;
}
export class ApiResponse {
  constructor(status: number, body: string | Uint8Array | ArrayBuffer, headers?: Record<string, string>);
  readonly status: number;
  readonly body: Buffer;
  readonly headers: Record<string, string>;
  header(name: string): string | null;
  isJson(): boolean;
  json(): Payload | null;
  dataObject(): Payload;
  dataList(): Payload[];
  meta(): Payload;
  message(): string | null;
}
export class BinaryFile {
  constructor(content: Uint8Array | ArrayBuffer, contentType: string, filename?: string | null);
  readonly content: Buffer;
  readonly contentType: string;
  readonly filename: string;
  static fromResponse(response: ApiResponse, fallback: string): BinaryFile;
  size(): number;
  saveTo(path: string): Promise<number>;
  saveIn(directory: string): Promise<string>;
}
export class IdempotencyKey {
  static generate(): string;
  static fromOperation(operationId: string, namespace?: string): string;
}
export class Transport {
  constructor(config: Config, options?: TransportOptions);
  readonly config: Config;
  get(path: string, query?: Payload): Promise<ApiResponse>;
  post(path: string, body?: Payload | null, key?: string | null): Promise<ApiResponse>;
  put(path: string, body: Payload, key?: string | null): Promise<ApiResponse>;
  delete(path: string): Promise<ApiResponse>;
  download(path: string, query?: Payload, fallback?: string): Promise<BinaryFile>;
  request(method: string, path: string, query?: Payload, body?: Payload | null, key?: string | null, accept?: string): Promise<ApiResponse>;
}
export class Entity {
  constructor(attributes: Payload);
  get<T = unknown>(path: string, fallback?: T): T | null;
  has(path: string): boolean;
  amount(path: string): number | null;
  date(path: string): Date | null;
  toObject(): Payload;
  toJSON(): Payload;
  many<T extends Entity>(path: string, Type: new (data: Payload) => T): T[];
  one<T extends Entity>(path: string, Type: new (data: Payload) => T): T | null;
}
export class Invoice extends Entity {
  typeEnum(): InvoiceType | null;
  statusEnum(): InvoiceStatus | null;
  isDraft(): boolean;
  isPaid(): boolean;
  grossTotal(): number | null;
  remainingAmount(): number | null;
  ksefNumber(): string | null;
  items(): InvoiceItem[];
  payments(): InvoicePayment[];
  seller(): InvoiceParty | null;
  buyer(): InvoiceParty | null;
}
export class Order extends Entity { statusEnum(): OrderStatus | null; isCorrecting(): boolean; grossTotal(): number | null; }
export class IncomingInvoice extends Entity { statusEnum(): IncomingInvoiceStatus | null; isPending(): boolean; isInApprovalFlow(): boolean; }
export class KsefStatus extends Entity { isAssigned(): boolean; isPending(): boolean; hasErrors(): boolean; }
export class Contractor extends Entity { registeredAddress(): Payload | null; correspondenceAddress(): Payload | null; }
export class ContractorInsights extends Entity { score(): number | null; }
export class Product extends Entity { isService(): boolean; }
export class InvoiceItem extends Entity {}
export class InvoicePayment extends Entity {}
export class InvoiceParty extends Entity {}
export class BankAccount extends Entity {}
export class EmailDelivery extends Entity {}
export class ExchangeRate extends Entity {}
export class InvoiceSerie extends Entity {}
export class PriceGroup extends Entity {}
export class ProductPrice extends Entity {}
export class ProfitabilityReport extends Entity {}
export class PublicLink extends Entity {}
export class StockLevel extends Entity {}
export class StockMovement extends Entity {}
export class StockMovementReceipt extends Entity {}
export class WarehouseInfo extends Entity {}
export class OrderActionResult {
  constructor(order: Order, meta: Payload);
  readonly order: Order;
  readonly meta: Readonly<Payload>;
  getMeta(key: string, fallback?: unknown): unknown;
  overpaymentGross(): number | null;
}
export class VoteResult {
  constructor(applied: boolean, reason: string | null, invoice: IncomingInvoice);
  readonly applied: boolean;
  readonly reason: string | null;
  readonly invoice: IncomingInvoice;
}
export class Page<T extends Entity> implements Iterable<T> {
  constructor(items: T[], currentPage?: number, lastPage?: number, total?: number | null, perPage?: number | null);
  readonly items: T[];
  readonly currentPage: number;
  readonly lastPage: number;
  readonly total: number | null;
  readonly perPage: number | null;
  static fromResponse<T extends Entity>(response: ApiResponse, Type: new (data: Payload) => T): Page<T>;
  hasMorePages(): boolean;
  nextPage(): number | null;
  isEmpty(): boolean;
  first(): T | null;
  count(): number;
  [Symbol.iterator](): Iterator<T>;
  toArray(): Payload[];
}
export class Paginator<T extends Entity> implements AsyncIterable<T> {
  constructor(fetchPage: (page: number) => Promise<Page<T>>, startPage?: number);
  pages(): AsyncGenerator<Page<T>>;
  [Symbol.asyncIterator](): AsyncGenerator<T>;
  collect(): Promise<T[]>;
}
declare class ReadableResource<T extends Entity> {
  constructor(transport: Transport);
  list(filters?: Payload, page?: number, perPage?: number): Promise<Page<T>>;
  all(filters?: Payload, perPage?: number): Paginator<T>;
  get(id: string): Promise<T>;
}
declare class CrudResource<T extends Entity> extends ReadableResource<T> {
  create(data: Payload, key?: string | null): Promise<T>;
  update(id: string, data: Payload, key?: string | null): Promise<T>;
  delete(id: string): Promise<void>;
}
export interface PaymentOptions { paidAt?: CalendarDateInput; paymentMethod?: string | null; idempotencyKey?: string | null; }
export interface PollOptions {
  /** Polling budget; an in-flight request uses the HTTP timeout. */
  timeoutSeconds?: number;
  intervalSeconds?: number;
  sleeper?: (seconds: number) => void | Promise<void>;
  clock?: () => number;
}
export class Invoices extends CrudResource<Invoice> {
  issue(id: string, key?: string | null): Promise<Invoice>;
  sendToKsef(id: string, key?: string | null): Promise<KsefStatus>;
  ksefStatus(id: string): Promise<KsefStatus>;
  waitForKsef(id: string, options?: PollOptions): Promise<KsefStatus>;
  pdf(id: string): Promise<BinaryFile>;
  xml(id: string, version?: number | null): Promise<BinaryFile>;
  sendEmail(id: string, email?: string | null, key?: string | null): Promise<EmailDelivery>;
  publicLink(id: string, key?: string | null): Promise<PublicLink>;
  recordPayment(id: string, amount: number | string, options?: PaymentOptions & { note?: string | null }): Promise<Invoice>;
  markPaid(id: string, options?: PaymentOptions): Promise<Invoice>;
  deletePayment(id: string, paymentId: string): Promise<void>;
}
export class Orders extends CrudResource<Order> {
  confirm(id: string, key?: string | null): Promise<Order>;
  close(id: string, key?: string | null): Promise<OrderActionResult>;
  cancel(id: string, key?: string | null): Promise<OrderActionResult>;
  sendConfirmation(id: string, email?: string | null, key?: string | null): Promise<Order>;
  pdf(id: string): Promise<BinaryFile>;
  issueAdvance(id: string, options?: Payload, key?: string | null): Promise<Invoice>;
  markPaid(id: string, options?: { idempotencyKey?: string | null; sendEmail?: boolean; seriesId?: string | null; invoiceType?: string | null; ossVatType?: number | string | null; markPaid?: boolean }): Promise<Invoice>;
  issueCorrection(id: string, lines: Payload[], reason?: string | null, key?: string | null): Promise<OrderActionResult>;
  issueKor(id: string, options?: { seriesId?: string | null; idempotencyKey?: string | null; sendEmail?: boolean }): Promise<Invoice>;
}
export class Contractors extends CrudResource<Contractor> {
  findByTaxNumber(taxNumber: string): Promise<Contractor | null>;
  insights(id: string): Promise<ContractorInsights>;
}
export class Products extends CrudResource<Product> { price(id: string, contractorId?: string | null, priceGroupId?: string | null): Promise<ProductPrice>; }
export class PriceGroups { constructor(transport: Transport); list(): Promise<PriceGroup[]>; }
export class IncomingInvoices extends ReadableResource<IncomingInvoice> {
  updatedSince(since: Date | string, status?: string | null, perPage?: number): Paginator<IncomingInvoice>;
  xml(id: string): Promise<BinaryFile>;
  accept(id: string, key?: string | null): Promise<IncomingInvoice>;
  reject(id: string, reason?: string | null, key?: string | null): Promise<IncomingInvoice>;
  vote(id: string, decision: 'approved' | 'rejected', email: string, options?: { name?: string | null; decidedAt?: DateInput; ksefNumber?: string | null; idempotencyKey?: string | null }): Promise<VoteResult>;
}
export class Warehouse {
  constructor(transport: Transport);
  warehouses(): Promise<WarehouseInfo[]>;
  stocks(filters?: Payload, page?: number, perPage?: number): Promise<Page<StockLevel>>;
  allStocks(filters?: Payload, perPage?: number): Paginator<StockLevel>;
  movements(filters?: Payload, page?: number, perPage?: number): Promise<Page<StockMovement>>;
  allMovements(filters?: Payload, perPage?: number): Paginator<StockMovement>;
  move(type: string, quantity: number | string, options?: Payload, key?: string | null): Promise<StockMovementReceipt>;
  receive(quantity: number | string, options?: Payload, key?: string | null): Promise<StockMovementReceipt>;
  issue(quantity: number | string, options?: Payload, key?: string | null): Promise<StockMovementReceipt>;
}
export class Reports { constructor(transport: Transport); profitability(from?: CalendarDateInput, to?: CalendarDateInput, groupBy?: 'product' | 'contractor' | null): Promise<ProfitabilityReport>; }
export class InvoiceSeries { constructor(transport: Transport); list(type?: string | null): Promise<InvoiceSerie[]>; default(type?: string): Promise<InvoiceSerie | null>; }
export class BankAccounts { constructor(transport: Transport); list(activeOnly?: boolean): Promise<BankAccount[]>; default(): Promise<BankAccount | null>; }
export class ExchangeRates { constructor(transport: Transport); list(currency?: string | null, date?: CalendarDateInput, dateFrom?: CalendarDateInput, dateTo?: CalendarDateInput): Promise<ExchangeRate[]>; rate(currency: string, date?: CalendarDateInput): Promise<ExchangeRate | null>; }
export class BillTo {
  constructor(tokenOrConfig: string | Config, options?: TransportOptions);
  static create(token: string, options?: TransportOptions): BillTo;
  static fromConfig(config: Config, options?: TransportOptions): BillTo;
  static sandbox(token: string, options?: TransportOptions): BillTo;
  readonly config: Config;
  readonly transport: Transport;
  readonly invoices: Invoices;
  readonly orders: Orders;
  readonly contractors: Contractors;
  readonly products: Products;
  readonly priceGroups: PriceGroups;
  readonly incomingInvoices: IncomingInvoices;
  readonly warehouse: Warehouse;
  readonly reports: Reports;
  readonly invoiceSeries: InvoiceSeries;
  readonly bankAccounts: BankAccounts;
  readonly exchangeRates: ExchangeRates;
}

// API response fields. Fields colliding with helpers use get().
export const ContractorType: Readonly<{
  Own: 'own';
  External: 'external';
}>;
export type ContractorType = typeof ContractorType[keyof typeof ContractorType];
export const IncomingInvoiceStatus: Readonly<{
  Pending: 'pending';
  Accepted: 'accepted';
  Rejected: 'rejected';
}>;
export type IncomingInvoiceStatus = typeof IncomingInvoiceStatus[keyof typeof IncomingInvoiceStatus];
export const InvoiceStatus: Readonly<{
  Draft: 'draft';
  Issued: 'issued';
  KsefIssuedOffline: 'ksef_issued_offline';
  KsefIssued: 'ksef_issued';
  Cancelled: 'cancelled';
}>;
export type InvoiceStatus = typeof InvoiceStatus[keyof typeof InvoiceStatus];
export const InvoiceType: Readonly<{
  VAT: 'VAT';
  KOR: 'KOR';
  ZAL: 'ZAL';
  ROZ: 'ROZ';
  KOR_ZAL: 'KOR_ZAL';
  KOR_ROZ: 'KOR_ROZ';
  OSS: 'OSS';
  KOR_OSS: 'KOR_OSS';
}>;
export type InvoiceType = typeof InvoiceType[keyof typeof InvoiceType];
export const OrderStatus: Readonly<{
  Draft: 'draft';
  Confirmed: 'confirmed';
  Closed: 'closed';
  Cancelled: 'cancelled';
}>;
export type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus];
export const PaymentMethod: Readonly<{
  Transfer: 'transfer';
  Cash: 'cash';
  Card: 'card';
  Compensation: 'compensation';
  Other: 'other';
}>;
export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];
export const Scope: Readonly<{
  InvoicesRead: 'invoices:read';
  InvoicesWrite: 'invoices:write';
  OrdersRead: 'orders:read';
  OrdersWrite: 'orders:write';
  KsefSend: 'ksef:send';
  ContractorsRead: 'contractors:read';
  ContractorsWrite: 'contractors:write';
  ProductsRead: 'products:read';
  ProductsWrite: 'products:write';
  IncomingRead: 'incoming:read';
  IncomingWrite: 'incoming:write';
  IncomingVote: 'incoming:vote';
  WarehouseRead: 'warehouse:read';
  WarehouseWrite: 'warehouse:write';
}>;
export type Scope = typeof Scope[keyof typeof Scope];
export const StockMovementType: Readonly<{
  PZ: 'pz';
  WZ: 'wz';
  PW: 'pw';
  RW: 'rw';
}>;
export type StockMovementType = typeof StockMovementType[keyof typeof StockMovementType];
export const TaxType: Readonly<{
  Local: 'local';
  EU: 'eu';
  NonEU: 'noneu';
  None: 'none';
}>;
export type TaxType = typeof TaxType[keyof typeof TaxType];
export const VatRate: Readonly<{
  Rate23: '23';
  Rate22: '22';
  Rate8: '8';
  Rate7: '7';
  Rate5: '5';
  Rate4: '4';
  Rate3: '3';
  ZeroDomestic: '0 KR';
  ZeroWdt: '0 WDT';
  ZeroExport: '0 EX';
  Exempt: 'zw';
  ReverseCharge: 'oo';
  NotSubjectI: 'np I';
  NotSubjectII: 'np II';
}>;
export type VatRate = typeof VatRate[keyof typeof VatRate];
export interface BankAccount {
  readonly id: string;
  readonly owner_name: string | null;
  readonly iban: string;
  readonly formatted_iban: string;
  readonly bank_name: string | null;
  readonly bic: string | null;
  readonly currency: string;
  readonly label: string | null;
  readonly is_default: boolean;
  readonly active: boolean;
}
export interface Contractor {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly tax_registration_type: string | null;
  readonly tax_number: string | null;
  readonly tax_country_code: string;
  readonly client_number: string | null;
  readonly price_group_id: string | null;
  readonly addresses?: Payload[];
  readonly payment_score?: Payload | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}
export interface ContractorInsights {
  readonly stats: Payload;
  readonly payment_score: Payload;
}
export interface EmailDelivery {
  readonly sent_to: string | null;
  readonly sent_at: string;
  readonly public_url: string;
}
export interface ExchangeRate {
  readonly currency: string;
  readonly rate: string | number;
  readonly rate_date: string;
  readonly source: string | null;
}
export interface IncomingInvoice {
  readonly id: string;
  readonly source: string;
  readonly duplicate_group_id: string | null;
  readonly ksef_number: string | null;
  readonly external_id: string | null;
  readonly invoice_number: string | null;
  readonly seller_nip: string | null;
  readonly seller_name: string | null;
  readonly issue_date: string | null;
  readonly net_amount: string | null;
  readonly vat_amount: string | null;
  readonly gross_amount: string | null;
  readonly currency: string;
  readonly status: string;
  readonly extraction_status: string | null;
  readonly cost_category: string | null;
  readonly project: string | null;
  readonly notes: string | null;
  readonly accepted_at: string | null;
  readonly accepted_via: string | null;
  readonly rejection_reason: string | null;
  readonly in_approval_flow: boolean;
  readonly approval?: Payload | null;
  readonly clarification_open: Payload | null;
  readonly duplicate_suspicion?: Payload | null;
  readonly ksef_acquired_at: string | null;
  readonly paid_at: string | null;
  readonly paid_amount: string | null;
  readonly payment_due_date: string | null;
  readonly seller_bank_account: string | null;
  readonly split_payment: boolean;
  readonly has_xml: boolean;
  readonly has_file: boolean;
  readonly lines?: Payload[];
  readonly created_at: string | null;
  readonly updated_at: string | null;
}
export interface Invoice {
  readonly effective_target: string;
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly invoice_number: string | null;
  readonly series_id: string | null;
  readonly order_id: string | null;
  readonly order_installment_index: number | null;
  readonly corrected_invoice_id: string | null;
  readonly is_correction: boolean;
  readonly buyer_contractor_id: string | null;
  readonly issue_date: string;
  readonly sales_date: string | null;
  readonly payment_method: string | null;
  readonly payment_date: string | null;
  readonly currency: string;
  readonly amount_entry_mode: string;
  readonly fx_rate: string | null;
  readonly fx_rate_date: string | null;
  readonly split_payment: boolean;
  readonly cash_method: boolean;
  readonly bank_number: string | null;
  readonly bank_name: string | null;
  readonly bank_swift: string | null;
  readonly notes: string | null;
  readonly additional_description: string | null;
  readonly totals: Payload;
  readonly economic: Payload | null;
  readonly correction?: Payload | null;
  readonly corrections?: Payload[];
  readonly ksef: Payload;
  readonly paid_at: string | null;
  readonly payment_status: string;
  readonly paid_amount: string;
  readonly remaining_amount: string;
  readonly cancelled_at: string | null;
  readonly cancellation_reason: string | null;
  readonly public_url: string | null;
  readonly email_delivery: Payload;
  readonly third_parties?: Payload[];
  readonly margin?: Payload | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}
export interface InvoiceItem {
  readonly line_number: number;
  readonly name: string;
  readonly quantity: string;
  readonly units: string | null;
  readonly unit_price: string | null;
  readonly unit_price_gross: string | null;
  readonly vat_type: string;
  readonly product_id: string | null;
  readonly net_amount: string;
  readonly vat_amount: string;
  readonly gross_amount: string;
  readonly unit_cost: string | null;
  readonly is_before_correction: boolean;
}
export interface InvoiceParty {
  readonly address_line_1: string | null;
  readonly address_line_2: string | null;
  readonly role: string;
  readonly name: string | null;
  readonly tax_type: string | null;
  readonly tax_number: string | null;
  readonly tax_country: string | null;
  readonly country_code: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly client_number: string | null;
}
export interface InvoicePayment {
  readonly id: string;
  readonly paid_at: string;
  readonly payment_method: string | null;
  readonly note: string | null;
  readonly created_at: string | null;
}
export interface InvoiceSerie {
  readonly id: string;
  readonly type: string;
  readonly code: string;
  readonly name: string;
  readonly pattern: string | null;
  readonly is_default: boolean;
  readonly is_active: boolean;
}
export interface KsefStatus {
  readonly is_ksef: boolean;
  readonly sent: boolean;
  readonly ksef_number: string | null;
  readonly ksef_offline: boolean;
  readonly ksef_date: string | null;
  readonly has_unresolved_errors: boolean;
  readonly errors: Payload[];
  readonly upo: Payload | null;
}
export interface Order {
  readonly source: string;
  readonly external_id: string | null;
  readonly display_number: string;
  readonly integration_warnings: string[];
  readonly buyer: Payload;
  readonly items?: Payload[];
  readonly id: string;
  readonly order_number: string | null;
  readonly status: string;
  readonly corrects_order_id: string | null;
  readonly correction_invoice_id: string | null;
  readonly currency: string;
  readonly order_date: string;
  readonly notes: string | null;
  readonly totals: Payload;
  readonly is_fully_invoiced: boolean;
  readonly payment_schedule?: Payload[] | null;
  readonly next_installment_index?: number | null;
  readonly invoices?: Payload[];
  readonly email_delivery: Payload;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}
export interface PriceGroup {
  readonly id: string;
  readonly name: string;
  readonly pricing: string;
  readonly markup_percent: number | null;
  readonly margin_percent: number | null;
}
export interface Product {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly description: string | null;
  readonly units: string | null;
  readonly sku: string | null;
  readonly ean: string | null;
  readonly unit_price: string | null;
  readonly unit_price_gross: string | null;
  readonly vat_type: string | null;
  readonly pkwiu: string | null;
  readonly track_stock: boolean;
  readonly low_stock_threshold: string | null;
  readonly is_active: boolean;
  readonly packagings?: Payload[];
  readonly created_at: string | null;
  readonly updated_at: string | null;
}
export interface ProductPrice {
  readonly product_id: string;
  readonly unit_price: number;
  readonly unit_price_gross: number;
  readonly vat_type: string;
  readonly source: string;
  readonly wdt: boolean;
}
export interface ProfitabilityReport {
  readonly meta: Payload;
  readonly summary: Payload;
  readonly groups: Payload[];
  readonly below_cost: Payload[];
}
export interface PublicLink {
  readonly public_url: string;
  readonly first_viewed_at: string | null;
}
export interface StockLevel {
  readonly id: string;
  readonly warehouse_id: string;
  readonly warehouse: string | null;
  readonly product_id: string;
  readonly product: string | null;
  readonly sku: string | null;
  readonly ean: string | null;
  readonly location: string | null;
  readonly quantity: number;
  readonly reserved: number;
  readonly available: number;
  readonly value: number;
  readonly updated_at: string | null;
}
export interface StockMovement {
  readonly id: string;
  readonly type: string;
  readonly movement_date: string | null;
  readonly product_id: string;
  readonly product: string | null;
  readonly warehouse_id: string | null;
  readonly location: string | null;
  readonly quantity: number;
  readonly quantity_after: number;
  readonly unit_cost: number | null;
  readonly note: string | null;
  readonly created_at: string | null;
}
export interface StockMovementReceipt {
  readonly id: string;
  readonly type: string;
  readonly quantity_after: number | null;
  readonly replayed: boolean;
}
export interface WarehouseInfo {
  readonly id: string;
  readonly name: string;
  readonly symbol: string | null;
  readonly is_default: boolean;
  readonly is_active: boolean;
}
