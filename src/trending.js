import { searchDomeggook, SourcingError } from "./sourcing.js";
import { calculateSafePrice } from "./margin.js";
import { assessResaleMargin, normalizeMarketPrices } from "../public/lib/margin.js";

/**
 * 판매 급등(인기 순위 상승) 상품 수집.
 *
 * 소싱처마다 공개적으로 얻을 수 있는 "판매·인기 순위" 자료가 다르다.
 * - 도매꾹 Open API 4.1: so=ha(인기상품순)·so=rd(도매꾹랭킹순). 판매 실적이 반영된 순서이며
 *   응답에서 품절·판매중지 상품은 제외된다(문서 명시).
 * - 오너클랜 공개 홈: "오너클랜 100" 순위(1~100위, 공급가 공개)와 인기 키워드 목록.
 * - 온채널 공개 상품센터: 사이트 판매랭킹순 TOP10(기준일 표시)과 베스트순(orderby=best) 목록.
 *   온채널은 비회원에게 가격을 공개하지 않아(회원전용공개) 가격은 null로 둔다.
 *
 * "급등"은 순위 자체가 아니라 순위 변화로 판정한다. 매일 1회 스냅샷을 남기고
 * 직전 집계일의 순위와 비교해 상승폭·신규 진입을 계산한다(스냅샷은 Cache API에 보관).
 */

const UA = "CoupangSellerAgent/2.0 (+https://coupang-seller-agent.luxrank.workers.dev)";
const OWNERCLAN_HOME = "https://www.ownerclan.com/";
const ONCHANNEL_INDEX = "https://www.onch3.co.kr/dbcenter_renewal/index.php";
const MAX_HTML = 4_000_000;
const FALLBACK_TOPICS = ["크리스마스", "핫팩", "수납", "방한", "캠핑"];
const TOPIC_LIMIT = 4;
const ITEMS_PER_TOPIC = 6;
const SNAPSHOT_TTL_SECONDS = 8 * 86400;
const BASELINE_LOOKBACK_DAYS = 4;

const HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "User-Agent": UA,
};

/* ── 문자열 도구 ───────────────────────────────────────────────────────── */

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] || " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const won = (value) => Number(value).toLocaleString("ko-KR") + "원";

function httpsImage(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("http://")) return "https://" + url.slice(7);
  return url.startsWith("https://") ? url : "";
}

export function kstDay(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
}

/* ── HTML 가져오기 ─────────────────────────────────────────────────────── */

async function fetchHtml(url, fetcher, timeoutMs = 12000) {
  try {
    const response = await fetcher(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!response.ok)
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    const html = (await response.text()).slice(0, MAX_HTML);
    return { ok: true, html };
  } catch (error) {
    const message = String(error?.message || error);
    return {
      ok: false,
      status: null,
      error: error?.name === "TimeoutError" ? `${Math.round(timeoutMs / 1000)}초 응답 없음` : message.slice(0, 120),
    };
  }
}

/* ── 오너클랜 공개 홈 파서 ─────────────────────────────────────────────── */

/** "오너클랜 100" 블록(1~100위)에서 순위·상품코드·상품명·공급가·이미지를 뽑는다. */
export function parseOwnerclanTop100(html) {
  const source = String(html || "");
  const start = source.indexOf("<!--오너클랜 100-->");
  const endMark = source.indexOf("<!--//오너클랜 100-->");
  const segment =
    start >= 0
      ? source.slice(start, endMark > start ? endMark : start + 400000)
      : source;
  const anchors = [];
  const iconPattern = /icon_top_(\d+)\.png/g;
  let match;
  while ((match = iconPattern.exec(segment)) !== null && anchors.length < 200)
    anchors.push({ rank: Number(match[1]), index: match.index });
  if (!anchors.length) {
    const codes = [...segment.matchAll(/<p class="code">\s*([A-Z0-9]{4,20})\s*<\/p>/g)];
    codes.slice(0, 100).forEach((codeMatch, index) =>
      anchors.push({ rank: index + 1, index: codeMatch.index }),
    );
  }
  const seen = new Set();
  const items = [];
  for (let index = 0; index < anchors.length; index++) {
    const block = segment.slice(
      anchors[index].index,
      index + 1 < anchors.length ? anchors[index + 1].index : segment.length,
    );
    const code = /<p class="code">\s*([A-Z0-9]{4,20})\s*<\/p>/.exec(block);
    const title = /<p class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!code || !title) continue;
    const name = cleanText(title[1]);
    if (!name || seen.has(code[1])) continue;
    seen.add(code[1]);
    const price = /won_color1">\s*([\d,]+)/.exec(block);
    const image = /<img[^>]+src="([^"]+)"/.exec(block);
    items.push({
      rank: anchors[index].rank,
      sku: code[1],
      name: name.slice(0, 160),
      price: price ? money(price[1]) : null,
      imageUrl: image ? httpsImage(image[1]) : "",
      url: "https://www.ownerclan.com/V2/product/view.php?selfcode=" + code[1],
    });
  }
  return items;
}

/** 홈의 "인기 키워드" 목록. */
export function parseOwnerclanKeywords(html) {
  const source = String(html || "");
  const keywords = [];
  const pattern =
    /topSearchKeyword=([^&"']+)[^>]*class="popular_products__keyword"[^>]*>#([^<]+)</g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let keyword = cleanText(match[2]);
    if (!keyword) {
      try {
        keyword = decodeURIComponent(match[1]).replace(/\+/g, " ");
      } catch {
        keyword = "";
      }
    }
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

/* ── 온채널 공개 상품센터 파서 ─────────────────────────────────────────── */

/** 사이트 판매랭킹순 TOP10 (기준일 포함). */
export function parseOnchannelRank(html) {
  const source = String(html || "");
  const basis = /판매랭킹순[\s\S]{0,120}?\(([^)]+)\)/.exec(source);
  const items = [];
  const pattern =
    /<li onclick="window\.open\('\/dbcenter_renewal\/detail\.php\?num=(\d+)'\)">\s*<img src="([^"]*)"[^>]*>\s*<div>\s*<div>(\d+)<\/div>\s*([^<]*)<\/div>/g;
  let match;
  while ((match = pattern.exec(source)) !== null && items.length < 30) {
    const name = cleanText(match[4]);
    if (!name) continue;
    items.push({
      rank: Number(match[3]),
      num: match[1],
      name: name.slice(0, 160),
      imageUrl: httpsImage(match[2]),
      url: "https://www.onch3.co.kr/dbcenter_renewal/detail.php?num=" + match[1],
    });
  }
  return { basisDate: basis ? cleanText(basis[1]) : "", items };
}

/** 상품센터 상단 인기 키워드(#수납 등). */
export function parseOnchannelKeywords(html) {
  const source = String(html || "");
  const keywords = [];
  const pattern = /href='\/dbcenter_renewal\/index\.php\?keyword=([^']+)'>#([^<]+)<\/a>/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const keyword = cleanText(match[2]);
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

/** 베스트순(orderby=best) 목록 카드. 온채널은 비회원에게 가격을 숨긴다. */
export function parseOnchannelCards(html) {
  const source = String(html || "");
  const blocks = source.split('<div class="product-card">').slice(1, 61);
  const items = [];
  for (const block of blocks) {
    const code = /name="list_count\[\]" value="([A-Z0-9]+)"/.exec(block);
    const name = /<div class="card-name">([^<]+)<\/div>/.exec(block);
    if (!code || !name) continue;
    const num = /href="\/dbcenter_renewal\/detail\.php\?num=(\d+)"/.exec(block);
    const supplier = /<span class="card-supplier">([^<]*)<\/span>/.exec(block);
    const image = /data-src="([^"]+)"/.exec(block);
    const price = /<span class="card-price">([\s\S]*?)<\/span>\s*<\/div>/.exec(block);
    const priceText = price ? cleanText(price[1]) : "";
    items.push({
      sku: code[1],
      name: cleanText(name[1]).slice(0, 160),
      num: num ? num[1] : "",
      supplier: supplier ? cleanText(supplier[1]) : "",
      imageUrl: image ? httpsImage(image[1]) : "",
      price: /회원전용/.test(priceText) ? null : money(priceText),
      url: num
        ? "https://www.onch3.co.kr/dbcenter_renewal/detail.php?num=" + num[1]
        : "",
    });
  }
  return items;
}

/* ── 스냅샷(직전 집계 대비 순위 변화) ──────────────────────────────────── */

async function readSnapshot(cache, url) {
  if (!cache) return null;
  try {
    const hit = await cache.match(new Request(url));
    if (!hit) return null;
    const data = await hit.json();
    return data && data.ranks && typeof data.ranks === "object" ? data : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cache, url, day, ranks) {
  if (!cache) return;
  try {
    await cache.put(
      new Request(url),
      new Response(JSON.stringify({ day, ranks }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${SNAPSHOT_TTL_SECONDS}`,
        },
      }),
    );
  } catch {
    /* 스냅샷은 비교용 부가 정보이므로 실패해도 조회 결과를 막지 않는다. */
  }
}

/**
 * 오늘 순위를 하루 1회 스냅샷으로 남기고, 직전 집계일의 순위를 기준선으로 읽는다.
 * 기준선이 없으면(첫 배포일) delta는 null이며 UI는 "비교 기준 준비 중"으로 표시한다.
 */
async function resolveBaseline(cache, origin, scopeKey, ranks, ctx) {
  if (!cache) return null;
  const keyOf = (day) =>
    new URL(`/api/_trend-snapshot/${encodeURIComponent(scopeKey)}/${day}`, origin).toString();
  const today = kstDay();
  const todaySnapshot = await readSnapshot(cache, keyOf(today));
  if (!todaySnapshot) {
    const write = writeSnapshot(cache, keyOf(today), today, ranks);
    // ctx.waitUntil은 반드시 ctx에 바인딩해 호출해야 한다(메서드만 떼어 쓰면 예외).
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(write);
    else await write;
  }
  for (let offset = 1; offset <= BASELINE_LOOKBACK_DAYS; offset++) {
    const snapshot = await readSnapshot(cache, keyOf(kstDay(-offset)));
    if (snapshot) return snapshot;
  }
  return null;
}

/* ── 점수·정렬 ─────────────────────────────────────────────────────────── */

/**
 * 화면 정렬용 공개 점수. 순위(최대 60) + 상승폭(최대 30) + 신규 진입(15) + 교차 인기(10).
 * 점수는 정렬 편의를 위한 것이며 판매량 예측이 아니다.
 */
export function trendScore({ rank, rankDelta, isNew, crossSource }) {
  const rankPenalty = Math.min(Math.max(rank || 100, 1), 100) * 0.6;
  const riseScore = rankDelta && rankDelta > 0 ? Math.min(30, rankDelta * 2) : 0;
  return (
    Math.round(
      (Math.max(0, 60 - rankPenalty) +
        riseScore +
        (isNew ? 15 : 0) +
        (crossSource ? 10 : 0)) *
        10,
    ) / 10
  );
}

/* ── 상품 정규화 ───────────────────────────────────────────────────────── */

function baseProduct({
  id,
  sourceId,
  sourceName,
  name,
  wholesalePrice,
  shippingFee = null,
  minOrder = 1,
  fulfillment = "consignment",
  sku,
  url,
  imageUrl,
  stock = null,
  inStock = null,
  tags = [],
  description,
}) {
  return {
    id,
    name,
    sourceId,
    sourceName,
    categoryId: "other",
    wholesalePrice,
    shippingFee,
    minOrder,
    fulfillment,
    sku,
    url,
    imageUrl,
    art: "box",
    stock,
    inStock,
    tags,
    description,
    dataKind: "live",
    capturedAt: new Date().toISOString(),
  };
}

function withTrend(product, trend) {
  return {
    ...product,
    rank: trend.rank,
    rankScope: trend.rankScope,
    rankBasisDate: trend.basisDate || null,
    prevRank: trend.prevRank,
    rankDelta: trend.rankDelta,
    isNew: trend.isNew,
    baselineDay: trend.baselineDay || null,
    topic: trend.topic || null,
    signals: trend.signals,
    trendScore: trendScore({
      rank: trend.rank,
      rankDelta: trend.rankDelta,
      isNew: trend.isNew,
      crossSource: trend.crossSource,
    }),
  };
}

function rankOf(ranks, key) {
  const value = ranks instanceof Map ? ranks.get(key) : ranks?.[key];
  return Number.isFinite(value) ? value : null;
}

function signalsFor({ rank, rankScope, rankDelta, isNew, prevRank, topic, crossLabel }) {
  const signals = [`${rankScope} ${rank}위`];
  if (topic) signals.push(`인기 키워드 ‘${topic}’`);
  if (isNew) signals.push("직전 집계 신규 진입");
  else if (rankDelta && rankDelta > 0) signals.push(`직전 집계보다 ${rankDelta}계단 상승`);
  else if (rankDelta === 0) signals.push("직전 집계와 같은 순위");
  else if (rankDelta && rankDelta < 0) signals.push(`직전 집계보다 ${Math.abs(rankDelta)}계단 하락`);
  else if (prevRank) signals.push(`${prevRank}위 → ${rank}위`);
  if (crossLabel) signals.push(crossLabel);
  return signals;
}

/* ── 수집 ─────────────────────────────────────────────────────────────── */

function priceFiltered(product, minPrice, maxPrice) {
  if (minPrice === null && maxPrice === null) return true;
  if (product.wholesalePrice === null) return false;
  if (minPrice !== null && product.wholesalePrice < minPrice) return false;
  if (maxPrice !== null && product.wholesalePrice > maxPrice) return false;
  return true;
}

function stockAllowed(product, stock) {
  if (stock === "all") return true;
  if (stock === "verified") return product.inStock === true;
  return product.inStock !== false;
}

function boundedNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) return fallback;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

export async function collectTrending(env = {}, params, options = {}) {
  const fetcher = options.fetcher || fetch;
  const ctx = options.ctx || {};
  const origin = options.origin || "https://coupang-seller-agent.luxrank.workers.dev";
  const cache = typeof caches !== "undefined" ? caches.default : null;

  const requested = String(params.get("source") || "all");
  const source = ["all", "domeggook", "ownerclan", "onchannel"].includes(requested)
    ? requested
    : "all";
  const q = cleanText(params.get("q") || "").slice(0, 40);
  const limit = boundedNumber(params.get("limit"), 24, 1, 60);
  const stock = ["available", "verified", "all"].includes(params.get("stock"))
    ? params.get("stock")
    : "available";
  const singleOrder = params.get("singleOrder") === "true";
  const freeShipping = params.get("freeShipping") === "true";
  const minPrice = params.get("minPrice") ? money(params.get("minPrice")) : null;
  const maxPrice = params.get("maxPrice") ? money(params.get("maxPrice")) : null;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice)
    throw new SourcingError("최소 가격은 최대 가격 이하여야 합니다.", 400);

  const wantOwnerclan = source === "all" || source === "ownerclan";
  const wantOnchannel = source === "all" || source === "onchannel";
  const wantDomeggook =
    (source === "all" || source === "domeggook") && Boolean(env.DOMEGGOOK_API_KEY);

  const onchannelKeyword = q || "수납";
  const [ownerclanPage, onchannelPage] = await Promise.all([
    wantOwnerclan ? fetchHtml(OWNERCLAN_HOME, fetcher) : Promise.resolve(null),
    wantOnchannel
      ? fetchHtml(
          ONCHANNEL_INDEX +
            "?keyword=" +
            encodeURIComponent(onchannelKeyword) +
            "&orderby=best",
          fetcher,
        )
      : Promise.resolve(null),
  ]);

  const ownerclanItems = ownerclanPage?.ok ? parseOwnerclanTop100(ownerclanPage.html) : [];
  const ownerclanKeywords = ownerclanPage?.ok ? parseOwnerclanKeywords(ownerclanPage.html) : [];
  const onchannelRank = onchannelPage?.ok
    ? parseOnchannelRank(onchannelPage.html)
    : { basisDate: "", items: [] };
  const onchannelKeywords = onchannelPage?.ok ? parseOnchannelKeywords(onchannelPage.html) : [];
  const onchannelBest = onchannelPage?.ok && q
    ? parseOnchannelCards(onchannelPage.html).slice(0, 5)
    : [];

  // 검색어가 있으면 순위 목록도 그 검색어에 맞는 상품만 남긴다.
  const needle = q.normalize("NFKC").toLocaleLowerCase("ko-KR");
  const matchesQuery = (name) =>
    !needle ||
    String(name || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .includes(needle);
  const ownerclanRanked = ownerclanItems.filter((item) => matchesQuery(item.name));
  const onchannelRanked = onchannelRank.items.filter((item) => matchesQuery(item.name));

  let topics;
  if (q) topics = [q];
  else {
    const shared = onchannelKeywords.filter((keyword) => ownerclanKeywords.includes(keyword));
    const merged = [...new Set([...shared, ...onchannelKeywords, ...ownerclanKeywords])];
    topics = merged.slice(0, TOPIC_LIMIT);
    if (topics.length < TOPIC_LIMIT)
      topics = [...new Set([...topics, ...FALLBACK_TOPICS])].slice(0, TOPIC_LIMIT);
  }

  const domeggookRuns = wantDomeggook
    ? await Promise.all(
        topics.map(async (topic) => {
          const search = new URLSearchParams({
            q: topic,
            pageSize: String(ITEMS_PER_TOPIC),
            page: "1",
            sort: "popular",
          });
          try {
            const data = await searchDomeggook(env, search, fetcher);
            return { topic, products: data.products || [] };
          } catch (error) {
            return { topic, error: String(error?.message || error).slice(0, 120) };
          }
        }),
      )
    : [];

  const products = [];
  const baselineDays = { domeggook: null, ownerclan: null, onchannel: null };

  // 오너클랜 100
  if (ownerclanRanked.length) {
    const ranks = new Map(ownerclanRanked.map((item) => [item.sku, item.rank]));
    const baseline = await resolveBaseline(cache, origin, "ownerclan:100", ranks, ctx);
    baselineDays.ownerclan = baseline?.day || null;
    for (const item of ownerclanRanked) {
      const prevRank = baseline ? rankOf(baseline.ranks, item.sku) : null;
      const rankDelta = baseline && prevRank ? prevRank - item.rank : null;
      const product = baseProduct({
        id: "live-ownerclan-" + item.sku,
        sourceId: "ownerclan",
        sourceName: "오너클랜",
        name: item.name,
        wholesalePrice: item.price,
        shippingFee: null,
        minOrder: 1,
        fulfillment: "consignment",
        sku: item.sku,
        url: item.url,
        imageUrl: item.imageUrl,
        stock: null,
        inStock: null,
        tags: ["오너클랜 100", item.rank + "위"],
        description:
          "오너클랜 공개 홈의 ‘오너클랜 100’ " +
          item.rank +
          "위 상품입니다. 재고·배송비·옵션은 판매사 로그인 후 상품 페이지에서 확인하세요.",
      });
      products.push(
        withTrend(product, {
          rank: item.rank,
          rankScope: "오너클랜 100",
          basisDate: null,
          prevRank,
          rankDelta,
          isNew: Boolean(baseline && !prevRank),
          baselineDay: baseline?.day || null,
          signals: signalsFor({
            rank: item.rank,
            rankScope: "오너클랜 100",
            rankDelta,
            isNew: Boolean(baseline && !prevRank),
            prevRank,
            crossSource: false,
          }),
        }),
      );
    }
  }

  // 온채널 사이트 판매랭킹 TOP10 + (검색어가 있으면) 베스트순 목록
  if (onchannelRanked.length) {
    const ranks = new Map(
      onchannelRanked.map((item) => ["onchannel-" + item.num, item.rank]),
    );
    const baseline = await resolveBaseline(cache, origin, "onchannel:rank", ranks, ctx);
    baselineDays.onchannel = baseline?.day || null;
    for (const item of onchannelRanked) {
      const key = "onchannel-" + item.num;
      const prevRank = baseline ? rankOf(baseline.ranks, key) : null;
      const rankDelta = baseline && prevRank ? prevRank - item.rank : null;
      const product = baseProduct({
        id: "live-onchannel-" + item.num,
        sourceId: "onchannel",
        sourceName: "온채널",
        name: item.name,
        wholesalePrice: null,
        shippingFee: null,
        minOrder: 1,
        fulfillment: "consignment",
        sku: item.num,
        url: item.url,
        imageUrl: item.imageUrl,
        stock: null,
        inStock: null,
        tags: ["온채널 판매랭킹", item.rank + "위"],
        description:
          "온채널 상품센터 판매랭킹순 " +
          item.rank +
          "위 상품입니다. 온채널은 비회원에게 가격을 공개하지 않아 공급가는 로그인 후 확인해야 합니다.",
      });
      products.push(
        withTrend(product, {
          rank: item.rank,
          rankScope: "온채널 판매랭킹",
          basisDate: onchannelRank.basisDate,
          prevRank,
          rankDelta,
          isNew: Boolean(baseline && !prevRank),
          baselineDay: baseline?.day || null,
          signals: signalsFor({
            rank: item.rank,
            rankScope: "온채널 판매랭킹",
            rankDelta,
            isNew: Boolean(baseline && !prevRank),
            prevRank,
          }),
        }),
      );
    }
  }

  for (const item of onchannelBest) {
    products.push(
      withTrend(
        baseProduct({
          id: "live-onchannel-" + (item.num || item.sku),
          sourceId: "onchannel",
          sourceName: "온채널",
          name: item.name,
          wholesalePrice: item.price,
          shippingFee: null,
          minOrder: 1,
          fulfillment: "consignment",
          sku: item.num || item.sku,
          url: item.url,
          imageUrl: item.imageUrl,
          stock: null,
          inStock: null,
          tags: ["온채널 베스트순", q],
          description:
            "온채널 상품센터 ‘" +
            q +
            "’ 베스트순 상품입니다." +
            (item.supplier ? " 공급사 " + item.supplier + "." : "") +
            (item.price === null ? " 공급가는 회원 로그인 후 확인할 수 있습니다." : ""),
        }),
        {
          rank: null,
          rankScope: "온채널 베스트순",
          basisDate: onchannelRank.basisDate,
          prevRank: null,
          rankDelta: null,
          isNew: false,
          signals: ["온채널 베스트순 ‘" + q + "’ 결과"],
          topic: q,
        },
      ),
    );
  }

  // 도매꾹 인기상품순 — 인기 키워드별
  const topicErrors = [];
  for (const run of domeggookRuns) {
    if (run.error) {
      topicErrors.push({ topic: run.topic, error: run.error });
      continue;
    }
    if (!run.products.length) continue;
    const ranks = new Map(run.products.map((product, index) => [product.sku, index + 1]));
    const scopeKey = "domeggook:" + run.topic;
    const baseline = await resolveBaseline(cache, origin, scopeKey, ranks, ctx);
    baselineDays.domeggook = baseline?.day || baselineDays.domeggook;
    const crossSources = [
      ownerclanKeywords.includes(run.topic) ? "오너클랜" : null,
      onchannelKeywords.includes(run.topic) ? "온채널" : null,
    ].filter(Boolean);
    const crossSource = crossSources.length > 0;
    const crossLabel = crossSource
      ? "도매꾹·" + crossSources.join("·") + " 동시 인기"
      : null;
    run.products.forEach((product, index) => {
      const rank = index + 1;
      const prevRank = baseline ? rankOf(baseline.ranks, product.sku) : null;
      const rankDelta = baseline && prevRank ? prevRank - rank : null;
      const isNew = Boolean(baseline && !prevRank);
      products.push(
        withTrend(
          {
            ...product,
            // 도매꾹 목록 API는 품절·판매중지 상품을 돌려주지 않는다(API 문서 명시).
            stock: product.stock ?? null,
            inStock: true,
            tags: [...new Set([...(product.tags || []), "도매꾹 인기상품순", run.topic])],
          },
          {
            rank,
            rankScope: "도매꾹 인기상품순",
            basisDate: null,
            prevRank,
            rankDelta,
            isNew,
            baselineDay: baseline?.day || null,
            topic: run.topic,
            crossSource,
            signals: signalsFor({
              rank,
              rankScope: "도매꾹 인기상품순",
              rankDelta,
              isNew,
              prevRank,
              topic: run.topic,
              crossLabel,
            }),
          },
        ),
      );
    });
  }

  // 중복 제거(같은 소싱처·같은 상품코드) 후 필터·정렬
  const unique = [
    ...new Map(products.map((product) => [product.id, product])).values(),
  ].filter(
    (product) =>
      stockAllowed(product, stock) &&
      priceFiltered(product, minPrice, maxPrice) &&
      (!singleOrder || product.minOrder === 1) &&
      (!freeShipping || product.shippingFee === 0),
  );
  unique.sort(
    (a, b) =>
      b.trendScore - a.trendScore ||
      (a.rank ?? 999) - (b.rank ?? 999) ||
      a.name.localeCompare(b.name, "ko"),
  );

  // 소싱처를 섞어 보여준다. 도매꾹은 키워드별 1위가 여러 개라 그대로 두면 한 소싱처가 화면을 독점한다.
  const ordered =
    source === "all" ? interleaveBySource(unique, limit) : unique.slice(0, limit);

  const notes = [
    "도매꾹 순위는 Open API 인기상품순(so=ha)이며 판매 실적이 반영됩니다. 목록 API는 품절·판매중지 상품을 제외하고 돌려주므로 도매꾹 상품은 재고 있음으로 표시합니다.",
    "오너클랜은 판매사 API에 판매순위 정렬이 없어, 공개 홈의 ‘오너클랜 100’ 순위를 사용합니다. 재고·배송비는 로그인 후 상품 페이지에서 확인해야 합니다.",
    "온채널은 공개 상품센터의 사이트 판매랭킹(일 단위)과 베스트순 검색 결과를 사용합니다. 비회원에게는 공급가가 공개되지 않아 가격은 비어 있습니다.",
    "‘상승’ 표시는 직전 집계일의 순위 스냅샷과 비교한 값입니다. 첫 집계일에는 비교 기준이 없어 상승폭이 표시되지 않습니다.",
  ];
  if (topicErrors.length)
    notes.push(
      "도매꾹 인기 키워드 일부를 조회하지 못했습니다: " +
        topicErrors.map((entry) => entry.topic).join(", "),
    );

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source,
    query: q,
    topics,
    baselineDays,
    sources: {
      domeggook: {
        ok: Boolean(wantDomeggook) && domeggookRuns.some((run) => !run.error),
        configured: Boolean(env.DOMEGGOOK_API_KEY),
        requested: source === "all" || source === "domeggook",
        topics: domeggookRuns.map((run) => ({
          topic: run.topic,
          items: run.products?.length || 0,
          error: run.error || null,
        })),
      },
      ownerclan: {
        ok: Boolean(ownerclanPage?.ok),
        reachable: Boolean(ownerclanPage?.ok),
        requested: wantOwnerclan,
        items: ownerclanRanked.length,
        ranked: ownerclanItems.length,
        keywords: ownerclanKeywords,
        error: ownerclanPage && !ownerclanPage.ok ? ownerclanPage.error : null,
      },
      onchannel: {
        ok: Boolean(onchannelPage?.ok),
        reachable: Boolean(onchannelPage?.ok),
        requested: wantOnchannel,
        rankItems: onchannelRanked.length,
        ranked: onchannelRank.items.length,
        basisDate: onchannelRank.basisDate,
        keywords: onchannelKeywords,
        error: onchannelPage && !onchannelPage.ok ? onchannelPage.error : null,
      },
    },
    filters: { stock, singleOrder, freeShipping, minPrice, maxPrice },
    total: unique.length,
    products: ordered,
    notes,
  };
}

/** 소싱처별 순위를 번갈아 꺼내 한 화면에 고루 섞는다. */
export function interleaveBySource(sorted, limit) {
  const groups = new Map();
  for (const product of sorted) {
    if (!groups.has(product.sourceId)) groups.set(product.sourceId, []);
    groups.get(product.sourceId).push(product);
  }
  const queues = [...groups.values()].sort(
    (a, b) => b[0].trendScore - a[0].trendScore,
  );
  const output = [];
  let cursor = 0;
  while (output.length < limit && queues.some((queue) => queue.length)) {
    const queue = queues[cursor % queues.length];
    if (queue.length) output.push(queue.shift());
    cursor++;
  }
  return output;
}

/* ── 자동 등록 안전 큐 ─────────────────────────────────────────────────── */

export const DAILY_QUOTA = 3;
export const HARD_CAP = 5;

/** 지재권(브랜드·캐릭터) 키워드 — 제목에 있으면 자동 등록 대상에서 제외한다. */
export const BRAND_WORDS = [
  "나이키", "아디다스", "뉴발란스", "푸마", "반스", "컨버스", "크록스",
  "디즈니", "산리오", "포켓몬", "짱구", "카카오프렌즈", "라인프렌즈", "뽀로로",
  "스투시", "노스페이스", "몽클레어", "구찌", "루이비통", "샤넬", "에르메스",
  "코치", "폴로", "챔피언", "아이폰", "갤럭시", "다이슨", "발뮤다", "르크루제",
  "스타벅스", "코카콜라", "펩시", "맥도날드", "레고", "닌텐도", "플레이스테이션",
];

/** 쿠팡에서 팔 수 없거나 별도 자격이 필요한 품목 키워드. */
export const BANNED_WORDS = [
  "성인용품", "성인용", "19금", "주류", "담배", "전자담배", "의약품", "처방",
  "건강기능식품", "다이어트약", "화장품", "기능성화장품", "식품", "먹거리",
  "도검", "칼날", "화약", "총기", "복제", "정품아님", "짝퉁", "이미테이션",
];

export const BLOCK_WORDS = [...BRAND_WORDS, ...BANNED_WORDS];

export const REVIEW_WORDS = [
  "유아", "아동", "어린이", "키즈", "베이비", "신생아", "젖병", "분유", "유모차",
  "전기", "전자", "충전", "배터리", "온열", "발열", "전기요", "전기장판", "led",
  "의료", "마사지", "온도계", "살균", "방역", "방한", "난방", "히터", "선풍기",
  "무료나눔", "윤리적", "최저가보장", "1위보장",
];

function keywordHit(name, words) {
  const lowered = name.toLocaleLowerCase("ko-KR");
  return words.filter((word) => lowered.includes(word.toLocaleLowerCase("ko-KR")));
}

/**
 * 급등 후보를 "자동 등록 가능 / 사람 확인 / 제외"로 나눈다.
 * 자동 등록 판정은 보수적이다: 실재고(판매중) 확인 + 1개 주문 + 배송비 확인 + 표준 마진 확보.
 */
export function buildRegistrationQueue(products, options = {}) {
  const limit = boundedNumber(String(options.limit ?? "3"), 3, 1, HARD_CAP);
  const registeredToday = boundedNumber(
    String(options.registeredToday ?? "0"),
    0,
    0,
    100,
  );
  // 화면·정기 액션이 확인한 쿠팡 최저가(상품 id/SKU → 원). 없으면 판정하지 않는다.
  const marketPrices = normalizeMarketPrices(options.marketPrices);
  const marketPriceOf = (product) => {
    for (const key of [product.id, product.sku]) {
      if (key && Object.hasOwn(marketPrices, key)) return marketPrices[key];
    }
    return Number.isSafeInteger(product.marketPrice) && product.marketPrice > 0
      ? product.marketPrice
      : null;
  };
  const evaluated = (Array.isArray(products) ? products : []).map((product) => {
    const block = keywordHit(product.name, BLOCK_WORDS);
    const review = keywordHit(product.name, REVIEW_WORDS);
    let estimate = null;
    try {
      estimate = calculateSafePrice(
        product.wholesalePrice,
        product.shippingFee ?? 3000,
        0.3,
        0.108,
      );
    } catch {
      estimate = null;
    }
    // 역마진 자동 판정: 쿠팡 최저가 - 100원에서 순마진이 0원 이하면 등록 후보에서 차단한다.
    const marketPrice = marketPriceOf(product);
    const marginAtLowest = assessResaleMargin({
      wholesalePrice: product.wholesalePrice,
      shippingFee: product.shippingFee,
      marketPrice,
    });
    const checks = [
      {
        key: "stock",
        label: "실재고(판매중) 확인",
        ok: product.inStock === true,
        note:
          product.inStock === true
            ? "공급사가 판매중으로 응답"
            : "재고·판매상태를 공급사 페이지에서 확인해야 함",
      },
      {
        key: "moq",
        label: "1개부터 주문",
        ok: product.minOrder === 1,
        note: product.minOrder === null ? "최소 주문 수량 미확인" : `최소 ${product.minOrder}개`,
      },
      {
        key: "shipping",
        label: "공급사 배송비 확인",
        ok: product.shippingFee !== null,
        note: product.shippingFee === null ? "배송비 미확인" : `${product.shippingFee.toLocaleString("ko-KR")}원`,
      },
      {
        key: "margin",
        label: "목표마진 30%·수수료 10.8% 기준 이익 5,000원 이상",
        ok: Boolean(estimate && estimate.netProfit >= 5000),
        note: estimate
          ? `권장 판매가 ${estimate.salePrice.toLocaleString("ko-KR")}원 · 예상 이익 ${estimate.netProfit.toLocaleString("ko-KR")}원`
          : "공급가·배송비로 계산 불가",
      },
      {
        key: "price_cap",
        label: "위탁 반품 리스크(공급가 10만 원 이하)",
        ok: product.wholesalePrice !== null && product.wholesalePrice <= 100000,
        note:
          product.wholesalePrice === null
            ? "공급가 미확인"
            : `${product.wholesalePrice.toLocaleString("ko-KR")}원`,
      },
      {
        key: "kc",
        label: "KC·법정 인증 대상 여부 검토",
        ok: review.length === 0,
        note: review.length ? `검토 키워드: ${review.join(", ")}` : "해당 키워드 없음",
      },
      {
        key: "ip",
        label: "지재권(브랜드·캐릭터) 배제",
        ok: block.length === 0,
        note: block.length ? `배제 키워드: ${block.join(", ")}` : "브랜드·캐릭터 키워드 없음",
      },
      {
        key: "lowest_price",
        label: "쿠팡 최저가 -100원 흑자 확인",
        ok: marginAtLowest ? !marginAtLowest.isLoss : false,
        pending: !marginAtLowest,
        note: marginAtLowest
          ? `최저가 ${won(marginAtLowest.marketPrice)} → 판매가 ${won(marginAtLowest.salePrice)} · 순마진 ${marginAtLowest.netProfit > 0 ? "+" : "−"}${won(Math.abs(marginAtLowest.netProfit))} (${marginAtLowest.marginRate}%)${marginAtLowest.isLoss ? " → 역마진 자동 차단" : marginAtLowest.verdict === "thin" ? " → 마진 주의" : ""}`
          : "쿠팡 최저가를 입력하면 최저가 -100원 기준 순마진을 자동 판정합니다(미입력 시 등록 직전 WING에서 확인 필요)",
      },
    ];
    const failed = checks.filter((check) => !check.ok && !check.pending);
    const lossBlocked = marginAtLowest?.isLoss === true;
    const verdict = block.length > 0 || lossBlocked ? "block" : failed.length === 0 && marginAtLowest?.verdict !== "thin" ? "ready" : "review";
    return {
      id: product.id,
      name: product.name,
      product,
      sourceId: product.sourceId,
      sourceName: product.sourceName,
      sku: product.sku,
      url: product.url,
      imageUrl: product.imageUrl,
      wholesalePrice: product.wholesalePrice,
      shippingFee: product.shippingFee,
      minOrder: product.minOrder,
      inStock: product.inStock,
      rank: product.rank ?? null,
      rankScope: product.rankScope || null,
      rankDelta: product.rankDelta ?? null,
      signals: product.signals || [],
      blockWords: block,
      reviewWords: review,
      estimate,
      marginAtLowest,
      marketPrice,
      checks,
      verdict,
      reasons: lossBlocked && marginAtLowest
        ? [
            `역마진 자동 차단: 최저가 ${won(marginAtLowest.marketPrice)} - 100원 = ${won(marginAtLowest.salePrice)}에서 순마진 ${marginAtLowest.netProfit > 0 ? "+" : "−"}${won(Math.abs(marginAtLowest.netProfit))}`,
            ...failed.map((check) => `${check.label}: ${check.note}`),
          ]
        : failed.map((check) => `${check.label}: ${check.note}`),
    };
  });
  const order = { ready: 0, review: 1, block: 2 };
  evaluated.sort(
    (a, b) =>
      order[a.verdict] - order[b.verdict] ||
      (b.estimate?.netProfit ?? 0) - (a.estimate?.netProfit ?? 0) ||
      (a.rank ?? 999) - (b.rank ?? 999),
  );
  const ready = evaluated.filter((item) => item.verdict === "ready");
  const remaining = Math.max(0, DAILY_QUOTA - registeredToday);
  const verdictCounts = { ready: 0, review: 0, block: 0 };
  const blockedHits = new Map();
  for (const item of evaluated) {
    verdictCounts[item.verdict] += 1;
    if (item.verdict === "block") {
      for (const word of item.blockWords || []) {
        if (word) blockedHits.set(word, (blockedHits.get(word) || 0) + 1);
      }
    }
  }
  return {
    ok: true,
    date: kstDay(),
    dailyQuota: DAILY_QUOTA,
    hardCap: HARD_CAP,
    registeredToday,
    remaining,
    recommendedNow: Math.min(limit, remaining),
    readyCount: ready.length,
    evaluatedTotal: evaluated.length,
    verdictCounts,
    marginCheckedCount: evaluated.filter((item) => item.marginAtLowest).length,
    marginBlockedCount: evaluated.filter((item) => item.marginAtLowest?.isLoss)
      .length,
    thinMarginCount: evaluated.filter(
      (item) => item.marginAtLowest?.verdict === "thin",
    ).length,
    blockedKeywords: [...blockedHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word, count]) => ({ word, count })),
    candidates: evaluated.slice(0, limit),
    rules: [
      "하루 자동 등록은 기본 3건, 절대 상한 5건(사용자 기존 원칙: 일일 2~3건 수기 등록으로 14종 판매중, 제재 없음).",
      "같은 공급사 상품은 하루 1건, 같은 카테고리는 하루 2건까지만 등록하고 가격대를 분산한다.",
      "실재고·판매중이 확인되지 않은 상품(오너클랜·온채널 공개 순위만 확인된 상품)은 자동 등록하지 않고 사람이 확인한다.",
      "지재권·브랜드·캐릭터 키워드가 제목에 있으면 제외하고, KC 인증 대상(전기·유아동·화장품·식품)은 사람이 인증 근거를 확인한 뒤 등록한다.",
      "등록 직전 쿠팡 최저가를 확인해 최저가 -100원에서도 흑자인 경우에만 등록한다.",
      "쿠팡 최저가를 확인한 상품은 최저가 -100원 판매가에서 도매 원가·배송비·수수료를 뺀 순마진이 0원 이하면 역마진으로 보고 자동 등록 후보에서 차단한다.",
      "순마진율이 5% 미만인 상품은 자동 등록하지 않고 사람이 확인한다.",
      "반품비 왕복 2만 원(전산 상한)을 감안해 공급가 10만 원 이하 위탁 상품을 우선한다.",
    ],
    nextStep:
      "이 큐는 피클 정기 액션이 브라우저로 WING에 등록할 때 후보·검수 근거로 쓴다. verdict=ready만 자동 등록 대상으로 삼고, review는 사용자 확인 후 등록한다.",
  };
}
