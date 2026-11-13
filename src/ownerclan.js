import { normalizeMoney, safeExternalUrl } from "../public/lib/products.js";
import { SourcingError, boundedInteger } from "./sourcing.js";

export function normalizeOwnerclanItem(item) {
  if (
    !item ||
    !item.key ||
    typeof item.name !== "string" ||
    !item.name.trim()
  )
    return null;
  let wholesalePrice = null;
  try {
    wholesalePrice = normalizeMoney(item.price);
  } catch {
    /* Unknown prices must not become zero. */
  }
  let thumb = String(item.imageUrl || item.thumb || "");
  if (thumb.startsWith("//")) thumb = "https:" + thumb;
  if (thumb.startsWith("http://")) thumb = "https://" + thumb.slice(7);
  return {
    id: "live-ownerclan-" + item.key,
    name: item.name.trim().slice(0, 160),
    sourceId: "ownerclan",
    sourceName: "오너클랜",
    categoryId: "other",
    wholesalePrice,
    shippingFee: typeof item.shippingFee === "number" ? item.shippingFee : null,
    minOrder: 1,
    fulfillment: "wholesale",
    sku: String(item.key),
    url: item.url || "https://ownerclan.com/V2/product/itView.php?it_id=" + item.key,
    imageUrl: safeExternalUrl(thumb),
    art: "box",
    tags: item.model ? [item.model] : [],
    description:
      "오너클랜 GraphQL API 조회 상품입니다. 옵션별 공급가·배송비·최소 주문 수량은 상품 원문에서 최종 확인하세요.",
    dataKind: "live",
    capturedAt: new Date().toISOString(),
  };
}

export async function searchOwnerclan(env, params, fetcher = fetch) {
  if (!env.OWNERCLAN_API_KEY)
    throw new SourcingError(
      "오너클랜 API가 연결되지 않았습니다. API 키를 설정해주세요.",
      503,
    );
  const query = (params.get("q") || "").trim();
  if (!query || query.length > 100)
    throw new SourcingError("검색어를 1~100자로 입력해주세요.", 400);
  const page = boundedInteger(params.get("page"), 1, 50);
  const pageSize = 24;

  const graphqlQuery = `
    query SearchItems($search: String, $first: Int) {
      allItems(search: $search, first: $first) {
        key
        name
        model
        price
        shippingFee
        imageUrl
        url
      }
    }
  `;

  let data;
  try {
    const response = await fetcher("https://api.ownerclan.com/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${env.OWNERCLAN_API_KEY}`,
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: query, first: pageSize * page },
      }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("upstream HTTP");
    const text = await response.text();
    if (text.length > 2000000) throw new Error("upstream size");
    data = JSON.parse(text);
  } catch {
    throw new SourcingError(
      "오너클랜에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
    );
  }

  const items = data?.data?.allItems;
  if (!Array.isArray(items)) {
    throw new SourcingError("오너클랜 응답 형식이 예상과 다릅니다.");
  }

  const products = items
    .slice((page - 1) * pageSize, page * pageSize)
    .map(normalizeOwnerclanItem)
    .filter(Boolean);

  return {
    ok: true,
    mode: "live",
    products,
    page,
    hasMore: items.length >= page * pageSize,
    note: "오너클랜 API 조회 결과입니다.",
  };
}
