'use strict';

/**
 * Substack subscriber sync (best-effort scraping).
 *
 * Substack non ha API pubblica documentata. Usiamo gli endpoint interni della
 * dashboard owner, autenticando con il cookie del proprietario della newsletter
 * (env SUBSTACK_COOKIE — copiato dal browser).
 *
 * Strategia robusta:
 *  - Prova multipli endpoint candidati (Substack ne cambia spesso il path)
 *  - Parser permissivo (cerca array di oggetti con campo email)
 *  - Fallback: se sync fallisce, lista DEFAULT_ALLOWED rimane attiva
 *  - Diagnostica esposta via /admin/sync-status (raw body se nessun endpoint matcha)
 *
 * NOTA: il cookie Substack scade. Quando il sync inizia a fallire, l'utente
 * rigenera il cookie dal browser e aggiorna la secret SUBSTACK_COOKIE.
 */

const PUBLICATION = process.env.SUBSTACK_PUBLICATION || 'lacassettadegliaitrezzi';
const SYNC_INTERVAL_MS = Number(process.env.SUBSTACK_SYNC_INTERVAL_MS) || 6 * 60 * 60 * 1000; // 6h
const FIRST_SYNC_DELAY_MS = 30_000; // 30s dopo startup
const MAX_BODY_DEBUG = 4000; // bytes max di response body salvati per debug

let lastSyncResult = null;
let syncTimer = null;

function endpointsToTry() {
  const base = `https://${PUBLICATION}.substack.com`;
  return [
    // Endpoint storici / più probabili (in ordine di likelihood)
    `${base}/api/v1/subscriber/email_with_status?subscription_type=paid&limit=1000`,
    `${base}/api/v1/publication/subscriber/list?subscription_type=paid&limit=1000`,
    `${base}/api/v1/subscriptions?subscription_type=paid&limit=1000`,
    `${base}/api/v1/subscriber?subscription_type=paid&limit=1000`,
  ];
}

async function fetchEndpoint(url, cookie) {
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      Accept: 'application/json,text/html;q=0.5',
      'User-Agent': 'cassetta-htmltopdf/1.0 (+substack-sync)',
    },
    redirect: 'follow',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    bodyText: text.slice(0, MAX_BODY_DEBUG),
    bodyJson: json,
    bodyLen: text.length,
  };
}

// Parser permissivo: cerca array con oggetti {email: "..."}
function extractEmails(json) {
  if (!json) return null;
  const candidates = [
    json.subscribers,
    json.subscriptions,
    json.email_with_status,
    json.data,
    json.items,
    json.results,
    Array.isArray(json) ? json : null,
  ];
  for (const arr of candidates) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const emails = arr
      .map(item => {
        if (typeof item === 'string') return item.toLowerCase().trim();
        return (item.email || item.email_address || item.user_email || '').toLowerCase().trim();
      })
      .filter(e => /^\S+@\S+\.\S+$/.test(e));
    if (emails.length > 0) return emails;
  }
  return null;
}

async function syncOnce() {
  const cookie = process.env.SUBSTACK_COOKIE;
  const startedAt = new Date().toISOString();

  if (!cookie) {
    lastSyncResult = {
      ok: false,
      reason: 'SUBSTACK_COOKIE non impostata. Esegui: fly secrets set SUBSTACK_COOKIE="..."',
      startedAt,
    };
    return lastSyncResult;
  }

  const attempts = [];
  for (const url of endpointsToTry()) {
    let attempt;
    try {
      const r = await fetchEndpoint(url, cookie);
      attempt = { url, status: r.status, contentType: r.contentType, bodyLen: r.bodyLen };
      const emails = extractEmails(r.bodyJson);
      if (emails && emails.length > 0) {
        lastSyncResult = {
          ok: true,
          url, status: r.status,
          count: emails.length,
          emails, // mantenuti in memoria per uso del server
          startedAt, finishedAt: new Date().toISOString(),
          attempts: [...attempts, attempt],
        };
        console.log(`✅ Substack sync: ${emails.length} email da ${url}`);
        return lastSyncResult;
      }
      // Salviamo anche un sample del body per debug, solo se è il primo attempt
      attempt.bodyTextSample = r.bodyText;
      attempt.bodyJsonKeys = r.bodyJson ? Object.keys(r.bodyJson) : null;
    } catch (err) {
      attempt = { url, error: err.message };
    }
    attempts.push(attempt);
  }

  lastSyncResult = {
    ok: false,
    reason: 'Nessun endpoint Substack ha ritornato una lista email parsabile. Verifica cookie e/o endpoint.',
    startedAt, finishedAt: new Date().toISOString(),
    attempts,
  };
  console.warn(`⚠️  Substack sync fallita: ${attempts.length} endpoint provati`);
  return lastSyncResult;
}

function startBackgroundSync(onUpdate) {
  if (syncTimer) return;
  const tick = async () => {
    try {
      const r = await syncOnce();
      if (r && r.ok && Array.isArray(r.emails) && typeof onUpdate === 'function') {
        onUpdate(r.emails);
      }
    } catch (_) { /* swallowed */ }
    syncTimer = setTimeout(tick, SYNC_INTERVAL_MS);
  };
  syncTimer = setTimeout(tick, FIRST_SYNC_DELAY_MS);
}

function stopBackgroundSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function getLastSync() { return lastSyncResult; }

module.exports = {
  syncOnce,
  startBackgroundSync,
  stopBackgroundSync,
  getLastSync,
  PUBLICATION,
  SYNC_INTERVAL_MS,
};
