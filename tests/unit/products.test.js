import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_PRODUCTS } from "../fixtures/demo-products.js";
import {
  filterProducts,
  normalizeImportedProduct,
  safeExternalUrl,
  escapeHtml,
  isStoredProduct,
} from "../../public/lib/products.js";
import { sourceSearchUrl, SOURCES } from "../../public/lib/sources.js";

const imported = (overrides = {}) =>
  normalizeImportedProduct({
    name: "나의 수납함",
    wholesalePrice: "3,500원",
    source: "도매꾹",
    ...overrides,
  });

test("demonstration catalog is diverse and explicitly not verified supplier offers", () => {
  assert.equal(DEMO_PRODUCTS.length, 48);
  assert.equal(
    new Set(DEMO_PRODUCTS.map((product) => product.categoryId)).size,
    8,
  );
  assert.equal(new Set(DEMO_PRODUCTS.map((product) => product.id)).size, 48);
  assert.ok(
    DEMO_PRODUCTS.every(
      (product) =>
        isStoredProduct(product) &&
        product.dataKind === "demo" &&
        !product.url &&
        !product.imageUrl,
    ),
  );
});

test("searches multiple words across names, tags, categories, supplier and SKU", () => {
  assert.ok(filterProducts(DEMO_PRODUCTS, { q: "반려동물 산책" }).length >= 2);
  assert.ok(
    filterProducts(DEMO_PRODUCTS, { q: "도매꾹" }).every(
      (product) => product.sourceId === "domeggook",
    ),
  );
  assert.equal(
    filterProducts([imported({ sku: "SKU-ABC" })], { q: "sku-abc" }).length,
    1,
  );
  assert.equal(filterProducts(DEMO_PRODUCTS, { q: "해당상품없음" }).length, 0);
  assert.equal(filterProducts(DEMO_PRODUCTS, { q: "캠핑 소품" }).length, 4);
});

test("combines category, source, price, MOQ and shipping filters", () => {
  const filtered = filterProducts(DEMO_PRODUCTS, {
    category: "living",
    maxPrice: 5000,
    singleOrder: true,
    consignment: true,
  });
  assert.ok(filtered.length > 0);
  assert.ok(
    filtered.every(
      (product) =>
        product.categoryId === "living" &&
        product.wholesalePrice <= 5000 &&
        product.minOrder === 1 &&
        product.fulfillment === "consignment",
    ),
  );
  assert.ok(
    filterProducts(DEMO_PRODUCTS, { freeShipping: true }).every(
      (product) => product.shippingFee === 0,
    ),
  );
  assert.ok(
    filterProducts(DEMO_PRODUCTS, { source: "domeme" }).every(
      (product) => product.sourceId === "domeme",
    ),
  );
  assert.equal(filterProducts([imported()], { freeShipping: true }).length, 0);
  assert.equal(filterProducts([imported()], { singleOrder: true }).length, 0);
});

test("sorts without mutation and places unknown values last in either direction", () => {
  const original = DEMO_PRODUCTS.map((product) => product.id);
  const unknown = {
    ...DEMO_PRODUCTS[0],
    id: "unknown",
    wholesalePrice: null,
    shippingFee: null,
    minOrder: null,
  };
  for (const sort of ["price-asc", "price-desc", "profit", "moq"]) {
    assert.equal(
      filterProducts([unknown, ...DEMO_PRODUCTS], { sort }).at(-1).id,
      "unknown",
    );
  }
  assert.deepEqual(
    DEMO_PRODUCTS.map((product) => product.id),
    original,
  );
  const ascending = filterProducts(DEMO_PRODUCTS, { sort: "price-asc" });
  assert.ok(
    ascending.every(
      (product, i) =>
        !i || product.wholesalePrice >= ascending[i - 1].wholesalePrice,
    ),
  );
});

test("normalizes imports but preserves unknown commercial terms", () => {
  const product = imported();
  assert.equal(product.wholesalePrice, 3500);
  assert.equal(product.shippingFee, null);
  assert.equal(product.minOrder, null);
  assert.equal(product.fulfillment, "unknown");
  assert.equal(product.sourceId, "domeggook");
  assert.equal(product.dataKind, "imported");
  assert.ok(isStoredProduct(product));
  assert.equal(imported({ source: "내 공급사" }).sourceName, "내 공급사");
  assert.equal(imported({ source: "내 공급사" }).sourceId, "other");
});

test("SKU identity survives name/price changes and separates suppliers", () => {
  const first = imported({ sku: "abc" });
  assert.equal(
    first.id,
    imported({ sku: "abc", name: "새 이름", wholesalePrice: "9999" }).id,
  );
  assert.notEqual(first.id, imported({ sku: "abc", source: "다른 공급사" }).id);
});

test("rejects invalid quantities, unsafe URLs and negative/invalid prices", () => {
  for (const overrides of [
    { wholesalePrice: "-1" },
    { wholesalePrice: "NaN" },
    { wholesalePrice: "1e3" },
    { wholesalePrice: "1.5" },
    { wholesalePrice: "3,50" },
    { wholesalePrice: "1,,000" },
    { wholesalePrice: "" },
    { shippingFee: "별도문의" },
    { minOrder: 0 },
    { minOrder: 1.5 },
    { minOrder: "abc" },
    { url: "javascript:alert(1)" },
    { imageUrl: "data:image/svg+xml,hello" },
    { url: "https://user:pass@example.com/" },
  ])
    assert.throws(() => imported(overrides));
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/",
    "/relative",
    "data:text/html,hi",
    "https://user:pass@example.com/",
  ])
    assert.equal(safeExternalUrl(url), "");
  assert.equal(
    safeExternalUrl("https://example.com/a?b=1"),
    "https://example.com/a?b=1",
  );
  assert.equal(
    escapeHtml('<img src=x onerror="test">&'),
    "&lt;img src=x onerror=&quot;test&quot;&gt;&amp;",
  );
});

test("encodes search terms on fixed wholesale mall origins", () => {
  assert.equal(SOURCES.length, 7);
  for (const source of SOURCES) {
    const link = new URL(sourceSearchUrl(source, "수납 & test/상품"));
    assert.equal(link.protocol, "https:");
    assert.ok(link.href.includes(encodeURIComponent("수납 & test/상품")));
    assert.equal(sourceSearchUrl(source, ""), source.home);
  }
});

test("manual additions preserve provenance and confirmed zero shipping", () => {
  const product = imported({
    importMethod: "manual",
    shippingFee: "0",
    minOrder: "1",
  });
  assert.equal(product.importMethod, "manual");
  assert.equal(product.shippingFee, 0);
  assert.equal(product.minOrder, 1);
});
