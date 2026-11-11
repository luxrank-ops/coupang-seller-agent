/**
 * 쿠팡 위탁판매 역마진 방지 및 판매가 산출 모듈
 */

export function calculateCoupangPrice(
  wholesalePrice,
  wholesaleShipping = 3000,
  targetMarginRate = 0.30,
  coupangFeeRate = 0.108
) {
  const price = Number(wholesalePrice) || 0;
  const shipping = Number(wholesaleShipping) || 0;
  const targetMargin = Number(targetMarginRate) || 0.30;
  const feeRate = Number(coupangFeeRate) || 0.108;

  const totalCost = price + shipping;

  // 판매가 = 원가 / (1 - 쿠팡수수료율 - 목표순마진율)
  const divisor = 1.0 - feeRate - targetMargin;
  if (divisor <= 0) {
    throw new Error('수수료율과 목표 마진의 합이 100%를 초과할 수 없습니다.');
  }

  const rawRequiredPrice = totalCost / divisor;
  
  // 100원 단위 올림 (소비자 심리 및 쿠팡 노출 가격 최적화)
  const salePrice = Math.ceil(rawRequiredPrice / 100) * 100;

  // 실제 쿠팡 수수료 (VAT 10% 별도 반영 시 10.8% * 1.1 = 약 11.88%)
  const coupangFee = Math.round(salePrice * feeRate);
  const netProfit = salePrice - coupangFee - totalCost;
  const actualMarginRate = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;

  return {
    salePrice,
    totalCost,
    wholesalePrice: price,
    wholesaleShipping: shipping,
    coupangFee,
    netProfit,
    marginRate: Number(actualMarginRate.toFixed(1)),
    isSafe: actualMarginRate >= (targetMargin * 100)
  };
}
