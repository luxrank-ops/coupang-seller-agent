import test from "node:test";
import assert from "node:assert/strict";
import { searchDomeggook, normalizeDomeggookItem } from "../../src/sourcing.js";
import { generateProductSeo } from "../../src/prompt.js";

const env = { DOMEGGOOK_API_KEY: "test-private-key" };
const params = (query) => new URLSearchParams(query);
const success = (body) => async () =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

test("uses fixed HTTPS upstream, server-side key, encoded query and conservative fields", async () => {
  let upstream, options;
  const data = await searchDomeggook(
    env,
    params({ q: "수납 & 정리", page: "2" }),
    async (url, init) => {
      upstream = new URL(url);
      options = init;
      return new Response(
        JSON.stringify({
          domeggook: {
            list: {
              item: {
                no: "12345678",
                title: "실제 API 응답 상품",
                price: "3,500",
                thumb: "http://images.example.com/item.jpg",
                unitQty: "100",
              },
            },
          },
        }),
      );
    },
  );
  assert.equal(upstream.origin, "https://domeggook.com");
  assert.equal(upstream.searchParams.get("kw"), "수납 & 정리");
  assert.equal(upstream.searchParams.get("aid"), env.DOMEGGOOK_API_KEY);
  assert.equal(upstream.searchParams.get("pg"), "2");
  assert.equal(options.redirect, "error");
  assert.equal(data.products[0].dataKind, "live");
  assert.equal(data.products[0].wholesalePrice, 3500);
  assert.equal(data.products[0].shippingFee, null);
  assert.equal(data.products[0].minOrder, null);
  assert.equal(
    data.products[0].imageUrl,
    "https://images.example.com/item.jpg",
  );
  assert.equal(data.products[0].url, "https://domeggook.com/12345678");
  assert.ok(!JSON.stringify(data).includes(env.DOMEGGOOK_API_KEY));
});

test("accepts explicit empty API lists and detects next pages without inventing totals", async () => {
  for (const list of ["", null, {}, [], { item: [] }]) {
    const data = await searchDomeggook(
      env,
      params({ q: "상품" }),
      success({ domeggook: { list } }),
    );
    assert.deepEqual(data.products, []);
    assert.equal(data.hasMore, false);
  }
  const items = Array.from({ length: 24 }, (_, i) => ({
    no: String(10000000 + i),
    title: "상품 " + i,
    price: 5000,
  }));
  assert.equal(
    (
      await searchDomeggook(
        env,
        params({ q: "상품" }),
        success({ domeggook: { list: { item: items } } }),
      )
    ).hasMore,
    true,
  );
  assert.equal(
    (
      await searchDomeggook(
        env,
        params({ q: "상품", page: "50" }),
        success({ domeggook: { list: { item: items } } }),
      )
    ).hasMore,
    false,
  );
});

test("fails on upstream errors/malformed shape without leaking secrets or returning demos", async () => {
  const fetchers = [
    async () => {
      throw new Error("https://secret?aid=" + env.DOMEGGOOK_API_KEY);
    },
    async () => new Response("bad", { status: 503 }),
    async () => new Response("invalid JSON"),
    success({ domeggook: { error: { msg: env.DOMEGGOOK_API_KEY } } }),
    success({ bad: true }),
    success({ domeggook: {} }),
    success({
      domeggook: { list: { item: [{ no: "invalid", title: "bad" }] } },
    }),
  ];
  for (const fetcher of fetchers)
    await assert.rejects(
      searchDomeggook(env, params({ q: "상품" }), fetcher),
      (error) =>
        error.status === 502 && !error.message.includes(env.DOMEGGOOK_API_KEY),
    );
});

test("requires configured key and valid query/page", async () => {
  await assert.rejects(
    searchDomeggook({}, params({ q: "상품" })),
    (error) => error.status === 503,
  );
  for (const query of [
    { q: "" },
    { q: "a".repeat(101) },
    { q: "상품", page: "0" },
    { q: "상품", page: "51" },
    { q: "상품", page: "1.1" },
  ])
    await assert.rejects(
      searchDomeggook(env, params(query)),
      (error) => error.status === 400,
    );
});

test("unknown prices remain null, unsafe images are dropped, invalid items are skipped", () => {
  assert.equal(
    normalizeDomeggookItem({
      no: "1",
      title: "상품",
      price: "문의",
      thumb: "javascript:alert(1)",
    }).wholesalePrice,
    null,
  );
  assert.equal(
    normalizeDomeggookItem({
      no: "1",
      title: "상품",
      price: "문의",
      thumb: "javascript:alert(1)",
    }).imageUrl,
    "",
  );
  assert.equal(normalizeDomeggookItem({ no: "bad", title: "상품" }), null);
});

test("configured AI responses are bounded and failures are not reported as success", async () => {
  const info = { name: "상품", description: "사양" },
    aiEnv = { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" };
  const generated = await generateProductSeo(
    info,
    aiEnv,
    success({
      choices: [
        {
          message: {
            content: JSON.stringify({
              productName: "등록 초안",
              searchTags: ["태그", 123],
              sellingPoints: ["설명"],
            }),
          },
        },
      ],
    }),
  );
  assert.equal(generated.mode, "ai");
  assert.deepEqual(generated.result.searchTags, ["태그"]);
  await assert.rejects(
    generateProductSeo(
      info,
      aiEnv,
      async () => new Response("error", { status: 500 }),
    ),
    /초안을 생성하지 못/,
  );
  await assert.rejects(
    generateProductSeo(info, aiEnv, success({})),
    /초안을 생성하지 못/,
  );
});
