/** Per-unit estimate. Excludes VAT settlement, ads, returns and other expenses. */
export function calculateSafePrice(
  wholesalePrice,
  wholesaleShipping = 3000,
  targetMarginRate = 0.3,
  coupangFeeRate = 0.108,
) {
  const price = Number(wholesalePrice);
  const shipping = Number(wholesaleShipping);
  const targetMargin = Number(targetMarginRate);
  const feeRate = Number(coupangFeeRate);
  if (
    wholesalePrice === null ||
    wholesalePrice === "" ||
    wholesaleShipping === null ||
    wholesaleShipping === ""
  ) {
    throw new Error("공급가와 배송비를 확인해 입력해주세요.");
  }
  if (
    ![price, shipping, targetMargin, feeRate].every(Number.isFinite) ||
    price < 0 ||
    shipping < 0 ||
    price > 100000000 ||
    shipping > 100000000
  ) {
    throw new Error("공급가·배송비는 0~1억 원 사이의 숫자로 입력해주세요.");
  }
  if (targetMargin < 0 || feeRate < 0 || targetMargin + feeRate >= 1) {
    throw new Error(
      "마진율·수수료율은 0 이상이며 합계가 100% 미만이어야 합니다.",
    );
  }
  const totalCost = price + shipping;
  const salePrice =
    Math.ceil(totalCost / (1 - feeRate - targetMargin) / 100) * 100;
  const coupangFee = Math.round(salePrice * feeRate);
  const netProfit = salePrice - coupangFee - totalCost;
  const marginRate = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;
  return {
    salePrice,
    totalCost,
    wholesalePrice: price,
    wholesaleShipping: shipping,
    coupangFee,
    netProfit,
    marginRate: Number(marginRate.toFixed(1)),
    isSafe: marginRate >= targetMargin * 100,
  };
}

export function estimateProduct(product) {
  try {
    return calculateSafePrice(product.wholesalePrice, product.shippingFee);
  } catch {
    return null;
  }
}
