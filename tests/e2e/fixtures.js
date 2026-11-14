// E2E 공통 픽스처 — 실제 도매꾹 API 응답 형태를 축약한 값.
// 브라우저 테스트는 네트워크·API 키에 의존하지 않도록 이 값으로 응답을 대신한다.
export const liveProducts = Array.from({ length: 26 }, (_, index) => ({
  id: "live-domeggook-" + (1000 + index),
  name: `실시간 수납 상품 ${index + 1}`,
  sourceId: "domeggook",
  sourceName: "도매꾹",
  categoryId: "other",
  wholesalePrice: 1000 + index * 500,
  shippingFee: index % 2 === 0 ? 0 : 3000,
  minOrder: 1,
  fulfillment: "wholesale",
  sku: String(1000 + index),
  url: `https://domeggook.com/${1000 + index}`,
  imageUrl: "",
  art: "box",
  tags: index % 2 === 0 ? ["무료배송"] : [],
  description: "도매꾹 목록 API 조회 상품",
  dataKind: "live",
  capturedAt: "2026-11-14T02:00:00.000Z",
}));

export const catalog = {
  ok: true,
  sources: [{ id: "domeggook", name: "도매꾹", mark: "꾹", tone: "orange", type: "종합 도매", country: "국내", home: "https://domeggook.com/", search: "https://domeggook.com/main/item/itemList.php?sw=", description: "도매" }],
  keywords: [
    { id: "storage", name: "수납·정리", q: "수납", icon: "box" },
    { id: "kitchen", name: "주방용품", q: "주방", icon: "utensils" },
  ],
  integrations: { domeggook: true, ownerclan: false, wing: true, seo: false },
  wing: { outboundCode: "25700124", returnCode: "1002747339", returnCharge: 10000 },
};

export const detail = {
  ok: true,
  source: "domeggook",
  no: "1000",
  title: "실시간 수납 상품 1",
  status: "판매중",
  price: 1000,
  inventory: 14,
  moq: 3,
  category: { name: "수납장", code: "01_16_08_00_00" },
  keywords: ["수납", "정리"],
  options: [{ name: "색상", values: ["화이트", "블랙"] }],
  delivery: { method: "택배", pay: "선결제", fee: 3000 },
  seller: { nick: "공급사", company: "공급사" },
  detail: { origin: "국산", manufacturer: "제조사", model: "M-1" },
  returnInfo: { address: "부산", fee: 3500, feeDouble: true },
  image: "",
  imageLicence: "이미지 사용 허용",
  url: "https://domeggook.com/1000",
  capturedAt: "2026-11-14T02:00:00.000Z",
};

export async function mockApis(page, overrides = {}) {
  const requests = [];
  await page.route("**/api/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/item-detail**", (route) =>
    route.fulfill({ json: detail }),
  );
  await page.route("**/api/register-product", (route) =>
    route.fulfill({
      status: 502,
      json: {
        ok: false,
        status: 401,
        code: "ERROR",
        message: "Invalid signature.",
        detail: { code: "IP_NOT_ALLOWED" },
      },
    }),
  );
  await page.route("**/api/products**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (overrides.products) return overrides.products(route, url);
    const freeOnly = url.searchParams.get("freeShipping") === "true";
    const items = liveProducts.filter(
      (product) => !freeOnly || product.shippingFee === 0,
    );
    await route.fulfill({
      json: {
        ok: true,
        mode: "live",
        source: "domeggook",
        products: items,
        page: 1,
        pageSize: 40,
        total: 30000,
        hasMore: false,
        note: "도매꾹 Open API 4.1 목록 조회 결과입니다.",
      },
    });
  });
  return requests;
}
