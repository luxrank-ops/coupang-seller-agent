import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../src/index.js";

const request = (path, init, env) =>
  worker.fetch(new Request("https://app.example" + path, init), env || {});
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const domeggookBody = (overrides = {}) =>
  JSON.stringify({
    domeggook: {
      header: {
        numberOfItems: 30000,
        currentPage: 1,
        itemsPerPage: "2",
        numberOfPages: 15000,
        sort: "se",
      },
      list: {
        item: [
          {
            no: "7385374",
            title: "주방수납장 틈새보관함 식탁정리함",
            price: "30200",
            unitQty: "1",
            thumb: "//cdn1.domeggook.com/a_img_330",
            deli: { who: "S", fee: "0", add: "false", fromOversea: "false" },
            market: { domeggook: "true", supply: "true" },
            ...overrides,
          },
          {
            no: "69187957",
            title: "데일리 파우치 미니 화장품 수납가방",
            price: "4410",
            unitQty: "22",
            thumb: "https://cdn1.domeggook.com/b_img_330",
            deli: { who: "P", fee: "3000", add: "true", fromOversea: "false" },
          },
        ],
      },
    },
  });

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("catalog lists sources, keyword presets and integration status without products or keys", async () => {
  const response = await request("/api/catalog", undefined, {
    DOMEGGOOK_API_KEY: "test-server-key",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const text = await response.text();
  assert.ok(!text.includes("test-server-key"));
  const data = JSON.parse(text);
  assert.equal(data.products, undefined);
  assert.ok(data.sources.length >= 7);
  assert.ok(data.keywords.some((keyword) => keyword.q === "수납"));
  assert.equal(data.integrations.domeggook, true);
  assert.equal(data.integrations.ownerclan, false);
  assert.equal(data.integrations.wing, false);
});

test("live search returns real upstream products with shipping and MOQ", async () => {
  const stub = stubFetch(
    async () => new Response(domeggookBody(), { status: 200 }),
  );
  try {
    const response = await request("/api/products?mode=live&q=수납", undefined, {
      DOMEGGOOK_API_KEY: "test-server-key",
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.source, "domeggook");
    assert.equal(data.products.length, 2);
    assert.equal(data.products[0].dataKind, "live");
    assert.equal(data.products[0].wholesalePrice, 30200);
    assert.equal(data.products[0].shippingFee, 0);
    assert.equal(data.products[0].minOrder, 1);
    assert.equal(data.products[1].shippingFee, 3000);
    assert.equal(data.products[1].minOrder, 22);
    assert.equal(data.total, 30000);
    assert.ok(!JSON.stringify(data).includes("test-server-key"));
  } finally {
    stub.restore();
  }
});

test("live search falls back to the second endpoint when the first is refused", async () => {
  const stub = stubFetch(async (url) => {
    if (url.includes("www.domeggook.com"))
      return new Response("blocked", { status: 403 });
    return new Response(domeggookBody(), { status: 200 });
  });
  try {
    const response = await request("/api/products?q=수납", undefined, {
      DOMEGGOOK_API_KEY: "key",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).products.length, 2);
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test("disconnected live search fails clearly instead of inventing sample data", async () => {
  const response = await request("/api/products?mode=live&q=수납");
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.ok(!data.products);
  assert.match(data.error, /API 키/);
});

test("upstream failure is reported with sanitized per-endpoint diagnostics", async () => {
  const stub = stubFetch(async () => {
    throw new TypeError("network connection lost");
  });
  try {
    const response = await request("/api/products?q=수납", undefined, {
      DOMEGGOOK_API_KEY: "secret-key",
    });
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.ok, false);
    assert.equal(data.upstream.length, 2);
    assert.ok(!JSON.stringify(data).includes("secret-key"));
    assert.match(data.upstream[0].errorName, /TypeError/);
  } finally {
    stub.restore();
  }
});

test("rejects unsupported methods, unknown APIs and invalid search parameters", async () => {
  assert.equal((await request("/api/catalog", { method: "POST" })).status, 405);
  assert.equal(
    (await request("/api/catalog", { method: "POST" })).headers.get("allow"),
    "GET",
  );
  assert.equal((await request("/api/unknown")).status, 404);
  const stub = stubFetch(
    async () => new Response(domeggookBody(), { status: 200 }),
  );
  try {
    for (const path of [
      "/api/products?mode=other",
      "/api/products?page=-1",
      "/api/products?pageSize=121",
      "/api/products?minPrice=-1",
      "/api/products?minPrice=5000&maxPrice=1000",
      "/api/products?q=" + "a".repeat(101),
      "/api/products?q=",
    ])
      assert.equal(
        (await request(path, undefined, { DOMEGGOOK_API_KEY: "key" })).status,
        400,
        path,
      );
  } finally {
    stub.restore();
  }
});

test("item detail exposes inventory, MOQ, options and category from the detail API", async () => {
  const stub = stubFetch(
    async () =>
      new Response(
        JSON.stringify({
          domeggook: {
            basis: {
              no: 7385374,
              status: "판매중",
              title: "주방수납장",
              keywords: { kw: ["수납", "주방"] },
            },
            price: { dome: "30200" },
            qty: { inventory: "14", domeMoq: "3", domeUnit: 1 },
            deli: {
              method: "택배",
              pay: "선결제",
              dome: { type: "고정배송비", fee: "3000" },
            },
            category: {
              current: { name: "수납장", code: "01_16_08_00_00" },
              parents: { elem: [{ name: "가구" }] },
            },
            selectOpt: JSON.stringify({
              set: [{ name: "색상", opts: ["화이트", "블랙"] }],
            }),
            seller: { id: "seller1", nick: "판매자", company: { name: "공급사" } },
            detail: { country: "국산", manufacturer: "제조사", model: "M-1" },
            return: { addr: { address1: "부산" }, deliAmt: 3500 },
            thumb: { original: "https://cdn1.domeggook.com/x.jpg" },
            desc: { license: { msg: "이미지 사용 허용" } },
          },
        }),
        { status: 200 },
      ),
  );
  try {
    const response = await request(
      "/api/item-detail?source=domeggook&no=7385374",
      undefined,
      { DOMEGGOOK_API_KEY: "key" },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.inventory, 14);
    assert.equal(data.moq, 3);
    assert.equal(data.category.code, "01_16_08_00_00");
    assert.deepEqual(data.options[0].values, ["화이트", "블랙"]);
    assert.equal(data.returnInfo.fee, 3500);
  } finally {
    stub.restore();
  }
});

test("idea discovery searches real keyword lists instead of sample products", async () => {
  const stub = stubFetch(
    async () => new Response(domeggookBody(), { status: 200 }),
  );
  try {
    const response = await request("/api/idea-products", undefined, {
      DOMEGGOOK_API_KEY: "key",
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, "live-idea");
    assert.ok(data.keywords.length >= 3);
    assert.equal(data.products.length, 2);
    assert.ok(
      data.products.every((product) => product.id.startsWith("live-domeggook-")),
    );
    assert.ok(stub.calls.length >= 3);
  } finally {
    stub.restore();
  }
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

test("WING registration reports missing configuration and missing required fields", async () => {
  const disabled = await request(
    "/api/register-product",
    post({ name: "상품", salePrice: 12900 }),
  );
  assert.equal(disabled.status, 503);

  const incomplete = await request(
    "/api/register-product",
    post({ name: "상품", salePrice: 12900 }),
    { WING_ACCESS_KEY: "a", WING_SECRET_KEY: "b" },
  );
  assert.equal(incomplete.status, 422);
  const data = await incomplete.json();
  assert.equal(data.ok, false);
  assert.ok(data.detail.problems.includes("노출카테고리 코드(displayCategoryCode)"));
  assert.equal(data.detail.code, "MISSING_FIELDS");
});

test("WING registration forwards the real Coupang answer and never fabricates success", async () => {
  const env = {
    WING_ACCESS_KEY: "access",
    WING_SECRET_KEY: "secret",
    WING_VENDOR_ID: "A01818224",
  };
  const body = {
    name: "주방수납장",
    salePrice: 45900,
    displayCategoryCode: "632113",
    notices: [{ categoryName: "기타 재화", detailName: "품명", content: "수납장" }],
    images: ["https://cdn1.domeggook.com/x.jpg"],
    description: "설명",
    sku: "7385374",
  };

  const rejected = stubFetch(
    async () =>
      new Response(
        JSON.stringify({ code: "ERROR", message: "Invalid signature." }),
        { status: 401 },
      ),
  );
  try {
    const response = await request("/api/register-product", post(body), env);
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.ok, false);
    assert.equal(data.status, 401);
    assert.equal(data.message, "Invalid signature.");
    assert.ok(data.payload.sellerProductName);
    assert.equal(data.payload.returnCharge, 10000);
    assert.equal(data.payload.outboundShippingPlaceCode, 25700124);
    assert.equal(data.payload.returnCenterCode, 1002747339);
    assert.ok(rejected.calls[0].url.includes("api-gateway.coupang.com"));
    assert.match(
      rejected.calls[0].init.headers.Authorization,
      /^CEA algorithm=HmacSHA256, access-key=access, signed-date=\d{6}T\d{6}Z, signature=[0-9a-f]{64}$/,
    );
  } finally {
    rejected.restore();
  }

  const accepted = stubFetch(
    async () =>
      new Response(JSON.stringify({ code: "SUCCESS", data: "1234567890" }), {
        status: 200,
      }),
  );
  try {
    const response = await request("/api/register-product", post(body), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.data.data, "1234567890");
  } finally {
    accepted.restore();
  }
});

test("WING status probe reports the real gateway answer", async () => {
  const stub = stubFetch(
    async () =>
      new Response(JSON.stringify({ code: "ERROR", message: "IP not allowed" }), {
        status: 403,
      }),
  );
  try {
    const response = await request("/api/wing/status", undefined, {
      WING_ACCESS_KEY: "access",
      WING_SECRET_KEY: "secret",
      WING_REGISTERED_IP: "54.186.5.104",
    });
    const data = await response.json();
    assert.equal(data.configured, true);
    assert.equal(data.reachable, false);
    assert.equal(data.status, 403);
    assert.equal(data.message, "IP not allowed");
    assert.equal(data.registeredIp, "54.186.5.104");
  } finally {
    stub.restore();
  }
});

test("non-API requests delegate to Workers static assets", async () => {
  const response = await request("/", undefined, {
    ASSETS: { fetch: () => new Response("static dashboard") },
  });
  assert.equal(await response.text(), "static dashboard");
  assert.equal((await request("/unknown")).status, 404);
});
