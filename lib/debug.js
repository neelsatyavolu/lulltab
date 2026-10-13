const LOG_KEY = "still.debugLog";
export const MAX_DEBUG_LOG = 100;

let logQueue = Promise.resolve();

export function debugLog(event, detail = {}) {
  const run = logQueue.then(() => writeDebug(event, detail));
  logQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function writeDebug(event, detail) {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const stored = await chrome.storage.local.get(["still.settings", LOG_KEY]);
    const debugOn = stored["still.settings"]?.debug === true;
    if (!debugOn) return;
    const entry = { t: Date.now(), event: String(event), ...sanitize(detail) };
    const log = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
    log.push(entry);
    if (log.length > MAX_DEBUG_LOG) log.splice(0, log.length - MAX_DEBUG_LOG);
    await chrome.storage.local.set({ [LOG_KEY]: log });
  } catch {
    /* logger must never throw */
  }
}

export async function getDebugLog() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return [];
  const stored = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
}

export async function clearDebugLog() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

export function formatDebugTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(11, 23);
}

export function buildDebugReport(payload) {
  const { version, ...rest } = payload || {};
  let lulltab = version;
  if (!lulltab && typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    try {
      lulltab = chrome.runtime.getManifest().version;
    } catch {
      lulltab = undefined;
    }
  }
  return JSON.stringify(
    {
      lulltab: lulltab || "1.3.1",
      when: new Date().toISOString(),
      ...rest,
    },
    null,
    2
  );
}

function sanitize(detail) {
  const out = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = typeof value === "string" ? value.slice(0, 400) : value;
    } else {
      out[key] = String(value).slice(0, 300);
    }
  }
  return out;
}
