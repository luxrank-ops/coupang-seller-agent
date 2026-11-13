import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  importCsv,
  makeCsv,
  exportProducts,
  CSV_TEMPLATE,
} from "../../public/lib/csv.js";
import { DEMO_PRODUCTS } from "../../src/catalog.js";

test("parses BOM, CRLF, commas, escaped quotes and multiline cells", () => {
  assert.deepEqual(
    parseCsv('\uFEFF상품명,설명\r\n"수납,함","첫 줄\n둘째 ""줄"""\r\n'),
    [
      ["상품명", "설명"],
      ["수납,함", '첫 줄\n둘째 "줄"'],
    ],
  );
});

test("supports Korean and English column names and validates individual rows", () => {
  const result = importCsv(
    "name,wholesale_price,shipping_fee,source,moq\n정상상품,3500,0,도매매,1\n오류상품,-1,3000,도매매,1\n미확인상품,2000,,,",
  );
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].shippingFee, 0);
  assert.equal(result.products[1].shippingFee, null);
  assert.equal(result.products[1].minOrder, null);
  assert.deepEqual(result.errors, [
    { row: 3, message: "금액은 0 이상의 숫자여야 합니다." },
  ]);
});

test("merges duplicate source and SKU by last row, reporting duplicates", () => {
  const result = importCsv(
    "상품명,도매가,소싱처,상품코드\n이름1,1000,도매꾹,A\n이름2,2000,도매꾹,A",
  );
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, "이름2");
  assert.equal(result.products[0].wholesalePrice, 2000);
  assert.equal(result.duplicates, 1);
});

test("refuses malformed files and duplicate headers instead of silently misaligning values", () => {
  for (const csv of [
    "",
    "상품명,도매가",
    "상품명,가격\n상품,100",
    "상품명,name,도매가\n상품,상품,100",
    '상품명,도매가\n"닫히지 않은,100',
    '상품명,도매가\n"상품"bad,100',
    '상품명,도매가\n부정"상품,100',
  ])
    assert.throws(() => importCsv(csv));
  const mismatch = importCsv("상품명,도매가\n정상,1000\n열개수오류,3,500");
  assert.equal(mismatch.products.length, 1);
  assert.equal(mismatch.errors[0].row, 3);
});

test("bounds total records and file bytes", () => {
  assert.throws(
    () => importCsv("상품명,도매가\n" + "상품,100\n".repeat(1001)),
    /1000/,
  );
  assert.throws(() => parseCsv("x".repeat(2 * 1024 * 1024 + 1)), /2MB/);
});

test("exports escaped UTF-8 CSV and neutralizes spreadsheet formulas", () => {
  const text = makeCsv([
    ["상품명", "설명"],
    ['=HYPERLINK("bad")', '새 줄\n쉼표,따옴표"'],
    [" \t+SUM(1)", "@bad"],
    ["-2", 2000],
  ]);
  const rows = parseCsv(text);
  assert.ok(text.startsWith("\uFEFF"));
  assert.equal(rows[1][0], '\'=HYPERLINK("bad")');
  assert.equal(rows[1][1], '새 줄\n쉼표,따옴표"');
  assert.ok(rows[2][0].startsWith("'"));
  assert.equal(rows[2][1], "'@bad");
  assert.equal(rows[3][0], "'-2");
  assert.equal(rows[3][1], "2000");
});

test("demo labels survive an export/import round trip; template imports", () => {
  const result = importCsv(exportProducts(DEMO_PRODUCTS.slice(0, 2)));
  assert.equal(result.products.length, 2);
  assert.equal(result.errors.length, 0);
  assert.ok(result.products.every((product) => product.dataKind === "demo"));
  assert.equal(importCsv(CSV_TEMPLATE).products.length, 1);
});

test("ignores prototype-like unknown column names and fulfillment values", () => {
  const result = importCsv(
    "상품명,도매가,constructor,__proto__,판매방식\n상품,1000,ignored,ignored,__proto__",
  );
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].fulfillment, "unknown");
  assert.equal(result.errors.length, 0);
});
