import { SourcingError } from "./sourcing.js";

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

export const COUPANG_SELLER_SYSTEM_PROMPT = `당신은 한국 온라인 판매자의 상품 등록 초안을 작성하는 도우미입니다.
제공된 상품명·설명에 명시된 사실만 사용하세요. 수량, 인증, 효능, 소재, 브랜드, 무료배송, 1+1 등의 사실을 새로 만들지 마세요.
입력이 충분하지 않으면 상품명을 그대로 쓰고 확인이 필요한 사항을 안내하세요.
검색 순위, 판매 실적, 지재권·KC 인증 적합성은 보장하지 마세요. 브랜드를 임의로 추가하지 마세요.
다음 JSON만 반환하세요: {"productName":"사실 기반 상품명","searchTags":["입력과 관련된 키워드 최대 20개"],"sellingPoints":["입력에서 확인 가능한 특징 또는 확인 필요 사항 최대 3개"]}`;

function templateSeo(info) {
  const tags = [
    ...new Set(
      (info.name + " " + (info.category || ""))
        .split(/[\s,>·]+/)
        .filter((word) => word.length >= 2),
    ),
  ].slice(0, 20);
  return {
    productName: info.name,
    searchTags: tags,
    sellingPoints: info.description
      ? [info.description.slice(0, 300)]
      : ["공급사 상품의 소재·규격·구성품을 확인한 뒤 특징을 작성해주세요."],
    detailHtml: `<div><h2>${escapeHtml(info.name)}</h2><p>${escapeHtml(info.description || "공급사에서 확인한 상품 정보를 입력해주세요.")}</p></div>`,
  };
}

// 무료 티어 모델은 혼잡(503)·할당량(429)으로 일시 실패하므로 예비 모델까지 순차 시도한다.
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.6-flash",
];
const GEMINI_ATTEMPT_TIMEOUT_MS = 14000;

function geminiModelChain(env) {
  const primary = env.GEMINI_MODEL || "gemini-3.5-flash";
  return [primary, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primary)];
}

function pickResult(provider, data) {
  const text =
    provider === "gemini"
      ? data.candidates?.[0]?.content?.parts?.[0]?.text
      : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("empty");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("json");
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  if (
    !parsed ||
    typeof parsed.productName !== "string" ||
    !parsed.productName.trim() ||
    !Array.isArray(parsed.searchTags) ||
    !Array.isArray(parsed.sellingPoints)
  )
    throw new Error("shape");
  return {
    productName: parsed.productName.slice(0, 200),
    searchTags: parsed.searchTags
      .filter((tag) => typeof tag === "string")
      .slice(0, 20)
      .map((tag) => tag.slice(0, 50)),
    sellingPoints: parsed.sellingPoints
      .filter((point) => typeof point === "string")
      .slice(0, 3)
      .map((point) => point.slice(0, 500)),
  };
}

async function callGemini(model, info, env, fetcher) {
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS),
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  COUPANG_SELLER_SYSTEM_PROMPT +
                  "\n입력: " +
                  JSON.stringify(info),
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!response.ok) {
    const error = new Error("gemini HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return pickResult("gemini", await response.json());
}

async function callOpenai(info, env, fetcher) {
  const response = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS),
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: COUPANG_SELLER_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(info) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error("openai HTTP " + response.status);
  return pickResult("openai", await response.json());
}

export async function generateProductSeo(info, env, fetcher = fetch) {
  const provider = env.LLM_PROVIDER || "gemini";
  const configured =
    provider === "gemini"
      ? Boolean(env.GEMINI_API_KEY)
      : provider === "openai" && Boolean(env.OPENAI_API_KEY);
  if (!configured)
    return {
      result: templateSeo(info),
      mode: "template",
      note: "AI 미연결: 입력한 정보만으로 만든 기본 초안입니다. 판매 전 사실을 확인하세요.",
    };

  const attempts =
    provider === "gemini"
      ? geminiModelChain(env).map((model) => () =>
          callGemini(model, info, env, fetcher),
        )
      : [() => callOpenai(info, env, fetcher)];

  let cause;
  const deadline = Date.now() + 25000;
  for (const attempt of attempts) {
    if (Date.now() > deadline) break;
    try {
      const result = await attempt();
      return {
        result,
        mode: "ai",
        note: "AI 초안입니다. 상품명·표현·인증·권리를 직접 검토하세요.",
      };
    } catch (error) {
      cause = error;
    }
  }
  throw new SourcingError(
    "AI 초안을 생성하지 못했습니다" +
      (cause
        ? " (" + String(cause.message || cause).slice(0, 120) + ")"
        : "") +
      ". 잠시 후 다시 시도해주세요.",
    502,
  );
}
