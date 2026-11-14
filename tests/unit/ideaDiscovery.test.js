import test from "node:test";
import assert from "node:assert/strict";
import { searchIdeaProducts, IDEA_QUERIES } from "../../src/ideaDiscovery.js";

const domeBody = (no, title, price, shipping) =>
  JSON.stringify({
    domeggook: {
      header: { numberOfItems: 100, numberOfPages: 10 },
      list: {
        item: {
          no,
          title,
          price,
          unitQty: "1",
          thumb: "https://cdn1.domeggook.com/x.jpg",
          deli: { who: shipping === 0 ? "S" : "P", fee: String(shipping) },
        },
      },
    },
  });

test("idea discovery searches real keywords and merges deduplicated live products", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    const keyword = new URL(String(url)).searchParams.get("kw");
    if (keyword === "접이식")
      return new Response(domeBody("1", "접이식 수납함", "3000", 3000));
    if (keyword === "무타공")
      return new Response(domeBody("2", "무타공 선반", "2000", 0));
    return new Response(domeBody("1", "접이식 수납함", "3000", 3000));
  };
  const result = await searchIdeaProducts(
    { DOMEGGOOK_API_KEY: "key" },
    new URLSearchParams(),
    fetcher,
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, "live-idea");
  assert.deepEqual(result.keywords.slice(0, IDEA_QUERIES.length), IDEA_QUERIES);
  assert.ok(calls.length >= 3);
  assert.equal(result.total, 2);
  // 무료배송 상품이 먼저 온다.
  assert.equal(result.products[0].id, "live-domeggook-2");
  assert.ok(result.note.includes("실제 조회"));
});

test("idea discovery fails loudly when every upstream search fails", async () => {
  await assert.rejects(
    searchIdeaProducts({ DOMEGGOOK_API_KEY: "key" }, new URLSearchParams(), async () => {
      throw new TypeError("offline");
    }),
    { status: 502 },
  );
});
