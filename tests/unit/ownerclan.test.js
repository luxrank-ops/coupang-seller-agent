import { searchOwnerclan, normalizeOwnerclanItem } from "../../src/ownerclan.js";
import { SourcingError } from "../../src/sourcing.js";
import assert from "node:assert";
import { test } from "node:test";

test("ownerclan adapter: normalization", () => {
  const rawItem = {
    key: "W12345",
    name: " Test Product ",
    price: 10000,
    shippingFee: 2500,
    imageUrl: "http://example.com/img.jpg",
    model: "MODEL-X"
  };
  const normalized = normalizeOwnerclanItem(rawItem);
  assert.strictEqual(normalized.id, "live-ownerclan-W12345");
  assert.strictEqual(normalized.name, "Test Product");
  assert.strictEqual(normalized.wholesalePrice, 10000);
  assert.strictEqual(normalized.shippingFee, 2500);
  assert.strictEqual(normalized.imageUrl, "https://example.com/img.jpg");
  assert.deepStrictEqual(normalized.tags, ["MODEL-X"]);
});

test("ownerclan adapter: search requires key", async () => {
  const env = {};
  const params = new URLSearchParams({ q: "test" });
  await assert.rejects(
    searchOwnerclan(env, params),
    { status: 503 }
  );
});

test("ownerclan adapter: mock successful search", async () => {
  const env = { OWNERCLAN_API_KEY: "mock-key" };
  const params = new URLSearchParams({ q: "test", page: "1" });
  const mockFetcher = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      data: {
        allItems: [
          { key: "W1", name: "Item 1", price: 5000 },
          { key: "W2", name: "Item 2", price: 6000 }
        ]
      }
    })
  });
  const result = await searchOwnerclan(env, params, mockFetcher);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.products.length, 2);
  assert.strictEqual(result.products[0].name, "Item 1");
});
