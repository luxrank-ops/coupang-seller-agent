#!/usr/bin/env node
/**
 * 쿠팡 WING 상품 등록 — 등록 IP에서 직접 실행하는 스크립트.
 *
 * 쿠팡 Open API는 WING > 판매자정보 > 추가판매정보에 등록한 IP에서만 호출됩니다.
 * Cloudflare Worker(=앱 서버)는 송신 IP가 매번 달라 등록 IP와 일치하지 않으므로,
 * 앱에서 내려받은 "등록 페이로드(JSON)"를 등록 IP 환경(사무실 PC 등)에서 이 스크립트로 전송합니다.
 *
 * 사용법
 *   WING_ACCESS_KEY=... WING_SECRET_KEY=... \
 *   node tools/wing-register.mjs 쿠팡등록_페이로드_상품.json
 *
 * 동작
 *   - payload.sellerProductName 이 있으면 그대로 등록 요청(POST seller-products)
 *   - 앱의 "등록 입력" 형식(name, salePrice, ...)이면 등록 페이로드로 변환 후 전송
 *   - 쿠팡의 응답(HTTP 상태·본문)을 그대로 출력하며, 성공/실패를 만들어내지 않습니다.
 */
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const GATEWAY = "https://api-gateway.coupang.com";
const PATH = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";

const ACCESS_KEY = process.env.WING_ACCESS_KEY;
const SECRET_KEY = process.env.WING_SECRET_KEY;
const VENDOR_ID = process.env.WING_VENDOR_ID || "A01818224";

function signedDate() {
  const iso = new Date().toISOString();
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

export function authorizationFor(method, path, query = "") {
  const datetime = signedDate();
  const message = datetime + method + path + query;
  const signature = createHmac("sha256", SECRET_KEY)
    .update(message)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

const pad = (n) => String(n).padStart(2, "0");
const dateTime = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 앱이 내려준 입력(name, salePrice, displayCategoryCode, notices, images …)을 등록 페이로드로 변환. */
export function buildPayload(input) {
  if (input.sellerProductName) return input;
  const name = String(input.name || "").trim();
  const salePrice = Number(input.salePrice);
  if (!name || !Number.isInteger(salePrice) || salePrice <= 0)
    throw new Error("name 과 salePrice(정수)가 필요합니다.");
  if (!input.displayCategoryCode)
    throw new Error("displayCategoryCode(노출카테고리 코드)가 필요합니다.");
  if (!Array.isArray(input.notices) || !input.notices.length)
    throw new Error("notices(상품 고시정보)가 필요합니다.");
  const images = (input.images || []).filter((url) => /^https:\/\//.test(url));
  if (!images.length) throw new Error("https 대표이미지 URL이 필요합니다.");
  return {
    sellerProductName: name.slice(0, 100),
    vendorId: VENDOR_ID,
    saleStartedAt: dateTime(Date.now()),
    saleEndedAt: dateTime("2099-01-01T00:00:00"),
    displayProductName: name.slice(0, 100),
    brand: "",
    generalProductName: name.slice(0, 100),
    productGroup: "",
    deliveryMethod: "SEQUENCIAL",
    deliveryCompanyCode: "CJGLS",
    deliveryChargeType: "FREE",
    deliveryCharge: 0,
    freeShipOverAmount: 0,
    deliveryChargeOnReturn: Number(input.returnCharge ?? 10000),
    remoteAreaDeliverable: "Y",
    unionDeliveryType: "UNION_DELIVERY",
    returnCenterCode: Number(process.env.WING_RETURN_CODE || 1002747339),
    returnChargeName: "아모가 반품지",
    companyContactNumber: "010-2846-8906",
    returnZipCode: "",
    returnAddress: "",
    returnAddressDetail: "",
    returnCharge: Number(input.returnCharge ?? 10000),
    outboundShippingPlaceCode: Number(
      process.env.WING_OUTBOUND_CODE || 25700124,
    ),
    vendorUserId: process.env.WING_VENDOR_USER || "hakdory75",
    requested: true,
    items: [
      {
        itemName: name.slice(0, 100),
        originalPrice: Number(input.originalPrice || salePrice),
        salePrice,
        maximumBuyCount: 100,
        maximumBuyForPerson: 0,
        maximumBuyForPersonPeriod: 1,
        outboundShippingTimeDay: 2,
        unitCount: 1,
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
        notices: input.notices.slice(0, 10).map((notice) => ({
          noticeCategoryName: notice.categoryName || "기타 재화",
          noticeCategoryDetailName: notice.detailName || "품명 및 모델명",
          content: String(notice.content || "").slice(0, 500),
        })),
        attributes: [],
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
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("사용법: WING_ACCESS_KEY=.. WING_SECRET_KEY=.. node tools/wing-register.mjs <payload.json>");
    process.exit(1);
  }
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error("WING_ACCESS_KEY / WING_SECRET_KEY 환경변수가 필요합니다.");
    process.exit(1);
  }
  const input = JSON.parse(await readFile(file, "utf8"));
  const payload = buildPayload(input);
  const response = await fetch(GATEWAY + PATH, {
    method: "POST",
    headers: {
      Authorization: authorizationFor("POST", PATH),
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json",
      "X-EXTENDED-TIMEOUT": "90000",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  console.log("HTTP", response.status);
  console.log(text);
  if (!response.ok) {
    if (response.status === 403 && text.includes("not allowed"))
      console.error(
        "\n→ 이 PC의 공인 IP가 WING OPEN API 등록 IP와 다릅니다. WING > 판매자정보 > 추가판매정보에서 현재 IP로 수정한 뒤 30분 후 다시 실행하세요.",
      );
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
