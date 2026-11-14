/**
 * 쿠팡 WING Open API 클라이언트.
 *
 * 서명 방식(쿠팡 문서·공식 예제): message = signed-date + method + path + query(‘?’ 제외),
 * signature = HMAC-SHA256(secretKey, message)의 **16진수 문자열**(hexdigest).
 * Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…
 *
 * 주의: 쿠팡 Open API는 WING > 판매자정보 > 추가판매정보에 등록한 IP에서만 호출된다.
 * Cloudflare Worker의 송신 IP는 엣지마다 달라지므로, 등록된 IP와 일치하지 않으면
 * 쿠팡이 거부한다. 이 모듈은 그 사실을 감추지 않고 실제 응답을 그대로 돌려준다.
 */

const GATEWAY = "https://api-gateway.coupang.com";
const SELLER_PRODUCTS_PATH =
  "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
const MAX_BODY = 400_000;

export class WingError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function signedDate() {
  const iso = new Date().toISOString(); // 2026-11-14T02:30:00.000Z
  return (
    iso.slice(2, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    "T" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "Z"
  );
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function wingConfigured(env = {}) {
  return Boolean(
    env.WING_ACCESS_KEY &&
      env.WING_SECRET_KEY &&
      (env.WING_VENDOR_ID || "A01818224"),
  );
}

export async function callWing(
  env,
  { method = "GET", path, query = "", body, fetcher = fetch },
) {
  if (!wingConfigured(env))
    throw new WingError(
      "쿠팡 WING Open API 키가 서버에 설정되지 않았습니다.",
      503,
      { code: "NOT_CONFIGURED" },
    );
  const datetime = signedDate();
  const message = datetime + method + path + query;
  const signature = await hmacHex(env.WING_SECRET_KEY, message);
  const authorization =
    `CEA algorithm=HmacSHA256, access-key=${env.WING_ACCESS_KEY}, ` +
    `signed-date=${datetime}, signature=${signature}`;
  const url = GATEWAY + path + (query ? "?" + query : "");
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json",
        "X-EXTENDED-TIMEOUT": "90000",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
  } catch (error) {
    throw new WingError(
      "쿠팡 Open API에 연결하지 못했습니다.",
      502,
      { code: "NETWORK", message: String(error?.message || error).slice(0, 200) },
    );
  }
  const text = (await response.text()).slice(0, MAX_BODY);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: data ? null : text.slice(0, 600),
    message: data?.message || data?.errorMessage || null,
    code: data?.code || data?.errorCode || null,
  };
}

/** WING Open API가 이 서버에서 실제로 응답하는지 확인한다(상품 목록 조회 1건). */
export async function probeWing(env, fetcher = fetch) {
  if (!wingConfigured(env))
    return {
      configured: false,
      reachable: false,
      message: "WING_ACCESS_KEY/WING_SECRET_KEY 미설정",
    };
  const result = await callWing(env, {
    path: SELLER_PRODUCTS_PATH,
    query:
      "vendorId=" +
      encodeURIComponent(env.WING_VENDOR_ID || "A01818224") +
      "&status=APPROVING&maxPerPage=1",
    fetcher,
  });
  return {
    configured: true,
    reachable: result.ok,
    status: result.status,
    code: result.code,
    message: result.message || result.raw,
    vendorId: env.WING_VENDOR_ID || "A01818224",
  };
}

/** WING에 등록된 IP 안내 (관리 화면에 입력된 값 — 서버가 알 수 있는 정보는 아님). */
export function wingNotes(env = {}) {
  return {
    registeredIp: env.WING_REGISTERED_IP || null,
    outboundCode: env.WING_OUTBOUND_CODE || "25700124",
    returnCode: env.WING_RETURN_CODE || "1002747339",
    returnCharge: Number(env.WING_RETURN_CHARGE || 10000),
  };
}

const dateTime = (value) => {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds())
  );
};

/**
 * 쿠팡 상품 등록 페이로드(판매자 API 계약)를 만든다.
 * 쿠팡이 요구하는 displayCategoryCode·고시정보(notices)는 상품마다 사람이 골라야 하므로
 * 지정되지 않으면 등록을 보내지 않고 무엇이 비었는지 돌려준다.
 */
export function buildSellerProductPayload(env, input = {}) {
  const problems = [];
  const name = String(input.name || "").trim();
  if (!name) problems.push("상품명");
  const salePrice = Number(input.salePrice);
  if (!Number.isInteger(salePrice) || salePrice <= 0)
    problems.push("판매가");
  const originalPrice = Number(input.originalPrice || salePrice);
  const categoryCode = String(input.displayCategoryCode || "").trim();
  if (!/^\d{6,12}$/.test(categoryCode) && categoryCode !== "")
    problems.push("노출카테고리 코드 형식");
  if (!categoryCode) problems.push("노출카테고리 코드(displayCategoryCode)");
  const notices = Array.isArray(input.notices) ? input.notices : [];
  if (!notices.length) problems.push("상품 고시정보(notices)");
  const images = (Array.isArray(input.images) ? input.images : [])
    .map((url) => String(url || "").trim())
    .filter((url) => /^https:\/\//.test(url));
  if (!images.length) problems.push("대표이미지 URL(https)");
  const outboundCode = Number(
    input.outboundShippingPlaceCode || env.WING_OUTBOUND_CODE || 25700124,
  );
  const returnCode = Number(
    input.returnCenterCode || env.WING_RETURN_CODE || 1002747339,
  );
  const returnCharge = Number(
    input.returnCharge ?? env.WING_RETURN_CHARGE ?? 10000,
  );
  if (problems.length)
    return { ok: false, problems, payload: null };

  const payload = {
    sellerProductName: name.slice(0, 100),
    vendorId: env.WING_VENDOR_ID || "A01818224",
    saleStartedAt: dateTime(input.saleStartedAt || Date.now()),
    saleEndedAt: dateTime(input.saleEndedAt || "2099-01-01T00:00:00"),
    displayProductName: String(input.displayProductName || name).slice(0, 100),
    brand: String(input.brand || ""),
    generalProductName: String(input.generalProductName || name).slice(0, 100),
    productGroup: String(input.productGroup || ""),
    deliveryMethod: "SEQUENCIAL",
    deliveryCompanyCode: String(input.deliveryCompanyCode || "CJGLS"),
    deliveryChargeType: Number(input.deliveryCharge || 0) === 0 ? "FREE" : "NOT_FREE",
    deliveryCharge: Number(input.deliveryCharge || 0),
    freeShipOverAmount: 0,
    deliveryChargeOnReturn: returnCharge,
    remoteAreaDeliverable: "Y",
    unionDeliveryType: "UNION_DELIVERY",
    returnCenterCode: returnCode,
    returnChargeName: String(input.returnChargeName || "아모가 반품지"),
    companyContactNumber: String(input.companyContactNumber || "010-2846-8906"),
    returnZipCode: String(input.returnZipCode || ""),
    returnAddress: String(input.returnAddress || ""),
    returnAddressDetail: String(input.returnAddressDetail || ""),
    returnCharge,
    outboundShippingPlaceCode: outboundCode,
    vendorUserId: String(input.vendorUserId || env.WING_VENDOR_USER || "hakdory75"),
    requested: true,
    items: [
      {
        itemName: String(input.itemName || name).slice(0, 100),
        originalPrice,
        salePrice,
        maximumBuyCount: Number(input.maximumBuyCount || 100),
        maximumBuyForPerson: 0,
        maximumBuyForPersonPeriod: 1,
        outboundShippingTimeDay: Number(input.outboundShippingTimeDay || 2),
        unitCount: Number(input.unitCount || 1),
        adultOnly: "EVERYONE",
        taxType: "TAX",
        parallelImported: "NOT_PARALLEL_IMPORTED",
        overseasPurchased: "NOT_OVERSEAS_PURCHASED",
        pccNeeded: false,
        externalVendorSku: String(input.sku || "").slice(0, 100),
        images: images.slice(0, 10).map((vendorPath, index) => ({
          imageOrder: index,
          imageType: index === 0 ? "REPRESENTATION" : "DETAIL",
          vendorPath,
        })),
        notices: notices.slice(0, 10).map((notice) => ({
          noticeCategoryName: String(notice.categoryName || "기타 재화"),
          noticeCategoryDetailName: String(notice.detailName || "품명 및 모델명"),
          content: String(notice.content || "").slice(0, 500),
        })),
        attributes: (Array.isArray(input.attributes) ? input.attributes : [])
          .slice(0, 20)
          .map((attribute) => ({
            attributeTypeName: String(attribute.typeName || "").slice(0, 100),
            attributeValueName: String(attribute.valueName || "").slice(0, 100),
          })),
        contents: [
          {
            contentsType: "TEXT",
            contentDetails: [
              {
                content: String(input.description || name).slice(0, 20000),
                detailType: "TEXT",
              },
            ],
          },
        ],
      },
    ],
  };
  return { ok: true, problems: [], payload };
}

/**
 * 실제 등록 요청. 쿠팡이 거부하면 그 응답(코드·메시지·HTTP 상태)을 그대로 반환한다.
 * 성공/실패를 앱이 만들어내지 않는다.
 */
export async function registerSellerProduct(env, input, fetcher = fetch) {
  if (!wingConfigured(env))
    throw new WingError(
      "쿠팡 WING Open API 키가 서버에 설정되지 않았습니다.",
      503,
      { code: "NOT_CONFIGURED" },
    );
  const built = buildSellerProductPayload(env, input);
  if (!built.ok)
    throw new WingError(
      "쿠팡 상품 등록에 필요한 항목이 비어 있습니다: " + built.problems.join(", "),
      422,
      { code: "MISSING_FIELDS", problems: built.problems },
    );
  const result = await callWing(env, {
    method: "POST",
    path: SELLER_PRODUCTS_PATH,
    body: built.payload,
    fetcher,
  });
  return {
    ok: result.ok,
    status: result.status,
    code: result.code,
    message: result.message || result.raw,
    data: result.data,
    payload: built.payload,
    attemptedAt: new Date().toISOString(),
  };
}
