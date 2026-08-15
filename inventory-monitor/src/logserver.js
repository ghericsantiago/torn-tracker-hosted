'use strict';

/**
 * Log server client — talks to the hosted portfolio server
 * (`/api/portfolio/logs?logTypes=…&from=…&to=…&limit=5000`), which already handles
 * Torn API auth + rate limits. Provides:
 *  - fetchWithRetry: global throttle + 429/5xx retry with backoff (honors Retry-After)
 *  - fetchLogsRange: windowed fetch with bisection when a window hits the cap
 *  - logKey: stable dedupe key (prefers the Torn log id)
 *
 * SRP: the only module that knows the log-server wire protocol.
 */

const C = require('./constants');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createLogClient(config) {
  let lastRequestAt = 0;   // last API call (global throttle)

  async function fetchWithRetry(url) {
    for (let attempt = 1; attempt <= config.requestRetries; attempt++) {
      const wait = lastRequestAt + config.requestIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      let res = null, json = null;
      try {
        res = await fetch(url);
        json = await res.json();
      } catch (e) {
        if (attempt >= config.requestRetries) throw e;             // network error, give up
        await sleep(1000 * attempt);                               // transient — brief backoff
        continue;
      }
      const err = json && json.error;
      const errMsg = err ? (typeof err === 'string' ? err : (err.error || JSON.stringify(err))) : '';
      const rateLimited = (res && (res.status === 429 || (res.status >= 500 && res.status < 600)))
        || /too many requests|rate limit/i.test(errMsg);
      if (!rateLimited) {
        if (res && !res.ok) throw new Error(`API HTTP ${res.status}`);
        if (json && json.error) throw new Error(`API error: ${errMsg}`);
        return json;
      }
      if (attempt < config.requestRetries) {
        let retryAfter = 0;
        try { retryAfter = parseFloat(res.headers.get('retry-after')) || 0; } catch { /* no header */ }
        const backoff = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
        const delay = Math.max(retryAfter * 1000, backoff);
        console.warn(`[poll] rate limited (attempt ${attempt}/${config.requestRetries}) — retrying in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
      }
    }
    throw new Error(`API error: Too many requests (after ${config.requestRetries} attempts)`);
  }

  async function fetchLogsRange(from, to) {
    const url = `${config.logsServer}/api/portfolio/logs?logTypes=${C.LOG_TYPES_PARAM}&from=${Math.floor(from)}&to=${Math.floor(to)}&limit=${config.logFetchLimit}`;
    const json = await fetchWithRetry(url);
    // The hosted server returns `{ log: [ { id, timestamp, details:{id,title,category}, data, params }, … ] }`.
    // Normalize array / {log: array} / object-keyed into an array with id attached.
    let logs;
    if (Array.isArray(json)) {
      logs = json;
    } else if (Array.isArray(json.log)) {
      logs = json.log;
    } else if (json.log && typeof json.log === 'object') {
      logs = Object.entries(json.log)
        .map(([id, entry]) => (entry && typeof entry === 'object') ? { id, ...entry } : null)
        .filter(Boolean);
    } else {
      logs = [];
      console.warn(`[poll] unexpected log response (log is ${typeof json.log}): ${JSON.stringify(json).slice(0, 300)}`);
    }
    // The server caps at `limit` per request — bisect the window to avoid missing data.
    if (logs.length >= config.logFetchLimit) {
      const mid = Math.floor((from + to) / 2);
      if (mid <= from || mid >= to) return logs;   // cannot split further
      const [a, b] = await Promise.all([fetchLogsRange(from, mid), fetchLogsRange(mid, to)]);
      return a.concat(b);
    }
    return logs;
  }

  // Stable dedupe key — prefer the Torn log id, fall back to a content key
  // so a missing id can never collapse all logs into one bucket.
  function logKey(log) {
    if (log.id !== undefined && log.id !== null) return String(log.id);
    return `${log.timestamp}:${log.log ?? log.details?.id}:${JSON.stringify(log.data || {})}`;
  }

  return { fetchWithRetry, fetchLogsRange, logKey };
}

module.exports = { createLogClient };
