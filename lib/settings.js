export const DEFAULTS = {
  enabled: true,
  idleMinutes: 15,
  keepPinned: true,
  keepAudible: true,
  keepAsideChat: true,
  debug: false,
  usageStats: true,
  whitelist: [],
};

export const IDLE_PRESETS = [1, 5, 10, 15, 30, 45, 60, 120, 240, 480];

const STORAGE_KEY = "still.settings";

export function clampIdleMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.idleMinutes;
  return Math.min(1440, Math.max(1, Math.round(n)));
}

export function mergeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const whitelist = Array.isArray(src.whitelist)
    ? src.whitelist.filter((rule) => rule && rule.kind && rule.pattern)
    : [];
  return {
    enabled: src.enabled !== false,
    idleMinutes: clampIdleMinutes(src.idleMinutes ?? DEFAULTS.idleMinutes),
    keepPinned: src.keepPinned !== false,
    keepAudible: src.keepAudible !== false,
    keepAsideChat: src.keepAsideChat !== false,
    debug: src.debug === true,
    usageStats: src.usageStats !== false,
    whitelist,
  };
}

export async function getSettings() {
  if (!hasStorage()) return mergeSettings(DEFAULTS);
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY]);
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = mergeSettings({ ...current, ...partial });
  if (!hasStorage()) return next;
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

function hasStorage() {
  return typeof chrome !== "undefined" && chrome.storage?.local;
}
