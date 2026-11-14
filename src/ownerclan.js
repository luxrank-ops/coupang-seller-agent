import { normalizeMoney, safeExternalUrl } from "../public/lib/products.js";
import { SourcingError, boundedInteger } from "./sourcing.js";

/**
 * 오너클랜 판매사 Open API (GraphQL + JWT).
 * 인증: POST https://auth.ownerclan.com/auth
 *   { service: "ownerclan", userType: "seller", username, password } → JWT (약 1개월)
 * 호출: POST https://api.ownerclan.com/v1/graphql, Authorization: Bearer <token>
 * 문서: https://www.ownerclan.com/llms-full.txt (기준일 2026-08-05)
 */
const AUTH_URL = "https://auth.ownerclan.com/auth";
const GRAPHQL_URL = "https://api.ownerclan.com/v1/graphql";
const UA = "CoupangSellerAgent/2.0 (+https://coupang-seller-agent.luxrank.workers.dev)";

// 아이솔레이트 메모리 캐시 — 토큰은 약 한 달 유효하다.
let tokenCache = { token: "", expiresAt: 0 };

export function ownerclanConfigured(env = {}) {
  return Boolean(
    (env.OWNERCLAN_USERNAME && env.OWNERCLAN_PASSWORD) || env.OWNERCLAN_TOKEN,
  );
}

export async function getOwnerclanToken(env, fetcher = fetch) {
  if (env.OWNERCLAN_TOKEN) return env.OWNERCLAN_TOKEN;
  if (!ownerclanConfigured(env))
    throw new SourcingError(
      "오너클랜 판매사 API 인증 정보(아이디·비밀번호)가 서버에 없습니다.",
      503,
    );
  if (tokenCache.token && tokenCache.expiresAt > Date.now())
    return tokenCache.token;
  let response;
  try {
    response = await fetcher(AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        service: "ownerclan",
        userType: "seller",
        username: env.OWNERCLAN_USERNAME,
        password: env.OWNERCLAN_PASSWORD,
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new SourcingError("오너클랜 인증 서버에 연결하지 못했습니다.", 502);
  }
  const text = (await response.text()).slice(0, 20000);
  if (!response.ok)
    throw new SourcingError(
      "오너클랜 로그인에 실패했습니다(HTTP " +
        response.status +
        "). 판매사 아이디·비밀번호를 확인해주세요.",
      response.status === 401 || response.status === 400 ? 401 : 502,
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SourcingError("오너클랜 인증 응답을 해석할 수 없습니다.");
  }
  const token =
    (typeof data === "string" && data) ||
    data?.token ||
    data?.accessToken ||
    data?.jwt ||
    data?.data?.token ||
    "";
  if (!token || typeof token !== "string")
    throw new SourcingError("오너클랜 인증 응답에 토큰이 없습니다.");
  tokenCache = { token, expiresAt: Date.now() + 20 * 24 * 3600 * 1000 };
  return token;
}

const SEARCH_QUERY = `
  query SearchItems($search: String!, $first: Int!, $after: String, $minPrice: Int, $maxPrice: Int) {
    allItems(search: $search, first: $first, after: $after, minPrice: $minPrice, maxPrice: $maxPrice) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          key
          name
          model
          price
          fixedPrice
          shippingFee
          status
          category { key name fullName }
          images(size: large)
          options { price quantity optionAttributes { name value } }
        }
      }
    }
  }
`;

export async function searchOwnerclan(env, params, fetcher = fetch) {
  const token = await getOwnerclanToken(env, fetcher);
  const query = (params.get("q") || "").trim();
  if (!query || query.length > 100)
    throw new SourcingError("검색어를 1~100자로 입력해주세요.", 400);
  const pageSize = boundedInteger(params.get("pageSize"), 24, 100);
  const after = (params.get("cursor") || "").trim() || null;
  const minPrice = params.get("minPrice");
  const maxPrice = params.get("maxPrice");
  const variables = {
    search: query,
    first: pageSize,
    after,
    minPrice: minPrice ? Number(normalizeMoney(minPrice)) : null,
    maxPrice: maxPrice ? Number(normalizeMoney(maxPrice)) : null,
  };

  let response;
  try {
    response = await fetcher(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token,
        "User-Agent": UA,
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SourcingError("오너클랜 API에 연결하지 못했습니다.", 502);
  }
  const text = (await response.text()).slice(0, 1_000_000);
  if (response.status === 401) {
    tokenCache = { token: "", expiresAt: 0 };
    throw new SourcingError(
      "오너클랜 토큰이 만료되었거나 거부되었습니다. 다시 시도해주세요.",
      401,
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SourcingError("오너클랜 응답을 해석할 수 없습니다.");
  }
  if (Array.isArray(data?.errors) && data.errors.length)
    throw new SourcingError(
      "오너클랜 API 오류: " +
        String(data.errors[0]?.message || "알 수 없는 오류").slice(0, 160),
    );
  const block = data?.data?.allItems;
  const edges = Array.isArray(block?.edges) ? block.edges : null;
  if (!edges) throw new SourcingError("오너클랜 응답 형식이 예상과 다릅니다.");

  const products = edges
    .map((edge) => normalizeOwnerclanItem(edge?.node))
    .filter(Boolean);
  return {
    ok: true,
    mode: "live",
    source: "ownerclan",
    sourceName: "오너클랜",
    products,
    page: 1,
    pageSize,
    hasMore: Boolean(block?.pageInfo?.hasNextPage),
    nextCursor: block?.pageInfo?.endCursor || null,
    note: "오너클랜 GraphQL API 조회 결과입니다. 옵션별 공급가·재고·배송비는 상품 옵션 정보를 확인하세요.",
  };
}

function httpsUrl(value) {
  let url = String(value || "").trim();
  if (url.startsWith("//")) url = "https:" + url;
  if (url.startsWith("http://")) url = "https://" + url.slice(7);
  return safeExternalUrl(url);
}

export function normalizeOwnerclanItem(item) {
  if (!item || !item.key || typeof item.name !== "string" || !item.name.trim())
    return null;
  let wholesalePrice = null;
  try {
    wholesalePrice = normalizeMoney(item.price);
  } catch {
    /* 알 수 없는 가격을 0으로 만들지 않는다. */
  }
  const options = (Array.isArray(item.options) ? item.options : [])
    .map((option) => ({
      price: Number(option?.price) || null,
      quantity: Number(option?.quantity) ?? null,
      attributes: (Array.isArray(option?.optionAttributes)
        ? option.optionAttributes
        : []
      )
        .map((attribute) =>
          [attribute?.name, attribute?.value].filter(Boolean).join(":"),
        )
        .filter(Boolean),
    }))
    .filter((option) => option.attributes.length);
  const stock = (Array.isArray(item.options) ? item.options : []).reduce(
    (sum, option) => sum + (Number(option?.quantity) || 0),
    0,
  );
  const images = Array.isArray(item.images)
    ? item.images.filter((url) => typeof url === "string")
    : [];
  return {
    id: "live-ownerclan-" + item.key,
    name: item.name.trim().slice(0, 160),
    sourceId: "ownerclan",
    sourceName: "오너클랜",
    categoryId: "other",
    wholesalePrice,
    shippingFee: typeof item.shippingFee === "number" ? item.shippingFee : null,
    minOrder: 1,
    fulfillment: "consignment",
    sku: String(item.key),
    url: "https://www.ownerclan.com/V2/product/itView.php?it_id=" + item.key,
    imageUrl: httpsUrl(images[0] || ""),
    art: "box",
    tags: [
      item.category?.name,
      stock > 0 ? "재고 " + stock : null,
    ].filter(Boolean),
    stock: stock || null,
    options,
    categoryName: item.category?.fullName || item.category?.name || "",
    description:
      "오너클랜 상품 " +
      item.key +
      (item.category?.fullName ? " · " + item.category.fullName : "") +
      ". 옵션별 공급가와 재고는 상품 옵션 정보를 확인하세요.",
    dataKind: "live",
    capturedAt: new Date().toISOString(),
  };
}

export async function probeOwnerclan(env, fetcher = fetch) {
  if (!ownerclanConfigured(env))
    return {
      configured: false,
      reachable: false,
      message: "오너클랜 판매사 아이디·비밀번호(또는 토큰) 미설정",
    };
  try {
    await getOwnerclanToken(env, fetcher);
    return { configured: true, reachable: true, message: "JWT 토큰 발급 성공" };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      message: String(error?.message || error).slice(0, 200),
    };
  }
}
