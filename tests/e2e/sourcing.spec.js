import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { makeCsv } from "../../public/lib/csv.js";

async function nav(page, view) {
  if (page.viewportSize().width <= 760)
    await page.locator("#menuToggle").click();
  await page.locator(`#sidebar [data-view="${view}"]`).click();
}
async function openImport(page) {
  if (page.viewportSize().width <= 760)
    await page.locator("#menuToggle").click();
  await page.locator('#sidebar [data-action="import-open"]').click();
}
async function upload(page, rows) {
  await openImport(page);
  await page.locator("#csvFile").setInputFiles({
    name: "products.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(makeCsv(rows), "utf8"),
  });
  await expect(page.locator("#confirmImport")).toBeEnabled();
  await page.locator("#confirmImport").click();
}
async function mockLive(page, handler) {
  await page.route("**/api/catalog", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.integrations.domeggook = true;
    await route.fulfill({ json: data });
  });
  await page.route("**/api/products?**", handler);
  await page.reload();
  await expect(page.locator(".product-card")).toHaveCount(12);
  await page.locator("#dataMode").selectOption("live");
}
const liveProduct = (name) => ({
  id: "live-test-" + name,
  name,
  wholesalePrice: 5000,
  shippingFee: null,
  minOrder: null,
  sourceId: "domeggook",
  categoryId: "other",
  fulfillment: "wholesale",
  dataKind: "live",
  sku: "12345678",
  url: "https://domeggook.com/12345678",
  imageUrl: "",
  tags: [],
  description: "공급사 조건 확인 필요",
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".product-card")).toHaveCount(12);
});

test("renders offline-capable sourcing UI without JS/CSP errors or horizontal overflow", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();
  await expect(page.locator("#resultsCount")).toHaveText("48개");
  await expect(page.locator("#sourceLinks a")).toHaveCount(7);
  await expect(page.locator("#dataNotice")).toContainText("예시 상품");
  await expect(page.locator('#dataMode option[value="live"]')).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(() => document.fonts.check("14px Pretendard")),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("searches real keywords and forwards safely encoded terms to wholesale mall links", async ({
  page,
}) => {
  await page.locator("#searchInput").fill("반려동물 산책");
  await page.locator("#searchForm").getByRole("button").click();
  await expect(page.locator("#resultsCount")).toHaveText("2개");
  await expect(page.locator(".product-card")).toHaveCount(2);
  await expect(page.locator("#sourceLinks a").first()).toHaveAttribute(
    "href",
    "https://domeggook.com/main/item/itemList.php?sw=" +
      encodeURIComponent("반려동물 산책"),
  );
  await expect(page).toHaveURL(/q=/);
  await page.locator("#searchInput").fill("존재하지않는상품123");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#productGrid .empty-state")).toContainText(
    "존재하지않는상품123",
  );
  await expect(page.locator(".product-card")).toHaveCount(0);
  await expect(page.locator("#productGrid .empty-state")).toContainText(
    "다른 키워드",
  );
});

test("combines filters, validates price ranges, resets and sorts results", async ({
  page,
}) => {
  if (page.viewportSize().width <= 760)
    await page.locator("#filterToggle").click();
  await page.locator('[data-category="living"]').click();
  await page.locator("#maxPrice").fill("5000");
  await page.locator("#consignment").check();
  await expect(page.locator("#resultsCount")).toHaveText("2개");
  await page.locator("#minPrice").fill("6000");
  await expect(page.locator("#priceError")).toContainText("최소 가격");
  await expect(page.locator(".product-card")).toHaveCount(0);
  await page.locator("#resetFilters").click();
  await expect(page.locator("#resultsCount")).toHaveText("48개");
  await page.locator("#sortOrder").selectOption("price-asc");
  await expect(page.locator(".product-price").first()).toContainText("1,100");
  await page.locator('[data-page="2"]').first().click();
  await expect(page.locator('.page-button[aria-current="page"]')).toHaveText(
    "2",
  );
});

test("favorites, candidates and edited zero rates persist across refresh without registering products", async ({
  page,
}) => {
  let registrations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/register-product")) registrations++;
  });
  const name = await page.locator(".product-name").first().textContent();
  await page.locator(".favorite-button").first().click();
  await page.locator(".select-button").first().click();
  await expect(page.locator("#selectionCount")).toHaveText("1");
  await page.reload();
  await expect(page.locator("#favoritesCount")).toHaveText("1");
  await expect(page.locator("#selectionCount")).toHaveText("1");
  await nav(page, "favorites");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await nav(page, "preparation");
  await expect(page.locator("#editName")).toHaveValue(name);
  await page.locator("#editShipping").fill("0");
  await page.locator("#editMargin").fill("0");
  await page.locator("#editFee").fill("0");
  await expect(page.locator("#marginResult")).toContainText("+0원");
  await page.reload();
  await expect(page.locator("#editMargin")).toHaveValue("0");
  await expect(page.locator("#editFee")).toHaveValue("0");
  await expect(page.locator("#editShipping")).toHaveValue("0");
  await page.locator("#generateSeo").click();
  await expect(page.locator("#seoNote")).toContainText("AI 미연결");
  await expect(page.locator("#editSeoName")).toHaveValue(name);
  await page.locator("#editName").fill("확인한 상품명");
  await expect(page.locator("#editSeoName")).toHaveValue("");
  await expect(
    page.locator('#prepareView a[href="https://wing.coupang.com/"]'),
  ).toBeVisible();
  expect(registrations).toBe(0);
});

test("opens honest product details and keeps selection/favorite buttons in sync", async ({
  page,
}) => {
  await page.locator(".product-name").first().click();
  const dialog = page.locator("#productDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("실제 취급 상품·가격·재고가 아닙니다");
  await expect(dialog.getByRole("link")).toHaveAttribute(
    "href",
    /itemList.php\?sw=/,
  );
  await dialog.locator('[data-action="favorite"]').click();
  await dialog.locator('[data-action="select"]').click();
  await expect(dialog.locator('[data-action="select"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.locator("[data-close]").click();
  await expect(page.locator(".select-button").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".favorite-button").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("compares up to four products and allows selection from the comparison table", async ({
  page,
}) => {
  for (let index = 0; index < 4; index++)
    await page.locator(".compare-button").nth(index).click();
  await page.locator(".compare-button").nth(4).click();
  await expect(page.locator("#compareCount")).toHaveText("4");
  await expect(page.locator("#toast")).toContainText("최대 4개");
  await page.locator("#compareOpen").click();
  await expect(page.locator("#compareDialog")).toBeVisible();
  await expect(page.locator("#compareContent thead th")).toHaveCount(5);
  await page.locator('#compareContent [data-action="select"]').first().click();
  await expect(page.locator("#selectionCount")).toHaveText("1");
  await page.locator('#compareContent [data-action="compare"]').first().click();
  await expect(page.locator("#compareContent thead th")).toHaveCount(4);
  await page.locator('[data-close="compareDialog"]').click();
  await expect(page.locator("#compareCount")).toHaveText("3");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("imports valid CSV rows, reports errors, prevents markup execution and updates duplicate SKUs", async ({
  page,
}) => {
  const headers = [
    "상품명",
    "도매가",
    "배송비",
    "소싱처",
    "카테고리",
    "최소주문수량",
    "상품URL",
    "판매방식",
    "상품코드",
  ];
  const malicious = "<img src=x onerror=window.__xss=true>";
  await openImport(page);
  await page.locator("#csvFile").setInputFiles({
    name: "supplier.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      makeCsv([
        headers,
        [
          "나의 수납함",
          3500,
          3000,
          "나의 공급사",
          "생활·수납",
          1,
          "https://supplier.example/item/abc",
          "위탁배송",
          "ABC",
        ],
        [malicious, 2000, "", "도매꾹", "생활·수납", "", "", "", "DEF"],
        ["잘못된 상품", -1, 3000, "", "", "", "", "", ""],
      ]),
    ),
  });
  await expect(page.locator("#importPreview")).toContainText("2개 상품");
  await expect(page.locator("#importPreview")).toContainText("오류 1행");
  await expect(page.locator("#confirmImport")).toContainText("정상 2개만");
  await page.locator("#confirmImport").click();
  await expect(page.locator("#dataMode")).toHaveValue("imported");
  await expect(page.locator(".product-card")).toHaveCount(2);
  await expect(page.locator(".product-name").nth(1)).toHaveText(malicious);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await page.locator(".select-button").first().click();
  await page.reload();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await upload(page, [
    headers,
    [
      "수정된 수납함",
      3900,
      0,
      "나의 공급사",
      "생활·수납",
      1,
      "https://supplier.example/item/abc",
      "위탁배송",
      "ABC",
    ],
  ]);
  await expect(page.locator(".product-card")).toHaveCount(2);
  await expect(page.locator(".product-name").first()).toHaveText(
    "수정된 수납함",
  );
  await nav(page, "preparation");
  await expect(page.locator("#editPrice")).toHaveValue("3900");
  await expect(page.locator("#editShipping")).toHaveValue("0");
});

test("rejects invalid CSV and exposes a downloadable, usable UTF-8 template", async ({
  page,
}) => {
  await openImport(page);
  await page.locator("#csvFile").setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("상품명,도매가\n오류,-1"),
  });
  await expect(page.locator("#importPreview")).toContainText("오류 1행");
  await expect(page.locator("#confirmImport")).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadTemplate").click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), "utf8");
  expect(text).toContain("상품명,도매가,배송비");
  expect(text.startsWith("\uFEFF")).toBeTruthy();
  await page.locator("#csvFile").setInputFiles({
    name: "bad-encoding.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0xff, 0xfe, 0xa1]),
  });
  await expect(page.locator("#importError")).toBeVisible();
  await expect(page.locator("#confirmImport")).toBeDisabled();
});

test("handles blocked persistence without pretending the changes were saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.reload();
  await page.locator(".select-button").first().click();
  await expect(page.locator("#storageWarning")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("저장 공간");
});

test("shows recoverable API loading errors rather than fabricated results", async ({
  page,
}) => {
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.reload();
  await expect(page.locator("#catalogError")).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(0);
  await page.unroute("**/api/catalog");
  await page.locator('#catalogError [data-action="retry"]').click();
  await expect(page.locator(".product-card")).toHaveCount(12);
});

test("live data keeps unknown shipping/MOQ unknown until manually confirmed", async ({
  page,
}) => {
  await mockLive(page, (route) =>
    route.fulfill({
      json: {
        ok: true,
        mode: "live",
        products: [liveProduct("API 수납함")],
        page: 1,
        hasMore: false,
      },
    }),
  );
  await page.locator("#searchInput").fill("수납");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("배송비 확인 필요");
  await expect(page.locator(".product-card")).toContainText(
    "배송비·공급가 확인 후 이익 계산",
  );
  await expect(page.locator("#dataNotice")).toContainText("불러온 상품에만");
  await page.locator(".select-button").first().click();
  await nav(page, "preparation");
  await expect(page.locator("#editShipping")).toHaveValue("");
  await expect(page.locator("#marginError")).toBeVisible();
  await page.locator("#editShipping").fill("0");
  await expect(page.locator("#marginError")).toBeHidden();
  await expect(page.locator("#marginResult")).toContainText("권장 판매가");
});

test("failed live search cannot fall back to demo offers", async ({ page }) => {
  await mockLive(page, (route) =>
    route.fulfill({
      status: 502,
      json: { ok: false, error: "공급사 API 연결 실패" },
    }),
  );
  await page.locator("#searchInput").fill("수납");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#catalogError")).toContainText(
    "공급사 API 연결 실패",
  );
  await expect(page.locator(".product-card")).toHaveCount(0);
});

test("adds a real sourced product by URL without a CSV and rejects unsafe links", async ({
  page,
}) => {
  await page.locator('.topbar [data-action="manual-open"]').click();
  await page.locator("#manualName").fill("내가 찾은 생활용품");
  await page.locator("#manualSource").fill("나의 도매 공급사");
  await page.locator("#manualPrice").fill("4200");
  await page.locator("#manualUrl").fill("http://supplier.example/item/123");
  await page.locator('#manualForm button[type="submit"]').click();
  await expect(page.locator("#manualError")).toContainText("https");
  await page.locator("#manualUrl").fill("https://supplier.example/item/123");
  await page.locator('#manualForm button[type="submit"]').click();
  await expect(page.locator("#prepareView")).toBeVisible();
  await expect(page.locator("#editName")).toHaveValue("내가 찾은 생활용품");
  await expect(page.locator("#editorSource")).toContainText("직접 추가");
  await expect(page.locator("#editShipping")).toHaveValue("");
  await expect(page.locator("#marginError")).toBeVisible();
  await page.reload();
  await expect(page.locator("#editName")).toHaveValue("내가 찾은 생활용품");
  await nav(page, "discover");
  await expect(page.locator("#dataMode")).toHaveValue("imported");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("직접 추가");
});

test("keeps keyboard focus after card updates and hides the closed mobile drawer from focus", async ({
  page,
}) => {
  if (page.viewportSize().width <= 760) {
    await expect(page.locator("#sidebar")).toHaveJSProperty("inert", true);
    await page.locator("#menuToggle").click();
    await expect(page.locator("#sidebar")).toHaveJSProperty("inert", false);
    await page.keyboard.press("Escape");
    await expect(page.locator("#menuToggle")).toBeFocused();
    await expect(page.locator("#sidebar")).toHaveJSProperty("inert", true);
  }
  const button = page.locator(".select-button").first();
  await button.focus();
  await button.press("Enter");
  await expect(page.locator(".select-button").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".select-button").first()).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("copies preparation data honestly without a registration request", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator(".select-button").first().click();
  await nav(page, "preparation");
  await page.locator("#copyDraft").click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("예시 상품");
  expect(text).toContain("권장 판매가:");
  expect(text).toContain("실제 쿠팡 등록·주문은 실행되지 않았습니다.");
  await page.locator("#editMargin").fill("95");
  await expect(page.locator("#marginError")).toContainText("100% 미만");
});

test("ignores superseded live searches so older responses cannot replace the latest query", async ({
  page,
}) => {
  await mockLive(page, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "첫번째")
      await new Promise((resolve) => setTimeout(resolve, 400));
    await route
      .fulfill({
        json: {
          ok: true,
          products: [liveProduct(query + " 상품")],
          page: 1,
          hasMore: false,
        },
      })
      .catch(() => {});
  });
  const firstRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/products?") &&
      new URL(request.url()).searchParams.get("q") === "첫번째",
  );
  await page.locator("#searchInput").fill("첫번째");
  await page.locator("#searchInput").press("Enter");
  await firstRequest;
  await page.locator("#searchInput").fill("두번째");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator(".product-name")).toHaveText("두번째 상품");
  await page.waitForTimeout(500);
  await expect(page.locator(".product-name")).toHaveText("두번째 상품");
});
