import {
  MAX_FILE_BYTES,
  MAX_PRODUCTS,
  normalizeImportedProduct,
} from "./products.js";
import { categoryName, getSource, FULFILLMENTS } from "./sources.js";

const HEADERS = {
  상품명: "name",
  name: "name",
  도매가: "wholesalePrice",
  공급가: "wholesalePrice",
  wholesaleprice: "wholesalePrice",
  price: "wholesalePrice",
  배송비: "shippingFee",
  shippingfee: "shippingFee",
  shipping: "shippingFee",
  소싱처: "source",
  공급사: "source",
  source: "source",
  sourceid: "source",
  카테고리: "category",
  category: "category",
  categoryid: "category",
  최소주문수량: "minOrder",
  최소주문: "minOrder",
  minorder: "minOrder",
  moq: "minOrder",
  상품url: "url",
  상품링크: "url",
  url: "url",
  이미지url: "imageUrl",
  imageurl: "imageUrl",
  판매방식: "fulfillment",
  fulfillment: "fulfillment",
  상품코드: "sku",
  sku: "sku",
  설명: "description",
  description: "description",
  데이터구분: "dataKind",
  datakind: "dataKind",
};

/** RFC 4180-style CSV, including BOM, escaped quotes, CRLF and embedded newlines. */
export function parseCsv(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_FILE_BYTES
  )
    throw new Error("CSV 파일은 UTF-8 형식, 2MB 이하여야 합니다.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    inQuotes = false,
    closedQuote = false;
  const finishCell = () => {
    row.push(cell);
    cell = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_PRODUCTS + 1)
      throw new Error(
        `한 번에 최대 ${MAX_PRODUCTS}개 상품을 가져올 수 있습니다.`,
      );
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else cell += char;
    } else if (char === '"') {
      if (cell.length || closedQuote)
        throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
      inQuotes = true;
    } else if (char === ",") finishCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else {
      if (closedQuote && char.trim())
        throw new Error("CSV의 닫는 따옴표 뒤에는 쉼표나 줄바꿈이 필요합니다.");
      if (!closedQuote) cell += char;
    }
  }
  if (inQuotes) throw new Error("CSV에 닫히지 않은 따옴표가 있습니다.");
  if (cell.length || row.length || closedQuote) finishRow();
  return rows;
}

export function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw new Error("헤더와 1개 이상의 상품 행이 필요합니다.");
  const headers = rows[0].map((value) => {
    const key = value.replace(/[\s_]/g, "").toLocaleLowerCase();
    return Object.hasOwn(HEADERS, key) ? HEADERS[key] : null;
  });
  if (!headers.includes("name") || !headers.includes("wholesalePrice"))
    throw new Error(
      "필수 열인 상품명(name), 도매가(wholesalePrice)를 확인해주세요.",
    );
  const mapped = headers.filter(Boolean);
  if (new Set(mapped).size !== mapped.length)
    throw new Error("같은 항목의 열이 중복되어 있습니다. 헤더를 확인해주세요.");
  const products = new Map(),
    errors = [];
  let duplicates = 0;
  rows.slice(1).forEach((values, index) => {
    try {
      if (values.length !== headers.length)
        throw new Error(
          "열 개수가 헤더와 다릅니다. 쉼표가 있는 값은 따옴표로 감싸주세요.",
        );
      const row = {};
      headers.forEach((key, column) => {
        if (key) row[key] = values[column];
      });
      const product = normalizeImportedProduct(row);
      if (products.has(product.id)) duplicates++;
      products.set(product.id, product);
    } catch (error) {
      errors.push({ row: index + 2, message: error.message });
    }
  });
  return {
    products: [...products.values()],
    errors,
    duplicates,
    totalRows: rows.length - 1,
  };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Prevent spreadsheet formula injection, including whitespace-prefixed formulas.
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
    text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function makeCsv(rows) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportProducts(products) {
  return makeCsv([
    [
      "상품명",
      "도매가",
      "배송비",
      "소싱처",
      "카테고리",
      "최소주문수량",
      "상품URL",
      "이미지URL",
      "판매방식",
      "상품코드",
      "설명",
      "데이터구분",
    ],
    ...products.map((product) => [
      product.name,
      product.wholesalePrice,
      product.shippingFee,
      getSource(product).name,
      categoryName(product.categoryId),
      product.minOrder,
      product.url || "",
      product.imageUrl || "",
      FULFILLMENTS[product.fulfillment] || "확인 필요",
      product.sku || "",
      product.description || "",
      {
        demo: "예시 (실제 공급 정보 아님)",
        imported: "직접 가져옴 (공급사 확인 필요)",
        live: "API 조회 (최종 확인 필요)",
      }[product.dataKind],
    ]),
  ]);
}

export const CSV_TEMPLATE = makeCsv([
  [
    "상품명",
    "도매가",
    "배송비",
    "소싱처",
    "카테고리",
    "최소주문수량",
    "상품URL",
    "이미지URL",
    "판매방식",
    "상품코드",
    "설명",
  ],
  [
    "테스트 수납함 (공급사 실제 정보로 교체)",
    3500,
    3000,
    "나의 공급사",
    "생활·수납",
    1,
    "",
    "",
    "위탁배송",
    "TEST-001",
    "공급사에서 확인한 사양을 입력하세요.",
  ],
]);
