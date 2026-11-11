# 쿠팡 위탁판매 전문 AI 비서 (Cloudflare Worker)

10년 차 이커머스 전문 MD의 판단 로직을 탑재한 **서버 비용 0원**의 쿠팡 위탁판매 자동화 비서 앱입니다.
반응형 웹 대시보드(모바일/PC 지원), 실시간 역마진 방지 계산 엔진, Gemini/OpenAI 기반 SEO 키워드 추출기, Cron 스케줄러가 단 하나의 Worker로 구동됩니다.

---

## 🚀 1분 만에 배포하기 (Quick Start)

### 1. 로컬 실행 및 테스트
```bash
cd coupang-seller-worker
npx wrangler dev
```
브라우저에서 `http://localhost:8787`로 접속하면 실시간 대시보드가 열립니다.

### 2. Cloudflare로 즉시 배포 (무료)
```bash
npx wrangler deploy
```
배포 완료 즉시 `https://coupang-seller-agent.<본인-서브도메인>.workers.dev` 주소가 발급됩니다.

### 3. AI API 키 등록 (무료 Gemini 또는 OpenAI)
어제 이모티학(emotihak.com)에 연결했던 무료 Gemini API 키를 그대로 사용하시면 원가 0원으로 돌아갑니다:
```bash
npx wrangler secret put GEMINI_API_KEY
# 프롬프트가 뜨면 Google AI Studio API 키를 입력
```
(OpenAI를 쓰실 경우 `npx wrangler secret put OPENAI_API_KEY` 입력 후 wrangler.toml의 LLM_PROVIDER를 "openai"로 변경)

---

## 🛠️ 핵심 기능

1. **실시간 마진 검증 엔진 (`src/margin.js`)**
   - 도매가와 배송비를 입력하면 쿠팡 카테고리 수수료(10.8%)를 반영해 순마진 30%가 나오는 권장 판매가를 100원 단위로 자동 올림 계산합니다.
   - 역마진 위험을 물리적으로 원천 차단합니다.

2. **10년 차 셀러 SEO 최적화 프롬프트 (`src/prompt.js`)**
   - [수량/혜택] + [시즌/용도 키워드] + [상품명] + [소재] + [장소] 공식으로 상단 노출용 상품명을 생성합니다.
   - 쿠팡 검색창 알고리즘에 걸리는 연관 검색 태그 15~20개를 자동 추출합니다.

3. **반응형 웹 대시보드 (`src/ui.js`)**
   - 스마트폰이나 PC 어디서든 접속해 도매 상품 정보를 넣고 원클릭으로 최적화 데이터를 뽑을 수 있습니다.

4. **자동 Cron 트리거 (`wrangler.toml`)**
   - 매일 오전 9시, 오후 6시에 Worker가 자동 실행되어 주문 확인 및 재고 체크 백그라운드 작업을 수행합니다.
