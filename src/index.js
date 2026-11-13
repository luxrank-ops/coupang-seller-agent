import { DEMO_PRODUCTS } from "./catalog.js";
import { SOURCES, CATEGORIES } from "../public/lib/sources.js";
import { filterProducts, normalizeMoney } from "../public/lib/products.js";
import { generateProductSeo } from "./prompt.js";
import { boundedInteger, searchDomeggook, SourcingError } from "./sourcing.js";

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

function getDemoProducts(params) {
  const page = boundedInteger(params.get("page"), 1, 1000);
  const pageSize = boundedInteger(params.get("pageSize"), 24, 100);
  const minPrice = params.has("minPrice")
    ? normalizeMoney(params.get("minPrice"))
    : "";
  const maxPrice = params.has("maxPrice")
    ? normalizeMoney(params.get("maxPrice"))
    : "";
  if (minPrice !== "" && maxPrice !== "" && minPrice > maxPrice)
    throw new SourcingError("최소 가격은 최대 가격 이하여야 합니다.", 400);
  const products = filterProducts(DEMO_PRODUCTS, {
    q: params.get("q"),
    category: params.get("category"),
    source: params.get("source"),
    minPrice,
    maxPrice,
    sort: params.get("sort"),
    freeShipping: params.get("freeShipping") === "true",
    singleOrder: params.get("singleOrder") === "true",
    consignment: params.get("consignment") === "true",
  });
  return {
    ok: true,
    mode: "demo",
    products: products.slice((page - 1) * pageSize, page * pageSize),
    total: products.length,
    page,
    pageSize,
    hasMore: page * pageSize < products.length,
    note: "기능 체험용 예시입니다. 실제 도매몰 상품·가격·재고 정보가 아닙니다.",
  };
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
        "/api/catalog": "GET",
        "/api/products": "GET",
        "/api/generate-seo": "POST",
        "/api/register-product": "POST",
      };
      const method = routeMethods[url.pathname];
      if (!method)
        return json(
          { ok: false, error: "요청한 API를 찾을 수 없습니다." },
          404,
        );
      if (request.method !== method)
        return json({ ok: false, error: `${method} 요청만 지원합니다.` }, 405, {
          Allow: method,
        });
      if (url.pathname === "/api/catalog")
        return json({
          ok: true,
          products: DEMO_PRODUCTS,
          sources: SOURCES,
          categories: CATEGORIES,
          integrations: {
            domeggook: Boolean(env.DOMEGGOOK_API_KEY),
            seo: Boolean(
              env.LLM_PROVIDER === "openai"
                ? env.OPENAI_API_KEY
                : env.GEMINI_API_KEY,
            ),
            wing: false,
          },
        });
      if (url.pathname === "/api/products") {
        const mode = url.searchParams.get("mode") || "demo";
        if ((url.searchParams.get("q") || "").length > 100)
          throw new SourcingError("검색어는 100자 이내로 입력해주세요.", 400);
        if (mode === "demo") {
          try {
            return json(getDemoProducts(url.searchParams));
          } catch (error) {
            throw new SourcingError(error.message, 400);
          }
        }
        if (mode !== "live")
          throw new SourcingError("지원하지 않는 검색 모드입니다.", 400);
        // Short, query-specific cache reduces upstream use without ever caching secrets.
        const cache = typeof caches !== "undefined" ? caches.default : null;
        const cacheUrl = new URL("/api/products", url.origin);
        cacheUrl.search = new URLSearchParams({
          mode: "live",
          q: (url.searchParams.get("q") || "").trim(),
          page: url.searchParams.get("page") || "1",
        }).toString();
        const cacheKey = new Request(cacheUrl);
        if (env.DOMEGGOOK_API_KEY && cache) {
          const hit = await cache.match(cacheKey);
          if (hit) return hit;
        }
        const result = await searchDomeggook(env, url.searchParams);
        const response = json(result, 200, {
          "Cache-Control": "public, max-age=60",
        });
        if (cache && ctx.waitUntil)
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
      if (url.pathname === "/api/register-product") {
        // Never imply that product registration happened. This app does not
        // implement Coupang's product-create contract; credentials alone are
        // not sufficient to make a safe, correct registration integration.
        return json(
          {
            ok: false,
            mode: "not_connected",
            error:
              "쿠팡 상품 등록 API는 연결되어 있지 않습니다. 상품을 검토한 뒤 WING에서 직접 등록해주세요.",
          },
          501,
        );
      }
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
      return json(
        {
          ok: false,
          error:
            error instanceof SourcingError
              ? error.message
              : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
        },
        error instanceof SourcingError ? error.status : 502,
      );
    }
  },
};
