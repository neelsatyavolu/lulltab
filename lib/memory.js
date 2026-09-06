/** Pure helpers for tab RAM display. No Chrome APIs. */

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return "—";
  const n = Math.max(0, Number(bytes));
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatBytesParts(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return { value: "—", unit: "" };
  const n = Math.max(0, Number(bytes));
  if (n < 1024 * 1024) return { value: String(Math.round(n / 1024) || 0), unit: "KB" };
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return { value: mb >= 10 ? mb.toFixed(0) : mb.toFixed(1), unit: "MB" };
  }
  return { value: (n / (1024 * 1024 * 1024)).toFixed(1), unit: "GB" };
}

export function processBytes(proc) {
  if (!proc || typeof proc !== "object") return null;
  for (const key of ["privateMemory", "private_memory", "jsMemoryUsed", "jsMemoryAllocated"]) {
    const n = Number(proc[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function tabIdsFromProcess(proc) {
  const raw = proc?.tabs ?? proc?.tabIds ?? proc?.tab_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id) => id != null).map(Number);
}

export function summarizeProcesses(processes) {
  const list = Array.isArray(processes) ? processes : Object.values(processes || {});
  const first = list[0];
  return {
    count: list.length,
    keys: first ? Object.keys(first).slice(0, 12).join(",") : "",
    tabsField: first ? tabIdsFromProcess(first).length : 0,
    sampleBytes: first ? processBytes(first) : null,
  };
}

export function attachProcessMemory(tabs, processes) {
  const list = Array.isArray(processes) ? processes : Object.values(processes || {});
  const byTab = new Map();
  for (const proc of list) {
    const ids = tabIdsFromProcess(proc);
    const bytes = processBytes(proc);
    if (!ids.length || bytes == null) continue;
    const share = ids.length;
    for (const id of ids) {
      byTab.set(id, {
        bytes: bytes / share,
        processBytes: bytes,
        sharedWith: share,
      });
    }
  }

  return (tabs || []).map((tab) => {
    if (tab.discarded) {
      return { ...tab, bytes: 0, processBytes: 0, sharedWith: 1, status: "sleeping" };
    }
    const mem = byTab.get(tab.id) || byTab.get(Number(tab.id));
    if (!mem) {
      return { ...tab, bytes: null, processBytes: null, sharedWith: 1, status: "awake" };
    }
    return { ...tab, ...mem, status: "awake" };
  });
}

export function sumAwakeBytes(rows) {
  return (rows || []).reduce((total, row) => {
    if (row.discarded) return total;
    return total + (Number(row.bytes) || 0);
  }, 0);
}

export function sortMemoryRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    if (a.discarded !== b.discarded) return a.discarded ? 1 : -1;
    return (Number(b.bytes) || 0) - (Number(a.bytes) || 0);
  });
}
