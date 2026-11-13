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
  let response;
  try {
    const common = {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    };
    if (provider === "gemini") {
      const model = env.GEMINI_MODEL || "gemini-2.5-flash";
      response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          ...common,
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
    } else {
      response = await fetcher("https://api.openai.com/v1/chat/completions", {
        ...common,
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
    }
    if (!response.ok) throw new Error("provider HTTP");
    const data = await response.json();
    const result = JSON.parse(
      provider === "gemini"
        ? data.candidates?.[0]?.content?.parts?.[0]?.text
        : data.choices?.[0]?.message?.content,
    );
    if (
      typeof result.productName !== "string" ||
      !result.productName.trim() ||
      !Array.isArray(result.searchTags) ||
      !Array.isArray(result.sellingPoints)
    )
      throw new Error("provider shape");
    return {
      result: {
        productName: result.productName.slice(0, 200),
        searchTags: result.searchTags
          .filter((tag) => typeof tag === "string")
          .slice(0, 20)
          .map((tag) => tag.slice(0, 50)),
        sellingPoints: result.sellingPoints
          .filter((point) => typeof point === "string")
          .slice(0, 3)
          .map((point) => point.slice(0, 500)),
      },
      mode: "ai",
      note: "AI 초안입니다. 상품명·표현·인증·권리를 직접 검토하세요.",
    };
  } catch {
    throw new Error(
      "AI 초안을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}
