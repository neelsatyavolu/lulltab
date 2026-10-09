import { test } from "node:test";
import assert from "node:assert/strict";
import { setSettings } from "../lib/settings.js";

test("concurrent setSettings calls keep every field", async () => {
  const store = {};
  let setCalls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items) => {
          setCalls += 1;
          if (setCalls === 1) {
            entered();
            await gate;
          }
          Object.assign(store, structuredClone(items));
        },
      },
    },
  };

  const first = setSettings({ idleMinutes: 5 });
  await entered;
  const second = setSettings({ debug: true });
  release();
  const [, done] = await Promise.all([first, second]);
  assert.equal(done.idleMinutes, 5);
  assert.equal(done.debug, true);
  assert.equal(store["still.settings"].idleMinutes, 5);
  assert.equal(store["still.settings"].debug, true);
});
