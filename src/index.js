import { SOURCES, KEYWORDS } from "../public/lib/sources.js";
import { generateProductSeo } from "./prompt.js";
import {
  getDomeggookItem,
  probeDomeggook,
  searchDomeggook,
  SourcingError,
} from "./sourcing.js";
import { probeOwnerclan, searchOwnerclan, ownerclanConfigured } from "./ownerclan.js";
import { searchIdeaProducts } from "./ideaDiscovery.js";
import {
  probeWing,
  registerSellerProduct,
  wingConfigured,
  wingNotes,
} from "./wing.js";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json"))
    throw new SourcingError("JSON 형식으로 요청해주세요.", 415);
  const text = await request.text();
  if (text.length > 16000)
    throw new SourcingError("요청 데이터가 너무 큽니다.", 413);
  try {
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== "object")
      throw new Error("shape");
    return body;
  } catch {
    throw new SourcingError("올바른 JSON 객체가 필요합니다.", 400);
  }
}

const CACHE_SECONDS = 60;

async function cachedJson(ctx, url, key, compute) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (!cache) return json(await compute());
  const cacheUrl = new URL("/api/_cache", url.origin);
  cacheUrl.search = key;
  const cacheKey = new Request(cacheUrl.toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const response = json(await compute(), 200, {
    "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
  });
  try {
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } catch {
    /* 캐시 저장 실패는 조회 결과에 영향을 주지 않는다. */
  }
  return response;
}

function integrations(env) {
  return {
    domeggook: Boolean(env.DOMEGGOOK_API_KEY),
    ownerclan: ownerclanConfigured(env),
    wing: wingConfigured(env),
    seo: Boolean(
      env.LLM_PROVIDER === "openai" ? env.OPENAI_API_KEY : env.GEMINI_API_KEY,
    ),
  };
}

async function searchLive(env, url, ctx) {
  const source = url.searchParams.get("source") || "domeggook";
  const keyword = (url.searchParams.get("q") || "").trim();
  if (keyword.length > 100)
    throw new SourcingError("검색어는 100자 이내로 입력해주세요.", 400);
  if (source === "ownerclan") return json(await searchOwnerclan(env, url.searchParams));
  if (source !== "domeggook")
    throw new SourcingError("지원하지 않는 소싱처입니다.", 400);
  const cacheKey = new URLSearchParams({
    source,
    q: keyword,
    page: url.searchParams.get("page") || "1",
    pageSize: url.searchParams.get("pageSize") || "40",
    minPrice: url.searchParams.get("minPrice") || "",
    maxPrice: url.searchParams.get("maxPrice") || "",
    singleOrder: url.searchParams.get("singleOrder") || "",
    freeShipping: url.searchParams.get("freeShipping") || "",
    category: url.searchParams.get("category") || "",
  }).toString();
  return cachedJson(ctx, url, cacheKey, () =>
    searchDomeggook(env, url.searchParams),
  );
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    try {
      const routeMethods = {
        "/api/health": "GET",
        "/api/catalog": "GET",
        "/api/products": "GET",
        "/api/item-detail": "GET",
        "/api/idea-products": "GET",
        "/api/wing/status": "GET",
        "/api/generate-seo": "POST",
        "/api/register-product": "POST",
      };
      const method = routeMethods[url.pathname];
      if (!method)
        return json({ ok: false, error: "요청한 API를 찾을 수 없습니다." }, 404);
      if (request.method !== method)
        return json({ ok: false, error: `${method} 요청만 지원합니다.` }, 405, {
          Allow: method,
        });

      if (url.pathname === "/api/health") {
        const [domeggook, ownerclan, wing] = await Promise.all([
          probeDomeggook(env),
          probeOwnerclan(env),
          probeWing(env),
        ]);
        return json({
          ok: true,
          integrations: integrations(env),
          domeggook,
          ownerclan,
          wing: { ...wing, ...wingNotes(env) },
        });
      }

      if (url.pathname === "/api/catalog")
        return json({
          ok: true,
          sources: SOURCES,
          keywords: KEYWORDS,
          integrations: integrations(env),
          wing: wingNotes(env),
        });

      if (url.pathname === "/api/products") {
        const mode = url.searchParams.get("mode") || "live";
        if (mode !== "live")
          throw new SourcingError("지원하지 않는 검색 모드입니다.", 400);
        return await searchLive(env, url, ctx);
      }

      if (url.pathname === "/api/item-detail") {
        const source = url.searchParams.get("source") || "domeggook";
        if (source !== "domeggook")
          throw new SourcingError("상세 조회는 현재 도매꾹만 지원합니다.", 400);
        const detail = await getDomeggookItem(
          env,
          url.searchParams.get("no") || "",
        );
        return json(detail);
      }

      if (url.pathname === "/api/idea-products") {
        return json(await searchIdeaProducts(env, url.searchParams));
      }

      if (url.pathname === "/api/wing/status") {
        return json({
          ok: true,
          configured: wingConfigured(env),
          ...(await probeWing(env)),
          ...wingNotes(env),
        });
      }

      if (url.pathname === "/api/register-product") {
        const body = await readJson(request);
        const result = await registerSellerProduct(env, {
          name: body.name,
          itemName: body.itemName,
          displayProductName: body.displayProductName,
          salePrice: body.salePrice,
          originalPrice: body.originalPrice,
          displayCategoryCode: body.displayCategoryCode,
          notices: body.notices,
          images: body.images,
          attributes: body.attributes,
          description: body.description,
          sku: body.sku,
          deliveryCharge: body.deliveryCharge,
          returnCharge: body.returnCharge,
          outboundShippingTimeDay: body.outboundShippingTimeDay,
          maximumBuyCount: body.maximumBuyCount,
        });
        return json({ ...result, ok: result.ok }, result.ok ? 200 : 502);
      }

      // /api/generate-seo (POST)
      const body = await readJson(request);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 160
      )
        throw new SourcingError("상품명은 1~160자로 입력해주세요.", 400);
      const info = {
        name: body.name.trim(),
        category: String(body.category || "").slice(0, 100),
        description: String(body.description || "").slice(0, 2000),
      };
      const generated = await generateProductSeo(info, env);
      return json({ ok: true, ...generated });
    } catch (error) {
      const known = error instanceof SourcingError;
      const status = known ? error.status : error?.status || 502;
      return json(
        {
          ok: false,
          error: known
            ? error.message
            : error?.message &&
                typeof error.message === "string" &&
                status < 500
              ? error.message
              : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
          upstream: known ? error.extra?.upstream : undefined,
          detail: error?.detail || undefined,
        },
        status,
      );
    }
  },
};
