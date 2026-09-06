import { getSettings, setSettings } from "./lib/settings.js";
import { parsePattern, isWhitelisted } from "./lib/whitelist.js";
import { classifyTab, isInternalUrl, hostnameOf, isAsideChatTitle, isAsideAgentGroup } from "./lib/engine.js";
import {
  attachProcessMemory,
  sumAwakeBytes,
  processBytes,
  summarizeProcesses,
} from "./lib/memory.js";
import { debugLog, getDebugLog, clearDebugLog, buildDebugReport } from "./lib/debug.js";

const ALARM = "still.scan";
const ACCESS_KEY = "still.access";
const memoryAccess = {};

let initLock = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => queueInit("install"));
chrome.runtime.onStartup.addListener(() => queueInit("startup"));
queueInit("wake");

function queueInit(reason) {
  const run = initLock.then(() => init(reason));
  initLock = run.catch((error) => console.warn(error));
  return run;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) scan().catch(console.warn);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  touch(tabId).then(() => scan()).catch(console.warn);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id != null) touch(tab.id).catch(console.warn);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forget(tabId).catch(console.warn);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.discarded === false) touch(tabId).catch(console.warn);
  if (changeInfo.pinned != null || changeInfo.audible != null || changeInfo.url) {
    applyAutoDiscardable(tab).catch(console.warn);
  }
  if (changeInfo.status === "complete") updateBadge().catch(console.warn);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["still.settings"]) {
    scan().catch(console.warn);
    protectWhitelisted().catch(console.warn);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "sleep-tab") sleepActive().catch(console.warn);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "sleep") {
    if (tab?.id != null) sleepTab(tab.id).catch(console.warn);
  } else if (info.menuItemId === "whitelist-site") {
    whitelistTab(tab).catch(console.warn);
  } else if (info.menuItemId === "sleep-others") {
    sleepOthers().catch(console.warn);
  }
});

async function init(reason) {
  await debugLog("init", { reason });
  if (reason === "startup") await setAccess({});
  await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  await seedAccess();
  if (reason === "install") await setupMenus();
  await protectWhitelisted();
  await scan();
}

async function setupMenus() {
  await chrome.contextMenus.removeAll();
  const items = [
    { id: "sleep", title: "Sleep this tab", contexts: ["page", "action"] },
    { id: "whitelist-site", title: "Never sleep this site", contexts: ["page", "action"] },
    { id: "sleep-others", title: "Sleep all other tabs", contexts: ["action"] },
  ];
  for (const item of items) {
    await createMenu(item);
  }
}

function createMenu(item) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(item, () => {
      const error = chrome.runtime.lastError;
      if (error && !/duplicate id/i.test(error.message || "")) {
        debugLog("menu-error", { id: item.id, message: error.message });
        reject(new Error(error.message));
        return;
      }
      if (error) debugLog("menu-duplicate", { id: item.id });
      resolve();
    });
  });
}

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return { ok: true, ...(await getState()) };
    case "SET_SETTINGS":
      await setSettings(message.partial || {});
      if (message.partial?.debug) await debugLog("debug-on");
      await scan();
      return { ok: true, settings: await getSettings() };
    case "SLEEP_TAB":
      await sleepTab(message.tabId);
      return { ok: true };
    case "WAKE_TAB":
      await wakeTab(message.tabId);
      return { ok: true };
    case "SLEEP_OTHERS":
      await sleepOthers();
      return { ok: true };
    case "WHITELIST_ADD":
      await addWhitelist(message.input, message.tabUrl);
      return { ok: true, settings: await getSettings() };
    case "WHITELIST_REMOVE":
      await removeWhitelist(message.id);
      return { ok: true, settings: await getSettings() };
    case "GET_MEMORY":
      return { ok: true, ...(await getMemoryStats()) };
    case "GET_DEBUG":
      return { ok: true, ...(await getDebugState()) };
    case "CLEAR_DEBUG":
      await clearDebugLog();
      await debugLog("log-cleared");
      return { ok: true, ...(await getDebugState()) };
    default:
      return { ok: false, error: "Unknown message" };
  }
}

async function getState() {
  const settings = await getSettings();
  const access = await getAccess();
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  const asideBusy = await getAsideBusyTabIds(tabs);
  const current = tabs.find((tab) => tab.active && tab.highlighted) || tabs.find((tab) => tab.active);
  const rows = tabs.map((tab) => {
    const verdict = classifyTab(tab, {
      now,
      lastAccess: access,
      settings,
      asideBusy: asideBusy.has(tab.id),
    });
    return {
      id: tab.id,
      title: tab.title || hostnameOf(tab.url) || "Tab",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      discarded: Boolean(tab.discarded),
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
      active: Boolean(tab.active),
      windowId: tab.windowId,
      ...verdict,
    };
  });
  const sleeping = rows.filter((tab) => tab.discarded).length;
  return {
    settings,
    currentTab: rows.find((tab) => tab.id === current?.id) || null,
    tabs: rows,
    counts: {
      total: rows.length,
      sleeping,
      awake: rows.length - sleeping,
    },
  };
}

async function getMemoryStats() {
  const tabs = (await chrome.tabs.query({})).map((tab) => ({
    id: tab.id,
    title: tab.title || hostnameOf(tab.url) || "Tab",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    discarded: Boolean(tab.discarded),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
  }));
  const collected = await collectTabRam(tabs);
  const rows = tabs.map((tab) => {
    if (tab.discarded) {
      return { ...tab, bytes: 0, processBytes: 0, sharedWith: 1, status: "sleeping" };
    }
    const mem = collected.byTab.get(tab.id);
    if (!mem) return { ...tab, bytes: null, processBytes: null, sharedWith: 1, status: "awake" };
    return { ...tab, ...mem, status: "awake" };
  });
  const system = await readSystemMemory();
  const awakeBytes = sumAwakeBytes(rows);
  const sleeping = rows.filter((tab) => tab.discarded).length;
  await debugLog("memory", {
    source: collected.source,
    mapped: collected.byTab.size,
    tabs: rows.length,
    sleeping,
    awakeBytes,
    sample: collected.sample,
  });
  return {
    rows,
    processAvailable: collected.source === "process",
    source: collected.source,
    system,
    awakeBytes,
    counts: {
      total: rows.length,
      sleeping,
      awake: rows.length - sleeping,
    },
  };
}

async function collectTabRam(tabs) {
  const byTab = new Map();
  let source = "none";
  let sample = "";

  const bulk = await readProcessInfo([]);
  if (bulk) {
    sample = JSON.stringify(summarizeProcesses(bulk));
    for (const row of attachProcessMemory(tabs, bulk)) {
      if (row.bytes != null && !row.discarded) byTab.set(row.id, row);
    }
    if (byTab.size) source = "process";
  }

  if (chrome.processes?.getProcessIdForTab) {
    const pairs = [];
    for (const tab of tabs) {
      if (tab.discarded || byTab.has(tab.id)) continue;
      const pid = await getProcessIdForTab(tab.id);
      if (pid != null) pairs.push({ tabId: tab.id, pid });
    }
    if (pairs.length) {
      const pids = [...new Set(pairs.map((item) => item.pid))];
      const info = await readProcessInfo(pids);
      if (info) {
        sample = sample || JSON.stringify(summarizeProcesses(info));
        const indexed = indexProcesses(info);
        const share = {};
        for (const item of pairs) share[item.pid] = (share[item.pid] || 0) + 1;
        for (const item of pairs) {
          const proc = indexed.get(item.pid) || indexed.get(String(item.pid));
          const bytes = processBytes(proc);
          if (bytes == null) continue;
          const n = share[item.pid] || 1;
          byTab.set(item.tabId, { bytes: bytes / n, processBytes: bytes, sharedWith: n });
        }
        if (byTab.size) source = "process";
      }
    }
  }

  if (!byTab.size) {
    const live = await waitForMemoryUpdate(1800);
    if (live) {
      sample = JSON.stringify(summarizeProcesses(live));
      for (const row of attachProcessMemory(tabs, live)) {
        if (row.bytes != null && !row.discarded) byTab.set(row.id, row);
      }
      if (byTab.size) source = "process";
    }
  }

  if (chrome.scripting?.executeScript) {
    for (const tab of tabs) {
      if (tab.discarded || byTab.has(tab.id)) continue;
      if (!/^https?:/i.test(tab.url || "")) continue;
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const memory = performance && performance.memory;
            return memory && memory.usedJSHeapSize ? memory.usedJSHeapSize : null;
          },
        });
        const bytes = injected?.[0]?.result;
        if (Number.isFinite(bytes) && bytes > 0) {
          byTab.set(tab.id, { bytes, processBytes: bytes, sharedWith: 1, kind: "heap" });
        }
      } catch (error) {
        await debugLog("heap-fail", { tabId: tab.id, message: error.message || String(error) });
      }
    }
    if (source === "none" && [...byTab.values()].some((row) => row.kind === "heap")) source = "heap";
  }

  return { byTab, source, sample };
}

function indexProcesses(processes) {
  const map = new Map();
  const list = Array.isArray(processes) ? processes : Object.values(processes || {});
  if (processes && !Array.isArray(processes)) {
    for (const [key, proc] of Object.entries(processes)) map.set(key, proc);
  }
  for (const proc of list) {
    if (proc?.id != null) map.set(proc.id, proc);
  }
  return map;
}

function getProcessIdForTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.processes.getProcessIdForTab(tabId, (pid) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(pid ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function waitForMemoryUpdate(ms) {
  return new Promise((resolve) => {
    if (!chrome.processes?.onUpdatedWithMemory) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      chrome.processes.onUpdatedWithMemory.removeListener(onUpdate);
      resolve(null);
    }, ms);
    function onUpdate(processes) {
      clearTimeout(timer);
      chrome.processes.onUpdatedWithMemory.removeListener(onUpdate);
      resolve(processes);
    }
    chrome.processes.onUpdatedWithMemory.addListener(onUpdate);
  });
}

function readProcessInfo(processIds) {
  return new Promise((resolve) => {
    if (!chrome.processes?.getProcessInfo) {
      resolve(null);
      return;
    }
    const ids = processIds && processIds.length ? processIds : [];
    try {
      chrome.processes.getProcessInfo(ids, true, (info) => {
        if (chrome.runtime.lastError) {
          debugLog("processes-error", { message: chrome.runtime.lastError.message });
          resolve(null);
          return;
        }
        resolve(info || {});
      });
    } catch (error) {
      debugLog("processes-error", { message: error.message || String(error) });
      resolve(null);
    }
  });
}

function readSystemMemory() {
  return new Promise((resolve) => {
    if (!chrome.system?.memory?.getInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.system.memory.getInfo((info) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(info || null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function getDebugState() {
  const settings = await getSettings();
  const log = await getDebugLog();
  const tabs = await chrome.tabs.query({});
  let alarm = null;
  try {
    alarm = await chrome.alarms.get(ALARM);
  } catch {
    alarm = null;
  }
  const probes = {
    processes: Boolean(chrome.processes?.getProcessInfo),
    processIdForTab: Boolean(chrome.processes?.getProcessIdForTab),
    systemMemory: Boolean(chrome.system?.memory?.getInfo),
    sessionStorage: Boolean(chrome.storage?.session),
    alarms: Boolean(chrome.alarms),
    contextMenus: Boolean(chrome.contextMenus),
    userAgent: navigator.userAgent || "",
  };
  const counts = {
    total: tabs.length,
    sleeping: tabs.filter((tab) => tab.discarded).length,
    access: Object.keys(await getAccess()).length,
  };
  const report = buildDebugReport({ settings, probes, counts, alarm, log });
  return { settings, probes, counts, alarm, log, report };
}

async function scan() {
  const settings = await getSettings();
  if (!settings.enabled) {
    await updateBadge();
    return;
  }
  const access = await getAccess();
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  const asideBusy = await getAsideBusyTabIds(tabs);
  let slept = 0;
  let failed = 0;
  for (const tab of tabs) {
    const busy = asideBusy.has(tab.id);
    const verdict = classifyTab(tab, { now, lastAccess: access, settings, asideBusy: busy });
    if (busy && tab.id != null) await touch(tab.id);
    if (verdict.sleep && tab.id != null) {
      try {
        await chrome.tabs.discard(tab.id);
        slept += 1;
      } catch (error) {
        failed += 1;
        await debugLog("discard-fail", {
          tabId: tab.id,
          message: error.message || String(error),
        });
      }
    }
  }
  await debugLog("scan", { tabs: tabs.length, slept, failed });
  await updateBadge();
}

async function sleepTab(tabId) {
  if (tabId == null) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.active) {
    const others = await chrome.tabs.query({ windowId: tab.windowId });
    const fallback = others.find((item) => item.id !== tab.id && !item.discarded) || others.find((item) => item.id !== tab.id);
    if (fallback?.id == null) {
      await debugLog("sleep-fail", { tabId, message: "last-tab" });
      throw new Error("Can't sleep the last tab in a window.");
    }
    await chrome.tabs.update(fallback.id, { active: true });
  }
  try {
    await chrome.tabs.discard(tabId);
  } catch (error) {
    await debugLog("sleep-fail", { tabId, message: error.message || String(error) });
    throw new Error(error.message || "Could not sleep this tab.");
  }
  await debugLog("sleep", { tabId });
  await updateBadge();
}

async function wakeTab(tabId) {
  if (tabId == null) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.discarded) await chrome.tabs.reload(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await debugLog("wake", { tabId });
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await touch(tabId);
  await updateBadge();
}

async function getAsideBusyTabIds(tabs) {
  const ids = new Set();
  for (const tab of tabs) {
    if (tab.id != null && isAsideChatTitle(tab.title)) ids.add(tab.id);
  }
  if (!chrome.tabGroups?.get) return ids;
  const groupIds = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => typeof id === "number" && id > -1))];
  for (const groupId of groupIds) {
    try {
      const group = await chrome.tabGroups.get(groupId);
      if (!isAsideAgentGroup(group.title)) continue;
      for (const tab of tabs) {
        if (tab.groupId === groupId && tab.id != null) ids.add(tab.id);
      }
    } catch {
      /* group gone */
    }
  }
  return ids;
}

async function sleepOthers() {
  const tabs = await chrome.tabs.query({});
  const settings = await getSettings();
  const asideBusy = await getAsideBusyTabIds(tabs);
  for (const tab of tabs) {
    if (!tab.active && !tab.discarded && !isInternalUrl(tab.url)) {
      if (settings.keepPinned && tab.pinned) continue;
      if (settings.keepAudible && tab.audible) continue;
      if (settings.keepAsideChat !== false && asideBusy.has(tab.id)) continue;
      if (isWhitelisted(tab.url, settings.whitelist)) continue;
      try {
        await chrome.tabs.discard(tab.id);
      } catch {
        /* ignore */
      }
    }
  }
  await updateBadge();
}

async function sleepActive() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const others = await chrome.tabs.query({ windowId: tab.windowId });
  const fallback = others.find((item) => item.id !== tab.id);
  if (fallback?.id != null) await chrome.tabs.update(fallback.id, { active: true });
  await sleepTab(tab.id);
}

async function addWhitelist(input, tabUrl) {
  const source = input && String(input).trim() ? input : hostnameOf(tabUrl);
  const parsed = parsePattern(source);
  const settings = await getSettings();
  const exists = settings.whitelist.some(
    (rule) => rule.kind === parsed.kind && rule.pattern === parsed.pattern
  );
  if (exists) return settings;
  const rule = {
    id: crypto.randomUUID(),
    ...parsed,
    createdAt: Date.now(),
  };
  return setSettings({ whitelist: [...settings.whitelist, rule] });
}

async function removeWhitelist(id) {
  const settings = await getSettings();
  return setSettings({ whitelist: settings.whitelist.filter((rule) => rule.id !== id) });
}

async function whitelistTab(tab) {
  if (!tab?.url) return;
  await addWhitelist("", tab.url);
}

async function seedAccess() {
  const access = await getAccess();
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  let changed = false;
  for (const tab of tabs) {
    if (tab.id != null && access[tab.id] == null) {
      access[tab.id] = now;
      changed = true;
    }
  }
  if (changed) await setAccess(access);
}

async function touch(tabId) {
  const access = await getAccess();
  access[tabId] = Date.now();
  await setAccess(access);
}

async function forget(tabId) {
  const access = await getAccess();
  if (access[tabId] == null) return;
  delete access[tabId];
  await setAccess(access);
}

async function getAccess() {
  try {
    const stored = await chrome.storage.session.get(ACCESS_KEY);
    if (stored[ACCESS_KEY] && typeof stored[ACCESS_KEY] === "object") {
      return { ...stored[ACCESS_KEY] };
    }
  } catch {
    /* Aside / older Chromium without session storage */
  }
  return { ...memoryAccess };
}

async function setAccess(access) {
  Object.keys(memoryAccess).forEach((key) => delete memoryAccess[key]);
  Object.assign(memoryAccess, access);
  try {
    await chrome.storage.session.set({ [ACCESS_KEY]: access });
  } catch {
    /* in-memory only */
  }
}

async function protectWhitelisted() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await applyAutoDiscardable(tab, settings);
  }
}

async function applyAutoDiscardable(tab, settingsArg) {
  if (tab?.id == null || isInternalUrl(tab.url)) return;
  const settings = settingsArg || (await getSettings());
  const protectedTab =
    isWhitelisted(tab.url, settings.whitelist) ||
    (settings.keepPinned && tab.pinned) ||
    (settings.keepAudible && tab.audible);
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: !protectedTab });
  } catch {
    /* some pages reject this */
  }
}

async function updateBadge() {
  await chrome.action.setBadgeText({ text: "" });
}
