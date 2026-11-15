import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import worker from "../../src/index.js";

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, "../fixtures", name), "utf8");
const ownerclanHtml = fixture("ownerclan-home.html");
const onchannelHtml = fixture("onchannel-index.html");

const request = (path, init, env) =>
  worker.fetch(new Request("https://app.example" + path, init), env || {});

function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://www.ownerclan.com/"))
      return new Response(ownerclanHtml, { status: 200 });
    if (target.startsWith("https://www.onch3.co.kr/"))
      return new Response(onchannelHtml, { status: 200 });
    if (target.startsWith("https://www.domeggook.com/")) {
      const parsed = new URL(target);
      assert.equal(parsed.searchParams.get("so"), "ha");
      return new Response(
        JSON.stringify({
          domeggook: {
            header: { numberOfItems: 500, currentPage: 1, itemsPerPage: "2", numberOfPages: 250, sort: "ha" },
            list: {
              item: [
                {
                  no: "9638478",
                  title: (parsed.searchParams.get("kw") || "인기") + " 수납 파우치 세트",
                  price: "15000",
                  unitQty: "1",
                  thumb: "//cdn1.domeggook.com/a_330",
                  deli: { who: "P", fee: "3000", add: "false", fromOversea: "false" },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };
  return { restore: () => { globalThis.fetch = original; } };
}

test("GET /api/trending returns merged rankings", async () => {
  const stub = stubFetch();
  try {
    const response = await request(
      "/api/trending?source=all&limit=10",
      undefined,
      { DOMEGGOOK_API_KEY: "test" },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.ok(data.products.length > 0);
    assert.ok(data.products.length <= 10);
    assert.ok(data.sources.onchannel.basisDate);
    assert.equal(typeof data.baselineDays.ownerclan, "object");
  } finally {
    stub.restore();
  }
});

test("GET /api/trending rejects an inverted price range", async () => {
  const response = await request(
    "/api/trending?minPrice=9000&maxPrice=1000",
    undefined,
    { DOMEGGOOK_API_KEY: "test" },
  );
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /최소 가격/);
});

test("GET /api/trending/queue exposes the daily safe quota", async () => {
  const stub = stubFetch();
  try {
    const response = await request(
      "/api/trending/queue?limit=2&registeredToday=1",
      undefined,
      { DOMEGGOOK_API_KEY: "test" },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.dailyQuota, 3);
    assert.equal(data.remaining, 2);
    assert.ok(Array.isArray(data.candidates));
    assert.ok(data.candidates.length <= 2);
    assert.match(data.endpoint, /\/api\/trending\/queue$/);
  } finally {
    stub.restore();
  }
});

test("trending endpoints reject unsupported methods", async () => {
  assert.equal((await request("/api/trending", { method: "POST" })).status, 405);
  const queue = await request("/api/trending/queue", { method: "POST" });
  assert.equal(queue.status, 405);
  assert.equal(queue.headers.get("allow"), "GET");
});
