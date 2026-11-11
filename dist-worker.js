/**
 * Coupang Seller AI Agent - Standalone Cloudflare Worker
 * Generated for Choonhak Lee (Amoga)
 */

/**
 * 쿠팡 위탁판매 역마진 방지 및 판매가 산출 모듈
 */

function calculateCoupangPrice(
  wholesalePrice,
  wholesaleShipping = 3000,
  targetMarginRate = 0.30,
  coupangFeeRate = 0.108
) {
  const price = Number(wholesalePrice) || 0;
  const shipping = Number(wholesaleShipping) || 0;
  const targetMargin = Number(targetMarginRate) || 0.30;
  const feeRate = Number(coupangFeeRate) || 0.108;

  const totalCost = price + shipping;

  // 판매가 = 원가 / (1 - 쿠팡수수료율 - 목표순마진율)
  const divisor = 1.0 - feeRate - targetMargin;
  if (divisor <= 0) {
    throw new Error('수수료율과 목표 마진의 합이 100%를 초과할 수 없습니다.');
  }

  const rawRequiredPrice = totalCost / divisor;
  
  // 100원 단위 올림 (소비자 심리 및 쿠팡 노출 가격 최적화)
  const salePrice = Math.ceil(rawRequiredPrice / 100) * 100;

  // 실제 쿠팡 수수료 (VAT 10% 별도 반영 시 10.8% * 1.1 = 약 11.88%)
  const coupangFee = Math.round(salePrice * feeRate);
  const netProfit = salePrice - coupangFee - totalCost;
  const actualMarginRate = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;

  return {
    salePrice,
    totalCost,
    wholesalePrice: price,
    wholesaleShipping: shipping,
    coupangFee,
    netProfit,
    marginRate: Number(actualMarginRate.toFixed(1)),
    isSafe: actualMarginRate >= (targetMargin * 100)
  };
}


/**
 * 10년 차 이커머스 MD 프롬프트 및 LLM 호출 모듈
 */

const COUPANG_SELLER_SYSTEM_PROMPT = `당신은 10년 차 이커머스 전문 MD이자, 1인 사업자를 위한 '쿠팡 무재고 위탁판매 전문 AI 비서'입니다.
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
async function generateProductSeo(productInfo, env) {
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


/**
 * 반응형 모바일/데스크톱 웹 대시보드 템플릿
 */

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>쿠팡 셀러 AI 비서 (Coupang Seller Copilot)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
    body { font-family: 'Pretendard', sans-serif; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">

  <!-- Header -->
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl shadow-sm">
          C
        </div>
        <div>
          <h1 class="font-bold text-lg leading-tight">쿠팡 위탁판매 AI 비서</h1>
          <p class="text-xs text-slate-500">10년 차 셀러 로직 · 무재고 역마진 0% 자동화</p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
          Cloudflare Edge 정상 가동
        </span>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      <!-- Left Column: Input & Sourcing -->
      <div class="lg:col-span-5 space-y-6">
        
        <!-- Sourcing Card -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-bold text-slate-900 flex items-center text-base">
              <i class="fa-solid fa-box-open text-blue-600 mr-2"></i> 도매 상품 정보 입력
            </h2>
            <div class="flex gap-1 text-xs">
              <button onclick="loadSample(1)" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium transition">문풍지</button>
              <button onclick="loadSample(2)" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium transition">차량수납</button>
              <button onclick="loadSample(3)" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium transition">러닝힙색</button>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">도매 상품명</label>
              <input type="text" id="rawName" placeholder="예: 5중날 실리콘 문풍지 5M" 
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">도매 공급가 (원)</label>
                <input type="number" id="wholesalePrice" placeholder="4500" value="4500" oninput="calculateMarginLive()"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">도매 배송비 (원)</label>
                <input type="number" id="wholesaleShipping" placeholder="2800" value="2800" oninput="calculateMarginLive()"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">목표 순마진율 (%)</label>
                <input type="number" id="targetMargin" placeholder="30" value="30" oninput="calculateMarginLive()"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">쿠팡 수수료율 (%)</label>
                <input type="number" id="coupangFee" placeholder="10.8" value="10.8" step="0.1" oninput="calculateMarginLive()"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
              </div>
            </div>

            <button onclick="generateSeo()" id="btnGenerate"
              class="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm hover:shadow transition flex items-center justify-center space-x-2">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
              <span>AI 10년차 셀러 최적화 생성</span>
            </button>
          </div>
        </div>

        <!-- Live Margin Calculator Result -->
        <div class="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-sm">
          <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">실시간 마진 검증 엔진</h3>
          
          <div class="flex items-baseline justify-between mb-4">
            <div>
              <span class="text-xs text-slate-400">쿠팡 권장 판매가 (무료배송)</span>
              <div class="text-3xl font-extrabold text-blue-400 tracking-tight" id="dispSalePrice">12,900원</div>
            </div>
            <div class="text-right">
              <span class="text-xs text-slate-400">건당 순수익</span>
              <div class="text-xl font-bold text-emerald-400" id="dispNetProfit">+4,207원</div>
            </div>
          </div>

          <div class="border-t border-slate-700/60 pt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <span class="text-slate-400 block">총 원가</span>
              <span class="font-semibold text-slate-200" id="dispTotalCost">7,300원</span>
            </div>
            <div>
              <span class="text-slate-400 block">쿠팡 수수료</span>
              <span class="font-semibold text-slate-200" id="dispCoupangFee">1,393원</span>
            </div>
            <div>
              <span class="text-slate-400 block">실제 마진율</span>
              <span class="font-bold text-emerald-400" id="dispMarginRate">32.6%</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Right Column: AI Generated Output -->
      <div class="lg:col-span-7 space-y-6">
        
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div class="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 class="font-bold text-slate-900 text-base">쿠팡 WING 맞춤 등록 데이터</h2>
              <p class="text-xs text-slate-500">1위 검색 노출을 위한 알고리즘 키워드 자동 배합</p>
            </div>
            <button onclick="copyAll()" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition flex items-center gap-1.5">
              <i class="fa-regular fa-copy"></i> 전체 복사
            </button>
          </div>

          <!-- Product Name -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1 flex justify-between">
              <span>SEO 최적화 노출 상품명</span>
              <span class="text-slate-400 font-normal" id="charCount">0자</span>
            </label>
            <div class="relative">
              <input type="text" id="outProductName" readonly
                class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:outline-none transition">
              <button onclick="copyText('outProductName')" class="absolute right-3 top-3 text-slate-400 hover:text-blue-600 text-xs">
                <i class="fa-regular fa-copy"></i>
              </button>
            </div>
          </div>

          <!-- Search Tags -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-2">쿠팡 검색어 키워드 태그 (최대 20개)</label>
            <div id="outSearchTags" class="flex flex-wrap gap-1.5 min-h-[48px] p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span class="text-xs text-slate-400">생성 버튼을 누르면 검색어 태그가 채워집니다.</span>
            </div>
          </div>

          <!-- Selling Points -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-2">핵심 세일즈 포인트 (모바일 상세 최적화)</label>
            <ul id="outSellingPoints" class="space-y-1.5 text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <li class="text-slate-400">상품의 3대 핵심 소구점이 생성됩니다.</li>
            </ul>
          </div>

          <!-- Action Buttons -->
          <div class="pt-2 flex items-center justify-between border-t border-slate-100">
            <span class="text-xs text-slate-400">WING 판매자센터 직접 등록 준비 완료</span>
            <button onclick="saveProductRecord()" 
              class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-sm hover:shadow transition flex items-center gap-1.5">
              <i class="fa-solid fa-check"></i>
              <span>등록 완료 및 이력 저장</span>
            </button>
          </div>
        </div>

        <!-- History Card -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 class="font-bold text-slate-900 text-sm mb-3">최근 관리 상품 목록</h3>
          <div id="historyList" class="divide-y divide-slate-100 text-xs">
            <div class="py-2.5 flex items-center justify-between">
              <div>
                <span class="font-semibold text-slate-800">[1+1] 5중 실리콘 문풍지 13M 대용량</span>
                <span class="text-slate-400 block text-[11px]">ID 16448585070 · 판매가 12,900원 (마진 32.6%)</span>
              </div>
              <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-[11px]">판매중 (아이템위너)</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  </main>

  <script>
    const samples = {
      1: { name: '5중 실리콘 창문 문풍지 6.5M 2롤', price: 4500, shipping: 2800 },
      2: { name: '차량용 가죽 시트 틈새 수납 포켓 좌우 1세트', price: 4600, shipping: 3000 },
      3: { name: '초경량 스마트폰 방수 러닝 웨이스트백 힙색', price: 6000, shipping: 3000 }
    };

    function loadSample(id) {
      const s = samples[id];
      if (!s) return;
      document.getElementById('rawName').value = s.name;
      document.getElementById('wholesalePrice').value = s.price;
      document.getElementById('wholesaleShipping').value = s.shipping;
      calculateMarginLive();
    }

    function calculateMarginLive() {
      const p = Number(document.getElementById('wholesalePrice').value) || 0;
      const s = Number(document.getElementById('wholesaleShipping').value) || 0;
      const m = (Number(document.getElementById('targetMargin').value) || 30) / 100;
      const f = (Number(document.getElementById('coupangFee').value) || 10.8) / 100;

      const totalCost = p + s;
      const divisor = 1.0 - f - m;
      if (divisor <= 0) return;

      const rawSalePrice = totalCost / divisor;
      const salePrice = Math.ceil(rawSalePrice / 100) * 100;
      const coupangFee = Math.round(salePrice * f);
      const netProfit = salePrice - coupangFee - totalCost;
      const marginRate = salePrice > 0 ? ((netProfit / salePrice) * 100).toFixed(1) : 0;

      document.getElementById('dispSalePrice').innerText = salePrice.toLocaleString() + '원';
      document.getElementById('dispNetProfit').innerText = '+' + netProfit.toLocaleString() + '원';
      document.getElementById('dispTotalCost').innerText = totalCost.toLocaleString() + '원';
      document.getElementById('dispCoupangFee').innerText = coupangFee.toLocaleString() + '원';
      document.getElementById('dispMarginRate').innerText = marginRate + '%';
    }

    async function generateSeo() {
      const name = document.getElementById('rawName').value.trim();
      if (!name) {
        alert('도매 상품명을 입력해주세요!');
        return;
      }

      const btn = document.getElementById('btnGenerate');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>10년 차 셀러 로직 분석 중...</span>';
      btn.disabled = true;

      try {
        const res = await fetch('/api/generate-seo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            price: document.getElementById('wholesalePrice').value,
            shipping: document.getElementById('wholesaleShipping').value
          })
        });

        const data = await res.json();
        if (data.ok && data.result) {
          const r = data.result;
          document.getElementById('outProductName').value = r.productName || '';
          document.getElementById('charCount').innerText = (r.productName || '').length + '자';

          // Tags
          const tagsContainer = document.getElementById('outSearchTags');
          tagsContainer.innerHTML = '';
          (r.searchTags || []).forEach(t => {
            const span = document.createElement('span');
            span.className = 'px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded-md font-medium text-[11px] shadow-2xs';
            span.innerText = '#' + t;
            tagsContainer.appendChild(span);
          });

          // Points
          const pointsContainer = document.getElementById('outSellingPoints');
          pointsContainer.innerHTML = '';
          (r.sellingPoints || []).forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = '<i class="fa-solid fa-check text-blue-500 mr-1.5"></i> ' + p;
            pointsContainer.appendChild(li);
          });
        }
      } catch (e) {
        alert('생성 오류: ' + e.message);
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    function copyText(elemId) {
      const el = document.getElementById(elemId);
      el.select();
      navigator.clipboard.writeText(el.value);
      alert('복사되었습니다!');
    }

    function copyAll() {
      const name = document.getElementById('outProductName').value;
      const tags = Array.from(document.querySelectorAll('#outSearchTags span')).map(s => s.innerText.replace('#','')).join(', ');
      const text = '상품명: ' + name + '\\n키워드 태그: ' + tags;
      navigator.clipboard.writeText(text);
      alert('상품명과 검색 태그가 복사되었습니다!');
    }

    function saveProductRecord() {
      const name = document.getElementById('outProductName').value;
      const price = document.getElementById('dispSalePrice').innerText;
      const margin = document.getElementById('dispMarginRate').innerText;
      if (!name) return;

      const list = document.getElementById('historyList');
      const item = document.createElement('div');
      item.className = 'py-2.5 flex items-center justify-between border-t border-slate-100';
      item.innerHTML = '<div><span class="font-semibold text-slate-800">' + name + '</span>' +
        '<span class="text-slate-400 block text-[11px]">판매가 ' + price + ' (마진 ' + margin + ')</span></div>' +
        '<span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200 text-[11px]">대기중</span>';
      list.prepend(item);
      alert('목록에 저장되었습니다!');
    }

    // 초기 마진 계산
    calculateMarginLive();
  </script>
</body>
</html>`;
}


/**
 * Coupang Seller AI Agent - Cloudflare Worker Entrypoint
 */





export default {
  /**
   * HTTP 요청 핸들러 (웹 대시보드 및 REST API)
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 메인 웹 대시보드 페이지
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(renderDashboardHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // CORS 프리플라이트 대응
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 2. 실시간 마진 계산 API
    if (url.pathname === '/api/calculate-margin' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = calculateCoupangPrice(
          body.wholesalePrice,
          body.wholesaleShipping || 3000,
          body.targetMarginRate || (Number(env.DEFAULT_TARGET_MARGIN) || 0.30),
          body.coupangFeeRate || (Number(env.DEFAULT_COUPANG_FEE) || 0.108)
        );
        return jsonResponse({ ok: true, result });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400);
      }
    }

    // 3. AI 기반 SEO 상품명 & 검색 태그 생성 API
    if (url.pathname === '/api/generate-seo' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await generateProductSeo(body, env);
        return jsonResponse({ ok: true, result });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // 4. 시스템 상태 및 통계 API
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        status: 'online',
        provider: env.LLM_PROVIDER || 'gemini',
        hasApiKey: Boolean(env.GEMINI_API_KEY || env.OPENAI_API_KEY),
        defaultFee: env.DEFAULT_COUPANG_FEE || '0.108',
        defaultMargin: env.DEFAULT_TARGET_MARGIN || '0.30'
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  /**
   * Cron Trigger 핸들러 (매일 정기 자동 실행)
   */
  async scheduled(event, env, ctx) {
    console.log(`[Cron Trigger 실행] cron: ${event.cron}, time: ${new Date().toISOString()}`);
    // 여기에 쿠팡 WING 신규 주문 조회 및 도매처 재고 자동 체크 로직이 연동됩니다.
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

