// Optional anonymous daily ping to analytics.n3el.dev. The only network request Lulltab makes.
// Sends a random install ID, the extension version, Chrome major version and CPU arch.
// No tabs, URLs, titles, settings or anything else about the user.

export const PRODUCT = "lulltab";
export const PING_URL = "https://analytics.n3el.dev/v1/heartbeat";
export const UNINSTALL_URL = `https://analytics.n3el.dev/u/${PRODUCT}`;
const STATE_KEY = "still.usage";
const TIMEOUT_MS = 10_000;
const RETRY_GAP_MS = 60 * 60 * 1000;

let inflight = null;

export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function chromeMajor(userAgent) {
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(String(userAgent || ""));
  return match ? match[1] : "unknown";
}

export function normalizeArch(arch) {
  if (arch === "x86-64") return "x86_64";
  if (arch === "x86-32") return "x86";
  return arch || "unknown";
}

export function buildPayload({ installId, version, userAgent, arch }) {
  return {
    product: PRODUCT,
    install_id: installId,
    version,
    platform: "chrome",
    os_version: chromeMajor(userAgent),
    arch: normalizeArch(arch),
    channel: "release",
  };
}

// Returns whether a ping was sent. Never throws.
export function maybeSendPing(enabled, now = Date.now()) {
  if (!enabled) return Promise.resolve(false);
  if (!inflight) {
    inflight = sendIfDue(now)
      .catch(() => false)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function syncUninstallUrl(enabled) {
  try {
    await chrome.runtime.setUninstallURL(enabled ? UNINSTALL_URL : "");
  } catch {
    /* best effort */
  }
}

async function sendIfDue(now) {
  const state = await loadState();
  const today = utcDay(now);
  if (state.lastSentDay === today) return false;
  if (now - (state.lastAttemptAt || 0) < RETRY_GAP_MS) return false;
  await chrome.storage.local.set({ [STATE_KEY]: { ...state, lastAttemptAt: now } });

  const platform = await chrome.runtime.getPlatformInfo().catch(() => ({}));
  const payload = buildPayload({
    installId: state.installId,
    version: chrome.runtime.getManifest().version,
    userAgent: globalThis.navigator?.userAgent,
    arch: platform.arch,
  });
  const response = await fetch(PING_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return false;
  await chrome.storage.local.set({
    [STATE_KEY]: { ...state, lastAttemptAt: now, lastSentDay: today },
  });
  return true;
}

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] && typeof stored[STATE_KEY] === "object" ? stored[STATE_KEY] : {};
  if (typeof state.installId === "string" && state.installId) return state;
  const next = { ...state, installId: crypto.randomUUID() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}
