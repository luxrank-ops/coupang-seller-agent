/**
 * 반응형 모바일/데스크톱 웹 대시보드 템플릿
 */

export function renderDashboardHtml() {
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
