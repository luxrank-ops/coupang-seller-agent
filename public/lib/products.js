import { CATEGORIES, SOURCES } from "./sources.js";
import { estimateProduct } from "./margin.js";

export const MAX_PRODUCTS = 1000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

export function stableId(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeMoney(value, optional = false) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (optional) return null;
    throw new Error("공급가를 입력해주세요.");
  }
  const raw = String(value).trim().replace(/원$/, "").replace(/^₩/, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw))
    throw new Error("금액은 0 이상의 숫자여야 합니다.");
  const result = Number(raw.replace(/,/g, ""));
  if (!Number.isSafeInteger(result) || result > 100000000)
    throw new Error("금액은 0~1억 원 사이의 정수여야 합니다.");
  return result;
}

export function normalizeImportedProduct(row) {
  const name = String(row.name || "").trim();
  if (!name || name.length > 160)
    throw new Error("상품명은 1~160자로 입력해주세요.");
  const sourceText = String(row.source || "")
    .trim()
    .slice(0, 40);
  const source = SOURCES.find(
    (item) =>
      item.id.toLowerCase() === sourceText.toLowerCase() ||
      item.name.toLowerCase() === sourceText.toLowerCase(),
  );
  const categoryText = String(row.category || "").trim();
  const category = CATEGORIES.find(
    (item) =>
      item.id !== "all" &&
      (item.id === categoryText || item.name === categoryText),
  );
  const minOrder =
    row.minOrder === undefined || String(row.minOrder).trim() === ""
      ? null
      : Number(row.minOrder);
  if (
    minOrder !== null &&
    (!Number.isSafeInteger(minOrder) || minOrder < 1 || minOrder > 1000000)
  )
    throw new Error("최소 주문 수량은 1~1,000,000 사이의 정수여야 합니다.");
  const url = safeExternalUrl(row.url);
  const imageUrl = safeExternalUrl(row.imageUrl);
  if (String(row.url || "").trim() && !url)
    throw new Error("상품 URL은 https 주소여야 합니다.");
  if (String(row.imageUrl || "").trim() && !imageUrl)
    throw new Error("이미지 URL은 https 주소여야 합니다.");
  const fulfillmentMap = {
    위탁: "consignment",
    위탁배송: "consignment",
    consignment: "consignment",
    도매: "wholesale",
    도매매입: "wholesale",
    wholesale: "wholesale",
    해외: "overseas",
    해외소싱: "overseas",
    overseas: "overseas",
  };
  const sourceId = source?.id || "other";
  const sku = String(row.sku || "")
    .trim()
    .slice(0, 100);
  // Explicit SKU is best; URL then name provide deterministic fallback identities.
  const identity = JSON.stringify([
    sourceId,
    source?.name || sourceText,
    sku || url || name,
  ]);
  return {
    id: "import-" + stableId(identity),
    name,
    sourceId,
    sourceName: source?.name || sourceText || "기타 공급사",
    categoryId: category?.id || "other",
    wholesalePrice: normalizeMoney(row.wholesalePrice),
    shippingFee: normalizeMoney(row.shippingFee, true),
    minOrder,
    fulfillment: Object.hasOwn(
      fulfillmentMap,
      String(row.fulfillment || "").trim(),
    )
      ? fulfillmentMap[String(row.fulfillment || "").trim()]
      : "unknown",
    sku,
    url,
    imageUrl,
    description: String(row.description || "")
      .trim()
      .slice(0, 2000),
    tags: [],
    art: category?.id || "box",
    // Keep exported demo rows visibly marked as examples when re-imported.
    dataKind:
      row.dataKind === "demo" || String(row.dataKind || "").startsWith("예시")
        ? "demo"
        : "imported",
    importMethod: row.importMethod === "manual" ? "manual" : "csv",
    capturedAt: new Date().toISOString(),
  };
}

export function isStoredProduct(product) {
  return Boolean(
    product &&
    typeof product === "object" &&
    typeof product.id === "string" &&
    product.id.length <= 200 &&
    typeof product.name === "string" &&
    product.name.length > 0 &&
    product.name.length <= 160 &&
    ["demo", "imported", "live"].includes(product.dataKind) &&
    (product.wholesalePrice === null ||
      (Number.isSafeInteger(product.wholesalePrice) &&
        product.wholesalePrice >= 0 &&
        product.wholesalePrice <= 100000000)) &&
    (product.shippingFee === null ||
      (Number.isSafeInteger(product.shippingFee) &&
        product.shippingFee >= 0 &&
        product.shippingFee <= 100000000)) &&
    (product.minOrder === null ||
      (Number.isSafeInteger(product.minOrder) &&
        product.minOrder > 0 &&
        product.minOrder <= 1000000)),
  );
}

export function filterProducts(products, filters = {}) {
  const tokens = String(filters.q || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches = products.filter((product) => {
    const searchable = [
      product.name,
      product.description,
      product.sourceName,
      product.sku,
      CATEGORIES.find((item) => item.id === product.categoryId)?.name,
      ...(Array.isArray(product.tags) ? product.tags : []),
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase();
    if (!tokens.every((token) => searchable.includes(token))) return false;
    if (
      filters.category &&
      filters.category !== "all" &&
      filters.category !== product.categoryId
    )
      return false;
    if (
      filters.source &&
      filters.source !== "all" &&
      filters.source !== product.sourceId
    )
      return false;
    if (
      filters.minPrice !== "" &&
      filters.minPrice != null &&
      (product.wholesalePrice === null ||
        product.wholesalePrice < Number(filters.minPrice))
    )
      return false;
    if (
      filters.maxPrice !== "" &&
      filters.maxPrice != null &&
      (product.wholesalePrice === null ||
        product.wholesalePrice > Number(filters.maxPrice))
    )
      return false;
    if (filters.freeShipping && product.shippingFee !== 0) return false;
    if (filters.singleOrder && product.minOrder !== 1) return false;
    if (filters.consignment && product.fulfillment !== "consignment")
      return false;
    return true;
  });
  const missingLast = (a, b) =>
    a === null ? (b === null ? 0 : 1) : b === null ? -1 : 0;
  return matches.sort((a, b) => {
    if (filters.sort === "price-asc")
      return (
        missingLast(a.wholesalePrice, b.wholesalePrice) ||
        (a.wholesalePrice ?? 0) - (b.wholesalePrice ?? 0)
      );
    if (filters.sort === "price-desc")
      return (
        missingLast(a.wholesalePrice, b.wholesalePrice) ||
        (b.wholesalePrice ?? 0) - (a.wholesalePrice ?? 0)
      );
    if (filters.sort === "profit") {
      const ap = estimateProduct(a)?.netProfit ?? null;
      const bp = estimateProduct(b)?.netProfit ?? null;
      return missingLast(ap, bp) || (bp ?? 0) - (ap ?? 0);
    }
    if (filters.sort === "moq")
      return (
        missingLast(a.minOrder, b.minOrder) ||
        (a.minOrder ?? 0) - (b.minOrder ?? 0)
      );
    return 0;
  });
}
