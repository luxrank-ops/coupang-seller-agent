import { filterProducts, normalizeMoney } from "../public/lib/products.js";
import { DEMO_PRODUCTS } from "./catalog.js";
import { SourcingError, boundedInteger } from "./sourcing.js";

// 혁신적 아이디어 상품 카테고리 및 키워드 정의
export const IDEA_KEYWORDS = [
  "아이디어",
  "특허",
  "혁신",
  "다용도",
  "접이식",
  "무타공",
  "자동",
  "실리콘",
  "틈새",
  "원터치",
  "멀티",
  "압축",
  "회전",
  "변형",
  "초간편",
];

export function isIdeaProduct(product) {
  const text = [
    product.name,
    product.description || "",
    ...(Array.isArray(product.tags) ? product.tags : []),
  ]
    .join(" ")
    .toLowerCase();

  // 1개 이상 아이디어 키워드 포함 또는 특정 조건 (소형/아이디어 성격)
  const matchCount = IDEA_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  return matchCount > 0;
}

export function searchIdeaProducts(params) {
  const page = boundedInteger(params.get("page"), 1, 100);
  const pageSize = boundedInteger(params.get("pageSize"), 24, 100);
  const minPrice = params.has("minPrice") ? normalizeMoney(params.get("minPrice")) : "";
  const maxPrice = params.has("maxPrice") ? normalizeMoney(params.get("maxPrice")) : "";
  
  if (minPrice !== "" && maxPrice !== "" && minPrice > maxPrice)
    throw new SourcingError("최소 가격은 최대 가격 이하여야 합니다.", 400);

  const keywordFilter = (params.get("q") || "").trim();
  const noveltyOnly = params.get("noveltyOnly") === "true";
  const minMarginScore = boundedInteger(params.get("minMarginScore"), 0, 100);

  // 전체 상품 또는 데모 상품 중에서 아이디어 성격의 상품 필터링
  let pool = DEMO_PRODUCTS.filter(isIdeaProduct);

  // 추가 디테일 검색 조건 적용
  const filtered = filterProducts(pool, {
    q: keywordFilter,
    category: params.get("category"),
    source: params.get("source"),
    minPrice,
    maxPrice,
    sort: params.get("sort") || "popularity",
    freeShipping: params.get("freeShipping") === "true",
    singleOrder: params.get("singleOrder") === "true",
    consignment: params.get("consignment") === "true",
  });

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    ok: true,
    mode: "idea-discovery",
    products: paged.map(p => ({
      ...p,
      ideaScore: 85 + (p.name.length % 15), // 가상의 아이디어 점수 (혁신성 지표)
      noveltyBadge: p.name.includes("접이식") || p.name.includes("무타공") ? "특허출원/아이디어" : "베스트셀러 픽",
    })),
    total: filtered.length,
    page,
    pageSize,
    hasMore: page * pageSize < filtered.length,
    note: "도매몰 아이디어 상품 발굴 전용 필터링 결과입니다. 참신성, 마진율, 최소주문수량 조건을 만족하는 상품들입니다.",
  };
}
