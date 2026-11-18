import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSafePrice,
  estimateProduct,
} from "../../public/lib/margin.js";

test("calculates per-unit selling price, fee and profit consistently", () => {
  assert.deepEqual(calculateSafePrice(4500, 2800), {
    salePrice: 12400,
    totalCost: 7300,
    wholesalePrice: 4500,
    wholesaleShipping: 2800,
    coupangFee: 1339,
    netProfit: 3761,
    marginRate: 30.3,
    isSafe: true,
  });
});

test("zero shipping, target margin and fee are not replaced by defaults", () => {
  assert.equal(calculateSafePrice(4500, 0, 0, 0).salePrice, 4500);
  assert.equal(calculateSafePrice(4500, 0, 0.3, 0).coupangFee, 0);
  assert.equal(calculateSafePrice(0, 0, 0, 0).marginRate, 0);
});

test("invalid and unknown costs do not produce fabricated estimates", () => {
  for (const args of [
    [null, 3000],
    ["", 3000],
    [4000, null],
    [4000, ""],
    [-1, 0],
    [Infinity, 0],
    ["abc", 0],
    [1e9, 0],
    [500, 0, -1],
    [500, 0, 0.9, 0.1],
    [500, 0, 0.1, -0.1],
  ])
    assert.throws(() => calculateSafePrice(...args));
  assert.equal(
    estimateProduct({ wholesalePrice: 1000, shippingFee: null }),
    null,
  );
});

test("역마진 판정: 쿠팡 최저가 -100원에서 남는 금액으로 적자를 가른다", async () => {
  const { assessResaleMargin, THIN_MARGIN_RATE } = await import(
    "../../public/lib/margin.js"
  );
  const base = { wholesalePrice: 15000, shippingFee: 3000 };
  // 12,900 - 100 = 12,800 판매, 수수료 1,382, 원가 18,000 → -6,582 (적자)
  const loss = assessResaleMargin({ ...base, marketPrice: 12900 });
  assert.equal(loss.salePrice, 12800);
  assert.equal(loss.coupangFee, 1382);
  assert.equal(loss.netProfit, -6582);
  assert.equal(loss.isLoss, true);
  assert.equal(loss.verdict, "loss");
  assert.equal(loss.marketPrice, 12900);

  // 순마진 0원 이하도 적자로 본다(팔아도 남는 게 없음). 11,300 - 100 = 11,200 판매, 수수료 1,210, 원가 10,000 → -10
  const breakEven = assessResaleMargin({
    wholesalePrice: 10000,
    shippingFee: 0,
    marketPrice: 11300,
  });
  assert.equal(breakEven.netProfit, -10);
  assert.equal(breakEven.isLoss, true);

  // 흑자
  const profit = assessResaleMargin({ ...base, marketPrice: 30000 });
  assert.equal(profit.salePrice, 29900);
  assert.equal(profit.netProfit, 8671);
  assert.equal(profit.isLoss, false);
  assert.equal(profit.verdict, "ok");

  // 얇은 마진(0 < 순마진 < 5%)
  const thin = assessResaleMargin({ ...base, marketPrice: 21100 });
  assert.ok(thin.netProfit > 0);
  assert.ok(thin.marginRate < THIN_MARGIN_RATE);
  assert.equal(thin.verdict, "thin");

  // 최저가·원가를 모르면 판정하지 않는다(추정 금지).
  assert.equal(assessResaleMargin({ ...base }), null);
  assert.equal(assessResaleMargin({ ...base, marketPrice: 0 }), null);
  assert.equal(assessResaleMargin({ wholesalePrice: null, shippingFee: 0, marketPrice: 10000 }), null);
  assert.equal(assessResaleMargin({ wholesalePrice: 1000, shippingFee: null, marketPrice: 10000 }), null);
});

test("저장된 쿠팡 최저가 목록은 정수·상한만 남긴다", async () => {
  const { normalizeMarketPrices } = await import("../../public/lib/margin.js");
  const cleaned = normalizeMarketPrices(
    JSON.stringify({ a: 12900, b: "9900", c: 0, d: -1, e: 1e9, f: 1.5, g: null }),
  );
  assert.deepEqual({ ...cleaned }, { a: 12900, b: 9900 });
  assert.deepEqual({ ...normalizeMarketPrices("not json") }, {});
  assert.deepEqual({ ...normalizeMarketPrices(null) }, {});
  assert.deepEqual({ ...normalizeMarketPrices([1, 2]) }, {});
});
