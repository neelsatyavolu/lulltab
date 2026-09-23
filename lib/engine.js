import { isWhitelisted } from "./whitelist.js";

const INTERNAL = /^(chrome|chrome-extension|edge|about|devtools|view-source|data|file|blob|javascript|aside):/i;

export function isHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isInternalUrl(url) {
  if (!url) return true;
  if (INTERNAL.test(url)) return true;
  return !isHttpUrl(url);
}

export function isAsideChatTitle(title) {
  return /\s[⋅·]\s*Chats?\s*$/i.test(String(title || ""));
}

export function isAsideAgentGroup(title) {
  return String(title || "").trim() === "Agent Tabs";
}

export function classifyTab(tab, { now, lastAccess, settings, asideBusy = false }) {
  if (!tab) return { sleep: false, reason: "missing" };
  if (tab.active) return { sleep: false, reason: "active", idleMs: 0 };
  if (tab.discarded) return { sleep: false, reason: "sleeping" };

  const last = Number(lastAccess?.[tab.id]);
  const touched = Number.isFinite(last) ? last : now;
  const idleMs = Math.max(0, now - touched);

  if (isInternalUrl(tab.url)) return { sleep: false, reason: "internal", idleMs };
  if (settings.keepPinned && tab.pinned) return { sleep: false, reason: "pinned", idleMs };
  if (settings.keepAudible && tab.audible) return { sleep: false, reason: "audible", idleMs };
  if (settings.keepAsideChat !== false && (asideBusy || isAsideChatTitle(tab.title))) {
    return { sleep: false, reason: "aside-chat", idleMs };
  }
  if (isWhitelisted(tab.url, settings.whitelist)) {
    return { sleep: false, reason: "whitelist", idleMs };
  }

  const limitMs = Math.max(1, settings.idleMinutes) * 60 * 1000;
  if (idleMs < limitMs) {
    return { sleep: false, reason: "fresh", idleMs, remainingMs: limitMs - idleMs };
  }
  return { sleep: true, reason: "idle", idleMs };
}

// Idle starts when a tab is left. Time spent looking at it does not count.
export function noteTabActivated(access, activeByWindow, { tabId, windowId, now }) {
  const nextAccess = { ...(access || {}) };
  const nextActive = { ...(activeByWindow || {}) };
  if (windowId != null && tabId != null) {
    const key = String(windowId);
    const previous = nextActive[key];
    if (previous != null && Number(previous) !== Number(tabId)) nextAccess[previous] = now;
    nextActive[key] = tabId;
  }
  if (tabId != null) nextAccess[tabId] = now;
  return { access: nextAccess, activeByWindow: nextActive };
}

// Keep the focused tab's timestamp current so a later leave isn't charged for view time.
export function stampActiveTabs(access, tabs, now) {
  const next = { ...(access || {}) };
  let changed = false;
  for (const tab of tabs || []) {
    if (!tab?.active || tab.id == null) continue;
    if (next[tab.id] !== now) {
      next[tab.id] = now;
      changed = true;
    }
  }
  return { access: next, changed };
}

// While Lulltab is on, only its timer may unload a tab. Chrome's memory saver ignores idleMinutes.
export function allowsBrowserDiscard(tab, settings) {
  if (settings?.enabled !== false) return false;
  if (!tab) return true;
  if (isWhitelisted(tab.url, settings.whitelist)) return false;
  if (settings.keepPinned && tab.pinned) return false;
  if (settings.keepAudible && tab.audible) return false;
  return true;
}

export function reasonLabel(reason) {
  switch (reason) {
    case "active":
      return "This tab is open";
    case "sleeping":
      return "Sleeping";
    case "internal":
      return "Browser page — never sleeps";
    case "pinned":
      return "Pinned — protected";
    case "audible":
      return "Playing sound — protected";
    case "aside-chat":
      return "Aside chat is running";
    case "whitelist":
      return "Whitelisted";
    case "fresh":
      return "Still within the idle window";
    case "idle":
      return "Idle — ready to sleep";
    default:
      return reason || "";
  }
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatIdleMinutes(minutes) {
  const n = Math.max(1, Math.round(Number(minutes) || 1));
  if (n < 60) return { value: String(n), unit: n === 1 ? "minute" : "minutes" };
  if (n % 60 === 0) {
    const hours = n / 60;
    return { value: String(hours), unit: hours === 1 ? "hour" : "hours" };
  }
  const hours = Math.floor(n / 60);
  const rem = n % 60;
  return { value: `${hours}h ${rem}m`, unit: "" };
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function faviconLetter(title, url) {
  const host = hostnameOf(url);
  const source = (title || host || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}
