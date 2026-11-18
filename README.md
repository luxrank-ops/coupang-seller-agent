# 쿠팡 셀러 AI 비서 · 상품 소싱 워크스페이스

Cloudflare Workers 기반의 상품 탐색·비교·판매 준비 앱입니다. 도매몰별 검색 바로가기와 공급사 CSV를 이용해 판매할 상품을 고를 수 있습니다. 쿠팡 공식 서비스가 아닙니다.

## 기능

- **7개 소싱처 외부 검색**: 도매꾹, 도매매, 오너클랜, 온채널, 도매토피아, 1688, Alibaba. 입력한 키워드를 인코딩해 각 사이트를 새 탭에서 엽니다. 해외몰은 중국어/영어 검색을 권장합니다. 사이트 정책·로그인 상태에 따라 결과가 달라질 수 있습니다.
- **도매꾹 실시간 검색(기본값)**: 서버가 도매꾹 Open API 4.1 `getItemList`를 직접 호출합니다. 첫 화면은 기본 키워드(`수납`)로 실제 상품을 바로 보여주고, 검색어·공급가 범위(`mnp`/`mxp`)·1개부터 주문(`mnq=1`)·무료배송(`who=S`)이 모두 서버 조회 조건으로 전달됩니다. 더 보기로 다음 페이지를 이어 붙입니다.
- **도매꾹 상세정보(4.6 `getItemView`)**: 상품 상세를 열면 재고·도매 MOQ·옵션 구성·도매꾹 카테고리 코드·배송 방법/부담/배송비·제주/도서 추가비·원산지·제조사·모델명·반품지·반품배송비·이미지 사용 허가를 실제 응답으로 보여줍니다.
- **아이디어 상품 발굴**: 예시 데이터가 아니라 아이디어성 키워드(접이식·무타공·원터치 등)로 도매꾹을 실제 조회해 1개부터 주문 가능한 상품만 모읍니다.
- **오너클랜 판매사 API**: JWT 인증(`auth.ownerclan.com/auth`) → `api.ownerclan.com/v1/graphql` `allItems` 조회를 구현했습니다. 계정 인증 정보가 설정되지 않으면 목록에 나타나지 않고 “미연결”로 표시됩니다.
- **최대 4개 상품 비교**, 관심 상품, 판매 후보 선택, 공급사 원문 확인.
- **찾은 상품 직접 추가**: 외부 도매몰에서 찾은 상품의 URL·공급가를 입력해 바로 판매 후보로 선택할 수 있습니다. 미확인 배송비·MOQ는 공란으로 남길 수 있습니다.
- **실제 공급사 CSV 가져오기**: 미리보기, 행별 오류, 중복 상품 업데이트, UTF-8 CSV 내보내기. 파일은 서버로 업로드하지 않습니다.
- **판매 준비**: 원가·배송비·마진·수수료 수정, 사실 기반 상품명/태그 초안, 등록 데이터 복사, **쿠팡 WING Open API 등록 실행**(서명 요청 실제 전송)과 등록 페이로드(JSON) 내려받기, 피클 비서 등록 요청문 복사.
- **로컬 저장**: 가져온 상품/관심 상품 최대 1,000개, 판매 후보 최대 100개 및 작성 중인 초안. 같은 브라우저·같은 사이트 주소에서만 유지됩니다. 다른 기기와 동기화되지 않습니다. 저장소 차단/용량 초과는 경고합니다.
- **🔥 급등 상품(판매·인기 순위)**: 사이드바 ‘급등 상품’ 탭이 도매꾹·오너클랜·온채널의 **공개된 판매·인기 순위**를 한 번에 모아 보여줍니다(`GET /api/trending`).
  - 도매꾹: Open API 인기상품순(`so=ha`). 판매 실적이 반영된 순서이며 품절·판매중지 상품은 응답에 없습니다.
  - 오너클랜: 공개 홈의 ‘오너클랜 100’(1~100위, 공급가 공개) 순위와 인기 키워드.
  - 온채널: 공개 상품센터의 사이트 판매랭킹순 TOP10(기준일 표시)과 베스트순(`orderby=best`). 비회원 가격은 비공개라 공급가를 비웁니다.
  - ‘상승’ 표시는 **직전 집계일의 순위 스냅샷**과 비교한 값입니다(스냅샷은 Cache API에 보관, 첫 배포일에는 비교 기준이 없습니다).
  - 실재고 필터는 판매중이 확인된 상품(도매꾹)만 남깁니다. 오너클랜·온채널은 재고를 공개하지 않아 ‘재고 확인 필요’로 표시됩니다.
- **자동 등록 안전 큐**: `GET /api/trending/queue`가 급등 후보를 제재 회피 기준으로 `ready`(자동 등록 가능) / `review`(사람 확인) / `block`(제외)으로 나눠 줍니다. 하루 기본 3건·최대 5건, 실재고·MOQ 1·배송비 확인·목표마진 이익 5,000원 이상·지재권 키워드 배제·KC 검토를 검사하고, 쿠팡 최저가 -100원 흑자는 등록 직전 확인 항목으로 남깁니다. 피클 정기 액션이 브라우저로 WING에 등록할 때 이 큐를 사용합니다.
- **⛔ 역마진(적자) 자동 필터**: 확인한 **쿠팡 동급 최저가 − 100원**을 판매가로 두고 `도매 원가 + 도매 배송비 + 쿠팡 판매수수료(기본 10.8%)`를 빼 순마진을 계산합니다. 순마진이 **0원 이하**면 역마진으로 판정해 ① 상품 카드·판매 준비·급등 큐에 배지로 표시하고 ② 판매 후보 담기를 막고 ③ WING 등록·등록 페이로드·피클 등록 요청문 복사·CSV 일괄 내보내기를 차단하고 ④ `POST /api/register-product`에 최저가가 함께 오면 서버에서 `422 LOSS_BLOCKED`로 한 번 더 막습니다.
  - 최저가는 상품 상세의 “쿠팡 동급 최저가” 입력, 판매 준비의 `쿠팡 동급 최저가` 필드, 급등 큐의 후보별 입력으로 기록하며 브라우저에 저장됩니다(같은 상품은 다음 판정에도 자동 적용).
  - 순마진율 5% 미만은 `review`(사람 확인)로 내려 자동 등록하지 않습니다.
  - **최저가를 모르는 상품은 추정하지 않습니다.** `lowest_price` 검수 항목이 ‘확인 필요(pending)’로 남습니다. 이때는 다른 검수를 통과하면 기존과 같이 `ready`가 될 수 있고, 등록 직전 WING에서 최저가를 확인해 흑자인 경우에만 등록하는 규칙이 그대로 적용됩니다. 최저가를 넘기면(`marketPrices`) 그 확인도 자동 판정으로 바뀝니다.
  - `GET/POST /api/margin/assess` — `{wholesalePrice, shippingFee, marketPrice, coupangFeeRate?, undercut?}`로 판정만 조회합니다(응답: `assessment`, `blockRegistration`). `GET /api/trending/queue?marketPrices={"상품id":12900}`로 큐에 최저가를 넘기면 서버가 자동 차단합니다.
- **연동 상태 표시**: `/api/health`와 화면 상단 칩이 도매꾹·오너클랜·WING·AI 연결 여부를 실제 점검 결과로 보여줍니다. 연결되지 않은 소싱처는 결과에 섞이지 않습니다(도매매·온채널·도매토피아·1688·Alibaba는 외부 검색 바로가기만 제공).
- **🤖 AI 운영팀(4단계 에이전트 팀)**: 사이드바 ‘AI 운영팀’ 탭이 1팀 발굴 → 2팀 검수·가격 → 3팀 등록 → 4팀 판매·CS 감시의 상태·규칙·오늘 큐를 한 화면에 보여줍니다.
  - `GET /api/agents/status` — 4팀 상태, 규칙, 오늘 큐 요약(`readyCount`, `dailyQuota`, `hardCap`, `verdictCounts`)·최근 실행 로그(`?registeredToday=`로 오늘 등록 건수 전달, 상태 캐시 없이 매번 계산).
  - `POST /api/agents/run` — `{"team":"discovery|audit|registration|monitoring"}`을 즉시 실행해 최신 스캔·검수 결과와 실행 로그를 돌려줍니다. 등록·주문 같은 외부 변경은 하지 않습니다.
  - `GET /api/agents/runs` / `POST /api/agents/runs` — 실행 로그 조회와 기록(허용 IP의 피클 브릿지가 점검 결과를 남길 때 사용).
  - 4팀은 Cloudflare Worker의 출구 IP가 매 요청 달라 쿠팡 Open API가 403으로 막히는 사실을 그대로 표시하고, 허용 IP(`WING_REGISTERED_IP`)와 점검 체크리스트·로그만 제공합니다.
  - 실행 로그는 KV·D1이 없는 배포라 Cache API + 인메모리에 최근 40건(7일) 보관합니다(콜로별 최선 노력).
- 모바일/데스크톱 반응형, 외부 CDN 없이 자체 CSS·JS·Pretendard 폰트 사용.

## 데이터의 의미와 제한

**화면에 보이는 상품은 모두 소싱처 API가 실제로 돌려준 값입니다.** 예시(목업) 상품은 앱에서 제거했고, 예시 데이터 파일은 `tests/fixtures/`의 테스트 전용으로만 남아 있습니다. API가 실패하면 예시로 대신 채우지 않고 오류를 표시합니다.

도매꾹 목록 API는 상품번호·제목·단가·MOQ(`unitQty`)·배송비 부담/금액(`deli.who`/`fee`)·사업자전용·해외직배송 여부를 줍니다. 옵션별 공급가·재고·정확한 카테고리는 상세 API(4.6)에서 확인합니다. **미확인 배송비·MOQ는 0원/1개로 바꾸지 않습니다.**

추정 판매가 공식:

```text
총 원가 = 상품 1개 공급가 + 공급사 배송비 전액
권장 판매가 = ceil(총 원가 / (1 - 수수료율 - 목표마진율) / 100) × 100
예상 이익 = 권장 판매가 - 반올림(판매가 × 수수료율) - 총 원가
```

상품 목록의 기본 가정은 목표마진 30%, 수수료 10.8%, 1개 판매, 고객 무료배송입니다. 판매 준비에서 수정할 수 있습니다. 부가세 정산·광고비·포장·반품·관부가세·국제운임 등은 제외합니다. 실제 이익이나 인증·권리 적합성을 보장하지 않습니다. 공급사 MOQ, 옵션, 실제 카테고리 수수료 및 거래 조건을 반드시 확인하세요.

역마진 판정 공식(쿠팡 최저가 경쟁에서 실제로 받을 수 있는 가격 기준):

```text
판매가 = 쿠팡 동급 최저가 - 100원
수수료 = round(판매가 × 수수료율)
순마진 = 판매가 - 수수료 - (도매 원가 + 도매 배송비)
순마진 ≤ 0 → 역마진(등록 차단) / 순마진율 < 5% → 마진 주의(사람 확인)
```

**상품을 선택하거나 저장해도 구매·주문은 실행되지 않습니다.** 쿠팡 등록은 `POST /api/register-product`가 쿠팡 WING Open API로 실제 서명 요청(`CEA algorithm=HmacSHA256`)을 보내고, 쿠팡의 응답 코드·메시지를 그대로 반환합니다. 성공/상품ID를 앱이 만들어내지 않습니다.

쿠팡 Open API는 **WING > 판매자정보 > 추가판매정보에 등록한 IP에서만** 호출됩니다(2026-11-14 현재 허용 IP 6개: 작업용 샌드박스 `54.186.5.104` + 온채널 공식 IP 5개). Cloudflare Worker의 송신 IP는 엣지마다 달라 고정할 수 없으므로(실측: `104.23.160.34`, `172.70.206.84`, `172.68.175.68`), 등록 IP와 일치하지 않으면 쿠팡이 `403 Your ip address … is not allowed`로 거부하며 앱은 그 사유를 그대로 표시합니다. 서명은 쿠팡 공식 예제대로 `HMAC-SHA256` 16진수(hexdigest)를 사용하며, 서명이 틀리면 `401 Invalid signature.`, IP가 다르면 위 403이 돌아옵니다.

등록 IP가 있는 환경(사무실 PC 등)에서 직접 등록하려면 앱의 “등록 페이로드(JSON)”를 내려받아 다음 스크립트를 실행합니다.

> 무료/일반 플랜의 Cloudflare Workers는 고정 송신 IP를 지정할 수 없습니다(고정 송신 IP는 Enterprise 부가 기능인 Dedicated CDN Egress IPs·Aegis). 그래서 Worker에서 쿠팡 Open API를 직접 호출하는 경로는 이 플랜에서 원리적으로 불가능합니다.
> 현재 WING에 등록된 `54.186.5.104`는 작업용 샌드박스(AWS us-west-2)의 송신 IP로, 사용자 PC의 IP가 아닙니다. 이 스크립트를 쓰려면 WING > 판매자정보 > 추가판매정보에서 등록 IP를 실제로 실행할 PC의 공인 IP로 바꾸고 30분 뒤 실행해야 합니다.

```bash
WING_ACCESS_KEY=… WING_SECRET_KEY=… node tools/wing-register.mjs 쿠팡등록_페이로드_상품.json
``` 또한 상품 등록에는 노출카테고리 코드와 상품 고시정보가 필수라서, 코드를 입력하지 않으면 요청을 보내지 않고 부족한 항목을 알려줍니다(HTTP 422). WING 화면에서의 등록은 “피클 비서에게 등록 요청 복사”로 진행합니다.

## 개발

Node.js 22.12 이상이 필요합니다.

```bash
npm ci
npm run dev             # 로컬 Workers + 정적 자산, 0.0.0.0:8787
npm test                # 네트워크 불필요: 도메인·CSV·저장소·Worker·API 어댑터 테스트
npx playwright install chromium
npm run test:e2e        # 데스크톱·모바일 사용자 흐름 + 접근성·가독성, 로컬 서버 자동 시작
npx wrangler deploy --dry-run
npm run deploy          # Cloudflare 권한이 있는 운영 환경에서만 실행
```

선택적으로 `CHROMIUM_EXECUTABLE_PATH`를 설정해 설치된 Chromium으로 E2E를 실행할 수 있습니다. API 어댑터는 모의 공급사 응답으로 테스트합니다. 실서비스 도매몰 접속이나 키 없이 기본 기능과 CSV를 사용할 수 있습니다.

서비스 배포 대상: `coupang-seller-agent.luxrank.workers.dev` (이 저장소의 설정 기준; 변경 사항 배포는 별도로 실행).

### 화면 가독성·접근성

- `public/styles.css`의 공통 색상 토큰으로 진한 네이비 본문, 인디고 주요 동작, 초록 선택·이익, 황색 주의, 적색 오류를 구분합니다. 선택·오류는 색상 외에도 텍스트·체크·테두리로 표시합니다.
- 상품명 15px, 가격 24px, 상품 보조 정보 12px 이상을 유지하고 상품·검색 입력창은 16px로 표시합니다. 좁은 화면은 글씨를 축소하는 대신 카드·필터·입력창 배치를 바꿉니다.
- `tests/e2e/accessibility.spec.js`는 axe의 WCAG A/AA 자동 검사(색상 대비 포함)를 목록·상세·비교·판매 준비·CSV·직접 추가·도매몰 안내와 선택/호버 상태에 실행합니다. 키보드 포커스와 320~1680px 가로 넘침도 검사합니다.
- 자동 검사 통과가 전체 접근성 준수를 보장하지는 않습니다. 실제 화면 확대·키보드·보조기기 확인도 함께 진행하세요.

## 소싱처 API 연결 (운영자)

키는 **Cloudflare Worker 시크릿**으로만 두고 코드·클라이언트 JS에 넣지 않습니다.

| 이름 | 용도 |
| --- | --- |
| `DOMEGGOOK_API_KEY` | 도매꾹 Open API 키(`aid`) |
| `OWNERCLAN_USERNAME` / `OWNERCLAN_PASSWORD` | 오너클랜 판매사 계정(JWT 발급, 인증 응답은 plain text JWT). `OWNERCLAN_TOKEN`으로 토큰만 넣어도 됩니다 |
| `WING_ACCESS_KEY` / `WING_SECRET_KEY` | 쿠팡 WING Open API 서명 키 |
| `WING_VENDOR_ID` / `WING_REGISTERED_IP` | 업체코드, WING에 등록된 IP(안내용) |
| `GEMINI_API_KEY` 또는 `OPENAI_API_KEY` | 상품명·태그 AI 초안(선택) |

```bash
npx wrangler secret put DOMEGGOOK_API_KEY
npx wrangler secret put OWNERCLAN_USERNAME
npx wrangler secret put OWNERCLAN_PASSWORD
npx wrangler secret put WING_ACCESS_KEY
npx wrangler secret put WING_SECRET_KEY
npm run deploy
```

오너클랜 검색(`allItems`)은 응답이 10초대에서 2분 가까이까지 들쭉날쭉합니다(2026-11-14 실측: `문풍지` 8.5초, `차박` 15.9초, `캠핑` 97초, `수납` 82~116초). 그래서 서버는 80초까지 기다리고, 브라우저는 92초까지 기다리며, 성공 결과는 10분간 재사용합니다. 초과 시 `504`와 함께 재시도 안내를 돌려줍니다. 검색 필터(`search`) 자체가 느린 것이라 앱에서 더 줄일 수 있는 여지가 적습니다.

도매꾹 호출은 문서의 권장 엔드포인트 `https://www.domeggook.com/ssl/api/`를 먼저 쓰고, 실패하면 `https://domeggook.com/ssl/api/`로 재시도합니다(리다이렉트 추적, 12초 타임아웃, 쿼리별 60초 캐시). 실패 시 `upstream` 배열에 엔드포인트별 상태·오류만 남기고 키는 노출하지 않습니다. 연동 상태는 `GET /api/health`로 확인합니다.

## 상품명·태그 초안

AI 키 미연결 시 입력한 상품명·카테고리·설명만 사용하는 **기본 템플릿**임을 표시합니다. 임의의 1+1 구성, 소재, 효능, 인증을 추가하지 않습니다. 선택적 서버 연결:

```bash
npx wrangler secret put GEMINI_API_KEY
# 또는 LLM_PROVIDER=openai 설정 후
npx wrangler secret put OPENAI_API_KEY
```

기본 모델은 `gemini-3.5-flash` / `gpt-4o-mini`이며 `GEMINI_MODEL` / `OPENAI_MODEL` 서버 변수로 변경할 수 있습니다. 연결된 경우 초안 생성 버튼을 눌렀을 때 입력 상품 정보가 해당 AI 제공자에게 전송됩니다. 생성 결과는 판매 전 직접 검토해야 합니다.

무료 티어 Gemini는 혼잡(503)·할당량(429)으로 일시 실패할 수 있어 `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-flash-lite-latest` → `gemini-3.6-flash` 순으로 재시도하고 전체 25초에서 끊습니다. `gemini-2.5-flash`는 신규 사용자에게 404로 응답하므로 쓰지 않습니다(2026-11-14 확인). Workers `fetch`는 `redirect: "error"`를 거부하므로(`Invalid redirect value`) 반드시 `redirect: "manual"`을 사용합니다.

## CSV 형식

UTF-8 CSV, 최대 2MB/1,000행. 필수 열은 `상품명`, `도매가`입니다. 영문 헤더도 지원합니다. 도매몰마다 다른 원본 파일은 앱의 양식에 맞게 열 이름을 변환해주세요. 금액은 **원화 정수**이며 해외 가격을 자동 환산하지 않습니다.

| 한글 열         | 영문 열                | 의미                                                                              |
| --------------- | ---------------------- | --------------------------------------------------------------------------------- |
| 상품명          | name                   | 필수, 최대 160자                                                                  |
| 도매가 / 공급가 | wholesalePrice / price | 필수, 0~1억 원 정수                                                               |
| 배송비          | shippingFee / shipping | 공란은 미확인, 0은 실제 배송비 0원                                                |
| 소싱처 / 공급사 | source / sourceId      | 지원 도매몰명 또는 직접 입력한 공급사                                             |
| 카테고리        | category / categoryId  | 화면의 카테고리명 또는 living/kitchen/pet/outdoor/car/office/fashion/garden/other |
| 최소주문수량    | minOrder / moq         | 공란은 미확인, 양의 정수                                                          |
| 상품URL         | url                    | https 주소                                                                        |
| 이미지URL       | imageUrl               | https 주소, 외부 이미지 요청은 브라우저에서 발생                                  |
| 판매방식        | fulfillment            | 위탁배송/consignment, 도매매입/wholesale, 해외소싱/overseas                       |
| 상품코드        | sku                    | 같은 공급사·상품코드는 마지막 정보로 업데이트                                     |
| 설명            | description            | 공급사에서 확인한 상품 사양, 최대 2,000자                                         |

`상품코드`가 없으면 상품 URL, 그것도 없으면 상품명으로 중복을 식별합니다. 오류 행은 미리보기에서 표시하며 정상 행만 가져오기를 명시적으로 선택할 수 있습니다. 업데이트 시 관심 상품·판매 후보 스냅샷도 갱신하지만, 사용자가 이미 수정한 초안은 유지합니다. CSV 내보내기는 스프레드시트 수식 주입을 방지합니다.

## 구조

```text
public/               정적 대시보드, 스타일, 브라우저 로직
public/lib/           공통 상품·CSV·마진·저장소·소싱처 모듈
src/index.js          Worker API 및 정적 자산 라우팅
src/sourcing.js       도매꾹 Open API 어댑터(목록 4.1·상세 4.6)
src/ownerclan.js      오너클랜 판매사 GraphQL 어댑터(JWT)
src/wing.js           쿠팡 WING Open API 서명·등록 클라이언트
src/trending.js       급등 순위 수집·순위 스냅샷·안전 등록 큐
src/agents.js         4단계 AI 운영팀 상태·수동 실행·실행 로그
src/ideaDiscovery.js  실시간 아이디어 키워드 발굴
tests/fixtures/       테스트 전용 예시 상품(앱 응답에는 사용하지 않음)
src/prompt.js         사실 기반 기본 초안 / 선택적 AI 제공자
 tests/unit/          Node 내장 테스트 러너
 tests/e2e/           Playwright 사용자 흐름
```

폰트: [Pretendard](https://github.com/orioncactus/pretendard), SIL Open Font License (`public/fonts/OFL.txt`). 상품 그림은 공급사 사진이 아닌 자체 SVG 예시 일러스트입니다.
