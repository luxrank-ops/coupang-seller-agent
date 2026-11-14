import {
  SOURCES,
  CATEGORIES,
  FULFILLMENTS,
  KEYWORDS,
  DEFAULT_QUERY,
  getSource,
  sourceSearchUrl,
  categoryName,
} from "./lib/sources.js";
import {
  escapeHtml as esc,
  filterProducts,
  safeExternalUrl,
  isStoredProduct,
  normalizeImportedProduct,
  MAX_PRODUCTS,
  MAX_FILE_BYTES,
} from "./lib/products.js";
import { calculateSafePrice, estimateProduct } from "./lib/margin.js";
import { CSV_TEMPLATE, importCsv, exportProducts } from "./lib/csv.js";
import { icon, hydrateIcons } from "./lib/icons.js";
import { productVisual, illustration } from "./lib/illustrations.js";
import { loadWorkspace, saveWorkspace } from "./lib/storage.js";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 12;
const money = (value) =>
  value === null || value === undefined
    ? "확인 필요"
    : Number(value).toLocaleString("ko-KR") + "원";
const kindLabel = (product) =>
  ({
    demo: "예시",
    imported: product.importMethod === "manual" ? "직접 추가" : "CSV",
    live: "API 조회",
  })[product.dataKind] || "확인 필요";
let browserStorage;
try {
  browserStorage = window.localStorage;
} catch {
  /* Storage may be disabled. */
}
const saved = loadWorkspace(browserStorage);
const urlParams = new URLSearchParams(location.search);
const state = {
  view: ["favorites", "preparation"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "discover",
  mode: saved.mode,
  source: urlParams.get("source") === "ownerclan" ? "ownerclan" : "domeggook",
  query: (urlParams.get("q") || "").slice(0, 100),
  category: CATEGORIES.some(
    (category) => category.id === urlParams.get("category"),
  )
    ? urlParams.get("category")
    : "all",
  imported: saved.imported,
  liveProducts: [],
  favorites: new Map(saved.favorites.map((product) => [product.id, product])),
  selected: new Map(saved.selected.map((product) => [product.id, product])),
  compare: new Map(),
  drafts: new Map(Object.entries(saved.drafts)),
  page: 1,
  loading: true,
  liveError: "",
  liveQuery: "",
  livePage: 0,
  liveHasMore: false,
  liveCursor: null,
  liveTotal: null,
  liveLoading: false,
  integrations: { domeggook: false, ownerclan: false, seo: false, wing: false },
  wing: {},
  keywords: KEYWORDS,
  detail: null,
  detailError: "",
  detailLoading: false,
  registerResult: null,
  registerLoading: false,
  activeProduct: saved.selected[0]?.id || null,
  pendingImport: null,
  storageFailed: saved.warning,
};
let toastTimer,
  liveController,
  liveRequestId = 0,
  seoController,
  seoRequestId = 0,
  importRequestId = 0;

hydrateIcons();
$("searchInput").value = state.query;
$("dataMode").value = state.mode;
renderSourceFilter();
if (
  SOURCES.some((source) => source.id === urlParams.get("source")) ||
  urlParams.get("source") === "other"
)
  $("sourceFilter").value = urlParams.get("source");
for (const field of ["minPrice", "maxPrice"])
  if (/^\d{1,9}$/.test(urlParams.get(field) || ""))
    $(field).value = urlParams.get(field);
for (const field of ["singleOrder", "freeShipping", "consignment"])
  $(field).checked = urlParams.get(field) === "true";
$("storageWarning").hidden = !state.storageFailed;

function persist() {
  const success = saveWorkspace(browserStorage, state);
  state.storageFailed = !success;
  $("storageWarning").hidden = success;
  return success;
}

function toast(message) {
  clearTimeout(toastTimer);
  const parent = document.querySelector("dialog[open]") || document.body;
  parent.appendChild($("toast"));
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3800);
}

function openDialog(id) {
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    if (dialog.id !== id) dialog.close();
  });
  if (!$(id).open) $(id).showModal();
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarBackdrop").hidden = true;
  $("menuToggle").setAttribute("aria-expanded", "false");
  const mobile = matchMedia("(max-width: 760px)").matches;
  $("sidebar").inert = mobile;
  if (mobile) $("sidebar").setAttribute("aria-hidden", "true");
  else $("sidebar").removeAttribute("aria-hidden");
}

function currentProducts() {
  if (state.view === "favorites") return [...state.favorites.values()];
  return state.mode === "imported" ? state.imported : state.liveProducts;
}

function findProduct(id) {
  return (
    [...state.imported, ...state.liveProducts].find(
      (product) => product.id === id,
    ) ||
    state.selected.get(id) ||
    state.favorites.get(id) ||
    state.compare.get(id)
  );
}

function filters() {
  const live = state.mode === "live";
  return {
    q: state.query,
    category: live ? "all" : state.category,
    source: live ? "all" : $("sourceFilter").value,
    minPrice: $("minPrice").value,
    maxPrice: $("maxPrice").value,
    freeShipping: $("freeShipping").checked,
    singleOrder: $("singleOrder").checked,
    consignment: live ? false : $("consignment").checked,
    sort: $("sortOrder").value,
  };
}

function validatePriceFilters() {
  const min = $("minPrice"),
    max = $("maxPrice");
  let error = "";
  if (!min.validity.valid || !max.validity.valid)
    error = "0~1억 원 사이의 정수를 입력하세요.";
  else if (
    min.value !== "" &&
    max.value !== "" &&
    Number(min.value) > Number(max.value)
  )
    error = "최소 가격은 최대 가격 이하여야 합니다.";
  $("priceError").textContent = error;
  $("priceError").hidden = !error;
  min.setAttribute("aria-invalid", String(Boolean(error)));
  max.setAttribute("aria-invalid", String(Boolean(error)));
  return !error;
}

function syncUrl() {
  const params = new URLSearchParams();
  const active = filters();
  if (active.q) params.set("q", active.q);
  if (active.category !== "all") params.set("category", active.category);
  if (active.source !== "all") params.set("source", active.source);
  for (const key of ["minPrice", "maxPrice"])
    if (active[key] !== "") params.set(key, active[key]);
  for (const key of ["freeShipping", "singleOrder", "consignment"])
    if (active[key]) params.set(key, "true");
  const hash = state.view === "discover" ? "" : "#" + state.view;
  history.replaceState(
    null,
    "",
    location.pathname + (params.size ? "?" + params.toString() : "") + hash,
  );
}

function renderSources() {
  const query = $("searchInput").value.trim();
  $("sourceLinks").innerHTML = SOURCES.map(
    (source) =>
      `<a class="source-link" href="${esc(sourceSearchUrl(source, query))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(source.name)}에서 ${esc(query || "상품")} 검색, 새 탭"><span class="source-logo tone-${source.tone} ${source.mark.length > 2 ? "small-word" : ""}">${source.mark}</span><span><strong>${source.name}</strong><small>${source.type}</small></span>${icon("arrow-up-right")}</a>`,
  ).join("");
  $("sourceDirectory").innerHTML = SOURCES.map(
    (source) =>
      `<a class="source-directory-card" href="${esc(sourceSearchUrl(source, query))}" target="_blank" rel="noopener noreferrer"><div class="directory-heading"><span class="source-logo tone-${source.tone} ${source.mark.length > 2 ? "small-word" : ""}">${source.mark}</span><span><h3>${source.name}</h3><small>${source.country} · ${source.type} · 외부 검색</small></span>${icon("arrow-up-right")}</div><p>${source.description}</p></a>`,
  ).join("");
}

function renderBadges() {
  $("favoritesCount").textContent = state.favorites.size;
  $("selectedNavCount").textContent = state.selected.size;
  $("compareCount").textContent = state.compare.size;
  $("compareOpen").disabled = state.compare.size < 2;
  $("selectionCount").textContent = state.selected.size;
  $("selectionNames").textContent = [...state.selected.values()]
    .map((product) => product.name)
    .join(", ");
  $("selectionBar").hidden =
    !state.selected.size || state.view === "preparation";
  document.body.classList.toggle(
    "has-selection",
    state.selected.size > 0 && state.view !== "preparation",
  );
  $("exportFavorites").disabled = !state.favorites.size;
  $("exportSelected").disabled = !state.selected.size;
  $("dataMode").querySelector('[value="imported"]').textContent =
    `내가 가져온 상품${state.imported.length ? " · " + state.imported.length : ""}`;
}

function renderNotice() {
  const notice = $("dataNotice");
  notice.className = "data-notice";
  if (state.view === "favorites") {
    notice.innerHTML =
      icon("info") +
      "<p>이 브라우저에 저장한 관심 상품입니다. 실시간 조회·직접 추가·CSV 구분을 확인하세요. 가격·재고는 자동 동기화되지 않습니다.</p>";
  } else if (state.mode === "imported") {
    notice.classList.add("imported");
    notice.innerHTML =
      icon("info") +
      '<p><strong>직접 가져온 상품</strong>입니다. 공급사에서 가격·재고·판매 권한을 확인하세요. 이 브라우저에만 저장됩니다.</p><button data-action="import-open">CSV 추가 ' +
      icon("plus") +
      "</button>" +
      (state.imported.length
        ? '<button data-action="clear-imported">목록 삭제</button>'
        : "");
  } else {
    notice.classList.add("live");
    const name = state.source === "ownerclan" ? "오너클랜" : "도매꾹";
    notice.innerHTML =
      icon("info") +
      `<p><strong>${name} 실시간 조회</strong> 결과입니다. 공급가·최소주문·배송비는 API 응답값이며, 옵션별 조건과 재고는 상품 상세에서 확인하세요.</p><button data-action="sources-open">다른 도매몰 바로가기 ` +
      icon("arrow-right") +
      "</button>";
  }
}

function renderCategories(base, active) {
  if (state.mode === "live") {
    $("categoryFilters").innerHTML = state.keywords
      .map(
        (keyword) =>
          `<button type="button" class="category-option ${keyword.q === state.query ? "active" : ""}" data-keyword="${esc(keyword.q)}" aria-pressed="${keyword.q === state.query}">${icon(keyword.icon)}${esc(keyword.name)}</button>`,
      )
      .join("");
    return;
  }
  const products = filterProducts(base, { ...active, category: "all" });
  $("categoryFilters").innerHTML = CATEGORIES.map((category) => {
    const count =
      category.id === "all"
        ? products.length
        : products.filter((product) => product.categoryId === category.id)
            .length;
    return `<button type="button" class="category-option ${category.id === state.category ? "active" : ""}" data-category="${category.id}" aria-pressed="${category.id === state.category}">${icon(category.icon)}${category.name}<span>${count}</span></button>`;
  }).join("");
}

function renderActiveFilters(active) {
  const chips = [];
  if (active.q) chips.push(["query", "검색: " + active.q]);
  if (active.category !== "all")
    chips.push(["category", categoryName(active.category)]);
  if (active.source !== "all")
    chips.push([
      "sourceFilter",
      SOURCES.find((source) => source.id === active.source)?.name ||
        "기타 공급사",
    ]);
  if (active.minPrice !== "" || active.maxPrice !== "")
    chips.push([
      "price",
      `${active.minPrice === "" ? "0원" : money(Number(active.minPrice))} ~ ${active.maxPrice === "" ? "제한 없음" : money(Number(active.maxPrice))}`,
    ]);
  for (const [key, label] of [
    ["freeShipping", "배송비 0원"],
    ["singleOrder", "1개부터 주문"],
    ["consignment", "위탁배송"],
  ])
    if (active[key]) chips.push([key, label]);
  $("activeFilters").innerHTML = chips
    .map(
      ([key, label]) =>
        `<button class="filter-chip" data-filter-clear="${key}" aria-label="${esc(label)} 필터 해제">${esc(label)}${icon("x")}</button>`,
    )
    .join("");
}

function renderProductCard(product) {
  const source = getSource(product),
    estimate = estimateProduct(product);
  const selected = state.selected.has(product.id),
    favorite = state.favorites.has(product.id),
    compared = state.compare.has(product.id);
  const id = esc(product.id);
  const shipping =
    product.shippingFee === null
      ? "배송비 확인 필요"
      : product.shippingFee === 0
        ? "공급사 배송비 0원"
        : "배송 " + money(product.shippingFee);
  return `<article class="product-card ${selected ? "is-selected" : ""}" data-product="${id}">
    <div class="product-image-wrap"><button class="product-art-button" data-action="detail" data-id="${id}" aria-label="${esc(product.name)} 상세 보기">${productVisual(product)}</button><div class="product-badges"><span class="product-badge ${product.dataKind === "live" ? "live" : ""}">${kindLabel(product)}</span><span class="product-badge fulfillment">${FULFILLMENTS[product.fulfillment] || "방식 확인 필요"}</span></div><button class="favorite-button" data-action="favorite" data-id="${id}" aria-label="${esc(product.name)} ${favorite ? "관심 상품 해제" : "관심 상품 저장"}" aria-pressed="${favorite}">${icon("heart")}</button></div>
    <div class="product-info"><div class="product-source"><span class="source-mini-dot"></span>${esc(source.name)}${product.dataKind === "demo" ? '<span class="source-inline-note">· 소싱처 예시</span>' : ""}</div><button class="product-name" data-action="detail" data-id="${id}">${esc(product.name)}</button><div class="product-price-row"><strong class="product-price">${product.wholesalePrice === null ? "확인 필요" : product.wholesalePrice.toLocaleString("ko-KR") + "<small>원</small>"}</strong><span class="price-caption">${product.dataKind === "demo" ? "예시 공급가" : "공급가"}</span></div><div class="product-terms"><span>최소 ${product.minOrder === null ? "수량 확인" : product.minOrder.toLocaleString("ko-KR") + "개"}</span><span class="terms-divider">·</span><span>${shipping}</span></div><div class="product-estimate ${estimate ? "" : "unknown"}">${estimate ? `<span>권장가 <b>${money(estimate.salePrice)}</b></span><span>예상 이익 <strong>+${money(estimate.netProfit)}</strong></span>` : "<span>배송비·공급가 확인 후 이익 계산</span>"}</div></div>
    <div class="product-actions"><button class="compare-button" data-action="compare" data-id="${id}" aria-label="${esc(product.name)} 비교 ${compared ? "해제" : "추가"}" aria-pressed="${compared}">${icon("columns")}비교</button><button class="select-button" data-action="select" data-id="${id}" aria-label="${esc(product.name)} 판매 후보 ${selected ? "해제" : "선택"}" aria-pressed="${selected}">${icon(selected ? "check" : "plus")}${selected ? "선택됨" : "선택하기"}</button></div>
  </article>`;
}

function renderEmpty(priceValid) {
  const active = filters();
  if (!priceValid)
    return `${icon("sliders")}<h2>가격 범위를 확인해주세요</h2><p>최소·최대 공급가를 올바르게 입력하면 검색 결과를 볼 수 있어요.</p>`;
  if (state.view === "favorites" && !state.favorites.size)
    return `${icon("heart")}<h2>아직 관심 상품이 없어요</h2><p>상품 카드의 하트를 누르면<br>다시 보고 싶은 상품을 모아둘 수 있어요.</p><button class="button button-primary" data-view="discover">상품 둘러보기 ${icon("arrow-right")}</button>`;
  if (
    state.view === "discover" &&
    state.mode === "imported" &&
    !state.imported.length
  )
    return `${icon("upload")}<h2>나만의 상품 카탈로그를 만들어보세요</h2><p>도매몰이나 공급사에서 받은 상품 CSV를 가져오면<br>직접 검색하고 비교·선택할 수 있어요.</p><button class="button button-primary" data-action="import-open">상품 CSV 가져오기</button>`;
  if (
    state.view === "discover" &&
    state.mode === "live" &&
    !state.liveQuery &&
    !state.liveError
  )
    return `${icon("search")}<h2>도매꾹에서 어떤 상품을 찾을까요?</h2><p>위 검색창에 키워드를 입력하고 상품 검색을 눌러주세요.<br>배송비·최소 주문 수량은 상품 상세에서 확인할 수 있습니다.</p>`;
  const q = active.q
    ? `“${esc(active.q)}”에 맞는 상품이 없어요`
    : "조건에 맞는 상품이 없어요";
  return `${icon("search")}<h2>${q}</h2><p>다른 키워드로 검색하거나 필터를 줄여보세요.<br>위 도매몰 바로가기에서 더 다양한 실제 상품을 찾을 수 있어요.</p><button class="button button-secondary" data-action="reset-all">검색 조건 초기화</button>${state.mode !== "imported" && state.view !== "favorites" ? '<button class="button button-primary" data-action="import-open">실제 상품 가져오기</button>' : ""}`;
}

function renderCatalog() {
  if (state.view === "preparation") return;
  const base = currentProducts(),
    active = filters(),
    priceValid = validatePriceFilters();
  const products = priceValid ? filterProducts(base, active) : [];
  renderCategories(base, active);
  renderNotice();
  renderActiveFilters(active);
  const sourceName =
    state.source === "ownerclan" ? "오너클랜" : "도매꾹";
  $("resultsHeading").textContent =
    state.view === "favorites"
      ? "나의 관심 상품"
      : state.mode === "imported"
        ? "가져온 상품"
        : sourceName + " 실시간 조회";
  $("resultsCount").textContent = state.liveLoading
    ? "조회 중…"
    : state.mode === "live" && state.view === "discover"
      ? `${products.length}개 표시 · ${base.length}개 불러옴` +
        (state.liveTotal
          ? ` / 전체 약 ${state.liveTotal.toLocaleString("ko-KR")}건`
          : "")
      : `${products.length}개`;
  const error =
    state.view === "discover" && state.mode === "live" ? state.liveError : "";
  $("catalogError").hidden = !error;
  $("catalogError").innerHTML = error
    ? esc(error) + '<button data-action="retry">다시 시도</button>'
    : "";
  const loading =
    state.liveLoading &&
    !base.length &&
    state.mode === "live" &&
    state.view === "discover";
  if (loading) {
    $("productGrid").innerHTML =
      '<div class="loading-state"><span class="spinner"></span>상품을 불러오고 있어요</div>';
    $("pagination").innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  state.page = Math.max(1, Math.min(state.page, totalPages));
  $("productGrid").innerHTML = products.length
    ? products
        .slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)
        .map(renderProductCard)
        .join("")
    : '<div class="empty-state">' + renderEmpty(priceValid) + "</div>";
  let pages = "";
  if (totalPages > 1) {
    pages = `<button class="page-button" data-page="${state.page - 1}" aria-label="이전 페이지" ${state.page === 1 ? "disabled" : ""}>${icon("chevron-left")}</button>`;
    const visible = new Set(
      [1, totalPages, state.page - 1, state.page, state.page + 1].filter(
        (page) => page >= 1 && page <= totalPages,
      ),
    );
    let previous = 0;
    for (const page of [...visible].sort((a, b) => a - b)) {
      if (previous && page - previous > 1)
        pages += '<span aria-hidden="true">…</span>';
      pages += `<button class="page-button ${page === state.page ? "active" : ""}" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ""} aria-label="${page}페이지">${page}</button>`;
      previous = page;
    }
    pages += `<button class="page-button" data-page="${state.page + 1}" aria-label="다음 페이지" ${state.page === totalPages ? "disabled" : ""}>${icon("chevron-right")}</button>`;
  }
  if (state.mode === "live" && state.view === "discover" && state.liveHasMore)
    pages += `<button class="button button-secondary" data-action="load-live" ${state.liveLoading ? "disabled" : ""}>${state.liveLoading ? "조회 중…" : "도매꾹에서 더 가져오기 " + icon("plus")}</button>`;
  $("pagination").innerHTML = pages;
}

function resetFilters(includeQuery = false) {
  state.category = "all";
  $("sourceFilter").value = "all";
  $("minPrice").value = "";
  $("maxPrice").value = "";
  for (const key of ["singleOrder", "freeShipping", "consignment"])
    $(key).checked = false;
  if (includeQuery) {
    state.query = "";
    $("searchInput").value = "";
  }
  state.page = 1;
}

function setView(view, initial = false) {
  if (!["discover", "favorites", "preparation"].includes(view)) return;
  if (!initial && state.view !== view) {
    flushDraft();
    stopSeo();
    cancelLive();
    resetFilters(true);
  }
  state.view = view;
  closeSidebar();
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (!button.classList.contains("nav-item")) return;
    button.classList.toggle("active", button.dataset.view === view);
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("pageLabel").textContent = {
    discover: "상품 소싱",
    favorites: "관심 상품",
    preparation: "판매 준비",
  }[view];
  document.title = $("pageLabel").textContent + " · 쿠팡 셀러 AI 비서";
  $("catalogView").hidden = view === "preparation";
  $("prepareView").hidden = view !== "preparation";
  $("discoverHero").hidden = view !== "discover";
  $("favoritesHero").hidden = view !== "favorites";
  $("sourceSection").hidden = view !== "discover";
  $("dataMode").hidden = view === "favorites";
  renderBadges();
  renderSources();
  if (view === "preparation") renderPreparation();
  else renderCatalog();
  syncUrl();
  if (!initial) window.scrollTo({ top: 0, behavior: "auto" });
}

// Re-rendering cards must not send keyboard focus back to the document root.
function rememberActionFocus() {
  const focused = document.activeElement;
  const action = focused?.dataset.action,
    id = focused?.dataset.id;
  if (!action || !id) return () => {};
  const root = focused.closest("dialog, #candidateList, #productGrid");
  return () => {
    if (!root) return;
    const selector = `[data-action="${CSS.escape(action)}"][data-id="${CSS.escape(id)}"]`;
    const next =
      root.querySelector(selector) ||
      root.querySelector(`[data-action="${CSS.escape(action)}"]`) ||
      root.querySelector("[data-close]");
    next?.focus({ preventScroll: true });
  };
}

function toggleFavorite(id) {
  const restoreFocus = rememberActionFocus();
  const product = findProduct(id);
  if (!product) return;
  if (state.favorites.has(id)) state.favorites.delete(id);
  else {
    if (state.favorites.size >= MAX_PRODUCTS)
      return toast("관심 상품은 최대 1,000개까지 저장할 수 있어요.");
    state.favorites.set(id, product);
  }
  const success = persist();
  renderBadges();
  renderCatalog();
  refreshOpenDialogs();
  restoreFocus();
  toast(
    success
      ? state.favorites.has(id)
        ? "관심 상품에 저장했어요. 하트를 다시 누르면 해제됩니다."
        : "관심 상품에서 해제했어요."
      : "저장 공간을 사용할 수 없어 이번 방문 중에만 유지됩니다.",
  );
}

function toggleSelected(id) {
  const restoreFocus = rememberActionFocus();
  const product = findProduct(id);
  if (!product) return;
  flushDraft();
  if (state.selected.has(id)) {
    state.selected.delete(id);
    if (state.activeProduct === id) {
      state.activeProduct = state.selected.keys().next().value || null;
      stopSeo();
    }
  } else {
    if (state.selected.size >= 100)
      return toast("판매 후보는 최대 100개까지 선택할 수 있어요.");
    state.selected.set(id, product);
    if (!state.activeProduct) state.activeProduct = id;
  }
  const success = persist();
  renderBadges();
  if (state.view === "preparation") renderPreparation();
  else renderCatalog();
  refreshOpenDialogs();
  restoreFocus();
  toast(
    success
      ? state.selected.has(id)
        ? "판매 후보로 선택했어요. 판매 준비에서 이어서 확인하세요."
        : "판매 후보에서 해제했어요."
      : "현재 방문 중에만 선택됩니다. 저장 공간을 확인해주세요.",
  );
}

function toggleCompare(id) {
  const restoreFocus = rememberActionFocus();
  const product = findProduct(id);
  if (!product) return;
  if (state.compare.has(id)) state.compare.delete(id);
  else {
    if (state.compare.size >= 4)
      return toast(
        "비교는 최대 4개까지 가능해요. 먼저 다른 상품을 해제해주세요.",
      );
    state.compare.set(id, product);
  }
  renderBadges();
  renderCatalog();
  if ($("compareDialog").open) renderComparison();
  else
    toast(
      state.compare.has(id)
        ? `비교 목록 ${state.compare.size}/4 · 위쪽 ‘비교’ 버튼에서 확인하세요.`
        : "비교 목록에서 해제했어요.",
    );
  restoreFocus();
}

function productLink(product) {
  return (
    safeExternalUrl(product.url) ||
    sourceSearchUrl(getSource(product), product.name)
  );
}

function showProduct(id, open = true) {
  const product = findProduct(id);
  if (!product) return;
  $("productDialog").dataset.product = id;
  const source = getSource(product),
    estimate = estimateProduct(product),
    selected = state.selected.has(id),
    favorite = state.favorites.has(id);
  const link = productLink(product);
  $("productDialogContent").innerHTML =
    `<div class="product-detail-top"><span>${categoryName(product.categoryId)} · ${kindLabel(product)} 상품</span><button class="icon-button" data-close="productDialog" aria-label="상품 상세 닫기">${icon("x")}</button></div><div class="product-detail-body"><div class="detail-art">${productVisual(product)}</div><div class="detail-data"><div class="product-source"><span class="source-mini-dot"></span>${esc(source.name)}${product.dataKind === "demo" ? " · 소싱처 예시" : ""}</div><h2 id="productDialogTitle">${esc(product.name)}</h2><div class="detail-price">${money(product.wholesalePrice)} <small>${product.dataKind === "demo" ? "예시 공급가" : "공급가"}</small></div><dl class="detail-terms"><dt>공급사 배송비</dt><dd>${money(product.shippingFee)}</dd><dt>최소 주문 수량</dt><dd>${product.minOrder === null ? "확인 필요" : product.minOrder.toLocaleString("ko-KR") + "개"}</dd><dt>판매 방식</dt><dd>${FULFILLMENTS[product.fulfillment] || "확인 필요"}</dd><dt>상품코드</dt><dd>${esc(product.sku || "미입력")}</dd><dt>재고·판매 권한</dt><dd>공급사 확인 필요</dd></dl><p class="detail-description">${esc(product.description || "상품의 구성과 거래 조건은 공급사에서 확인하세요.")}</p></div></div><div id="detailLive" class="detail-live"></div><div class="detail-bottom"><div class="detail-estimate"><span>${estimate ? "권장 판매가 " + money(estimate.salePrice) : "공급가·배송비 확인 후 계산 가능"}</span>${estimate ? "<strong>예상 이익 +" + money(estimate.netProfit) + "</strong>" : ""}</div><p class="form-hint">목표마진 30%·수수료 10.8%, 1개 판매 기준 추정. 부가세 정산·광고·반품비 등 제외.</p>${product.dataKind === "demo" ? '<div class="inline-warning">기능 체험용 예시입니다. 해당 도매몰의 실제 취급 상품·가격·재고가 아닙니다. 아래 링크는 실제 상품 원문이 아닌 유사 상품 키워드 검색입니다.</div>' : '<div class="inline-warning">공급가·배송비·MOQ·재고와 이미지 사용 권한, 법정 인증 등 판매 요건을 최종 확인하세요. API·CSV 정보는 자동 동기화되지 않습니다.</div>'}<div class="detail-footer">${link ? `<a class="button button-secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${product.dataKind === "demo" || !product.url ? "도매몰에서 유사 상품 찾기" : "공급사 상품 원문 보기"} ${icon("arrow-up-right")}</a>` : ""}<button class="button button-secondary" data-action="favorite" data-id="${esc(id)}" aria-pressed="${favorite}">${icon("heart")}${favorite ? "관심 저장됨" : "관심 상품"}</button><button class="button ${selected ? "button-secondary is-selected" : "button-primary"}" data-action="select" data-id="${esc(id)}" aria-pressed="${selected}">${icon(selected ? "check" : "plus")}${selected ? "선택 해제" : "판매 후보로 선택"}</button></div></div>`;
  if (open) openDialog("productDialog");
  if (product.dataKind === "live" && product.sourceId === "domeggook")
    loadDetail(product);
}

function detailRow(label, value) {
  return value === null || value === undefined || value === ""
    ? ""
    : `<span>${esc(label)}</span><strong>${esc(value)}</strong>`;
}

function renderDetail(detail) {
  const box = $("detailLive");
  if (!box) return;
  if (!detail) {
    box.innerHTML = "";
    return;
  }
  const rows = [
    detailRow("판매 상태", detail.status),
    detailRow(
      "재고",
      detail.inventory === null ? null : detail.inventory.toLocaleString("ko-KR") + "개",
    ),
    detailRow(
      "도매 MOQ",
      detail.moq === null ? null : detail.moq.toLocaleString("ko-KR") + "개",
    ),
    detailRow("배송 방식", detail.delivery?.method),
    detailRow("배송비 부담", detail.delivery?.pay),
    detailRow(
      "배송비",
      detail.delivery?.fee === null || detail.delivery?.fee === undefined
        ? null
        : detail.delivery.fee.toLocaleString("ko-KR") + "원",
    ),
    detailRow(
      "제주/도서 추가비",
      detail.delivery?.jejuExtra || detail.delivery?.islandExtra
        ? `${(detail.delivery.jejuExtra || 0).toLocaleString("ko-KR")}원 / ${(detail.delivery.islandExtra || 0).toLocaleString("ko-KR")}원`
        : null,
    ),
    detailRow(
      "도매꾹 카테고리",
      [detail.category?.name, detail.category?.code]
        .filter(Boolean)
        .join(" · "),
    ),
    detailRow("원산지", detail.detail?.origin),
    detailRow("제조사", detail.detail?.manufacturer),
    detailRow("모델명", detail.detail?.model),
    detailRow("판매자", [detail.seller?.nick, detail.seller?.company].filter(Boolean).join(" · ")),
    detailRow(
      "반품 배송비",
      detail.returnInfo?.fee === null || detail.returnInfo?.fee === undefined
        ? null
        : detail.returnInfo.fee.toLocaleString("ko-KR") +
          "원" +
          (detail.returnInfo.feeDouble ? " (왕복)" : ""),
    ),
    detailRow("반품지", detail.returnInfo?.address),
  ]
    .filter(Boolean)
    .join("");
  const options = (detail.options || [])
    .map(
      (option) =>
        `<li><span>${esc(option.name || "옵션")}</span>${option.values.map((value) => `<em>${esc(value)}</em>`).join("")}</li>`,
    )
    .join("");
  box.innerHTML =
    '<div class="detail-live-heading"><strong>도매꾹 상세정보 API</strong><small>' +
    (detail.capturedAt ? esc(detail.capturedAt.slice(0, 19).replace("T", " ")) + " 조회" : "") +
    "</small></div>" +
    (rows ? `<div class="detail-live-grid">${rows}</div>` : "") +
    (options
      ? `<div class="detail-live-options"><span>옵션 구성</span><ul>${options}</ul></div>`
      : "") +
    (detail.imageLicence
      ? `<p class="detail-live-note">이미지 사용: ${esc(detail.imageLicence)}</p>`
      : "") +
    (detail.keywords?.length
      ? `<p class="detail-live-note">판매자 키워드: ${detail.keywords.slice(0, 10).map(esc).join(", ")}</p>`
      : "");
}

async function loadDetail(product) {
  const box = $("detailLive");
  if (!box) return;
  box.innerHTML =
    '<div class="detail-live-heading"><span class="spinner"></span>도매꾹 상세정보를 불러오는 중…</div>';
  try {
    const no = product.sku || String(product.id).replace("live-domeggook-", "");
    const response = await fetch(
      "/api/item-detail?source=domeggook&no=" + encodeURIComponent(no),
      { signal: AbortSignal.timeout(15000) },
    );
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(data.error || "상세 정보를 불러오지 못했습니다.");
    if ($("productDialog").dataset.product !== product.id) return;
    state.detail = data;
    renderDetail(data);
  } catch (error) {
    if ($("productDialog").dataset.product !== product.id) return;
    box.innerHTML = `<div class="detail-live-heading">상세 정보를 불러오지 못했습니다: ${esc(error.message)}</div>`;
  }
}

function refreshOpenDialogs() {
  if ($("productDialog").open)
    showProduct($("productDialog").dataset.product, false);
  if ($("compareDialog").open) renderComparison();
}

function renderComparison() {
  const products = [...state.compare.values()];
  if (!products.length) {
    $("compareDialog").close();
    return;
  }
  const row = (title, content, cls = "") =>
    `<tr><th scope="row">${title}</th>${products.map((product) => `<td class="${cls}">${content(product)}</td>`).join("")}</tr>`;
  $("compareContent").innerHTML =
    `<table class="compare-table"><thead><tr><th scope="col">비교 항목</th>${products.map((product) => `<th scope="col">${productVisual(product, "compare-art")}${esc(product.name)}<small>${kindLabel(product)} · ${esc(getSource(product).name)}</small><button class="compare-remove" data-action="compare" data-id="${esc(product.id)}">비교에서 제외 ${icon("x")}</button></th>`).join("")}</tr></thead><tbody>${row("도매 공급가", (product) => money(product.wholesalePrice))}${row("공급사 배송비", (product) => money(product.shippingFee))}${row("최소 주문", (product) => (product.minOrder === null ? "확인 필요" : product.minOrder.toLocaleString("ko-KR") + "개"))}${row("판매 방식", (product) => FULFILLMENTS[product.fulfillment] || "확인 필요")}${row("권장 판매가", (product) => money(estimateProduct(product)?.salePrice))}${row(
      "예상 이익",
      (product) => {
        const estimate = estimateProduct(product);
        return estimate ? "+" + money(estimate.netProfit) : "계산 불가";
      },
      "profit-cell",
    )}${row("원문·판매 후보", (product) => `${productLink(product) ? `<a class="button button-secondary" href="${esc(productLink(product))}" target="_blank" rel="noopener noreferrer">${product.dataKind === "demo" ? "유사 상품 찾기" : "공급사 확인"} ${icon("arrow-up-right")}</a><br>` : ""}<button class="button ${state.selected.has(product.id) ? "button-secondary" : "button-primary"}" data-action="select" data-id="${esc(product.id)}" aria-pressed="${state.selected.has(product.id)}">${icon(state.selected.has(product.id) ? "check" : "plus")}${state.selected.has(product.id) ? "선택 해제" : "판매 후보 선택"}</button>`)}</tbody></table>`;
}

async function loadMeta() {
  try {
    const response = await fetch("/api/catalog", {
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error("catalog");
    state.integrations = { ...state.integrations, ...(data.integrations || {}) };
    if (Array.isArray(data.keywords) && data.keywords.length)
      state.keywords = data.keywords;
    if (data.wing) state.wing = data.wing;
  } catch {
    state.integrations = state.integrations || {};
  } finally {
    state.loading = false;
    renderSourceFilter();
    renderIntegrationStatus();
    renderCatalog();
  }
}

function renderIntegrationStatus() {
  const chips = [];
  const add = (label, ok, extra) =>
    chips.push(
      `<span class="integration-chip ${ok ? "is-on" : "is-off"}">${icon(ok ? "check" : "x")}${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ""}</span>`,
    );
  add("도매꾹 실시간 조회", state.integrations.domeggook);
  add(
    "오너클랜 판매사 API",
    state.integrations.ownerclan,
    state.integrations.ownerclan ? "" : "인증 정보 필요",
  );
  add(
    "쿠팡 WING 등록",
    state.integrations.wing,
    state.integrations.wing ? "" : "키 미설정",
  );
  add("AI 초안", state.integrations.seo, state.integrations.seo ? "" : "키 미설정");
  const consignmentLabel = $("consignment")?.closest("label");
  if (consignmentLabel)
    consignmentLabel.classList.toggle("is-hidden", state.mode === "live");
  $("apiStatus").innerHTML =
    '<div class="integration-row">' +
    chips.join("") +
    '</div><p class="integration-help">도매꾹 Open API 4.1/4.6으로 상품 목록·상세를 실제 조회합니다. 연결되지 않은 소싱처는 결과에 섞이지 않습니다.</p>';
}

function renderSourceFilter() {
  const select = $("sourceFilter");
  if (state.mode === "live") {
    select.innerHTML =
      '<option value="domeggook">도매꾹 (실시간 API)</option>' +
      `<option value="ownerclan"${state.integrations.ownerclan ? "" : " disabled"}>오너클랜${state.integrations.ownerclan ? " (실시간 API)" : " · 미연결"}</option>`;
    select.value = state.source;
    select.closest(".filter-group")?.classList.remove("is-hidden");
    return;
  }
  select.innerHTML =
    '<option value="all">전체 소싱처</option>' +
    SOURCES.map(
      (source) => `<option value="${source.id}">${source.name}</option>`,
    ).join("") +
    '<option value="other">기타 공급사</option>';
}

function cancelLive() {
  liveRequestId++;
  liveController?.abort();
  state.liveLoading = false;
}

function sourceLabel(source = state.source) {
  return source === "ownerclan" ? "오너클랜" : "도매꾹";
}

async function searchLive(append = false) {
  const source = state.source;
  const available =
    source === "ownerclan"
      ? state.integrations.ownerclan
      : state.integrations.domeggook;
  if (!available) {
    state.liveError =
      sourceLabel() + " API가 연결되지 않았습니다. 서버 설정을 확인해주세요.";
    state.liveProducts = [];
    renderCatalog();
    return;
  }
  const query = state.query.trim();
  if (!query) {
    cancelLive();
    state.liveProducts = [];
    state.liveQuery = "";
    state.liveError = "";
    state.liveHasMore = false;
    state.liveTotal = null;
    renderCatalog();
    return;
  }
  cancelLive();
  const requestId = liveRequestId;
  liveController = new AbortController();
  if (!append) {
    state.liveProducts = [];
    state.livePage = 0;
    state.liveQuery = "";
    state.liveHasMore = false;
    state.liveCursor = null;
    state.liveTotal = null;
    state.page = 1;
  }
  state.liveLoading = true;
  state.liveError = "";
  renderCatalog();
  try {
    const active = filters();
    const params = new URLSearchParams({
      mode: "live",
      source,
      q: query,
      pageSize: "40",
      page: String(append ? state.livePage + 1 : 1),
    });
    if (source === "ownerclan") {
      params.delete("page");
      if (append && state.liveCursor) params.set("cursor", state.liveCursor);
    }
    if (/^\d+$/.test(active.minPrice)) params.set("minPrice", active.minPrice);
    if (/^\d+$/.test(active.maxPrice)) params.set("maxPrice", active.maxPrice);
    if (active.singleOrder) params.set("singleOrder", "true");
    if (active.freeShipping) params.set("freeShipping", "true");
    const response = await fetch("/api/products?" + params, {
      signal: AbortSignal.any([
        liveController.signal,
        AbortSignal.timeout(20000),
      ]),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(data.error || sourceLabel() + " 상품을 조회하지 못했습니다.");
    if (!Array.isArray(data.products) || !data.products.every(isStoredProduct))
      throw new Error("상품 응답 형식이 올바르지 않습니다.");
    if (
      requestId !== liveRequestId ||
      state.mode !== "live" ||
      state.view !== "discover"
    )
      return;
    state.liveProducts = [
      ...new Map(
        (append
          ? [...state.liveProducts, ...data.products]
          : data.products
        ).map((product) => [product.id, product]),
      ).values(),
    ];
    state.livePage = data.page || 1;
    state.liveQuery = query;
    state.liveHasMore = Boolean(data.hasMore);
    state.liveCursor = data.nextCursor || null;
    state.liveTotal = Number.isFinite(data.total) ? data.total : null;
    state.liveNote = data.note || "";
  } catch (error) {
    if (requestId === liveRequestId && error.name !== "AbortError")
      state.liveError = error.message || sourceLabel() + "에 연결하지 못했습니다.";
  } finally {
    if (requestId === liveRequestId) {
      state.liveLoading = false;
      renderCatalog();
    }
  }
}

function refreshLive() {
  if (state.mode === "live" && state.view === "discover" && state.query)
    searchLive();
  else renderCatalog();
}

function applySearch() {
  state.query = $("searchInput").value.trim().slice(0, 100);
  state.page = 1;
  renderSources();
  syncUrl();
  if (state.mode === "live" && state.view === "discover") searchLive();
  else renderCatalog();
}
function stopSeo() {
  seoRequestId++;
  seoController?.abort();
  $("generateSeo").disabled = false;
  $("generateSeo").innerHTML = icon("sparkles") + "상품명·태그 초안 만들기";
}

function defaultDraft(product) {
  return {
    name: product.name,
    price:
      product.wholesalePrice === null ? "" : String(product.wholesalePrice),
    shipping: product.shippingFee === null ? "" : String(product.shippingFee),
    margin: "30",
    fee: "10.8",
    description: product.dataKind === "demo" ? "" : product.description || "",
    seoName: "",
    tags: [],
    points: [],
    seoNote: "",
  };
}

function readDraft() {
  const previous = state.drafts.get(state.activeProduct) || {};
  return {
    ...previous,
    name: $("editName").value,
    price: $("editPrice").value,
    shipping: $("editShipping").value,
    margin: $("editMargin").value,
    fee: $("editFee").value,
    description: $("editDescription").value,
    seoName: $("editSeoName").value,
  };
}

function flushDraft() {
  if (
    state.view !== "preparation" ||
    !state.activeProduct ||
    !state.selected.has(state.activeProduct) ||
    $("prepareLayout").hidden ||
    $("prepareForm").dataset.product !== state.activeProduct
  )
    return;
  state.drafts.set(state.activeProduct, readDraft());
  const success = persist();
  $("draftStatus").textContent = success
    ? "이 브라우저에 자동 저장됨"
    : "저장 실패 · CSV 내보내기 권장";
}

function getMargin() {
  for (const field of ["editPrice", "editShipping", "editMargin", "editFee"])
    if (!$(field).validity.valid || $(field).value === "")
      throw new Error("공급가·배송비·마진율·수수료율을 올바르게 입력해주세요.");
  return calculateSafePrice(
    $("editPrice").value,
    $("editShipping").value,
    Number($("editMargin").value) / 100,
    Number($("editFee").value) / 100,
  );
}

function renderMargin() {
  try {
    const result = getMargin();
    $("marginError").hidden = true;
    $("marginResult").className = "margin-result";
    $("marginResult").innerHTML =
      `<div class="margin-stat"><span>권장 판매가 · 무료배송 가정</span><strong>${money(result.salePrice)}</strong></div><div class="margin-stat profit"><span>1개 판매 시 예상 이익</span><strong>+${money(result.netProfit)}</strong></div><div class="margin-breakdown"><span>총 원가 <b>${money(result.totalCost)}</b></span><span>수수료 <b>${money(result.coupangFee)}</b></span><span>추정 마진율 <b>${result.marginRate}%</b></span></div>`;
  } catch (error) {
    $("marginError").textContent = error.message;
    $("marginError").hidden = false;
    $("marginResult").className = "margin-result is-invalid";
    $("marginResult").textContent =
      "입력값 확인 후 권장 판매가와 예상 이익을 계산합니다.";
  }
}

function renderSeoOutput(draft) {
  $("editSeoName").value = draft.seoName || "";
  $("seoTags").innerHTML = (draft.tags || [])
    .map((tag) => `<span class="tag">#${esc(tag)}</span>`)
    .join("");
  $("seoPoints").innerHTML = (draft.points || [])
    .map((point) => `<li>${esc(point)}</li>`)
    .join("");
  $("seoNote").textContent =
    draft.seoNote ||
    (state.integrations.seo
      ? "AI 연결됨 · 버튼을 누르면 상품명·설명이 설정된 AI 제공자에게 전송됩니다. 생성 결과는 직접 검토하세요."
      : "AI 미연결 · 입력한 사실만 기본 템플릿으로 정리합니다.");
}

function renderPreparation() {
  $("prepareEmpty").hidden = state.selected.size > 0;
  $("prepareLayout").hidden = !state.selected.size;
  $("candidateCount").textContent = state.selected.size;
  if (!state.selected.size) {
    state.activeProduct = null;
    $("prepareForm").dataset.product = "";
    return;
  }
  if (!state.selected.has(state.activeProduct))
    state.activeProduct = state.selected.keys().next().value;
  $("candidateList").innerHTML = [...state.selected.values()]
    .map(
      (product) =>
        `<div class="candidate-item ${product.id === state.activeProduct ? "active" : ""}"><button class="candidate-pick" data-action="candidate" data-id="${esc(product.id)}" ${product.id === state.activeProduct ? 'aria-current="true"' : ""}><strong>${esc(product.name)}</strong><small>${esc(getSource(product).name)} · ${kindLabel(product)} · ${money(product.wholesalePrice)}</small></button><button class="icon-button" data-action="select" data-id="${esc(product.id)}" aria-label="${esc(product.name)} 판매 후보 해제">${icon("x")}</button></div>`,
    )
    .join("");
  const product = state.selected.get(state.activeProduct);
  const draft = {
    ...defaultDraft(product),
    ...state.drafts.get(state.activeProduct),
  };
  state.drafts.set(state.activeProduct, draft);
  $("prepareForm").dataset.product = state.activeProduct;
  const link = productLink(product);
  $("editorSource").innerHTML =
    `${esc(getSource(product).name)} · ${kindLabel(product)} · 최소 ${product.minOrder === null ? "수량 확인 필요" : product.minOrder + "개"} ${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${product.dataKind === "demo" ? "유사 상품 찾기" : "공급사 확인"} ${icon("arrow-up-right")}</a>` : ""}`;
  $("editorDemoNotice").hidden = product.dataKind !== "demo";
  for (const [id, key] of [
    ["editName", "name"],
    ["editPrice", "price"],
    ["editShipping", "shipping"],
    ["editMargin", "margin"],
    ["editFee", "fee"],
    ["editDescription", "description"],
  ])
    $(id).value = draft[key];
  $("draftStatus").textContent = state.storageFailed
    ? "저장 공간 확인 필요"
    : "이 브라우저에 자동 저장";
  renderSeoOutput(draft);
  renderMargin();
  renderRegisterResult();
}

async function generateSeo() {
  if (!$("editName").reportValidity()) return;
  if (!$("editName").value.trim()) return toast("상품명을 입력해주세요.");
  flushDraft();
  stopSeo();
  const id = state.activeProduct,
    requestId = seoRequestId,
    draft = state.drafts.get(id);
  const product = state.selected.get(id);
  seoController = new AbortController();
  $("generateSeo").disabled = true;
  $("generateSeo").innerHTML = '<span class="spinner"></span>초안 작성 중…';
  try {
    const response = await fetch("/api/generate-seo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([
        seoController.signal,
        AbortSignal.timeout(20000),
      ]),
      body: JSON.stringify({
        name: draft.name.trim(),
        description: draft.description,
        category: categoryName(product.categoryId),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.result)
      throw new Error(data.error || "초안을 생성하지 못했습니다.");
    if (requestId !== seoRequestId || id !== state.activeProduct) return;
    if (
      $("editName").value !== draft.name ||
      $("editDescription").value !== draft.description
    )
      return toast("입력 정보가 변경되었어요. 초안을 다시 생성해주세요.");
    const updated = {
      ...readDraft(),
      seoName: data.result.productName || draft.name,
      tags: data.result.searchTags || [],
      points: data.result.sellingPoints || [],
      seoNote: data.note || "상품 등록 전 사실을 확인하세요.",
    };
    state.drafts.set(id, updated);
    renderSeoOutput(updated);
    persist();
    toast(
      data.mode === "template"
        ? "AI 미연결 · 입력 정보를 이용한 기본 초안을 만들었어요."
        : "AI 초안을 만들었어요. 판매 전 내용을 검토하세요.",
    );
  } catch (error) {
    if (requestId === seoRequestId && error.name !== "AbortError") {
      $("seoNote").textContent = error.message;
      toast(error.message);
    }
  } finally {
    if (requestId === seoRequestId) {
      $("generateSeo").disabled = false;
      $("generateSeo").innerHTML = icon("sparkles") + "상품명·태그 초안 만들기";
    }
  }
}

async function copyDraft() {
  if (!$("editName").reportValidity() || !$("editName").value.trim()) return;
  let estimate;
  try {
    estimate = getMargin();
  } catch (error) {
    toast(error.message);
    return;
  }
  flushDraft();
  const draft = state.drafts.get(state.activeProduct),
    product = state.selected.get(state.activeProduct);
  const text = [
    product.dataKind === "demo"
      ? "주의: 예시 상품. 공급사 실제 정보 확인 필요."
      : "상품 등록 준비용 초안. 공급 조건 최종 확인 필요.",
    "상품명: " + (draft.seoName.trim() || draft.name.trim()),
    "소싱처: " + getSource(product).name,
    "도매 공급가: " + money(estimate.wholesalePrice),
    "공급사 배송비: " + money(estimate.wholesaleShipping),
    "권장 판매가: " + money(estimate.salePrice),
    "추정 이익: " + money(estimate.netProfit),
    "추정 마진율: " + estimate.marginRate + "%",
    "검색 태그: " + (draft.tags || []).join(", "),
    "상품 설명: " + draft.description,
    "공급사 확인 링크: " + productLink(product),
    "쿠팡 등록은 ‘쿠팡 WING에 등록 실행’ 또는 ‘피클 비서에게 등록 요청’으로 진행합니다.",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("등록 준비 데이터를 복사했어요. WING에서 검토 후 직접 등록하세요.");
  } catch {
    toast(
      "복사 권한을 사용할 수 없습니다. 선택 상품 CSV 내보내기를 이용해주세요.",
    );
  }
}

async function copyForPickle() {
  if (!$("editName").reportValidity() || !$("editName").value.trim()) return;
  let estimate;
  try {
    estimate = getMargin();
  } catch (error) {
    toast(error.message);
    return;
  }
  flushDraft();
  const draft = state.drafts.get(state.activeProduct),
    product = state.selected.get(state.activeProduct);
  const text = [
    "[피클 상품 등록 요청]",
    "- 상품명: " + (draft.seoName.trim() || draft.name.trim()),
    "- 소싱처: " + getSource(product).name + (productLink(product) ? " (" + productLink(product) + ")" : ""),
    "- 상품코드: " + (product.sku || "미확인"),
    "- 도매원가: " + money(estimate.wholesalePrice) + " (배송비 " + money(estimate.wholesaleShipping) + ")",
    "- 최소주문: " + (product.minOrder ?? "확인 필요") + "개 / 재고: " + (state.detail?.no === product.sku && state.detail?.inventory !== null ? state.detail.inventory + "개" : "상세 확인"),
    "- 쿠팡 판매가: " + money(estimate.salePrice) + " (무료배송)",
    "- 목표마진: " + estimate.marginRate + "% (예상 순수익 " + money(estimate.netProfit) + ")",
    "- 검색 태그: " + (draft.tags || []).join(", "),
    "- 핵심 소구점: " + (draft.points || []).join(" / "),
    "- 반품배송비: 초도 10,000원 / 반품 10,000원 (왕복 20,000원)",
    "위 조건으로 쿠팡 WING에 대행 등록해줘!",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("피클 비서 등록 요청문을 복사했어요! 피클 대화창에 붙여넣으시면 즉시 WING 등록을 진행합니다.");
  } catch {
    toast("복사 권한을 사용할 수 없습니다.");
  }
}

function noticeTemplate(kind, product, detail) {
  const model = detail?.detail?.model || product.sku || product.name;
  const maker = detail?.detail?.manufacturer || getSource(product).name;
  const origin = detail?.detail?.origin || "상세설명 참조";
  const base = [
    { categoryName: kind, detailName: "품명 및 모델명", content: model },
    { categoryName: kind, detailName: "제조자/수입자", content: maker },
    { categoryName: kind, detailName: "제조국", content: origin },
    {
      categoryName: kind,
      detailName: "A/S 책임자와 전화번호",
      content: "아모가 010-2846-8906",
    },
  ];
  if (kind === "패션잡화")
    base.push({
      categoryName: kind,
      detailName: "크기",
      content: detail?.detail?.size || "상세설명 참조",
    });
  return base;
}

function registrationInput() {
  const draft = state.drafts.get(state.activeProduct),
    product = state.selected.get(state.activeProduct);
  if (!draft || !product) throw new Error("판매 후보를 먼저 선택해주세요.");
  const estimate = getMargin();
  const detail =
    state.detail && state.detail.no === (product.sku || "")
      ? state.detail
      : null;
  const images = [];
  for (const url of [product.imageUrl, detail?.image]) {
    if (url && !images.includes(url)) images.push(url);
  }
  return {
    product,
    estimate,
    detail,
    input: {
      name: (draft.seoName || draft.name || product.name).trim(),
      itemName: (draft.name || product.name).trim(),
      salePrice: estimate.salePrice,
      originalPrice: estimate.salePrice,
      displayCategoryCode: $("wingCategory").value.trim(),
      images,
      description: draft.description || product.description || "",
      sku: product.sku || "",
      deliveryCharge: 0,
      returnCharge: 10000,
      attributes: [],
      notices: noticeTemplate($("wingNotice").value, product, detail),
    },
  };
}

async function registerToWing() {
  if (!$("editName").reportValidity()) return;
  flushDraft();
  let prepared;
  try {
    prepared = registrationInput();
  } catch (error) {
    return toast(error.message);
  }
  state.registerLoading = true;
  renderRegisterResult();
  try {
    const response = await fetch("/api/register-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify(prepared.input),
    });
    const data = await response.json();
    state.registerResult = data;
    if (data.ok)
      toast(
        "쿠팡에 상품 등록을 요청했고 쿠팡이 접수했습니다. WING에서 승인 상태를 확인하세요.",
      );
    else toast(data.error || "쿠팡이 등록 요청을 거부했습니다.");
  } catch (error) {
    state.registerResult = {
      ok: false,
      error:
        error.name === "TimeoutError"
          ? "쿠팡 응답이 40초 안에 오지 않았습니다."
          : "등록 요청을 보내지 못했습니다: " + error.message,
    };
  } finally {
    state.registerLoading = false;
    renderRegisterResult();
  }
}

function renderRegisterResult() {
  const box = $("registerResult");
  if (!box) return;
  if (state.registerLoading) {
    box.hidden = false;
    box.className = "alert alert-info";
    box.innerHTML =
      '<span class="spinner"></span><p>쿠팡 WING Open API로 등록을 요청하는 중입니다…</p>';
    return;
  }
  const result = state.registerResult;
  if (!result) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.className = "alert " + (result.ok ? "alert-success" : "alert-error");
  const detailBits = [];
  if (result.status) detailBits.push("HTTP " + result.status);
  if (result.code) detailBits.push("코드 " + result.code);
  if (result.message) detailBits.push(String(result.message).slice(0, 300));
  if (Array.isArray(result.problems) && result.problems.length)
    detailBits.push("부족한 항목: " + result.problems.join(", "));
  if (result.detail?.code) detailBits.push("상세: " + result.detail.code);
  box.innerHTML =
    `<p><strong>${result.ok ? "쿠팡 등록 요청 접수됨" : "쿠팡이 등록을 거부했습니다."}</strong> ` +
    esc(result.error || "") +
    (detailBits.length ? "<br>" + esc(detailBits.join(" · ")) : "") +
    "</p>" +
    (result.ok
      ? ""
      : '<p class="form-hint">쿠팡 Open API는 WING &gt; 판매자정보 &gt; 추가판매정보에 등록한 IP에서만 호출됩니다. 이 앱은 Cloudflare에서 실행되어 송신 IP가 매번 달라지므로 등록 IP와 일치하지 않을 수 있습니다. WING 화면 등록은 아래 <strong>피클 비서에게 등록 요청 복사</strong>로 진행하세요.</p>');
}

function downloadWingPayload() {
  if (!$("editName").reportValidity() || !$("editName").value.trim()) return;
  flushDraft();
  let prepared;
  try {
    prepared = registrationInput();
  } catch (error) {
    return toast(error.message);
  }
  downloadFile(
    JSON.stringify(prepared.input, null, 2),
    "쿠팡등록_페이로드_" + (prepared.input.name || "상품").slice(0, 15) + ".json",
  );
  toast("쿠팡 상품 등록 API 페이로드(JSON)를 내려받았습니다.");
}


function downloadFile(content, filename) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openImport() {
  importRequestId++;
  state.pendingImport = null;
  $("csvFile").value = "";
  $("csvText").value = "";
  $("importPreview").hidden = true;
  $("importPreview").innerHTML = "";
  $("importError").hidden = true;
  $("confirmImport").disabled = true;
  $("confirmImport").innerHTML = icon("check") + "상품 가져오기";
  openDialog("importDialog");
}

function clearImportPreview() {
  state.pendingImport = null;
  $("confirmImport").disabled = true;
  $("importPreview").hidden = true;
  $("importError").hidden = true;
}

function previewImport(text) {
  clearImportPreview();
  try {
    const result = importCsv(text);
    state.pendingImport = result;
    $("importPreview").hidden = false;
    $("importPreview").innerHTML =
      `<div class="import-preview-heading"><strong>${result.products.length}개 상품</strong> 가져오기 가능 · 오류 ${result.errors.length}행${result.duplicates ? " · 중복 " + result.duplicates + "행 (마지막 값 반영)" : ""}</div>${
        result.products.length
          ? `<table class="import-preview-table"><thead><tr><th>상품명 (처음 5개)</th><th>공급가</th><th>소싱처</th></tr></thead><tbody>${result.products
              .slice(0, 5)
              .map(
                (product) =>
                  `<tr><td>${esc(product.name)}</td><td>${money(product.wholesalePrice)}</td><td>${esc(getSource(product).name)}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : ""
      }${
        result.errors.length
          ? `<ul class="import-preview-errors">${result.errors
              .slice(0, 8)
              .map((error) => `<li>${error.row}행: ${esc(error.message)}</li>`)
              .join(
                "",
              )}${result.errors.length > 8 ? "<li>그 외 " + (result.errors.length - 8) + "개 오류</li>" : ""}</ul>`
          : ""
      }`;
    $("confirmImport").disabled = !result.products.length;
    $("confirmImport").innerHTML =
      icon("check") +
      (result.errors.length
        ? `정상 ${result.products.length}개만 가져오기`
        : `${result.products.length}개 상품 가져오기`);
  } catch (error) {
    $("importError").textContent = error.message;
    $("importError").hidden = false;
  }
}

function confirmImport() {
  const pending = state.pendingImport;
  if (!pending?.products.length) return;
  const merged = new Map(
    state.imported.map((product) => [product.id, product]),
  );
  let updated = 0;
  for (const product of pending.products) {
    if (merged.has(product.id)) updated++;
    merged.set(product.id, product);
  }
  if (merged.size > MAX_PRODUCTS) {
    $("importError").textContent =
      "이 브라우저에는 최대 1,000개 상품을 가져올 수 있습니다. 기존 목록을 정리하거나 파일을 줄여주세요.";
    $("importError").hidden = false;
    return;
  }
  flushDraft();
  stopSeo();
  cancelLive();
  state.imported = [...merged.values()];
  for (const collection of [state.favorites, state.selected, state.compare])
    for (const product of pending.products)
      if (collection.has(product.id)) collection.set(product.id, product);
  state.mode = "imported";
  $("dataMode").value = "imported";
  const success = persist();
  $("importDialog").close();
  state.pendingImport = null;
  setView("discover");
  resetFilters(true);
  renderBadges();
  renderCatalog();
  renderSources();
  syncUrl();
  toast(
    success
      ? `${pending.products.length}개 상품을 가져왔어요${updated ? " · 기존 " + updated + "개 업데이트" : ""}.`
      : "가져왔지만 브라우저 저장에 실패했어요. 새로고침 전에 CSV로 내보내세요.",
  );
}

function exportSelection() {
  flushDraft();
  const products = [...state.selected.values()].map((product) => {
    const draft = state.drafts.get(product.id);
    if (!draft) return product;
    const validMoney = (value) =>
      /^\d+$/.test(value) && Number(value) <= 100000000;
    return {
      ...product,
      name: draft.name.trim() || product.name,
      wholesalePrice: validMoney(draft.price)
        ? Number(draft.price)
        : product.wholesalePrice,
      shippingFee: validMoney(draft.shipping)
        ? Number(draft.shipping)
        : product.shippingFee,
      description: draft.description || product.description,
    };
  });
  if (products.length)
    downloadFile(exportProducts(products), "판매후보_상품.csv");
}

// One delegated handler keeps generated cards free of inline JavaScript.
document.addEventListener("click", (event) => {
  const target = event.target.closest(
    "[data-action], [data-view], [data-query], [data-close], [data-page], [data-category], [data-keyword], [data-filter-clear]",
  );
  if (!target || target.disabled) return;
  if (target.dataset.view) {
    setView(target.dataset.view);
    return;
  }
  if (target.dataset.close) {
    $(target.dataset.close).close();
    return;
  }
  if (target.dataset.query) {
    $("searchInput").value = target.dataset.query;
    applySearch();
    return;
  }
  if (target.dataset.keyword) {
    $("searchInput").value = target.dataset.keyword;
    applySearch();
    return;
  }
  if (target.dataset.category) {
    state.category = target.dataset.category;
    state.page = 1;
    renderCatalog();
    syncUrl();
    return;
  }
  if (target.dataset.page) {
    state.page = Number(target.dataset.page);
    renderCatalog();
    $("resultsHeading").scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    return;
  }
  if (target.dataset.filterClear) {
    const key = target.dataset.filterClear;
    if (key === "query") {
      $("searchInput").value = "";
      applySearch();
    } else if (key === "category") state.category = "all";
    else if (key === "sourceFilter") $("sourceFilter").value = "all";
    else if (key === "price") {
      $("minPrice").value = "";
      $("maxPrice").value = "";
    } else $(key).checked = false;
    state.page = 1;
    renderCatalog();
    syncUrl();
    return;
  }
  const id = target.dataset.id;
  switch (target.dataset.action) {
    case "favorite":
      toggleFavorite(id);
      break;
    case "select":
      toggleSelected(id);
      break;
    case "compare":
      toggleCompare(id);
      break;
    case "detail":
      showProduct(id);
      break;
    case "sources-open":
      renderSources();
      openDialog("sourcesDialog");
      closeSidebar();
      break;
    case "import-open":
      openImport();
      closeSidebar();
      break;
    case "manual-open":
      $("manualForm").reset();
      $("manualCategory").value = "other";
      $("manualError").hidden = true;
      openDialog("manualDialog");
      closeSidebar();
      $("manualName").focus();
      break;
    case "retry":
      state.mode === "live" ? searchLive() : renderCatalog();
      break;
    case "load-live":
      searchLive(true);
      break;
    case "reset-all":
      resetFilters(true);
      applySearch();
      break;
    case "candidate":
      flushDraft();
      stopSeo();
      state.activeProduct = id;
      renderPreparation();
      break;
    case "clear-imported":
      if (
        confirm(
          "가져온 카탈로그를 모두 삭제할까요? 관심 상품·판매 후보로 저장한 상품과 초안은 유지됩니다.",
        )
      ) {
        state.imported = [];
        persist();
        renderBadges();
        renderCatalog();
      }
      break;
  }
});

$("searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  applySearch();
});
$("searchInput").addEventListener("input", () => {
  renderSources();
  if (!$("searchInput").value && state.query) applySearch();
});
$("dataMode").addEventListener("change", () => {
  cancelLive();
  state.mode = $("dataMode").value === "imported" ? "imported" : "live";
  resetFilters(false);
  persist();
  renderSourceFilter();
  renderBadges();
  renderCatalog();
  syncUrl();
  if (state.mode === "live") searchLive();
});
$("sourceFilter").addEventListener("change", () => {
  if (state.mode !== "live") return;
  state.source = $("sourceFilter").value === "ownerclan" ? "ownerclan" : "domeggook";
  syncUrl();
  searchLive();
});
for (const key of [
  "singleOrder",
  "freeShipping",
  "consignment",
  "sortOrder",
])
  $(key).addEventListener("change", () => {
    state.page = 1;
    syncUrl();
    if (state.mode === "live" && state.view === "discover") refreshLive();
    else renderCatalog();
  });
let priceTimer;
for (const key of ["minPrice", "maxPrice"])
  $(key).addEventListener("input", () => {
    state.page = 1;
    syncUrl();
    if (!validatePriceFilters()) {
      renderCatalog();
      return;
    }
    clearTimeout(priceTimer);
    priceTimer = setTimeout(() => {
      if (state.mode === "live" && state.view === "discover" && state.query)
        searchLive();
      else renderCatalog();
    }, 400);
  });
$("resetFilters").addEventListener("click", () => {
  resetFilters();
  syncUrl();
  if (state.mode === "live" && state.view === "discover" && state.query)
    searchLive();
  else renderCatalog();
});
$("filterToggle").addEventListener("click", () => {
  const open = $("filtersPanel").classList.toggle("open");
  $("filterToggle").setAttribute("aria-expanded", String(open));
  if (open)
    $("filtersPanel").scrollIntoView({ block: "start", behavior: "auto" });
});
$("compareOpen").addEventListener("click", () => {
  if (state.compare.size >= 2) {
    renderComparison();
    openDialog("compareDialog");
  }
});
$("clearSelection").addEventListener("click", () => {
  state.selected.clear();
  state.activeProduct = null;
  persist();
  renderBadges();
  renderCatalog();
  toast("판매 후보 선택을 해제했어요. 작성한 초안은 유지됩니다.");
});
$("menuToggle").addEventListener("click", () => {
  const open = $("sidebar").classList.toggle("open");
  $("sidebarBackdrop").hidden = !open;
  $("menuToggle").setAttribute("aria-expanded", String(open));
  $("sidebar").inert = !open;
  $("sidebar").setAttribute("aria-hidden", String(!open));
  if (open) $("sidebar").querySelector("[aria-current='page']")?.focus();
});
$("sidebarBackdrop").addEventListener("click", () => {
  closeSidebar();
  $("menuToggle").focus();
});
matchMedia("(max-width: 760px)").addEventListener("change", closeSidebar);
document.addEventListener("keydown", (event) => {
  if (!$("sidebar").classList.contains("open")) return;
  if (event.key === "Escape") {
    closeSidebar();
    $("menuToggle").focus();
  }
  if (event.key === "Tab") {
    const items = [
      ...$("sidebar").querySelectorAll("a, button:not(:disabled)"),
    ];
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    if ($("toast").parentElement === dialog)
      document.body.appendChild($("toast"));
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close();
    }
  });
}
$("prepareForm").addEventListener("submit", (event) => event.preventDefault());
$("prepareForm").addEventListener("input", (event) => {
  if (!state.activeProduct) return;
  if (event.target.id === "editName" || event.target.id === "editDescription") {
    const draft = state.drafts.get(state.activeProduct);
    if (draft && (draft.seoName || draft.tags?.length)) {
      draft.seoName = "";
      draft.tags = [];
      draft.points = [];
      draft.seoNote =
        "공급 정보가 변경되었어요. 상품 등록 초안을 다시 작성해주세요.";
      renderSeoOutput(draft);
    }
  }
  flushDraft();
  renderMargin();
});
$("generateSeo").addEventListener("click", generateSeo);
$("copyDraft").addEventListener("click", copyDraft);
$("copyForPickle")?.addEventListener("click", copyForPickle);
$("registerWing")?.addEventListener("click", registerToWing);
$("downloadWingPayload")?.addEventListener("click", downloadWingPayload);
$("downloadTemplate").addEventListener("click", () =>
  downloadFile(CSV_TEMPLATE, "상품_가져오기_양식.csv"),
);
$("previewCsv").addEventListener("click", () => {
  importRequestId++;
  previewImport($("csvText").value);
});
$("csvText").addEventListener("input", () => {
  importRequestId++;
  clearImportPreview();
});
$("csvFile").addEventListener("change", async () => {
  const file = $("csvFile").files[0],
    requestId = ++importRequestId;
  clearImportPreview();
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES)
      throw new Error("파일은 2MB 이하여야 합니다.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (requestId === importRequestId) previewImport(text);
  } catch {
    if (requestId === importRequestId) {
      $("importError").textContent =
        "파일을 읽을 수 없습니다. 2MB 이하 UTF-8 CSV 파일인지 확인해주세요.";
      $("importError").hidden = false;
    }
  }
});
$("confirmImport").addEventListener("click", confirmImport);
$("exportSelected").addEventListener("click", exportSelection);
$("exportFavorites").addEventListener("click", () => {
  if (state.favorites.size)
    downloadFile(
      exportProducts([...state.favorites.values()]),
      "관심_상품.csv",
    );
});
document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (image.tagName !== "IMG" || !image.dataset.productImage) return;
    const product = findProduct(image.dataset.productImage);
    if (!product) return;
    const wrapper = document.createElement("span");
    wrapper.innerHTML = illustration(product, image.className);
    image.replaceWith(wrapper.firstElementChild);
  },
  true,
);
window.addEventListener("pagehide", flushDraft);

// A single sourced product can be selected without preparing a CSV file.
$("sourceSuggestions").innerHTML = SOURCES.map(
  (source) => `<option value="${source.name}"></option>`,
).join("");
$("manualCategory").innerHTML = CATEGORIES.filter(
  (category) => category.id !== "all",
)
  .map((category) => `<option value="${category.id}">${category.name}</option>`)
  .join("");
$("manualCategory").value = "other";
$("manualForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("manualError").hidden = true;
  try {
    const product = normalizeImportedProduct({
      name: $("manualName").value,
      wholesalePrice: $("manualPrice").value,
      shippingFee: $("manualShipping").value,
      source: $("manualSource").value,
      category: $("manualCategory").value,
      url: $("manualUrl").value,
      minOrder: $("manualMoq").value,
      fulfillment: $("manualFulfillment").value,
      sku: $("manualSku").value,
      importMethod: "manual",
    });
    const existing = state.imported.findIndex((item) => item.id === product.id);
    if (existing < 0 && state.imported.length >= MAX_PRODUCTS)
      throw new Error("카탈로그는 최대 1,000개까지 저장할 수 있습니다.");
    if (!state.selected.has(product.id) && state.selected.size >= 100)
      throw new Error("판매 후보는 최대 100개까지 선택할 수 있습니다.");
    flushDraft();
    stopSeo();
    cancelLive();
    if (existing < 0) state.imported.push(product);
    else state.imported[existing] = product;
    for (const collection of [state.favorites, state.compare])
      if (collection.has(product.id)) collection.set(product.id, product);
    state.selected.set(product.id, product);
    const previousDraft = state.drafts.get(product.id);
    if (previousDraft) {
      // Unlike a background CSV refresh, this is an explicit edit by the user.
      state.drafts.set(product.id, {
        ...previousDraft,
        name: product.name,
        price: String(product.wholesalePrice),
        shipping:
          product.shippingFee === null ? "" : String(product.shippingFee),
        seoName: "",
        tags: [],
        points: [],
        seoNote: "공급 정보를 직접 수정했어요. 등록 초안을 다시 확인해주세요.",
      });
    }
    state.mode = "imported";
    $("dataMode").value = "imported";
    $("manualDialog").close();
    // Flush the previous editor before changing the active candidate.
    setView("preparation");
    state.activeProduct = product.id;
    renderPreparation();
    const success = persist();
    renderBadges();
    toast(
      success
        ? "직접 찾은 상품을 판매 후보로 추가했어요."
        : "추가했지만 저장에 실패했어요. CSV로 내보내주세요.",
    );
  } catch (error) {
    $("manualError").textContent = error.message;
    $("manualError").hidden = false;
  }
});

renderSources();
renderBadges();
setView(state.view, true);
loadMeta().then(() => {
  if (state.mode === "live" && state.view === "discover") {
    if (!state.query) {
      state.query = DEFAULT_QUERY;
      $("searchInput").value = DEFAULT_QUERY;
      syncUrl();
    }
    searchLive();
  }
});
