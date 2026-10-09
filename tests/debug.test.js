import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDebugReport, debugLog, getDebugLog } from "../lib/debug.js";

test("debug report records the extension version", () => {
  const report = JSON.parse(buildDebugReport({ version: "9.9.9", probes: { alarms: true } }));
  assert.equal(report.lulltab, "9.9.9");
  assert.equal(report.version, undefined);
  assert.equal(report.probes.alarms, true);
  assert.ok(report.when);
  assert.equal(JSON.parse(buildDebugReport({ probes: {} })).lulltab, "1.3.1");
});

test("concurrent debug logs keep every entry", async () => {
  const store = { "still.settings": { debug: true }, "still.debugLog": [] };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) if (key in store) out[key] = structuredClone(store[key]);
          return out;
        },
        set: async (items) => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          Object.assign(store, structuredClone(items));
        },
      },
    },
  };
  await Promise.all([debugLog("a"), debugLog("b"), debugLog("c")]);
  const log = await getDebugLog();
  assert.deepEqual(
    log.map((entry) => entry.event),
    ["a", "b", "c"]
  );
});
