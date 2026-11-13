import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { makeCsv } from "../../public/lib/csv.js";

async function expectAccessible(page) {
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}

async function expectNoOverflow(page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize().width);
}

async function openSidebar(page) {
  if (page.viewportSize().width <= 760)
    await page.locator("#menuToggle").click();
}

async function nav(page, view) {
  await openSidebar(page);
  await page.locator(`#sidebar [data-view="${view}"]`).click();
}

async function openImport(page) {
  await openSidebar(page);
  await page.locator('#sidebar [data-action="import-open"]').click();
}

async function expectCompleteCardActions(page) {
  const clipped = await page.locator(".product-actions").evaluateAll((groups) =>
    groups.flatMap((group) => {
      const edge =
        group.getBoundingClientRect().right -
        parseFloat(getComputedStyle(group).paddingRight);
      return [...group.querySelectorAll("button")]
        .filter((button) => button.getBoundingClientRect().right > edge + 1)
        .map((button) => button.textContent);
    }),
  );
  expect(
    clipped,
    "Card actions must not disappear under overflow:hidden",
  ).toEqual([]);
}

async function expectFontSize(page, selector, minimum) {
  for (const size of await page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
    ))
    expect(size, selector).toBeGreaterThanOrEqual(minimum);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".product-card")).toHaveCount(12);
});

test("catalog, filters, navigation and empty states keep readable contrast and typography", async ({
  page,
}) => {
  await expectAccessible(page);
  await expectFontSize(page, ".product-name", 15);
  await expectFontSize(page, ".product-price", 24);
  await expectFontSize(
    page,
    ".product-source, .product-terms, .product-estimate, .product-badge, .price-caption, .data-notice",
    12,
  );
  await expectFontSize(page, "#searchInput", 16);

  for (const height of await page
    .locator(".select-button, .compare-button, .favorite-button")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    ))
    expect(height).toBeGreaterThanOrEqual(40);

  if (page.viewportSize().width <= 760) {
    await page.locator("#filterToggle").click();
    await expect(page.locator("#filtersPanel")).toBeVisible();
  }
  await expectAccessible(page);
  await expectFontSize(page, ".category-option, .checkbox-label", 13);
  await page.locator('[data-category="living"]').click();
  await expectAccessible(page);
  await page.locator("#resetFilters").click();

  await openSidebar(page);
  await expectAccessible(page);
  await page.locator('#sidebar [data-view="favorites"]').click();
  await expect(page.locator("#productGrid .empty-state")).toBeVisible();
  await expectAccessible(page);
  await expectNoOverflow(page);
});

test("details, comparison, selected and hovered controls remain high contrast", async ({
  page,
}) => {
  await page.locator(".product-name").first().click();
  await expectAccessible(page);
  await page.locator('#productDialog [data-action="favorite"]').click();
  await expectAccessible(page);
  await page.locator("#productDialog [data-close]").click();

  await page.locator(".compare-button").nth(0).click();
  await page.locator(".compare-button").nth(1).click();
  await page.locator(".compare-button").first().hover();
  await expectAccessible(page);
  await page.locator("#compareOpen").click();
  await expectAccessible(page);
  await page.locator("#compareDialog [data-close]").click();

  const select = page.locator(".select-button").first();
  await select.hover();
  await expectAccessible(page);
  await select.click();
  await select.hover();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  // Hover must not replace the selected green surface with the indigo surface.
  await expectAccessible(page);
  await expectNoOverflow(page);
});

test("preparation, margin errors and generated draft metadata stay readable", async ({
  page,
}) => {
  await page.locator(".select-button").first().click();
  await page.locator('#selectionBar [data-view="preparation"]').click();
  await expect(page.locator("#editName")).toBeVisible();
  await expectFontSize(page, ".form-field", 14);
  await expectFontSize(page, ".form-field input, .form-field textarea", 16);
  await expectAccessible(page);

  await page.locator("#generateSeo").click();
  await expect(page.locator("#seoNote")).toContainText("AI 미연결");
  await expectAccessible(page);
  await page.locator("#editMargin").fill("99.9");
  await expect(page.locator("#marginResult")).toHaveClass(/is-invalid/);
  await expectAccessible(page);
  await expectNoOverflow(page);
});

test("manual, CSV preview and supplier directory dialogs meet automated accessibility checks", async ({
  page,
}) => {
  await page.locator('.topbar [data-action="manual-open"]').click();
  await expectAccessible(page);
  await expectFontSize(page, "#manualDialog input, #manualDialog select", 16);
  await page.locator("#manualDialog [data-close]").first().click();

  await openImport(page);
  await expectAccessible(page);
  await page.locator("#csvFile").setInputFiles({
    name: "readability.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      makeCsv([
        ["상품명", "도매가", "배송비", "최소주문수량", "소싱처", "카테고리"],
        ["확인할 공급사 수납 상품", 4500, "", "", "도매꾹", "living"],
      ]),
      "utf8",
    ),
  });
  await expect(page.locator("#confirmImport")).toBeEnabled();
  await expectAccessible(page);
  await expectNoOverflow(page);
  await page.locator("#confirmImport").click();
  await expect(page.locator("#dataNotice")).toHaveClass(/imported/);
  await expectAccessible(page);

  await openSidebar(page);
  await page.locator('#sidebar .nav-item[data-action="sources-open"]').click();
  await expectAccessible(page);
  await expectNoOverflow(page);
});

test("keyboard focus is visible on search and clipped product artwork", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await expect(page.locator(".skip-link")).toBeInViewport();
  await page.locator("#searchInput").focus();
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
  );
  const searchBorder = await page
    .locator("#searchForm")
    .evaluate((element) => getComputedStyle(element).borderColor);
  expect(primary).toBe("#4338ca");
  expect(searchBorder).toBe("rgb(67, 56, 202)");
  await page.locator(".product-art-button").first().focus();
  await expect(page.locator(".product-art-button").first()).toBeFocused();
  const focus = await page
    .locator(".product-art-button")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, offset: style.outlineOffset };
    });
  expect(focus).toEqual({ width: "3px", offset: "-4px" });
});

test("larger text fits narrow phones, tablets, desktop and 200 percent desktop zoom widths", async ({
  page,
}) => {
  // A 1440px desktop at 200% browser zoom has a 720px CSS viewport.
  for (const width of [
    320, 360, 375, 390, 540, 720, 768, 1020, 1024, 1240, 1440, 1680,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNoOverflow(page);
    await expectCompleteCardActions(page);
    await expectFontSize(page, ".product-name", 15);
    await expectFontSize(page, ".product-terms, .product-estimate", 12);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator("#filterToggle").click();
  await expectNoOverflow(page);
  await page.locator("#filterToggle").click();
  await page.locator(".select-button").first().click();
  await expect(page.locator("#selectionBar")).toBeInViewport();
  await expectNoOverflow(page);
  await page.locator('#selectionBar [data-view="preparation"]').click();
  await expectNoOverflow(page);
  await page.locator('.topbar [data-action="manual-open"]').click();
  await expectNoOverflow(page);
  await page.locator("#manualDialog [data-close]").first().click();
  await nav(page, "favorites");
  await expectNoOverflow(page);

  // Larger type must not strand the last controls below a short viewport.
  await page.setViewportSize({ width: 1440, height: 600 });
  await nav(page, "discover");
  await page.locator("#clearSelection").click();
  await page.locator("#consignment").scrollIntoViewIfNeeded();
  await expect(page.locator("#consignment")).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 500 });
  await openSidebar(page);
  await page.locator("#sidebar .sidebar-footer").scrollIntoViewIfNeeded();
  await expect(page.locator("#sidebar .sidebar-footer")).toBeInViewport();
});
