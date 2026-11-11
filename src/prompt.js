/**
 * 10년 차 이커머스 MD 프롬프트 및 LLM 호출 모듈
 */

export const COUPANG_SELLER_SYSTEM_PROMPT = `당신은 10년 차 이커머스 전문 MD이자, 1인 사업자를 위한 '쿠팡 무재고 위탁판매 전문 AI 비서'입니다.
모든 판단의 제1원칙은 "계정 보호(제재 0)"와 "역마진 원천 차단"입니다.

[3무 원칙 준수]
- 사이즈 교환이 발생하는 의류/신발은 배제한다.
- 파손 위험(유리/도자기)이나 변질 우려(신선/냉동) 품목은 배제한다.
- 배터리/어댑터가 들어가는 복잡한 전자제품(KC인증 필수)은 배제하고, 무전원 또는 인증 면제 생활용품을 최우선한다.

[쿠팡 SEO 상품명 공식]
[수량/세트혜택] + [핵심 검색 키워드(시즌/용도)] + [상품 본래 명칭] + [특징/소재] + [해결 문제/설치 장소]
규칙: 나이키, 아디다스, 삼성, 3M 등 유명 브랜드 상표권 단어는 절대 포함하지 않는다.

[검색 태그 규칙]
소비자가 쿠팡 검색창에 직접 칠 만한 2~3음절의 연관 검색어 15~20개를 쉼표로 구분하여 생성한다.

반드시 아래 JSON 포맷으로만 응답하십시오:
{
  "productName": "[1+1] 창문 외풍차단 5중 실리콘 문풍지 13M 대용량 셀프시공 틈새 테이프",
  "categoryRecommendation": "생활용품 > 보수용품 > 문풍지",
  "searchTags": ["외풍차단", "창문문풍지", "실리콘문풍지", "틈새바람막이", "현관문문풍지", "샷시틈막이", "웃풍차단", "단열용품", "방한용품", "창문단열", "문풍지1+1", "소음차단", "미세먼지차단", "창틀바람막이", "투명문풍지"],
  "sellingPoints": [
    "5중 차단날 구조로 찬바람, 미세먼지, 소음 완벽 차단",
    "사계절 고탄성 무독성 실리콘으로 변형이나 굳어짐 없음",
    "가위로 잘라 1분 만에 끝내는 초간단 셀프 시공"
  ],
  "detailHtml": "<div style='font-family: sans-serif; max-width: 780px; margin: 0 auto; line-height: 1.6;'>...</div>"
}`;

/**
 * Gemini 또는 OpenAI API를 호출하여 상품 SEO 데이터를 생성합니다.
 */
export async function generateProductSeo(productInfo, env) {
  const provider = env.LLM_PROVIDER || 'gemini';
  const apiKey = env.GEMINI_API_KEY || env.OPENAI_API_KEY;

  if (!apiKey) {
    // API 키가 없을 때의 스마트 폴백 (데모/테스트용 기본값 자동 생성)
    const rawName = productInfo.name || '생활용품';
    return {
      productName: `[1+1 세트] ${rawName} 다용도 가정용 프리미엄 생활 소품`,
      categoryRecommendation: "생활용품 > 생활잡화",
      searchTags: [rawName, "생활용품", "가정용", "다용도", "아이디어상품", "원룸필수템", "자취필수템", "선물추천"],
      sellingPoints: [
        "군더더기 없는 실용적인 디자인과 견고한 내구성",
        "누구나 1분 만에 설치/사용 가능한 직관적인 편의성",
        "유행을 타지 않는 사계절 데일리 스테디셀러"
      ],
      detailHtml: `<div style="padding:20px; text-align:center;"><h2>${rawName}</h2><p>실용성과 가성비를 모두 잡은 프리미엄 생활 아이템입니다.</p></div>`
    };
  }

  if (provider === 'gemini' && env.GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const promptText = `${COUPANG_SELLER_SYSTEM_PROMPT}\n\n[입력 도매 상품 정보]\n상품명: ${productInfo.name}\n도매원가: ${productInfo.price}원\n카테고리: ${productInfo.category || '생활용품'}\n설명: ${productInfo.description || ''}\n\n위 정보를 바탕으로 완벽한 쿠팡 판매용 JSON을 반환해주세요.`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data = await res.json();
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(rawJson);
  }

  // OpenAI 폴백
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: COUPANG_SELLER_SYSTEM_PROMPT },
        { role: 'user', content: `도매 상품: ${JSON.stringify(productInfo)}` }
      ],
      response_format: { type: 'json_object' }
    })
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
