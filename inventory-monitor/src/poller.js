'use strict';

/**
 * Poller — the background loop that fetches log windows from the log server,
 * applies them to state via the ledger, and persists. Owns the dedupe buffer
 * (`processedSet`, derived from state.processedIds) and the poll-in-progress flag.
 *
 * DIP: depends on injected { config, state, db, logClient, applyLog }.
 */

function createPoller({ config, state, db, logClient, applyLog, finalizeNewTrades, reconcileFifo }) {
  let processedSet = new Set(state.processedIds);
  let polling = false;

  // Drop the dedupe buffer (called after a reset — state.processedIds is already cleared).
  function resetDedupe() {
    processedSet = new Set(state.processedIds);
  }

  async function poll() {
    if (polling) return { skipped: true };
    if (!config.logsServer) {
      state.poll = { lastTs: Date.now(), lastOk: false, lastMsg: 'Log server not set — configure LOGS_SERVER in inventory-monitor/.env', processed: 0 };
      return { skipped: true };
    }
    polling = true;
    try {
      const nowTs = Math.floor(Date.now() / 1000);
      let from = (typeof state.lastTs === 'number' && state.lastTs > 0) ? state.lastTs : state.startTs;
      if (from >= nowTs) {
        state.poll = { lastTs: Date.now(), lastOk: true, lastMsg: 'Up to date', processed: 0 };
        await db.persist([], 0);
        return { processed: 0 };
      }

      // Progress tracking (exposed via /api/state → UI progress bar)
      const setProgress = (phase, current, total, label) => {
        state.poll.inProgress = true;
        state.poll.progress = { phase, current, total, label };
      };
      const bar = (cur, tot) => {
        const w = 22, pct = tot ? Math.min(1, cur / tot) : 0;
        const n = Math.round(pct * w);
        return `[${'█'.repeat(n)}${'░'.repeat(w - n)}] ${cur}/${tot}`;
      };
      // Terminal progress stays on ONE line — each update rewrites the line with \r
      // (and clears any leftover characters from a longer previous line).
      const term = process.stdout;
      const printProgress = line => term.write('\r' + line + '\x1b[K');
      const clearProgress = () => term.write('\r\x1b[K');

      // Fetch in ≤6h windows to stay inside API range limits.
      const chunkTotal = Math.max(1, Math.ceil((nowTs - from) / config.fetchChunk));
      const allLogs = [];
      let cursor = from, chunkIdx = 0;
      setProgress('fetch', 0, chunkTotal, 'Fetching logs');
      console.log(`[poll] fetching ${chunkTotal} window${chunkTotal > 1 ? 's' : ''}…`);
      // Window times shown in Torn City time (ET) — matches the dashboard.
      const etFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.tornTimeZone, hour: '2-digit', minute: '2-digit', hour12: false });
      const et = ts => etFmt.format(new Date(ts * 1000));
      while (cursor < nowTs) {
        const to = Math.min(cursor + config.fetchChunk, nowTs);
        chunkIdx++;
        setProgress('fetch', chunkIdx, chunkTotal, `Fetching window ${chunkIdx}/${chunkTotal}`);
        printProgress(`[poll] ${bar(chunkIdx, chunkTotal)} window ${et(cursor)}–${et(to)} ET`);
        allLogs.push(...await logClient.fetchLogsRange(cursor, to));
        cursor = to;
      }
      allLogs.sort((a, b) => a.timestamp - b.timestamp);

      let applied = 0, newestTs = state.lastTs || 0;
      const newProcessed = [];
      const logTotal = allLogs.length;
      setProgress('apply', 0, logTotal, 'Applying logs');
      let logIdx = 0;
      for (const log of allLogs) {
        logIdx++;
        if (logTotal > 20) {
          setProgress('apply', logIdx, logTotal, `Applying logs ${logIdx}/${logTotal}`);
          if (logIdx % 100 === 0 || logIdx === logTotal) printProgress(`[poll] ${bar(logIdx, logTotal)} applying`);
        }
        const key = logClient.logKey(log);
        if (processedSet.has(key)) continue;
        if (log.timestamp < state.startTs) continue;
        try {
          if (applyLog(log, state)) applied++;
        } catch (e) {
          clearProgress();
          console.warn(`[poll] skipping malformed log ${key}: ${e.message}`);
        }
        processedSet.add(key);
        state.processedIds.push(key);
        newProcessed.push(key);
        if (log.timestamp > newestTs) newestTs = log.timestamp;
      }
      clearProgress();
      console.log(`[poll] done — applied ${applied} new log${applied === 1 ? '' : 's'}${logTotal > 0 ? ` (${logTotal} fetched)` : ' (nothing new)'}`);

      // Finalize FIFO + transaction rows for trades assembled this batch.
      // Track the state.processedIds length before so we can capture any newly-added
      // trade_fifo: dedup keys and include them in newProcessed → persisted to DB.
      // Without this, trade keys wouldn't survive a restart and trades would be re-finalized.
      if (finalizeNewTrades) {
        const prevLen = state.processedIds.length;
        finalizeNewTrades(state, processedSet);
        if (state.processedIds.length > prevLen) {
          newProcessed.push(...state.processedIds.slice(prevLen));
        }
      }

      // FIFO reconciliation — auto-close any gap between FIFO remaining totals and
      // true inventory net (log ledger + inventory manual adjustments).
      // Runs silently after every poll; also callable on demand via POST /api/fifo/reconcile.
      if (reconcileFifo) {
        const r = reconcileFifo(state);
        if (r.itemsAffected > 0) {
          console.log(`[poll] FIFO reconcile: ${r.itemsAffected} item(s) — +${r.unitsCreated} lot units created, -${r.unitsDepleted} depleted`);
        }
      }

      if (state.processedIds.length > config.processedMax) {
        state.processedIds = state.processedIds.slice(-config.processedMax);
        processedSet = new Set(state.processedIds);
      }
      if (newestTs > (state.lastTs || 0)) state.lastTs = newestTs;

      state.poll = {
        lastTs: Date.now(),
        lastOk: true,
        lastMsg: applied > 0 ? `Processed ${applied} new log entries` : 'Up to date',
        processed: applied,
        inProgress: false,
        progress: null,
      };
      await db.persist(newProcessed, applied);
      return { processed: applied };
    } catch (e) {
      state.poll = { lastTs: Date.now(), lastOk: false, lastMsg: e.message, processed: 0, inProgress: false, progress: null };
      console.error('[poll]', e.message);
      return { error: e.message };
    } finally {
      polling = false;
    }
  }

  return { poll, resetDedupe };
}

module.exports = { createPoller };
