import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  loadWorkspace,
  saveWorkspace,
} from "../../public/lib/storage.js";
import { DEMO_PRODUCTS } from "../../src/catalog.js";

const state = () => ({
  favorites: new Map([[DEMO_PRODUCTS[0].id, DEMO_PRODUCTS[0]]]),
  selected: new Map([[DEMO_PRODUCTS[1].id, DEMO_PRODUCTS[1]]]),
  imported: [],
  drafts: new Map([
    [
      "demo-living-2",
      {
        name: "수정된 상품",
        price: "5200",
        shipping: "0",
        margin: "0",
        fee: "0",
        description: "",
        seoName: "",
        tags: ["수납"],
        points: [],
      },
    ],
  ]),
  mode: "imported",
});

test("persists independent favorites, selection and draft values, including zeros", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key),
    setItem: (key, value) => memory.set(key, value),
  };
  assert.ok(saveWorkspace(storage, state()));
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.favorites[0].id, DEMO_PRODUCTS[0].id);
  assert.equal(loaded.selected[0].id, DEMO_PRODUCTS[1].id);
  assert.equal(loaded.drafts["demo-living-2"].shipping, "0");
  assert.equal(loaded.drafts["demo-living-2"].margin, "0");
  assert.equal(loaded.mode, "imported");
  assert.equal(loaded.warning, false);
  assert.equal(memory.size, 1);
  assert.ok(memory.has(STORAGE_KEY));
});

test("blocked/corrupt storage does not crash or report successful saving", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.equal(saveWorkspace(blocked, state()), false);
  assert.equal(loadWorkspace(blocked).warning, true);
  assert.equal(
    loadWorkspace({ getItem: () => "invalid json" }).favorites.length,
    0,
  );
  assert.equal(
    loadWorkspace({ getItem: () => JSON.stringify({ version: 999 }) }).warning,
    true,
  );
});

test("discards malformed products and ignores arbitrary draft fields", () => {
  const loaded = loadWorkspace({
    getItem: () =>
      JSON.stringify({
        version: 1,
        favorites: [{ name: "<script>" }, DEMO_PRODUCTS[0]],
        selected: [],
        imported: [],
        drafts: {
          item: {
            name: "valid",
            __unexpected: "no",
            tags: [1, "수납"],
            points: [],
          },
        },
        accessKey: "must-not-be-loaded",
      }),
  });
  assert.equal(loaded.favorites.length, 1);
  assert.equal(loaded.drafts.item.__unexpected, undefined);
  assert.deepEqual(loaded.drafts.item.tags, ["수납"]);
  assert.equal(loaded.accessKey, undefined);
});
