import test from "node:test";
import assert from "node:assert/strict";
import {
  searchOwnerclan,
  normalizeOwnerclanItem,
  ownerclanConfigured,
  resetOwnerclanTokenCache,
} from "../../src/ownerclan.js";

test("ownerclan normalization keeps real option stock and category", () => {
  const normalized = normalizeOwnerclanItem({
    key: "W12345",
    name: " 테스트 상품 ",
    price: 10000,
    shippingFee: 2500,
    images: ["http://example.com/img.jpg"],
    category: { name: "주방", fullName: "생활/주방 > 주방" },
    options: [
      { price: 10000, quantity: 4, optionAttributes: [{ name: "색상", value: "화이트" }] },
      { price: 12000, quantity: 3, optionAttributes: [{ name: "색상", value: "블랙" }] },
    ],
  });
  assert.equal(normalized.id, "live-ownerclan-W12345");
  assert.equal(normalized.name, "테스트 상품");
  assert.equal(normalized.wholesalePrice, 10000);
  assert.equal(normalized.shippingFee, 2500);
  assert.equal(normalized.imageUrl, "https://example.com/img.jpg");
  assert.equal(normalized.fulfillment, "consignment");
  assert.equal(normalized.stock, 7);
  assert.deepEqual(normalized.options[0].attributes, ["색상:화이트"]);
  assert.ok(normalized.tags.includes("재고 7"));
  assert.equal(normalized.unknownField, undefined);
});

test("ownerclan configuration requires an account or token", async () => {
  assert.equal(ownerclanConfigured({}), false);
  assert.equal(ownerclanConfigured({ OWNERCLAN_TOKEN: "t" }), true);
  assert.equal(
    ownerclanConfigured({ OWNERCLAN_USERNAME: "u", OWNERCLAN_PASSWORD: "p" }),
    true,
  );
  await assert.rejects(
    searchOwnerclan({}, new URLSearchParams({ q: "test" })),
    { status: 503 },
  );
});

test("ownerclan accepts the plain-text JWT the auth endpoint returns", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("auth.ownerclan.com"))
      return new Response("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWtkb3J5NzUifQ.c2lnbmF0dXJl", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    return new Response(JSON.stringify({ data: { allItems: { edges: [], pageInfo: {} } } }), { status: 200 });
  };
  const result = await searchOwnerclan(
    { OWNERCLAN_USERNAME: "hakdory75", OWNERCLAN_PASSWORD: "pw" },
    new URLSearchParams({ q: "수납" }),
    fetcher,
  );
  assert.equal(result.ok, true);
  assert.equal(
    calls[1].init.headers.Authorization,
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWtkb3J5NzUifQ.c2lnbmF0dXJl",
  );
});

test("ownerclan authenticates then queries allItems with the bearer token", async () => {
  resetOwnerclanTokenCache();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("auth.ownerclan.com"))
      return new Response(JSON.stringify({ token: "jwt-token" }), { status: 200 });
    return new Response(
      JSON.stringify({
        data: {
          allItems: {
            pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
            edges: [
              { node: { key: "W1", name: "상품 1", price: 5000, shippingFee: 0 } },
              { node: { key: "W2", name: "상품 2", price: 6000, shippingFee: 3000 } },
            ],
          },
        },
      }),
      { status: 200 },
    );
  };
  const result = await searchOwnerclan(
    { OWNERCLAN_USERNAME: "hakdory75", OWNERCLAN_PASSWORD: "pw" },
    new URLSearchParams({ q: "수납", pageSize: "2" }),
    fetcher,
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "ownerclan");
  assert.equal(result.products.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "cursor-2");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    service: "ownerclan",
    userType: "seller",
    username: "hakdory75",
    password: "pw",
  });
  assert.equal(calls[1].init.headers.Authorization, "Bearer jwt-token");
  const variables = JSON.parse(calls[1].init.body).variables;
  assert.equal(variables.search, "수납");
  assert.equal(variables.first, 2);
});

test("ownerclan reports API errors and expired tokens instead of inventing products", async () => {
  resetOwnerclanTokenCache();
  const apiError = async (url) => {
    if (String(url).includes("auth.ownerclan.com"))
      return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(JSON.stringify({ errors: [{ message: "권한 없음" }] }), {
      status: 200,
    });
  };
  await assert.rejects(
    searchOwnerclan(
      { OWNERCLAN_USERNAME: "u", OWNERCLAN_PASSWORD: "p" },
      new URLSearchParams({ q: "수납" }),
      apiError,
    ),
    /오너클랜 API 오류: 권한 없음/,
  );

  const unauthorized = async (url) => {
    if (String(url).includes("auth.ownerclan.com"))
      return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response("no", { status: 401 });
  };
  await assert.rejects(
    searchOwnerclan(
      { OWNERCLAN_USERNAME: "u", OWNERCLAN_PASSWORD: "p" },
      new URLSearchParams({ q: "수납" }),
      unauthorized,
    ),
    { status: 401 },
  );
});
