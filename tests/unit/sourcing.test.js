import test from "node:test";
import assert from "node:assert/strict";
import {
  searchDomeggook,
  normalizeDomeggookItem,
  buildDomeggookListQuery,
  getDomeggookItem,
  probeDomeggook,
} from "../../src/sourcing.js";

const env = { DOMEGGOOK_API_KEY: "test-private-key" };
const params = (query) => new URLSearchParams(query);

const listBody = (item) =>
  JSON.stringify({ domeggook: { header: { numberOfItems: 10, numberOfPages: 5 }, list: { item } } });

test("uses the documented www endpoint first with the server key and encoded query", async () => {
  const calls = [];
  const data = await searchDomeggook(env, params({ q: "수납 & 정리", page: "2" }), async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return new Response(
      listBody({
        no: "12345678",
        title: "실제 API 응답 상품",
        price: "3,500",
        thumb: "http://images.example.com/item.jpg",
        unitQty: "4",
        deli: { who: "P", fee: "2500", add: "true" },
      }),
    );
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://www.domeggook.com");
  assert.equal(calls[0].url.pathname, "/ssl/api/");
  assert.equal(calls[0].url.searchParams.get("kw"), "수납 & 정리");
  assert.equal(calls[0].url.searchParams.get("aid"), env.DOMEGGOOK_API_KEY);
  assert.equal(calls[0].url.searchParams.get("pg"), "2");
  assert.equal(calls[0].url.searchParams.get("so"), "se");
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(data.products[0].dataKind, "live");
  assert.equal(data.products[0].wholesalePrice, 3500);
  assert.equal(data.products[0].shippingFee, 2500);
  assert.equal(data.products[0].minOrder, 4);
  assert.equal(data.products[0].imageUrl, "https://images.example.com/item.jpg");
  assert.equal(data.products[0].url, "https://domeggook.com/12345678");
  assert.equal(data.total, 10);
  assert.equal(data.hasMore, true);
  assert.ok(!JSON.stringify(data).includes(env.DOMEGGOOK_API_KEY));
});

test("falls back to the apex endpoint and reports sanitized failures", async () => {
  const calls = [];
  const data = await searchDomeggook(env, params({ q: "수납" }), async (url) => {
    calls.push(String(url));
    if (String(url).includes("www.")) throw new TypeError("network lost");
    return new Response(listBody({ no: "1", title: "상품", price: "1000" }));
  });
  assert.equal(calls.length, 2);
  assert.equal(data.products.length, 1);

  await assert.rejects(
    searchDomeggook(env, params({ q: "수납" }), async () => {
      throw new TypeError("offline");
    }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.extra.upstream.length, 2);
      assert.ok(!JSON.stringify(error.extra).includes(env.DOMEGGOOK_API_KEY));
      return true;
    },
  );
});

test("translates filters into documented request parameters", () => {
  const query = buildDomeggookListQuery(
    params({
      q: "캠핑",
      minPrice: "1000",
      maxPrice: "50000",
      singleOrder: "true",
      freeShipping: "true",
      page: "3",
    }),
    24,
  );
  assert.deepEqual(query, {
    ver: "4.1",
    mode: "getItemList",
    market: "dome",
    om: "json",
    sz: "24",
    pg: "3",
    kw: "캠핑",
    so: "se",
    mnp: "1000",
    mxp: "50000",
    mnq: "1",
    who: "S",
  });
  const category = buildDomeggookListQuery(params({ category: "01_16_08_00_00" }));
  assert.equal(category.ca, "01_16_08_00_00");
  assert.equal(category.so, "rd");
  assert.throws(() => buildDomeggookListQuery(params({})), /검색어/);
});

test("accepts explicit empty lists and never invents totals", async () => {
  for (const list of ["", null, {}, [], { item: [] }]) {
    const data = await searchDomeggook(
      env,
      params({ q: "상품" }),
      async () =>
        new Response(JSON.stringify({ domeggook: { header: {}, list } })),
    );
    assert.deepEqual(data.products, []);
    assert.equal(data.total, null);
  }
});

test("API-level refusal is surfaced instead of an empty success", async () => {
  await assert.rejects(
    searchDomeggook(
      env,
      params({ q: "상품" }),
      async () =>
        new Response(
          JSON.stringify({
            domeggook: {
              header: { code: "11", dcode: "NO_SEARCH_OPT", dmessage: "최소 한 가지 이상의 검색 조건" },
            },
          }),
        ),
    ),
    /검색 조건/,
  );
  await assert.rejects(
    searchDomeggook(
      env,
      params({ q: "상품" }),
      async () =>
        new Response(JSON.stringify({ errors: { dcode: "AUTH", dmessage: "키 오류" } })),
    ),
    /키 오류/,
  );
});

test("requires a configured key and a valid query", async () => {
  await assert.rejects(searchDomeggook({}, params({ q: "상품" })), { status: 503 });
  await assert.rejects(searchDomeggook(env, params({ q: "" })), { status: 400 });
  await assert.rejects(
    searchDomeggook(env, params({ q: "상품", pageSize: "500" })),
    { status: 400 },
  );
});

test("unknown prices stay null, free shipping becomes 0 and invalid rows are skipped", () => {
  const unknown = normalizeDomeggookItem({ no: "9", title: "가격 미상", price: "", deli: { who: "P", fee: "" } });
  assert.equal(unknown.wholesalePrice, null);
  assert.equal(unknown.shippingFee, null);
  const free = normalizeDomeggookItem({ no: "10", title: "무료배송", price: "1000", deli: { who: "S", fee: "0" } });
  assert.equal(free.shippingFee, 0);
  assert.ok(free.tags.includes("무료배송"));
  assert.equal(normalizeDomeggookItem({ no: "abc", title: "번호 오류" }), null);
  assert.equal(normalizeDomeggookItem({ no: "11", title: "  " }), null);
  assert.equal(normalizeDomeggookItem({ no: "12", title: "이미지", thumb: "javascript:alert(1)" }).imageUrl, "");
});

test("item detail maps inventory, options, category and return policy", async () => {
  const detail = await getDomeggookItem(env, "7385374", async () =>
    new Response(
      JSON.stringify({
        domeggook: {
          basis: { no: 7385374, status: "판매중", title: "수납장", keywords: { kw: ["수납"] } },
          price: { dome: "30200" },
          qty: { inventory: "14", domeMoq: "3" },
          deli: { method: "택배", pay: "선결제", dome: { type: "고정배송비", fee: "3000" } },
          category: { current: { name: "수납장", code: "01_16_08_00_00" } },
          selectOpt: JSON.stringify({ set: [{ name: "색상", opts: ["화이트"] }] }),
          return: { addr: { address1: "부산" }, deliAmt: 3500, deliAmtDouble: "true" },
          thumb: { original: "https://cdn1.domeggook.com/x.jpg" },
        },
      }),
    ),
  );
  assert.equal(detail.inventory, 14);
  assert.equal(detail.moq, 3);
  assert.equal(detail.delivery.fee, 3000);
  assert.equal(detail.category.name, "수납장");
  assert.deepEqual(detail.options, [{ name: "색상", values: ["화이트"] }]);
  assert.equal(detail.returnInfo.fee, 3500);
  assert.equal(detail.returnInfo.feeDouble, true);
  await assert.rejects(getDomeggookItem(env, "abc"), { status: 400 });
});

test("health probe reports each endpoint result", async () => {
  const probe = await probeDomeggook(env, async (url) =>
    String(url).includes("www.")
      ? new Response(listBody({ no: "1", title: "상품", price: "1" }))
      : new Response("blocked", { status: 403 }),
  );
  assert.equal(probe.configured, true);
  assert.equal(probe.endpoints[0].ok, true);
  assert.equal(probe.endpoints[1].ok, false);
  assert.equal(probe.endpoints[1].status, 403);
  assert.equal((await probeDomeggook({})).configured, false);
});
