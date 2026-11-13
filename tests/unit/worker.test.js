import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../src/index.js";

const request = (path, init, env) =>
  worker.fetch(new Request("https://app.example" + path, init), env);
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("catalog exposes integration status but no credentials", async () => {
  const response = await request("/api/catalog", undefined, {
    DOMEGGOOK_API_KEY: "test-server-key",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const text = await response.text();
  assert.ok(!text.includes("test-server-key"));
  const data = JSON.parse(text);
  assert.equal(data.products.length, 48);
  assert.equal(data.sources.length, 7);
  assert.equal(data.integrations.domeggook, true);
  assert.equal(data.integrations.wing, false);
});

test("demo search combines filters and returns paginated, clearly labeled examples", async () => {
  const response = await request(
    "/api/products?q=수납&category=living&maxPrice=5000&pageSize=2",
  );
  const data = await response.json();
  assert.equal(data.mode, "demo");
  assert.ok(data.note.includes("예시"));
  assert.ok(data.total >= 2);
  assert.equal(data.products.length, 2);
  assert.ok(
    data.products.every(
      (product) =>
        product.categoryId === "living" && product.wholesalePrice <= 5000,
    ),
  );
  assert.equal((await (await request("/api/products?q=없음")).json()).total, 0);
  assert.ok(
    (await (await request("/api/products?freeShipping=false")).json()).total >
      (await (await request("/api/products?freeShipping=true")).json()).total,
  );
});

test("rejects unsupported methods, unknown APIs and invalid search parameters", async () => {
  assert.equal((await request("/api/catalog", { method: "POST" })).status, 405);
  assert.equal(
    (await request("/api/catalog", { method: "POST" })).headers.get("allow"),
    "GET",
  );
  assert.equal((await request("/api/unknown")).status, 404);
  for (const path of [
    "/api/products?mode=other",
    "/api/products?page=-1",
    "/api/products?pageSize=101",
    "/api/products?minPrice=-1",
    "/api/products?minPrice=5000&maxPrice=1000",
    "/api/products?q=" + "a".repeat(101),
  ])
    assert.equal((await request(path)).status, 400, path);
});

test("disconnected live search fails clearly rather than returning sample data", async () => {
  const response = await request("/api/products?mode=live&q=수납");
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.ok(!data.products);
});

test("template SEO preserves facts and never invents bundles or certifications", async () => {
  const response = await request(
    "/api/generate-seo",
    post({
      name: "투명 수납함",
      description: "<script>alert(1)</script>",
      category: "생활·수납",
    }),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mode, "template");
  assert.equal(data.result.productName, "투명 수납함");
  assert.ok(!data.result.productName.includes("1+1"));
  assert.ok(!data.result.detailHtml.includes("<script>"));
  assert.ok(data.note.includes("AI 미연결"));
});

test("SEO validates JSON, content type, size and product name", async () => {
  assert.equal(
    (await request("/api/generate-seo", { method: "POST", body: "{}" })).status,
    415,
  );
  assert.equal(
    (
      await request("/api/generate-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{oops",
      })
    ).status,
    400,
  );
  assert.equal((await request("/api/generate-seo", post([]))).status, 400);
  assert.equal(
    (await request("/api/generate-seo", post({ name: "" }))).status,
    400,
  );
  assert.equal(
    (await request("/api/generate-seo", post({ name: "a".repeat(161) })))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/generate-seo",
        post({ name: "상품", description: "a".repeat(17000) }),
      )
    ).status,
    413,
  );
});

test("WING registration cannot fabricate successful IDs, even when keys are supplied", async () => {
  const response = await request(
    "/api/register-product",
    post({ name: "상품", accessKey: "test-key" }),
  );
  assert.equal(response.status, 501);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.mode, "not_connected");
  assert.equal(data.productId, undefined);
});

test("non-API requests delegate to Workers static assets", async () => {
  const response = await request("/", undefined, {
    ASSETS: { fetch: () => new Response("static dashboard") },
  });
  assert.equal(await response.text(), "static dashboard");
  assert.equal((await request("/unknown")).status, 404);
});
