import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes,
  formatBytesParts,
  attachProcessMemory,
  sumAwakeBytes,
  sortMemoryRows,
  processBytes,
  tabIdsFromProcess,
} from "../lib/memory.js";

test("formatBytes uses KB/MB/GB", () => {
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(800), "800 B");
  assert.equal(formatBytes(12 * 1024), "12 KB");
  assert.equal(formatBytes(5.2 * 1024 * 1024), "5.2 MB");
  assert.equal(formatBytes(42 * 1024 * 1024), "42 MB");
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), "1.5 GB");
});

test("formatBytesParts splits the hero readout", () => {
  assert.deepEqual(formatBytesParts(900 * 1024 * 1024), { value: "900", unit: "MB" });
  assert.deepEqual(formatBytesParts(2.4 * 1024 * 1024 * 1024), { value: "2.4", unit: "GB" });
});

test("sleeping tabs report zero RAM even if a process is listed", () => {
  const rows = attachProcessMemory(
    [
      { id: 1, discarded: true, title: "Docs" },
      { id: 2, discarded: false, title: "Mail" },
    ],
    {
      9: { id: 9, tabs: [1, 2], privateMemory: 80 * 1024 * 1024 },
    }
  );
  assert.equal(rows[0].bytes, 0);
  assert.equal(rows[0].status, "sleeping");
  assert.equal(rows[1].sharedWith, 2);
  assert.equal(rows[1].bytes, 40 * 1024 * 1024);
  assert.equal(rows[1].status, "awake");
});

test("exclusive renderer keeps the full privateMemory", () => {
  const [row] = attachProcessMemory(
    [{ id: 4, discarded: false }],
    [{ tabs: [4], privateMemory: 120 * 1024 * 1024 }]
  );
  assert.equal(row.bytes, 120 * 1024 * 1024);
  assert.equal(row.sharedWith, 1);
});

test("awake tabs without a process still show as loaded", () => {
  const [row] = attachProcessMemory([{ id: 8, discarded: false }], {});
  assert.equal(row.bytes, null);
  assert.equal(row.status, "awake");
});

test("processBytes reads Chrome and fallback field names", () => {
  assert.equal(processBytes({ privateMemory: 10 }), 10);
  assert.equal(processBytes({ jsMemoryUsed: 8 }), 8);
  assert.equal(processBytes({ privateMemory: 0 }), null);
  assert.deepEqual(tabIdsFromProcess({ tabIds: ["3", 4] }), [3, 4]);
});

test("sum and sort put heavy awake tabs first, sleeping last", () => {
  const rows = attachProcessMemory(
    [
      { id: 1, discarded: true, title: "Sleepy" },
      { id: 2, discarded: false, title: "Light" },
      { id: 3, discarded: false, title: "Heavy" },
    ],
    {
      a: { tabs: [2], privateMemory: 10 * 1024 * 1024 },
      b: { tabs: [3], privateMemory: 90 * 1024 * 1024 },
    }
  );
  assert.equal(sumAwakeBytes(rows), 100 * 1024 * 1024);
  const sorted = sortMemoryRows(rows);
  assert.equal(sorted[0].title, "Heavy");
  assert.equal(sorted[1].title, "Light");
  assert.equal(sorted[2].discarded, true);
});
