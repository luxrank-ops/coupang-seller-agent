import { normalizeMoney, safeExternalUrl } from "../public/lib/products.js";

export class SourcingError extends Error {
  constructor(message, status = 502, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function boundedInteger(value, fallback, max) {
  if (value === null || value === undefined || value === "")
    return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max)
    throw new SourcingError(`숫자 범위는 1~${max}입니다.`, 400);
  return Number(value);
}

/**
 * 도매꾹 Open API 문서가 지정한 기본 엔드포인트는 www.domeggook.com 이다.
 * (openapi.domeggook.com > 상품리스트 4.1, Endpoint: https://www.domeggook.com/ssl/api/)
 * Cloudflare 엣지에서 apex 호스트가 막히는 경우가 있어 두 주소를 순서대로 시도한다.
 */
export const DOMEGGOOK_ENDPOINTS = [
  "https://www.domeggook.com/ssl/api/",
  "https://domeggook.com/ssl/api/",
];

const UA = "CoupangSellerAgent/2.0 (+https://coupang-seller-agent.luxrank.workers.dev)";
const UPSTREAM_HEADERS = {
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "User-Agent": UA,
};
const MAX_BODY = 2_000_000;
const PAGE_SIZE = 40;

const num = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value) => (typeof value === "string" ? value.trim() : "");
const flag = (value) => value === true || value === "true" || value === "y";

function httpsUrl(value) {
  let url = String(value || "").trim();
  if (url.startsWith("//")) url = "https:" + url;
  if (url.startsWith("http://")) url = "https://" + url.slice(7);
  return safeExternalUrl(url);
}

/** 서버 오류 메시지에 업스트림 URL(=API 키 포함)이 새지 않도록 지운다. */
function sanitize(message) {
  return String(message || "")
    .replace(/https?:\/\/[^\s"']+/g, "[upstream]")
    .replace(/aid=[^&\s"']+/g, "aid=[redacted]")
    .slice(0, 160);
}

export function buildDomeggookListQuery(params, pageSize = PAGE_SIZE) {
  const query = {
    ver: "4.1",
    mode: "getItemList",
    market: "dome",
    om: "json",
    sz: String(pageSize),
    pg: String(boundedInteger(params.get("page"), 1, 500)),
  };
  const keyword = text(params.get("q")).slice(0, 100);
  const category = text(params.get("category"));
  if (keyword) query.kw = keyword;
  if (/^\d{2}(?:_\d{2}){4}$/.test(category)) query.ca = category;
  if (!keyword && !category && !text(params.get("seller")))
    throw new SourcingError("검색어를 1~100자로 입력해주세요.", 400);
  if (text(params.get("seller"))) query.id = text(params.get("seller")).slice(0, 40);
  // 검색어가 있으면 정확도순, 없으면 도매꾹 랭킹순이 API 기본값이다.
  query.so = keyword ? "se" : "rd";
  const minPrice = text(params.get("minPrice"));
  const maxPrice = text(params.get("maxPrice"));
  if (minPrice) query.mnp = String(normalizeMoney(minPrice));
  if (maxPrice) query.mxp = String(normalizeMoney(maxPrice));
  if (params.get("singleOrder") === "true") query.mnq = "1";
  if (params.get("freeShipping") === "true") query.who = "S";
  return query;
}

async function callDomeggook(env, query, fetcher, endpoint) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ ...query, aid: env.DOMEGGOOK_API_KEY }).toString();
  const started = Date.now();
  let response;
  try {
    response = await fetcher(url.toString(), {
      headers: UPSTREAM_HEADERS,
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
  } catch (error) {
    return {
      ok: false,
      endpoint,
      ms: Date.now() - started,
      errorName: sanitize(error?.name || "Error"),
      errorMessage: sanitize(error?.message || String(error)),
    };
  }
  let body = "";
  try {
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      endpoint,
      status: response.status,
      ms: Date.now() - started,
      errorName: "BodyError",
      errorMessage: sanitize(error?.message || String(error)),
    };
  }
  return {
    ok: response.ok,
    endpoint,
    status: response.status,
    ms: Date.now() - started,
    body: body.slice(0, MAX_BODY),
  };
}

function parseEnvelope(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { error: "도매꾹 응답이 JSON 형식이 아닙니다." };
  }
  if (data?.errors) {
    return {
      error:
        "도매꾹 API가 요청을 거부했습니다: " +
        sanitize(data.errors.dmessage || data.errors.message || data.errors.dcode),
      code: data.errors.dcode || data.errors.code,
    };
  }
  const root = data?.domeggook;
  if (!root) return { error: "도매꾹 응답 형식이 예상과 다릅니다." };
  if (root.header && root.header.code && !root.header.numberOfItems) {
    return {
      error:
        "도매꾹 API가 요청을 거부했습니다: " +
        sanitize(root.header.dmessage || root.header.message),
      code: root.header.dcode || root.header.code,
    };
  }
  return { root };
}

export function normalizeDomeggookItem(item) {
  if (
    !item ||
    !/^\d{1,20}$/.test(String(item.no)) ||
    typeof item.title !== "string" ||
    !item.title.trim()
  )
    return null;
  const price = num(item.price);
  const who = text(item.deli?.who);
  const fee = num(item.deli?.fee);
  const moq = num(item.unitQty);
  const tags = [];
  if (who === "S") tags.push("무료배송");
  if (flag(item.comOnly)) tags.push("사업자전용");
  if (flag(item.adultOnly)) tags.push("성인전용");
  if (flag(item.deli?.fromOversea)) tags.push("해외직배송");
  if (text(item.deli?.who) === "B") tags.push("착불");
  const seller = text(item.nick) || text(item.id);
  return {
    id: "live-domeggook-" + item.no,
    name: item.title.trim().slice(0, 160),
    sourceId: "domeggook",
    sourceName: "도매꾹",
    categoryId: "other",
    wholesalePrice: price !== null && price >= 0 ? Math.round(price) : null,
    // 목록 API의 배송비 부담 구분(S=무료)과 금액을 그대로 옮긴다.
    shippingFee:
      who === "S" ? 0 : fee !== null && fee >= 0 ? Math.round(fee) : null,
    minOrder: moq !== null && moq >= 1 ? Math.round(moq) : null,
    fulfillment: "wholesale",
    sku: String(item.no),
    url: "https://domeggook.com/" + item.no,
    imageUrl: httpsUrl(item.thumb),
    art: "box",
    tags,
    seller,
    description:
      "도매꾹 상품 " +
      item.no +
      (seller ? " · 판매자 " + seller : "") +
      ". 목록 API 값이며 재고·옵션별 공급가·최종 배송비는 상세 정보에서 확인하세요.",
    dataKind: "live",
    capturedAt: new Date().toISOString(),
  };
}

export async function searchDomeggook(env, params, fetcher = fetch) {
  if (!env.DOMEGGOOK_API_KEY)
    throw new SourcingError(
      "도매꾹 API 키가 서버에 설정되지 않았습니다.",
      503,
    );
  const pageSize = boundedInteger(params.get("pageSize"), PAGE_SIZE, 120);
  const query = buildDomeggookListQuery(params, pageSize);
  const attempts = [];
  let parsed = null;
  for (const endpoint of DOMEGGOOK_ENDPOINTS) {
    const result = await callDomeggook(env, query, fetcher, endpoint);
    if (!result.ok) {
      attempts.push({
        endpoint,
        status: result.status ?? null,
        errorName: result.errorName || "HTTPError",
        errorMessage: result.errorMessage || `HTTP ${result.status}`,
      });
      continue;
    }
    const envelope = parseEnvelope(result.body);
    if (envelope.error) {
      attempts.push({
        endpoint,
        status: result.status ?? null,
        errorName: "ApiError",
        errorMessage: envelope.error,
      });
      continue;
    }
    parsed = { root: envelope.root, endpoint, ms: result.ms };
    break;
  }
  if (!parsed) {
    throw new SourcingError(
      "도매꾹 API에서 상품을 받아오지 못했습니다. 잠시 후 다시 시도해주세요.",
      502,
      { upstream: attempts },
    );
  }

  const root = parsed.root;
  let items = root.list?.item;
  if (items === undefined || items === null) {
    // 명시적 빈 목록은 정상, 목록 자체가 없으면 성공으로 보지 않는다.
    if (
      root.list !== "" &&
      root.list !== null &&
      !(Array.isArray(root.list) && root.list.length === 0) &&
      !(
        root.list &&
        typeof root.list === "object" &&
        Object.keys(root.list).length === 0
      )
    )
      throw new SourcingError("도매꾹 응답 형식이 예상과 다릅니다.");
    items = [];
  }
  if (!Array.isArray(items)) items = [items];
  const products = items.map(normalizeDomeggookItem).filter(Boolean);
  if (items.length && !products.length)
    throw new SourcingError("도매꾹 상품 정보를 해석할 수 없습니다.");

  const page = Number(query.pg);
  const total = num(root.header?.numberOfItems);
  const numberOfPages = num(root.header?.numberOfPages);
  return {
    ok: true,
    mode: "live",
    source: "domeggook",
    sourceName: "도매꾹",
    products,
    page,
    pageSize,
    total,
    hasMore: numberOfPages ? page < Math.min(numberOfPages, 500) : items.length >= pageSize,
    note: "도매꾹 Open API 4.1 목록 조회 결과입니다. 목록 정보는 배송비 부담 구분과 금액까지 제공하지만, 옵션별 공급가·재고·MOQ는 상품 상세에서 최종 확인해야 합니다.",
    upstreamMs: parsed.ms,
  };
}

/** 상품 상세정보 4.6 (getItemView) — 재고·MOQ·배송비·카테고리·옵션까지 실제 값. */
export async function getDomeggookItem(env, itemNo, fetcher = fetch) {
  if (!env.DOMEGGOOK_API_KEY)
    throw new SourcingError("도매꾹 API 키가 서버에 설정되지 않았습니다.", 503);
  if (!/^\d{1,20}$/.test(String(itemNo || "")))
    throw new SourcingError("상품번호가 올바르지 않습니다.", 400);
  const query = {
    ver: "4.6",
    mode: "getItemView",
    market: "dome",
    om: "json",
    no: String(itemNo),
  };
  const attempts = [];
  let data = null;
  for (const endpoint of DOMEGGOOK_ENDPOINTS) {
    const result = await callDomeggook(env, query, fetcher, endpoint);
    if (!result.ok) {
      attempts.push({
        endpoint,
        status: result.status ?? null,
        errorName: result.errorName || "HTTPError",
        errorMessage: result.errorMessage || `HTTP ${result.status}`,
      });
      continue;
    }
    const envelope = parseEnvelope(result.body);
    if (envelope.error) {
      attempts.push({
        endpoint,
        status: result.status ?? null,
        errorName: "ApiError",
        errorMessage: envelope.error,
      });
      continue;
    }
    data = envelope.root;
    break;
  }
  if (!data)
    throw new SourcingError(
      "도매꾹 상품 상세를 불러오지 못했습니다.",
      502,
      { upstream: attempts },
    );

  const basis = data.basis || {};
  const deli = data.deli || {};
  const qty = data.qty || {};
  const category = data.category || {};
  const options = (() => {
    try {
      const parsed = JSON.parse(data.selectOpt || "");
      const set = Array.isArray(parsed?.set) ? parsed.set : [];
      return set
        .map((entry) => ({
          name: text(entry?.name),
          values: Array.isArray(entry?.opts) ? entry.opts.map(text).filter(Boolean) : [],
        }))
        .filter((entry) => entry.values.length);
    } catch {
      return [];
    }
  })();
  const keywords = Array.isArray(basis.keywords?.kw)
    ? basis.keywords.kw.map(text).filter(Boolean).slice(0, 20)
    : [];
  const fee = num(deli.dome?.fee);
  const feeTable = text(deli.dome?.tbl);
  const tableFirst = feeTable
    ? num(feeTable.split("|")[0]?.split("+")[1] ?? "")
    : null;
  return {
    ok: true,
    source: "domeggook",
    no: String(basis.no || itemNo),
    title: text(basis.title),
    status: text(basis.status),
    price: num(data.price?.dome),
    supplyPrice: num(data.price?.supply),
    inventory: num(qty.inventory),
    moq: num(qty.domeMoq),
    unit: num(qty.domeUnit),
    category: {
      name: text(category.current?.name),
      code: text(category.current?.code),
      parents: Array.isArray(category.parents?.elem)
        ? category.parents.elem.map((entry) => text(entry?.name)).filter(Boolean)
        : [],
    },
    keywords,
    options,
    delivery: {
      method: text(deli.method),
      pay: text(deli.pay),
      fee: fee !== null ? fee : tableFirst,
      feeTable,
      sendAverage: text(deli.sendAvg),
      fromOversea: flag(deli.fromOversea),
      jejuExtra: num(deli.feeExtra?.jeju),
      islandExtra: num(deli.feeExtra?.islands),
    },
    seller: {
      id: text(data.seller?.id),
      nick: text(data.seller?.nick),
      company: text(data.seller?.company?.name),
      score: text(data.seller?.score?.avg),
    },
    detail: {
      origin: text(data.detail?.country),
      manufacturer: text(data.detail?.manufacturer),
      model: text(data.detail?.model),
      weight: text(data.detail?.weight),
      size: text(data.detail?.size),
    },
    returnInfo: {
      address: [
        text(data.return?.addr?.address1),
        text(data.return?.addr?.address2),
      ]
        .filter(Boolean)
        .join(" "),
      fee: num(data.return?.deliAmt),
      feeDouble: flag(data.return?.deliAmtDouble),
    },
    image: httpsUrl(data.thumb?.original || data.thumb?.large),
    imageLicence: text(data.desc?.license?.msg),
    url: "https://domeggook.com/" + String(basis.no || itemNo),
    capturedAt: new Date().toISOString(),
  };
}

/** 통합 상태 점검용 — 각 엔드포인트에 실제로 1건 조회를 시도한다. */
export async function probeDomeggook(env, fetcher = fetch) {
  const query = { ver: "4.1", mode: "getItemList", market: "dome", om: "json", sz: "1", pg: "1", kw: "수납", so: "se" };
  const results = [];
  if (!env.DOMEGGOOK_API_KEY) {
    return { configured: false, endpoints: [] };
  }
  for (const endpoint of DOMEGGOOK_ENDPOINTS) {
    const result = await callDomeggook(env, query, fetcher, endpoint);
    if (!result.ok) {
      results.push({
        endpoint,
        ok: false,
        status: result.status ?? null,
        ms: result.ms,
        error: `${result.errorName}: ${result.errorMessage}`,
      });
      continue;
    }
    const envelope = parseEnvelope(result.body);
    results.push({
      endpoint,
      ok: !envelope.error,
      status: result.status,
      ms: result.ms,
      error: envelope.error || null,
      items: envelope.root
        ? (Array.isArray(envelope.root.list?.item)
            ? envelope.root.list.item.length
            : envelope.root.list?.item
              ? 1
              : 0)
        : 0,
    });
  }
  return { configured: true, endpoints: results };
}
