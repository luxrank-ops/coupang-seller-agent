import { normalizeMoney, safeExternalUrl } from "../public/lib/products.js";

export class SourcingError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function boundedInteger(value, fallback, max) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max)
    throw new SourcingError(`숫자 범위는 1~${max}입니다.`, 400);
  return Number(value);
}

export function normalizeDomeggookItem(item) {
  if (
    !item ||
    !/^\d{1,20}$/.test(String(item.no)) ||
    typeof item.title !== "string" ||
    !item.title.trim()
  )
    return null;
  let wholesalePrice = null;
  try {
    wholesalePrice = normalizeMoney(item.price);
  } catch {
    /* Unknown prices must not become zero. */
  }
  // Legacy image URLs can be HTTP. Upgrade, but never proxy arbitrary URLs.
  let thumb = String(item.thumb || "");
  if (thumb.startsWith("//")) thumb = "https:" + thumb;
  if (thumb.startsWith("http://")) thumb = "https://" + thumb.slice(7);
  return {
    id: "live-domeggook-" + item.no,
    name: item.title.trim().slice(0, 160),
    sourceId: "domeggook",
    sourceName: "도매꾹",
    categoryId: "other",
    wholesalePrice,
    // List API fields do not establish final shipping, order units or stock.
    shippingFee: null,
    minOrder: null,
    fulfillment: "wholesale",
    sku: String(item.no),
    url: "https://domeggook.com/" + item.no,
    imageUrl: safeExternalUrl(thumb),
    art: "box",
    tags: [],
    description:
      "도매꾹 목록 API 조회 상품입니다. 옵션별 공급가·배송비·최소 주문 수량·판매 가능 여부는 상품 원문에서 최종 확인하세요.",
    dataKind: "live",
    capturedAt: new Date().toISOString(),
  };
}

export async function searchDomeggook(env, params, fetcher = fetch) {
  if (!env.DOMEGGOOK_API_KEY)
    throw new SourcingError(
      "도매꾹 API가 연결되지 않았습니다. 도매몰 검색 바로가기 또는 CSV 가져오기를 이용해주세요.",
      503,
    );
  const query = (params.get("q") || "").trim();
  if (!query || query.length > 100)
    throw new SourcingError("검색어를 1~100자로 입력해주세요.", 400);
  const page = boundedInteger(params.get("page"), 1, 50);
  const pageSize = 24;
  const url = new URL("https://domeggook.com/ssl/api/");
  url.search = new URLSearchParams({
    ver: "4.1",
    mode: "getItemList",
    aid: env.DOMEGGOOK_API_KEY,
    market: "dome",
    om: "json",
    kw: query,
    so: "da",
    sz: String(pageSize),
    pg: String(page),
  }).toString();
  let data;
  try {
    const response = await fetcher(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("upstream HTTP");
    const text = await response.text();
    if (text.length > 2000000) throw new Error("upstream size");
    data = JSON.parse(text);
  } catch {
    // No upstream URLs/errors in the response: they may contain the server key.
    throw new SourcingError(
      "도매꾹에 연결할 수 없습니다. 잠시 후 다시 시도하거나 도매몰에서 직접 검색해주세요.",
    );
  }
  const root = data?.domeggook;
  if (!root || root.error)
    throw new SourcingError(
      "도매꾹 API가 요청을 처리하지 못했습니다. 서버의 API 권한·사용 한도를 확인해주세요.",
    );
  let items = root.list?.item;
  if (items === undefined || items === null) {
    // An explicit empty list is valid; a missing list is not a successful search.
    if (
      root.list !== "" &&
      root.list !== null &&
      !(Array.isArray(root.list) && root.list.length === 0) &&
      !(
        root.list &&
        typeof root.list === "object" &&
        Object.keys(root.list).length === 0
      )
    ) {
      throw new SourcingError(
        "도매꾹 응답 형식이 예상과 다릅니다. 도매몰 검색 바로가기를 이용해주세요.",
      );
    }
    items = [];
  }
  if (!Array.isArray(items)) items = [items];
  const products = items.map(normalizeDomeggookItem).filter(Boolean);
  if (items.length && !products.length)
    throw new SourcingError(
      "도매꾹 상품 정보를 해석할 수 없습니다. 도매몰에서 직접 확인해주세요.",
    );
  return {
    ok: true,
    mode: "live",
    products,
    page,
    hasMore: items.length >= pageSize && page < 50,
    note: "API 조회 결과입니다. 배송비·MOQ·재고·판매 권한은 원문에서 확인해주세요. 필터는 불러온 상품에 적용됩니다.",
  };
}
