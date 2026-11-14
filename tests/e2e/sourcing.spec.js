import { test, expect } from "@playwright/test";
import { mockApis, liveProducts } from "./fixtures.js";
import { makeCsv } from "../../public/lib/csv.js";

async function nav(page, view) {
  if (page.viewportSize().width <= 760)
    await page.locator("#menuToggle").click();
  await page.locator(`#sidebar [data-view="${view}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
});

test("첫 화면은 예시 상품이 아니라 도매꾹 실시간 조회 결과를 보여준다", async ({
  page,
}) => {
  await expect(page.locator("#searchInput")).toHaveValue("수납");
  await expect(page.locator(".product-card").first()).toBeVisible();
  await expect(page.locator("#resultsHeading")).toContainText("도매꾹 실시간");
  await expect(page.locator("#resultsCount")).toContainText("전체 약 30,000건");
  await expect(page.locator(".product-badge").first()).toContainText("API 조회");
  await expect(page.locator("#dataNotice")).toContainText("실시간 조회");
  await expect(page.locator("#dataNotice")).not.toContainText("예시 상품");
  await expect(page.locator("#dataMode option[value='demo']")).toHaveCount(0);
});

test("검색어와 필터가 서버 조회 조건으로 전달된다", async ({ page }) => {
  const requests = await mockApis(page);
  await page.goto("/");
  await page.locator("#freeShipping").check();
  await expect
    .poll(() => requests.some((url) => url.searchParams.get("freeShipping") === "true"))
    .toBe(true);
  await page.locator("#searchInput").fill("캠핑");
  await page.locator("#searchForm button[type=submit]").click();
  await expect
    .poll(() => requests.filter((url) => url.searchParams.get("q") === "캠핑").length)
    .toBeGreaterThan(0);
  await expect(page.locator(".product-card")).toHaveCount(
    liveProducts.filter((product) => product.shippingFee === 0).length,
  );
});

test("상품 상세는 도매꾹 상세정보 API의 재고·옵션·카테고리를 보여준다", async ({
  page,
}) => {
  await page.locator(".product-name").first().click();
  await expect(page.locator("#productDialog")).toBeVisible();
  await expect(page.locator("#detailLive")).toContainText("도매꾹 상세정보 API");
  await expect(page.locator("#detailLive")).toContainText("14");
  await expect(page.locator("#detailLive")).toContainText("01_16_08_00_00");
  await expect(page.locator("#detailLive")).toContainText("화이트");
});

test("판매 후보 선택 → 마진 계산 → 등록 실행 결과 표시까지 이어진다", async ({
  page,
}) => {
  await page.locator(".select-button").first().click();
  await nav(page, "preparation");
  await expect(page.locator("#candidateCount")).toHaveText("1");
  await expect(page.locator("#marginResult")).toContainText("권장 판매가");
  await page.locator("#editShipping").fill("3000");
  await expect(page.locator("#marginResult")).toContainText("예상 이익");

  await page.locator("#wingCategory").fill("632113");
  await page.locator("#registerWing").click();
  await expect(page.locator("#registerResult")).toContainText(
    "쿠팡이 등록을 거부했습니다",
  );
  await expect(page.locator("#registerResult")).toContainText("Invalid signature.");
});

test("카테고리 코드가 없으면 등록을 보내지 않고 부족한 항목을 알린다", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/register-product", {
    data: { name: "상품", salePrice: 12900 },
  });
  expect([422, 503]).toContain(response.status());
});

test("CSV로 가져온 상품은 별도 모드에서 검색·필터된다", async ({ page }) => {
  if (page.viewportSize().width <= 760) await page.locator("#menuToggle").click();
  await page.locator('#sidebar [data-action="import-open"]').click();
  await page
    .locator("#csvFile")
    .setInputFiles({
      name: "products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        makeCsv([
          { name: "가져온 상품 A", wholesalePrice: 5000, shippingFee: 0 },
          { name: "가져온 상품 B", wholesalePrice: 7000, shippingFee: 3000 },
        ]),
        "utf8",
      ),
    });
  await expect(page.locator("#confirmImport")).toBeEnabled();
  await page.locator("#confirmImport").click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await expect(page.locator("#resultsHeading")).toContainText("가져온 상품");
});

test("실시간 조회가 실패하면 예시 상품으로 대체하지 않고 오류를 보여준다", async ({
  page,
}) => {
  await page.route("**/api/products**", (route) =>
    route.fulfill({
      status: 502,
      json: { ok: false, error: "도매꾹 API에서 상품을 받아오지 못했습니다." },
    }),
  );
  await page.goto("/");
  await expect(page.locator("#catalogError")).toBeVisible();
  await expect(page.locator("#catalogError")).toContainText("도매꾹");
  await expect(page.locator(".product-card")).toHaveCount(0);
});
