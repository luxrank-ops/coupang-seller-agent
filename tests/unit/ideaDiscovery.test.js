import { searchIdeaProducts, isIdeaProduct } from "../../src/ideaDiscovery.js";
import assert from "node:assert";
import { test } from "node:test";

test("idea discovery: identifies innovative products", () => {
  const p1 = { name: "접이식 실리콘 드라잉 매트", description: "" };
  const p2 = { name: "일반 컵", description: "" };
  assert.strictEqual(isIdeaProduct(p1), true);
  assert.strictEqual(isIdeaProduct(p2), false);
});

test("idea discovery: searches idea products endpoint logic", () => {
  const params = new URLSearchParams({ page: "1", pageSize: "10" });
  const res = searchIdeaProducts(params);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.mode, "idea-discovery");
  assert.ok(res.products.length > 0);
  assert.ok(res.products[0].ideaScore >= 85);
});
