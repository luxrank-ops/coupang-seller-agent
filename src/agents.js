/**
 * 4단계 AI 운영팀 — 발굴 · 검수·가격 · 등록 · 판매·CS 감시.
 *
 * 앱의 `🤖 AI 운영팀` 탭이 읽는 상태 API와 수동 실행 API의 계산을 모아 둔다.
 * 원칙: 서버가 확인하지 못한 것은 확인했다고 쓰지 않는다.
 * - 1~3팀은 급등 수집(/api/trending)·안전 큐(/api/trending/queue)와 같은 계산을 그대로 쓴다.
 * - 4팀은 Cloudflare Worker의 출구 IP가 매 요청 달라 쿠팡 Open API가 403으로 막히는 사실을
 *   숨기지 않고, 허용 IP(피클 브릿지) 상태와 점검 체크리스트·실행 로그만 제공한다.
 * - 실행 로그는 KV·D1이 없는 배포라 Cache API + 인메모리에 최근 40건을 보관한다(콜로별, 최선 노력).
 */
import { SourcingError } from "./sourcing.js";
import {
  BANNED_WORDS,
  BLOCK_WORDS,
  BRAND_WORDS,
  DAILY_QUOTA,
  HARD_CAP,
  REVIEW_WORDS,
  buildRegistrationQueue,
  collectTrending,
} from "./trending.js";
import { probeWing, wingConfigured, wingNotes } from "./wing.js";

const DEFAULT_ORIGIN = "https://coupang-seller-agent.luxrank.workers.dev";
export const TEAM_IDS = ["discovery", "audit", "registration", "monitoring"];
const MAX_RUNS = 40;
const RUN_TTL_SECONDS = 7 * 86400;
const RUN_CACHE_PATH = "/api/_agent-runs";

/** 피클 정기 액션 기준 자동 등록 스케줄(KST). 서버는 스케줄을 실행하지 않고 화면에 안내만 한다. */
export const SCHEDULES = [
  {
    at: "07:00",
    label: "하이티켓 3종 전략 소싱·등록",
    action: "scheduled-actions/💎-매일-07시-하이티켓-3종-전략-소싱-및-등록",
  },
  {
    at: "08:30",
    label: "급등상품 안전 자동 등록(검수 통과분만)",
    action: "scheduled-actions/🚀-매일-08시30분-급등상품-안전-자동-등록",
  },
];

export const KEYWORD_RULES = {
  brand: BRAND_WORDS.length,
  banned: BANNED_WORDS.length,
  block: BLOCK_WORDS.length,
  kc: REVIEW_WORDS.length,
};

const MONITORING_CHECKLIST = [
  {
    key: "sales_status",
    label: "판매중·승인대기 상태 확인",
    detail: "WING 상품 목록에서 판매중지·품절·승인거부로 바뀐 상품이 있는지 확인",
  },
  {
    key: "soldout",
    label: "공급사 품절(결품) 감지",
    detail: "판매중 상품의 공급사 원본 페이지를 열어 SOLD OUT·단종 여부 확인",
  },
  {
    key: "price_inversion",
    label: "가격 역전(최저가 추월) 점검",
    detail: "쿠팡 동일상품 최저가가 내 판매가보다 낮아졌는지 확인하고 필요 시 재가격",
  },
  {
    key: "order_flow",
    label: "주문·발주·송장 입력 지연",
    detail: "주문 발생 시 공급사 발주와 운송장 입력이 출고 기한 안에 끝났는지 확인",
  },
  {
    key: "cs",
    label: "취소·반품·문의 응대",
    detail: "취소·반품 요청과 고객 문의에 기한 내 응답했는지 확인",
  },
];

/* ── 실행 로그 저장소 ──────────────────────────────────────────────────── */

let memoryRuns = [];

function cacheStore() {
  return typeof caches !== "undefined" ? caches.default : null;
}

function runCacheKey(origin) {
  return new URL(RUN_CACHE_PATH, String(origin || DEFAULT_ORIGIN)).toString();
}

function normalizeRun(run) {
  return {
    id: String(run.id || ""),
    team: String(run.team || ""),
    action: String(run.action || "").slice(0, 80),
    state: String(run.state || "ok").slice(0, 20),
    source: run.source === "external" ? "external" : "api",
    summary: String(run.summary || "").slice(0, 600),
    findings: Array.isArray(run.findings)
      ? run.findings.slice(0, 12).map((item) => String(item).slice(0, 300))
      : [],
    metrics: run.metrics && typeof run.metrics === "object" ? run.metrics : null,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || new Date().toISOString(),
    ms: Number.isFinite(run.ms) ? run.ms : null,
  };
}

function sortRuns(runs) {
  return [...runs].sort(
    (a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0),
  );
}

async function readCachedRuns(origin) {
  const cache = cacheStore();
  if (!cache) return [];
  try {
    const hit = await cache.match(new Request(runCacheKey(origin)));
    if (!hit) return [];
    const data = await hit.json();
    if (!Array.isArray(data?.runs)) return [];
    return data.runs.map(normalizeRun).filter((run) => run.id && run.team);
  } catch {
    return [];
  }
}

async function writeCachedRuns(origin, runs, ctx) {
  const cache = cacheStore();
  if (!cache) return false;
  const body = JSON.stringify({ updatedAt: new Date().toISOString(), runs });
  const put = cache
    .put(
      new Request(runCacheKey(origin)),
      new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${RUN_TTL_SECONDS}`,
        },
      }),
    )
    .then(() => true)
    .catch(() => false);
  try {
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
    else await put;
  } catch {
    return false;
  }
  return true;
}

/** 최근 실행 로그(메모리 + Cache API 병합, 최신순). */
export async function listRuns(origin = DEFAULT_ORIGIN, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), MAX_RUNS);
  const cached = await readCachedRuns(origin);
  const seen = new Set();
  const merged = [];
  for (const run of sortRuns([...memoryRuns, ...cached])) {
    if (!run.id || seen.has(run.id)) continue;
    seen.add(run.id);
    if (options.team && run.team !== options.team) continue;
    merged.push(run);
    if (merged.length >= limit) break;
  }
  return merged;
}

/** 실행 로그 1건 기록. Cache API가 없는 환경(단위테스트)에서는 메모리에만 남는다. */
export async function recordRun(env = {}, input = {}, options = {}) {
  const team = String(input.team || "").trim();
  if (!TEAM_IDS.includes(team))
    throw new SourcingError(
      "실행 로그에는 team(discovery, audit, registration, monitoring)이 필요합니다.",
      400,
    );
  const action = String(input.action || "").trim();
  if (!action)
    throw new SourcingError("실행 로그에는 action(무엇을 했는지)이 필요합니다.", 400);
  const run = normalizeRun({
    ...input,
    team,
    action,
    id:
      input.id ||
      "run_" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6),
    finishedAt: input.finishedAt || new Date().toISOString(),
  });
  memoryRuns = sortRuns([run, ...memoryRuns]).slice(0, MAX_RUNS);
  const origin = options.origin || DEFAULT_ORIGIN;
  const cached = await readCachedRuns(origin);
  const next = sortRuns([run, ...cached, ...memoryRuns]).filter(
    (entry, index, all) =>
      entry.id && all.findIndex((item) => item.id === entry.id) === index,
  );
  await writeCachedRuns(origin, next.slice(0, MAX_RUNS), options.ctx);
  return run;
}

/* ── 시간 표기 ─────────────────────────────────────────────────────────── */

function kstStamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "기록 없음";
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  const pad = (number) => String(number).padStart(2, "0");
  return (
    pad(kst.getUTCMonth() + 1) +
    "-" +
    pad(kst.getUTCDate()) +
    " " +
    pad(kst.getUTCHours()) +
    ":" +
    pad(kst.getUTCMinutes())
  );
}

function boundedCount(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 500
    ? parsed
    : fallback;
}

/* ── 수집 + 안전 큐 ────────────────────────────────────────────────────── */

/** 1~3팀이 함께 쓰는 급등 수집 + 검수 큐 계산. */
export async function scanTrending(env = {}, options = {}) {
  const params = new URLSearchParams({ source: "all", limit: "60" });
  const trending = await collectTrending(env, params, {
    fetcher: options.fetcher || fetch,
    ctx: options.ctx || {},
    origin: options.origin || DEFAULT_ORIGIN,
  });
  const queue = buildRegistrationQueue(trending.products, {
    limit: "3",
    registeredToday: String(boundedCount(options.registeredToday, 0)),
  });
  return { trending, queue };
}

/* ── 팀 상태 ───────────────────────────────────────────────────────────── */

function discoveryTeam(trending, lastRun) {
  const sources = trending.sources || {};
  const live = [
    sources.domeggook?.ok ? "도매꾹" : null,
    sources.ownerclan?.ok ? "오너클랜" : null,
    sources.onchannel?.ok ? "온채널" : null,
  ].filter(Boolean);
  const keywordCount = (sources.domeggook?.topics || []).filter(
    (topic) => topic.items > 0,
  ).length;
  return {
    id: "discovery",
    name: "1팀 발굴",
    role: "도매꾹·오너클랜·온채널 급등 스캔",
    state: live.length ? "active" : "attention",
    headline: live.length
      ? `${live.join("·")} 공개 순위에서 ${trending.total}건을 모았습니다. 직전 집계 순위와 비교해 상승·신규 진입을 표시합니다.`
      : "이번 스캔에서 도매몰 응답을 받지 못했습니다. 잠시 후 다시 실행해 주세요.",
    metrics: [
      { label: "수집 상품", value: `${trending.total}건`, hint: "필터 적용 후 중복 제거 기준" },
      { label: "마지막 스캔", value: kstStamp(trending.generatedAt), hint: "KST" },
      {
        label: "도매꾹 인기 키워드",
        value: `${keywordCount}/${(sources.domeggook?.topics || []).length}개`,
        hint: sources.domeggook?.configured ? "인기상품순(so=ha)" : "API 키 미설정",
      },
      {
        label: "오너클랜 100",
        value: `${sources.ownerclan?.items ?? 0}건`,
        hint: sources.ownerclan?.ok ? "공개 홈 1~100위" : sources.ownerclan?.error || "응답 없음",
      },
      {
        label: "온채널 판매랭킹",
        value: `${sources.onchannel?.rankItems ?? 0}건`,
        hint: sources.onchannel?.ok
          ? `기준일 ${sources.onchannel?.basisDate || "표시 없음"}`
          : sources.onchannel?.error || "응답 없음",
      },
    ],
    rules: [
      "도매꾹은 Open API 인기상품순(so=ha)으로 판매 실적이 반영된 순서를 읽고, 목록 API가 제외한 품절·판매중지 상품은 후보에서 빠집니다.",
      "오너클랜은 판매순위 정렬 API가 없어 공개 홈의 ‘오너클랜 100’ 순위를 쓰고, 온채널은 공개 상품센터의 판매랭킹·베스트순을 씁니다.",
      "‘급등’은 순위 자체가 아니라 직전 집계일 스냅샷 대비 상승폭·신규 진입으로 판정합니다(첫 집계일은 비교 기준 준비 중).",
      "수집 결과는 3분간 재사용해 도매몰 과호출을 막고, 수동 실행은 캐시를 건너뛰고 새로 스캔합니다.",
    ],
    actions: [{ id: "discovery", label: "지금 스캔 실행" }],
    lastRun,
  };
}

function auditTeam(queue, lastRun) {
  const counts = queue.verdictCounts || { ready: 0, review: 0, block: 0 };
  const blocked = (queue.blockedKeywords || [])
    .slice(0, 3)
    .map((entry) => `${entry.word} ${entry.count}건`);
  return {
    id: "audit",
    name: "2팀 검수·가격",
    role: "실재고·MOQ·마진·지재권·KC·최저가 -100원",
    state: counts.ready > 0 ? "active" : "attention",
    headline:
      `검수 대상 ${queue.evaluatedTotal ?? 0}건 중 통과 ${counts.ready}건 · 사람 확인 ${counts.review}건 · 차단 ${counts.block}건.` +
      (blocked.length ? ` 차단 키워드: ${blocked.join(", ")}.` : ""),
    metrics: [
      { label: "자동 등록 가능(ready)", value: `${counts.ready}건`, hint: "검수 8항목 모두 통과" },
      { label: "사람 확인(review)", value: `${counts.review}건`, hint: "재고·배송비·KC 근거 확인 필요" },
      { label: "차단(block)", value: `${counts.block}건`, hint: "지재권·금지품목 키워드" },
      {
        label: "지재권·금지 키워드",
        value: `${KEYWORD_RULES.block}종`,
        hint: `브랜드·캐릭터 ${KEYWORD_RULES.brand} + 금지품목 ${KEYWORD_RULES.banned}`,
      },
      { label: "KC 검토 키워드", value: `${KEYWORD_RULES.kc}종`, hint: "전기·유아동·피부접촉 등" },
    ],
    rules: [
      "실재고(공급사 판매중 응답) · 1개부터 주문 · 공급사 배송비 확인이 모두 확인돼야 자동 등록 대상이 됩니다.",
      `목표마진 30%·쿠팡 수수료 10.8% 기준 예상 이익 5,000원 이상, 공급가 10만 원 이하(왕복 반품비 2만 원 상한)만 통과합니다.`,
      `제목에 지재권·브랜드·캐릭터 키워드(${KEYWORD_RULES.brand}종)나 금지품목(${KEYWORD_RULES.banned}종)이 있으면 즉시 차단하고, KC 검토 키워드(${KEYWORD_RULES.kc}종)는 사람이 인증 근거를 확인합니다.`,
      "‘쿠팡 최저가 -100원’은 등록 직전 WING에서 최저가를 조회해야 판정되므로 자동 판정하지 않고 확인 필요로 남깁니다. -100원에서도 흑자인 경우에만 등록합니다.",
    ],
    actions: [{ id: "audit", label: "검수 다시 실행" }],
    lastRun,
  };
}

function registrationTeam(queue, lastRun) {
  const ready = Math.min(queue.readyCount || 0, queue.remaining || 0);
  return {
    id: "registration",
    name: "3팀 등록",
    role: "일일 안전 한도·오늘 등록 큐 관리",
    state: queue.remaining > 0 ? "active" : "paused",
    headline:
      `하루 기본 ${queue.dailyQuota}건·절대 상한 ${queue.hardCap}건. 오늘 등록 ${queue.registeredToday}건, 남은 한도 ${queue.remaining}건, 지금 등록 가능 ${queue.recommendedNow}건.`,
    metrics: [
      { label: "오늘 등록", value: `${queue.registeredToday}건`, hint: "요청 파라미터 기준" },
      { label: "남은 한도", value: `${queue.remaining}건`, hint: `기본 ${queue.dailyQuota}건 기준` },
      { label: "절대 상한", value: `${queue.hardCap}건`, hint: "하루 총 신규 등록" },
      { label: "등록 후보(ready)", value: `${queue.readyCount}건`, hint: "2팀 검수 통과" },
      {
        label: "07:00 + 08:30",
        value: SCHEDULES.map((entry) => entry.at).join(" / "),
        hint: "피클 정기 액션(KST) — 합산 5건 이하",
      },
    ],
    rules: [
      "07:00 하이티켓 3종 액션과 08:30 급등 자동 등록 액션을 합쳐 하루 신규 등록 5건을 넘기지 않습니다.",
      "같은 공급사 상품은 하루 1건, 같은 카테고리는 하루 2건까지만 등록하고 가격대를 분산합니다.",
      "verdict=ready만 자동 등록 대상입니다. review는 사용자가 확인한 뒤 등록하고 block은 등록하지 않습니다.",
      "등록 직전 쿠팡 최저가를 확인해 최저가 -100원에서도 흑자인 경우에만 판매가를 정합니다(적자면 다음 후보로).",
      "실제 WING 등록은 Cloudflare Worker가 아니라 피클 정기 액션(허용 IP 브릿지)이 수행합니다. 이 화면은 후보·한도·로그만 보여줍니다.",
    ],
    actions: [
      { id: "registration", label: "오늘 등록 큐 다시 계산" },
      { id: "queue", label: "오늘 등록 큐 보기" },
    ],
    lastRun,
  };
}

function monitoringTeam(env, lastRun) {
  const notes = wingNotes(env);
  const configured = wingConfigured(env);
  const lastProbe = lastRun?.metrics?.probe || null;
  const reachable = lastProbe ? lastProbe.reachable === true : null;
  const egress = lastProbe?.egressIp || null;
  const state = reachable === true ? "active" : "limited";
  return {
    id: "monitoring",
    name: "4팀 판매·CS 감시",
    role: "판매·주문·품절·가격역전 감시",
    state,
    headline: reachable === true
      ? "WING Open API 게이트가 정상 응답합니다. 판매·품절·가격역전 점검을 체크리스트와 실행 로그로 남길 수 있습니다."
      : `쿠팡 Open API는 WING에 등록한 IP에서만 호출됩니다. Worker 출구 IP${egress ? `(${egress})` : ""}는 허용 목록에 없어 403이 나므로, 판매·주문 조회와 등록은 허용 IP(${notes.registeredIp || "미설정"})의 피클 브릿지로 수행합니다.`,
    metrics: [
      {
        label: "WING 게이트",
        value: configured ? (reachable === true ? "정상" : reachable === false ? "403 (IP 미허용)" : "미점검") : "키 미설정",
        hint: lastProbe?.checkedAt ? `마지막 점검 ${kstStamp(lastProbe.checkedAt)}` : "‘게이트 점검’을 실행하면 실제 응답을 기록합니다",
      },
      { label: "등록된 허용 IP", value: notes.registeredIp || "미설정", hint: "WING > 판매자정보 > 추가판매정보" },
      { label: "Worker 출구 IP", value: egress || "가변", hint: "요청마다 달라 403 원인" },
      { label: "감시 항목", value: `${MONITORING_CHECKLIST.length}개`, hint: "판매상태·품절·가격역전·발주·CS" },
      { label: "실행 로그", value: lastRun ? "기록 있음" : "없음", hint: "Cache API + 인메모리, 최근 40건" },
    ],
    rules: [
      "Worker는 쿠팡 Open API를 직접 조회하지 않습니다(IP 제한). 판매·주문·품절·가격역전 점검은 허용 IP의 피클 브릿지에서 실행하고 결과를 이 로그에 기록합니다.",
      "감시 주기: 판매중 상품 품절·가격역전은 매일, 주문·송장 지연은 주문 발생 시 확인합니다.",
      "가격역전이 확인되면 최저가 -100원 흑자 여부를 다시 계산해 판매가를 조정하거나 판매중지를 검토합니다.",
      "공급사 품절이 확인되면 즉시 판매중지하고, 결품 취소가 발생하면 사유와 시각을 남깁니다.",
      "로그는 Cache API(콜로별 최선 노력, 7일) + 인메모리에 보관합니다. KV·D1이 없어 모든 콜로에 같은 로그가 보장되지는 않습니다.",
    ],
    actions: [{ id: "monitoring", label: "WING 게이트 점검" }],
    lastRun,
  };
}

function trimCandidate(item) {
  return {
    id: item.id,
    name: item.name,
    sourceName: item.sourceName,
    sku: item.sku,
    url: item.url,
    wholesalePrice: item.wholesalePrice,
    shippingFee: item.shippingFee,
    minOrder: item.minOrder,
    inStock: item.inStock,
    rank: item.rank,
    rankScope: item.rankScope,
    verdict: item.verdict,
    estimate: item.estimate,
    reasons: item.reasons,
    checks: (item.checks || []).map((check) => ({
      key: check.key,
      label: check.label,
      ok: check.ok,
      pending: Boolean(check.pending),
      note: check.note,
    })),
  };
}

/** `🤖 AI 운영팀` 탭이 읽는 4팀 상태 + 오늘 큐 요약. */
export async function buildAgentsStatus(env = {}, options = {}) {
  const origin = options.origin || DEFAULT_ORIGIN;
  const registeredToday = boundedCount(options.registeredToday, 0);
  const scan =
    options.scan ||
    (await scanTrending(env, { ...options, registeredToday }));
  const { trending, queue } = scan;
  const runs = await listRuns(origin, { limit: MAX_RUNS });
  const lastByTeam = {};
  for (const team of TEAM_IDS)
    lastByTeam[team] = runs.find((run) => run.team === team) || null;
  const teams = [
    discoveryTeam(trending, lastByTeam.discovery),
    auditTeam(queue, lastByTeam.audit),
    registrationTeam(queue, lastByTeam.registration),
    monitoringTeam(env, lastByTeam.monitoring),
  ];
  const notes = wingNotes(env);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scanAt: trending.generatedAt,
    teams,
    queue: {
      date: queue.date,
      evaluatedTotal: queue.evaluatedTotal ?? 0,
      readyCount: queue.readyCount,
      verdictCounts: queue.verdictCounts || { ready: 0, review: 0, block: 0 },
      blockedKeywords: queue.blockedKeywords || [],
      dailyQuota: queue.dailyQuota,
      hardCap: queue.hardCap,
      registeredToday: queue.registeredToday,
      remaining: queue.remaining,
      recommendedNow: queue.recommendedNow,
      candidates: (queue.candidates || []).map(trimCandidate),
    },
    schedules: SCHEDULES,
    keywordRules: KEYWORD_RULES,
    wing: {
      configured: wingConfigured(env),
      registeredIp: notes.registeredIp,
      directApiAllowed: false,
      reason:
        "Cloudflare Worker의 출구 IP는 요청마다 달라 쿠팡 Open API 허용 IP와 일치하지 않습니다. 등록·주문 조회는 허용 IP의 피클 브릿지에서 실행합니다.",
      bridge: {
        via: "pickle-bridge",
        registeredIp: notes.registeredIp,
        outboundCode: notes.outboundCode,
        returnCode: notes.returnCode,
        returnCharge: notes.returnCharge,
      },
    },
    monitoring: {
      checklist: MONITORING_CHECKLIST,
      lastProbe: lastByTeam.monitoring?.metrics?.probe || null,
    },
    runs: runs.slice(0, 8),
    storage: {
      durable: Boolean(cacheStore()),
      backend: cacheStore()
        ? "Cloudflare Cache API + 인메모리"
        : "인메모리(이 인스턴스)",
      retentionDays: RUN_TTL_SECONDS / 86400,
      maxRuns: MAX_RUNS,
      note: "KV·D1이 없는 배포라 실행 로그는 콜로별 최선 노력으로 보관됩니다. 모든 콜로에 같은 로그가 보장되지는 않습니다.",
    },
    notes: [
      "1~3팀은 /api/trending·/api/trending/queue와 같은 수집·검수 계산을 그대로 사용합니다.",
      "3팀은 후보와 한도만 계산하며 스스로 WING에 등록하지 않습니다. 실제 등록은 07:00·08:30 피클 정기 액션이 수행합니다.",
      "4팀은 Worker에서 쿠팡 Open API를 직접 호출하지 않습니다(IP 제한). 상태·체크리스트·실행 로그만 제공하고, 점검은 허용 IP 브릿지에서 합니다.",
    ],
  };
}

/* ── 수동 실행 ─────────────────────────────────────────────────────────── */

function runMetrics(trending, queue) {
  return {
    total: trending.total,
    sources: {
      domeggook: trending.sources?.domeggook?.ok || false,
      ownerclan: trending.sources?.ownerclan?.ok || false,
      onchannel: trending.sources?.onchannel?.ok || false,
    },
    verdictCounts: queue.verdictCounts,
    readyCount: queue.readyCount,
  };
}

/** 팀 하나를 즉시 실행하고 실행 로그를 남긴다. 등록·주문 같은 외부 변경은 하지 않는다. */
export async function runAgent(env = {}, team, options = {}) {
  const id = String(team || "").trim();
  if (!TEAM_IDS.includes(id))
    throw new SourcingError(
      "알 수 없는 에이전트 팀입니다. discovery, audit, registration, monitoring 중 하나를 지정해 주세요.",
      400,
    );
  const origin = options.origin || DEFAULT_ORIGIN;
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  let run;
  let scan = options.scan || null;

  if (id === "monitoring") {
    const probe = await probeWing(env, options.fetcher || fetch);
    const egress = /Your ip address ([0-9.]+)/i.exec(String(probe.message || ""));
    const checkedAt = new Date().toISOString();
    const probeRecord = {
      checkedAt,
      configured: probe.configured,
      reachable: probe.reachable,
      status: probe.status ?? null,
      message: String(probe.message || "").slice(0, 300),
      egressIp: egress ? egress[1] : null,
    };
    run = {
      team: id,
      action: "WING 게이트 점검 + 감시 체크리스트 생성",
      state: probe.reachable ? "ok" : "blocked",
      summary: probe.reachable
        ? "WING Open API가 정상 응답했습니다. 판매·품절·가격역전 점검을 실행할 수 있습니다."
        : `WING Open API가 이 서버에서 호출되지 않습니다(HTTP ${probe.status ?? "오류"}). ${probeRecord.message || ""}`.trim(),
      findings: MONITORING_CHECKLIST.map((item) => `${item.label}: ${item.detail}`),
      metrics: { probe: probeRecord },
    };
  } else {
    scan = scan || (await scanTrending(env, { ...options, fresh: true }));
    const { trending, queue } = scan;
    const counts = queue.verdictCounts || { ready: 0, review: 0, block: 0 };
    if (id === "discovery")
      run = {
        team: id,
        action: "도매몰 급등 스캔",
        state: trending.total > 0 ? "ok" : "empty",
        summary:
          `도매꾹·오너클랜·온채널에서 ${trending.total}건을 수집했습니다.` +
          ` (도매꾹 ${trending.sources?.domeggook?.ok ? "정상" : "실패"},` +
          ` 오너클랜 ${trending.sources?.ownerclan?.ok ? "정상" : "실패"},` +
          ` 온채널 ${trending.sources?.onchannel?.ok ? "정상" : "실패"})`,
        findings: [
          `수집 키워드: ${(trending.topics || []).join(", ") || "없음"}`,
          ...(trending.notes || []).slice(0, 3),
        ],
        metrics: runMetrics(trending, queue),
      };
    else if (id === "audit")
      run = {
        team: id,
        action: "안전 규칙 검수",
        state: "ok",
        summary: `검수 대상 ${queue.evaluatedTotal ?? 0}건: ready ${counts.ready} · review ${counts.review} · block ${counts.block}.`,
        findings: [
          ...(queue.blockedKeywords || []).map(
            (entry) => `차단 키워드 ‘${entry.word}’ ${entry.count}건`,
          ),
          ...(queue.rules || []),
        ],
        metrics: runMetrics(trending, queue),
      };
    else
      run = {
        team: id,
        action: "오늘 등록 큐 계산",
        state: queue.remaining > 0 ? "ok" : "paused",
        summary:
          `오늘 등록 ${queue.registeredToday}건 · 남은 한도 ${queue.remaining}건 · 지금 등록 가능 ${queue.recommendedNow}건 · ready ${queue.readyCount}건.` +
          " 이 실행은 후보만 계산하며 WING에 등록하지 않습니다.",
        findings: (queue.candidates || []).map(
          (item) => `${item.verdict}: ${item.name} (${item.sourceName})`,
        ),
        metrics: runMetrics(trending, queue),
      };
  }

  run.startedAt = startedAt;
  run.finishedAt = new Date().toISOString();
  run.ms = Date.now() - startedMs;
  const stored = await recordRun(env, { ...run, source: "api" }, { origin, ctx: options.ctx });
  const status = await buildAgentsStatus(env, { ...options, scan });
  return { ok: true, run: stored, status };
}
