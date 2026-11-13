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
