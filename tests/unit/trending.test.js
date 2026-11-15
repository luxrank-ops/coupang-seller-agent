import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRegistrationQueue,
  cleanText,
  collectTrending,
  interleaveBySource,
  parseOnchannelCards,
  parseOnchannelKeywords,
  parseOnchannelRank,
  parseOwnerclanKeywords,
  parseOwnerclanTop100,
  trendScore,
} from "../../src/trending.js";

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, "../fixtures", name), "utf8");

const ownerclanHtml = fixture("ownerclan-home.html");
const onchannelHtml = fixture("onchannel-index.html");

const domeggookBody = (topic) =>
  JSON.stringify({
    domeggook: {
      header: {
        numberOfItems: 1200,
        currentPage: 1,
        itemsPerPage: "2",
        numberOfPages: 600,
        sort: "ha",
      },
      list: {
        item: [
          {
            no: "9638478",
            title: topic + " 여행용 파우치 6종세트 수납가방",
            price: "8900",
            unitQty: "1",
            thumb: "//cdn1.domeggook.com/a_330",
            deli: { who: "S", fee: "0", add: "false", fromOversea: "false" },
          },
          {
            no: "63167724",
            title: topic + " 미니멀 스탠드 행거",
            price: "15200",
            unitQty: "2",
            thumb: "https://cdn1.domeggook.com/b_330",
            deli: { who: "P", fee: "3000", add: "true", fromOversea: "false" },
          },
        ],
      },
    },
  });

function stubFetch() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.startsWith("https://www.ownerclan.com/"))
      return new Response(ownerclanHtml, { status: 200 });
    if (target.startsWith("https://www.onch3.co.kr/"))
      return new Response(onchannelHtml, { status: 200 });
    if (target.startsWith("https://www.domeggook.com/")) {
      const parsed = new URL(target);
      return new Response(domeggookBody(parsed.searchParams.get("kw") || "인기"), {
        status: 200,
      });
    }
    return new Response("not found", { status: 404 });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      const hit = store.get(typeof request === "string" ? request : request.url);
      return hit ? new Response(hit, { headers: { "Content-Type": "application/json" } }) : undefined;
    },
    async put(request, response) {
      store.set(
        typeof request === "string" ? request : request.url,
        await response.text(),
      );
    },
  };
}

test("cleanText strips markup and entities", () => {
  assert.equal(cleanText(" <b>수납</b>&nbsp;정리 &amp; 가방 "), "수납 정리 & 가방");
});

test("parseOwnerclanTop100 reads rank, code, name and price", () => {
  const items = parseOwnerclanTop100(ownerclanHtml);
  assert.ok(items.length >= 3);
  assert.deepEqual(
    items.slice(0, 3).map((item) => [item.rank, item.sku, item.price]),
    [
      [1, "W00A056", 10000],
      [2, "W97FE49", 16660],
      [3, "W6F4E3E", 49380],
    ],
  );
  assert.match(items[0].name, /레지아/);
  assert.equal(
    items[0].url,
    "https://www.ownerclan.com/V2/product/view.php?selfcode=W00A056",
  );
  assert.match(items[0].imageUrl, /^https:\/\/cdn\.ownerclan\.com\//);
});

test("parseOwnerclanKeywords returns the home popular keywords", () => {
  const keywords = parseOwnerclanKeywords(ownerclanHtml);
  assert.ok(keywords.includes("크리스마스"));
  assert.ok(keywords.includes("핫팩"));
  assert.ok(keywords.length >= 5);
});

test("parseOnchannelRank reads the daily sales ranking with basis date", () => {
  const { basisDate, items } = parseOnchannelRank(onchannelHtml);
  assert.equal(basisDate, "26.11.15 기준");
  assert.equal(items.length, 10);
  assert.equal(items[0].rank, 1);
  assert.equal(items[0].num, "11729992");
  assert.match(items[0].name, /줄무늬양말/);
  assert.equal(
    items[0].url,
    "https://www.onch3.co.kr/dbcenter_renewal/detail.php?num=11729992",
  );
});

test("parseOnchannelKeywords and cards keep guest-only prices empty", () => {
  assert.ok(parseOnchannelKeywords(onchannelHtml).includes("크리스마스"));
  const cards = parseOnchannelCards(onchannelHtml);
  assert.ok(cards.length >= 1);
  assert.equal(cards[0].price, null);
  assert.match(cards[0].sku, /^CH\d+$/);
});

test("trendScore rewards higher rank, rising rank and new entry", () => {
  const top = trendScore({ rank: 1, rankDelta: 0, isNew: false, crossSource: false });
  const low = trendScore({ rank: 40, rankDelta: 0, isNew: false, crossSource: false });
  const rising = trendScore({ rank: 20, rankDelta: 12, isNew: false, crossSource: false });
  const flat = trendScore({ rank: 20, rankDelta: 0, isNew: false, crossSource: false });
  const fresh = trendScore({ rank: 20, rankDelta: null, isNew: true, crossSource: false });
  assert.ok(top > low);
  assert.ok(rising > flat);
  assert.ok(fresh > flat);
});

test("collectTrending merges ownerclan, onchannel and domeggook rankings", async () => {
  const stub = stubFetch();
  try {
    const result = await collectTrending(
      { DOMEGGOOK_API_KEY: "test" },
      new URLSearchParams({ source: "all", limit: "30" }),
      { fetcher: globalThis.fetch, origin: "https://app.example" },
    );
    assert.equal(result.ok, true);
    const bySource = (id) => result.products.filter((product) => product.sourceId === id);
    assert.ok(bySource("ownerclan").length >= 3);
    assert.ok(bySource("onchannel").length >= 10);
    assert.ok(bySource("domeggook").length >= 2);
    assert.equal(result.sources.ownerclan.ok, true);
    assert.equal(result.sources.onchannel.basisDate, "26.11.15 기준");
    assert.ok(result.topics.length >= 1);
    assert.ok(result.topics.length <= 4);

    const ownerclan = bySource("ownerclan")[0];
    assert.equal(ownerclan.wholesalePrice, 10000);
    assert.equal(ownerclan.inStock, null);
    assert.equal(ownerclan.dataKind, "live");
    assert.ok(ownerclan.signals.some((signal) => signal.includes("오너클랜 100")));

    const domeggook = bySource("domeggook")[0];
    assert.equal(domeggook.inStock, true);
    assert.equal(domeggook.shippingFee, 0);
    assert.equal(domeggook.tags.includes("도매꾹 인기상품순"), true);

    const onchannel = bySource("onchannel").find((product) => product.rank === 1);
    assert.equal(onchannel.wholesalePrice, null);

    // 소싱처를 섞어 보여주되, 각 소싱처 안에서는 점수 내림차순을 유지한다.
    const groups = new Map();
    for (const product of result.products) {
      if (!groups.has(product.sourceId)) groups.set(product.sourceId, []);
      groups.get(product.sourceId).push(product.trendScore);
    }
    for (const scores of groups.values())
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.ok(groups.size >= 2);
    assert.ok(new Set(result.products.slice(0, 6).map((p) => p.sourceId)).size >= 2);
    assert.equal(result.baselineDays.ownerclan, null);
    assert.ok(result.notes.length >= 3);
  } finally {
    stub.restore();
  }
});

test("collectTrending stock=verified keeps only confirmed in-stock items", async () => {
  const stub = stubFetch();
  try {
    const result = await collectTrending(
      { DOMEGGOOK_API_KEY: "test" },
      new URLSearchParams({ source: "all", stock: "verified", limit: "30" }),
      { fetcher: globalThis.fetch, origin: "https://app.example" },
    );
    assert.ok(result.products.length > 0);
    assert.ok(result.products.every((product) => product.inStock === true));
    assert.ok(result.products.every((product) => product.sourceId === "domeggook"));
  } finally {
    stub.restore();
  }
});

test("collectTrending rejects inverted price range", async () => {
  await assert.rejects(
    collectTrending(
      {},
      new URLSearchParams({ minPrice: "9000", maxPrice: "1000" }),
      { fetcher: async () => new Response("", { status: 500 }) },
    ),
    (error) => error.status === 400,
  );
});

test("collectTrending reports rank changes against the previous snapshot", async () => {
  const stub = stubFetch();
  const cache = memoryCache();
  globalThis.caches = { default: cache };
  try {
    // 어제 순위: 오너클랜 1위였던 상품이 오늘 2위, 3위 상품은 어제 없음(신규)
    await cache.put(
      new Request(
        "https://app.example/api/_trend-snapshot/" +
          encodeURIComponent("ownerclan:100") +
          "/" +
          new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10),
      ),
      new Response(JSON.stringify({ day: "yesterday", ranks: { W97FE49: 1, W00A056: 2 } })),
    );
    const result = await collectTrending(
      { DOMEGGOOK_API_KEY: "test" },
      new URLSearchParams({ source: "ownerclan", limit: "10" }),
      { fetcher: globalThis.fetch, origin: "https://app.example" },
    );
    const first = result.products.find((product) => product.sku === "W00A056");
    const third = result.products.find((product) => product.sku === "W6F4E3E");
    assert.equal(first.prevRank, 2);
    assert.equal(first.rankDelta, 1);
    assert.equal(third.prevRank, null);
    assert.equal(third.isNew, true);
    assert.equal(result.baselineDays.ownerclan, "yesterday");
    assert.ok(third.signals.includes("직전 집계 신규 진입"));
  } finally {
    delete globalThis.caches;
    stub.restore();
  }
});

test("interleaveBySource mixes sources without breaking per-source order", () => {
  const items = [
    { id: "d1", sourceId: "domeggook", trendScore: 90 },
    { id: "d2", sourceId: "domeggook", trendScore: 80 },
    { id: "o1", sourceId: "ownerclan", trendScore: 70 },
    { id: "c1", sourceId: "onchannel", trendScore: 60 },
  ];
  const mixed = interleaveBySource(items, 4).map((item) => item.id);
  assert.equal(mixed.length, 4);
  assert.deepEqual(mixed, ["d1", "o1", "c1", "d2"]);
});

test("buildRegistrationQueue grades candidates and enforces the daily quota", () => {
  const products = [
    {
      id: "a",
      name: "접이식 수납 박스 3단",
      sourceId: "domeggook",
      sourceName: "도매꾹",
      sku: "1",
      wholesalePrice: 15000,
      shippingFee: 3000,
      minOrder: 1,
      inStock: true,
      rank: 1,
      rankScope: "도매꾹 인기상품순",
    },
    {
      id: "b",
      name: "나이키 에어맥스 스니커즈",
      sourceId: "domeggook",
      sourceName: "도매꾹",
      sku: "2",
      wholesalePrice: 45000,
      shippingFee: 0,
      minOrder: 1,
      inStock: true,
      rank: 2,
    },
    {
      id: "c",
      name: "레지아 V넥바람막이 7종",
      sourceId: "ownerclan",
      sourceName: "오너클랜",
      sku: "W00A056",
      wholesalePrice: 10000,
      shippingFee: null,
      minOrder: 1,
      inStock: null,
      rank: 1,
    },
  ];
  const queue = buildRegistrationQueue(products, { limit: "3", registeredToday: "1" });
  assert.equal(queue.dailyQuota, 3);
  assert.equal(queue.remaining, 2);
  assert.equal(queue.candidates.length, 3);
  const byId = (id) => queue.candidates.find((item) => item.id === id);
  assert.equal(byId("a").verdict, "ready");
  assert.equal(byId("b").verdict, "block");
  assert.equal(byId("c").verdict, "review");
  assert.ok(byId("a").estimate.netProfit >= 5000);
  assert.equal(byId("a").checks.find((check) => check.key === "lowest_price").pending, true);
  assert.ok(queue.rules.length >= 5);
  assert.equal(queue.candidates[0].id, "a");

  const capped = buildRegistrationQueue(products, { limit: "9", registeredToday: "0" });
  assert.ok(capped.candidates.length <= 5);
  assert.equal(capped.recommendedNow, 3);
});
