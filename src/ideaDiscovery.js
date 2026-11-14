import { SourcingError, searchDomeggook } from "./sourcing.js";

/**
 * 아이디어 상품 발굴 — 예시 데이터가 아니라 도매꾹 실시간 목록을
 * ‘아이디어성 키워드’로 실제 검색해 모아 보여준다.
 * 점수·등급 같은 추정 지표는 만들지 않고, 확인 가능한 사실(공급가·MOQ·배송비)만 쓴다.
 */
export const IDEA_QUERIES = [
  "접이식",
  "무타공",
  "원터치",
  "다용도",
  "압축",
  "틈새",
];

export async function searchIdeaProducts(env, params, fetcher = fetch) {
  const extra = (params.get("q") || "").trim().slice(0, 40);
  const keywords = [...new Set([extra, ...IDEA_QUERIES].filter(Boolean))].slice(
    0,
    6,
  );
  const perKeyword = 12;
  const searches = keywords.map((keyword) => {
    const searchParams = new URLSearchParams({
      q: keyword,
      pageSize: String(perKeyword),
      page: "1",
      singleOrder: "true",
      ...(params.get("minPrice") ? { minPrice: params.get("minPrice") } : {}),
      ...(params.get("maxPrice") ? { maxPrice: params.get("maxPrice") } : {}),
    });
    return searchDomeggook(env, searchParams, fetcher).catch(() => null);
  });
  const results = (await Promise.all(searches)).filter(Boolean);
  if (!results.length)
    throw new SourcingError(
      "도매꾹 실시간 검색에 실패해 아이디어 상품을 모으지 못했습니다.",
      502,
    );
  const merged = new Map();
  for (const result of results)
    for (const product of result.products)
      if (!merged.has(product.id)) merged.set(product.id, product);
  const products = [...merged.values()].sort((a, b) => {
    const freeA = a.shippingFee === 0 ? 1 : 0;
    const freeB = b.shippingFee === 0 ? 1 : 0;
    if (freeA !== freeB) return freeB - freeA;
    return (a.wholesalePrice ?? Infinity) - (b.wholesalePrice ?? Infinity);
  });
  return {
    ok: true,
    mode: "live-idea",
    keywords,
    products,
    total: products.length,
    note:
      "도매꾹에서 아이디어성 키워드(" +
      keywords.join(", ") +
      ")로 실제 조회한 결과입니다. 1개부터 주문 가능한 상품만 모았고, 무료배송·낮은 공급가 순으로 정렬했습니다.",
  };
}
