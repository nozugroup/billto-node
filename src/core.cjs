'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const VERSION = '1.0.0';
const API_COMPAT = '2026-09-15';
const DEFAULT_BASE_URL = 'https://billto.pl/api/v1';
const SANDBOX_BASE_URL = 'https://sandbox.billto.pl/api/v1';
const DEFAULT_USER_AGENT = `billto-node/${VERSION} (+https://github.com/nozugroup/billto-php; compat=${API_COMPAT})`;
const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const compact = data => Object.fromEntries(Object.entries(data).filter(([, value]) => value != null));
const dateString = value => {
  if (value == null) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Calendar dates must be valid YYYY-MM-DD strings; convert timestamps in your business time zone explicitly.');
  }
  return value;
};
const isoString = value => value instanceof Date ? value.toISOString() : value;
const segment = value => {
  if (typeof value !== 'string' || !value || value === '.' || value === '..') throw new TypeError('Resource ID must be a nonempty string.');
  return encodeURIComponent(value);
};

class Config {
  constructor(token, options = {}) {
    const defaults = { baseUrl: DEFAULT_BASE_URL, maxRetries: 2, autoIdempotency: true, retryBaseDelay: 0.5, maxRetryDelay: 10, timeout: 30, userAgent: DEFAULT_USER_AGENT, correlationId: null };
    for (const key of Object.keys(options)) if (!(key in defaults)) throw new TypeError(`Unknown config option: ${key}`);
    Object.assign(this, defaults, options);
    Object.defineProperty(this, 'token', { value: token, enumerable: false });
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new TypeError('API token must be nonempty and contain no newlines.');
    const url = new URL(this.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid API base URL.');
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) throw new TypeError('maxRetries must be a nonnegative integer.');
    for (const key of ['retryBaseDelay', 'maxRetryDelay', 'timeout']) if (!Number.isFinite(this[key]) || this[key] < 0 || (key === 'timeout' && this[key] === 0)) throw new TypeError(`Invalid ${key}.`);
    if (typeof this.autoIdempotency !== 'boolean') throw new TypeError('autoIdempotency must be a boolean.');
    if (typeof this.userAgent !== 'string' || !this.userAgent.trim() || /[^\x20-\x7e]/.test(this.userAgent)) throw new TypeError('Invalid User-Agent.');
    if (this.correlationId !== null && (typeof this.correlationId !== 'string' || !this.correlationId.trim() || /[^\x20-\x7e]/.test(this.correlationId))) throw new TypeError('Invalid X-Correlation-Id.');
    Object.freeze(this);
  }
  withCorrelationId(correlationId) { return new Config(this.token, { ...this, correlationId }); }
  withBaseUrl(baseUrl) { return new Config(this.token, { ...this, baseUrl }); }
  withMaxRetries(maxRetries) { return new Config(this.token, { ...this, maxRetries }); }
  withAutoIdempotency(autoIdempotency) { return new Config(this.token, { ...this, autoIdempotency }); }
  withUserAgent(userAgent) { return new Config(this.token, { ...this, userAgent }); }
  identify(product, version, contact, compat = API_COMPAT) {
    const clean = (value, limit) => String(value).replace(/[^A-Za-z0-9._\-/:@+?=&%]/g, '').slice(0, limit);
    const parts = [clean(product, 60), clean(version, 40), clean(contact, 180)];
    if (parts.some(value => !value)) throw new TypeError('Product, version and contact are required.');
    return this.withUserAgent(`${parts[0]}/${parts[1]} (+${parts[2]}${compat ? `; compat=${clean(compat, 40)}` : ''}) billto-node/${VERSION}`);
  }
  normalizedBaseUrl() { return this.baseUrl.replace(/\/+$/, ''); }
}

class BillToError extends Error {
  constructor(message, options) { super(message, options); this.name = new.target.name; }
}
class TransportError extends BillToError {}
class UnexpectedResponseError extends BillToError {
  constructor(message, response) { super(message); this.response = response; }
}
class ApiError extends BillToError {
  constructor(message, response) { super(message); this.status = response.status; this.response = response; }
  body() { return this.response.json(); }
  get(key) { return this.body()?.[key] ?? null; }
  isClientError() { return this.status >= 400 && this.status < 500; }
  isServerError() { return this.status >= 500; }
}
class AuthenticationError extends ApiError {}
class PaymentRequiredError extends ApiError { upgradeUrl() { return this.get('upgrade_url'); } }
class ForbiddenError extends ApiError {
  isInsufficientScope() { return this.message.toLowerCase().includes('scope'); }
  isNipConflict() { return this.get('code') === 'nip_conflict'; }
}
class NotFoundError extends ApiError {}
class ConflictError extends ApiError { data() { return this.get('data'); } }
class ServerError extends ApiError {}
class ValidationError extends ApiError {
  constructor(message, response) {
    super(message, response);
    const errors = this.get('errors');
    this.errors = Object.fromEntries(Object.entries(isObject(errors) ? errors : {}).map(([key, values]) => [key, (Array.isArray(values) ? values : [values]).map(value => typeof value === 'string' ? value : JSON.stringify(value))]));
  }
  has(field) { return Object.hasOwn(this.errors, field); }
  first(field) { return this.errors[field]?.[0] ?? null; }
  messages() { return Object.values(this.errors).flat(); }
}
class RateLimitError extends ApiError {
  constructor(message, response) {
    super(message, response);
    const retry = response.header('retry-after');
    this.retryAfter = retry != null && /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) : null;
    if (retry && this.retryAfter === null && /[A-Za-z]{3}/.test(retry) && !Number.isNaN(Date.parse(retry))) this.retryAfter = Math.max(0, (Date.parse(retry) - Date.now()) / 1000);
    this.usage = this.get('usage');
    this.upgradeUrl = this.get('upgrade_url');
  }
  isPlanLimit() { return this.retryAfter === null; }
}
function mapError(response) {
  const ErrorClass = ({ 401: AuthenticationError, 402: PaymentRequiredError, 403: ForbiddenError, 404: NotFoundError, 409: ConflictError, 422: ValidationError, 429: RateLimitError })[response.status] ?? (response.status >= 500 ? ServerError : ApiError);
  return new ErrorClass(response.message() ?? `BillTo API error (HTTP ${response.status}).`, response);
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class ApiResponse {
  constructor(status, body, headers = {}) {
    this.status = status;
    this.body = Buffer.from(body);
    this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  }
  header(name) { return this.headers[name.toLowerCase()] ?? null; }
  isJson() { return (this.header('content-type') ?? '').toLowerCase().includes('json'); }
  json() { try { const data = JSON.parse(this.body.toString('utf8')); return isObject(data) ? data : null; } catch { return null; } }
  dataObject() {
    const data = this.json()?.data;
    if (!isObject(data)) throw new UnexpectedResponseError('Expected an object in "data".', this);
    return data;
  }
  dataList() {
    const data = this.json()?.data;
    if (!Array.isArray(data) || !data.every(isObject)) throw new UnexpectedResponseError('Expected a list of objects in "data".', this);
    return data;
  }
  meta() { const meta = this.json()?.meta; return isObject(meta) ? meta : {}; }
  message() { const value = this.json()?.message; return typeof value === 'string' ? value : null; }
}
function safeFilename(value) {
  const name = String(value).replace(/\\/g, '/').split('/').pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '');
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? 'download.bin' : name;
}
class BinaryFile {
  constructor(content, contentType, filename = 'download.bin') { this.content = Buffer.from(content); this.contentType = contentType; this.filename = safeFilename(filename ?? 'download.bin'); }
  static fromResponse(response, fallback) {
    const disposition = response.header('content-disposition') ?? '';
    const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    let filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.trim() ?? fallback;
    if (extended) { try { filename = decodeURIComponent(extended[1].replace(/^"|"$/g, '')); } catch { /* Fall back to the ordinary filename. */ } }
    return new BinaryFile(response.body, response.header('content-type') ?? 'application/octet-stream', filename);
  }
  size() { return this.content.length; }
  async saveTo(destination) { await writeFile(destination, this.content); return this.size(); }
  async saveIn(directory) { const destination = path.join(directory, this.filename); await this.saveTo(destination); return destination; }
}
class IdempotencyKey {
  static generate() { return randomUUID(); }
  static fromOperation(operationId, namespace = 'billto-node') { return createHash('sha256').update(`${namespace}|${operationId}`, 'utf8').digest('hex'); }
}
function queryPairs(query, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value instanceof Date) pairs.push([name, value.toISOString()]);
    else if (typeof value === 'object') pairs.push(...queryPairs(value, name));
    else pairs.push([name, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)]);
  }
  return pairs;
}
class Transport {
  constructor(config, { fetch: fetcher = globalThis.fetch, sleeper = sleep, keyGenerator = IdempotencyKey.generate, onResponse = null } = {}) {
    this.config = config; this.fetch = fetcher; this.sleeper = sleeper; this.keyGenerator = keyGenerator; this.onResponse = onResponse;
    if (onResponse !== null && typeof onResponse !== 'function') throw new TypeError('onResponse must be a function.');
  }
  get(path, query = {}) { return this.request('GET', path, query); }
  post(path, body = {}, key = null) { return this.request('POST', path, {}, body ?? {}, key); }
  put(path, body, key = null) { return this.request('PUT', path, {}, body, key); }
  delete(path) { return this.request('DELETE', path); }
  async download(path, query = {}, fallback = 'download.bin') { return BinaryFile.fromResponse(await this.request('GET', path, query, null, null, '*/*'), fallback); }
  async request(method, path, query = {}, body = null, key = null, accept = 'application/json') {
    method = method.toUpperCase();
    const mutation = ['POST', 'PUT', 'PATCH'].includes(method);
    if (mutation && key == null && this.config.autoIdempotency) key = this.keyGenerator();
    if (key != null && (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key))) throw new TypeError('Invalid idempotency key.');
    const retryable = !mutation || key != null;
    const url = new URL(`${this.config.normalizedBaseUrl()}/${path.replace(/^\/+/, '')}`);
    for (const [name, value] of queryPairs(query)) url.searchParams.append(name, value);
    const headers = { Authorization: `Bearer ${this.config.token}`, Accept: accept, 'User-Agent': this.config.userAgent };
    if (this.config.correlationId !== null) headers['X-Correlation-Id'] = this.config.correlationId;
    if (key != null) headers['Idempotency-Key'] = key;
    const encoded = body === null ? undefined : JSON.stringify(body);
    if (encoded !== undefined) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      let response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout * 1000);
      try {
        const raw = await this.fetch(url.toString(), { method, headers, body: encoded, redirect: 'manual', signal: controller.signal });
        response = new ApiResponse(raw.status, await raw.arrayBuffer(), Object.fromEntries(raw.headers));
      } catch (cause) {
        clearTimeout(timer);
        if (retryable && attempt < this.config.maxRetries) { await this.sleeper(this.backoff(attempt)); continue; }
        throw new TransportError('Could not reach the BillTo API.', { cause });
      } finally { clearTimeout(timer); }
      if (this.onResponse) await this.onResponse(response);
      if (response.status >= 200 && response.status < 300) return response;
      if (response.status < 400) throw new UnexpectedResponseError('Unexpected HTTP redirect or informational response.', response);
      const error = mapError(response);
      if (retryable && attempt < this.config.maxRetries && ([502, 503, 504].includes(error.status) || (error instanceof RateLimitError && error.retryAfter !== null))) {
        await this.sleeper(error instanceof RateLimitError ? Math.min(error.retryAfter, this.config.maxRetryDelay) : this.backoff(attempt));
        continue;
      }
      throw error;
    }
  }
  backoff(attempt) { return Math.min(this.config.retryBaseDelay * 2 ** attempt * (1 + Math.random() * 0.25), this.config.maxRetryDelay); }
}

module.exports = { VERSION, API_COMPAT, DEFAULT_BASE_URL, SANDBOX_BASE_URL, DEFAULT_USER_AGENT, Config, BillToError, TransportError, UnexpectedResponseError, ApiError, AuthenticationError, PaymentRequiredError, ForbiddenError, NotFoundError, ConflictError, ServerError, ValidationError, RateLimitError, ApiResponse, BinaryFile, IdempotencyKey, Transport, compact, dateString, isoString, segment, sleep };
