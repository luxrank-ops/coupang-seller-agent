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

/* ── 역마진(적자) 자동 판정 ────────────────────────────────────────────────
 * 쿠팡 최저가 경쟁에서는 "목표마진 30%" 가격을 부를 수 없다. 실제 판매가는
 * 쿠팡 동급 최저가에서 100원을 뺀 가격이므로, 그 가격에서 도매 원가·도매
 * 배송비·쿠팡 판매수수료를 빼고 남는 금액이 0원 이하면 팔수록 손해다.
 * 이 계산은 브라우저·Worker·테스트가 같은 함수를 쓴다.
 */

/** 쿠팡 판매수수료 기본값(카테고리 평균 약 10.8%). */
export const DEFAULT_COUPANG_FEE_RATE = 0.108;
/** 쿠팡 동급 최저가에서 내리는 금액(원). */
export const DEFAULT_PRICE_UNDERCUT = 100;
/** 순마진율이 이보다 얇으면 '마진 주의'(%)로 표시한다. */
export const THIN_MARGIN_RATE = 5;

const MAX_MONEY = 100000000;

/**
 * 쿠팡 동급 최저가 - 100원에 팔 때의 순마진을 계산한다.
 * 최저가를 모르면 null(판정 불가)을 돌려준다 — 추정값으로 채우지 않는다.
 * isLoss는 순마진 0원 이하(적자)이며, 이 경우 등록 후보에서 차단한다.
 */
export function assessResaleMargin(options = {}) {
  const {
    wholesalePrice,
    shippingFee,
    marketPrice,
    coupangFeeRate = DEFAULT_COUPANG_FEE_RATE,
    undercut = DEFAULT_PRICE_UNDERCUT,
  } = options || {};
  const blank = (value) =>
    value === null || value === undefined || String(value).trim() === "";
  // 배송비 0원은 유효한 값이고, 비어 있음(null)은 '미확인'이라 판정하지 않는다.
  if (blank(wholesalePrice) || blank(shippingFee) || blank(marketPrice))
    return null;
  const cost = Number(wholesalePrice);
  const shipping = Number(shippingFee);
  const lowest = Number(marketPrice);
  const feeRate = Number(coupangFeeRate);
  const step = Number(undercut);
  if (
    ![cost, shipping].every(Number.isFinite) ||
    cost < 0 ||
    shipping < 0 ||
    cost > MAX_MONEY ||
    shipping > MAX_MONEY
  )
    return null;
  if (!Number.isFinite(lowest) || lowest <= 0 || lowest > MAX_MONEY) return null;
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) return null;
  const undercutAmount =
    Number.isFinite(step) && step >= 0 ? Math.round(step) : DEFAULT_PRICE_UNDERCUT;
  const market = Math.round(lowest);
  const salePrice = Math.max(0, market - undercutAmount);
  const totalCost = cost + shipping;
  const coupangFee = Math.round(salePrice * feeRate);
  const netProfit = salePrice - coupangFee - totalCost;
  const marginRate =
    salePrice > 0 ? Number(((netProfit / salePrice) * 100).toFixed(1)) : -100;
  const isLoss = netProfit <= 0;
  return {
    marketPrice: market,
    salePrice,
    undercut: undercutAmount,
    coupangFeeRate: feeRate,
    coupangFee,
    totalCost,
    netProfit,
    marginRate,
    isLoss,
    verdict: isLoss ? "loss" : marginRate < THIN_MARGIN_RATE ? "thin" : "ok",
  };
}

/** 상품(공급가·배송비)과 확인한 쿠팡 최저가로 적자 여부를 판정한다. */
export function assessProductMargin(product, marketPrice, options = {}) {
  if (!product || typeof product !== "object") return null;
  return assessResaleMargin({
    wholesalePrice: product.wholesalePrice,
    shippingFee: product.shippingFee,
    marketPrice,
    ...options,
  });
}

/**
 * 화면에서 입력·전달받은 쿠팡 최저가 목록을 안전하게 정리한다.
 * 상품 id(또는 SKU) → 최저가(1~1억 원 정수)만 남긴다.
 */
export function normalizeMarketPrices(input, limit = 500) {
  const output = Object.create(null);
  let source = input;
  if (typeof source === "string") {
    if (!source.trim()) return output;
    try {
      source = JSON.parse(source);
    } catch {
      return output;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source))
    return output;
  let kept = 0;
  for (const [key, value] of Object.entries(source)) {
    if (kept >= limit) break;
    const id = String(key).trim().slice(0, 200);
    const price = Number(value);
    if (!id) continue;
    if (!Number.isSafeInteger(price) || price <= 0 || price > MAX_MONEY) continue;
    output[id] = price;
    kept += 1;
  }
  return output;
}

