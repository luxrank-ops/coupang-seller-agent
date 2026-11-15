import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import worker from "../../src/index.js";
import { buildAgentsStatus, runAgent, recordRun, listRuns } from "../../src/agents.js";
import { buildRegistrationQueue } from "../../src/trending.js";

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, "../fixtures", name), "utf8");
const ownerclanHtml = fixture("ownerclan-home.html");
const onchannelHtml = fixture("onchannel-index.html");

const request = (path, init, env) =>
  worker.fetch(new Request("https://app.example" + path, init), env || {});
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function stubFetch({ wingStatus = null } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    if (target.startsWith("https://www.ownerclan.com/"))
      return new Response(ownerclanHtml, { status: 200 });
    if (target.startsWith("https://www.onch3.co.kr/"))
      return new Response(onchannelHtml, { status: 200 });
    if (target.startsWith("https://www.domeggook.com/")) {
      const parsed = new URL(target);
      return new Response(
        JSON.stringify({
          domeggook: {
            header: { numberOfItems: 500, currentPage: 1, itemsPerPage: "2", numberOfPages: 250, sort: "ha" },
            list: {
              item: [
                {
                  no: "9638478",
                  title: (parsed.searchParams.get("kw") || "인기") + " 수납 파우치 세트",
                  price: "15000",
                  unitQty: "1",
                  thumb: "//cdn1.domeggook.com/a_330",
                  deli: { who: "P", fee: "3000", add: "false", fromOversea: "false" },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (target.startsWith("https://api-gateway.coupang.com")) {
      if (wingStatus === null) return new Response("unexpected", { status: 500 });
      return new Response(
        JSON.stringify({
          code: "ERROR",
          message:
            "Your ip address 104.23.160.35 is not allowed for this request. If you need service access, please contact the Coupang seller call center.",
        }),
        { status: wingStatus },
      );
    }
    return new Response("not found", { status: 404 });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const wingEnv = {
  DOMEGGOOK_API_KEY: "test",
  WING_ACCESS_KEY: "access",
  WING_SECRET_KEY: "secret",
  WING_VENDOR_ID: "A01818224",
  WING_REGISTERED_IP: "54.186.5.104",
};

test("GET /api/agents/status describes the four teams and today's safe queue", async () => {
  const stub = stubFetch();
  try {
    const response = await request("/api/agents/status?registeredToday=1", undefined, {
      DOMEGGOOK_API_KEY: "test",
      WING_REGISTERED_IP: "54.186.5.104",
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.deepEqual(
      data.teams.map((team) => team.id),
      ["discovery", "audit", "registration", "monitoring"],
    );
    for (const team of data.teams) {
      assert.ok(team.name && team.role && team.headline);
      assert.ok(Array.isArray(team.metrics) && team.metrics.length >= 4);
      assert.ok(Array.isArray(team.rules) && team.rules.length >= 3);
    }
    assert.equal(data.queue.dailyQuota, 3);
    assert.equal(data.queue.hardCap, 5);
    assert.equal(data.queue.registeredToday, 1);
    assert.equal(data.queue.remaining, 2);
    assert.ok(data.queue.readyCount >= 1);
    assert.ok(data.queue.verdictCounts.ready >= 1);
    assert.equal(
      data.queue.evaluatedTotal,
      data.queue.verdictCounts.ready +
        data.queue.verdictCounts.review +
        data.queue.verdictCounts.block,
    );
    assert.ok(data.queue.candidates.length <= 3);
    assert.equal(data.keywordRules.block, 58);
    assert.equal(data.keywordRules.brand, 36);
    assert.equal(data.keywordRules.banned, 22);
    assert.equal(data.keywordRules.kc, 31);
    assert.equal(data.wing.directApiAllowed, false);
    assert.equal(data.wing.registeredIp, "54.186.5.104");
    assert.equal(data.storage.durable, false);
    assert.equal(data.monitoring.checklist.length, 5);
    assert.equal(data.schedules[0].at, "07:00");
    assert.equal(data.schedules[1].at, "08:30");
    assert.equal(data.teams[0].metrics.find((m) => m.label === "수집 상품").value.endsWith("건"), true);
    assert.match(
      data.teams[1].rules.join(" "),
      /지재권·브랜드·캐릭터 키워드\(36종\)/,
    );
    assert.match(data.teams[1].rules.join(" "), /최저가 -100원/);
    assert.match(data.teams[2].rules.join(" "), /5건을 넘기지/);
    assert.match(data.teams[3].headline, /403|허용 IP/);
  } finally {
    stub.restore();
  }
});

test("status reports the scan time and honours registeredToday", async () => {
  const stub = stubFetch();
  try {
    const data = await buildAgentsStatus(
      { DOMEGGOOK_API_KEY: "test" },
      { origin: "https://app.example", registeredToday: "3", fetcher: globalThis.fetch },
    );
    assert.ok(data.scanAt);
    assert.equal(data.queue.registeredToday, 3);
    assert.equal(data.queue.remaining, 0);
    assert.equal(data.queue.recommendedNow, 0);
    assert.equal(data.teams[2].state, "paused");
  } finally {
    stub.restore();
  }
});

test("POST /api/agents/run executes the discovery team and records a run log", async () => {
  const stub = stubFetch();
  try {
    const response = await request(
      "/api/agents/run",
      post({ team: "discovery" }),
      { DOMEGGOOK_API_KEY: "test" },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.run.team, "discovery");
    assert.equal(data.run.source, "api");
    assert.equal(data.run.action, "도매몰 급등 스캔");
    assert.ok(data.run.metrics.total > 0);
    assert.ok(data.run.ms >= 0);
    assert.ok(data.run.id.startsWith("run_"));
    assert.equal(data.status.ok, true);
    assert.equal(data.status.teams[0].lastRun.id, data.run.id);

    const logs = await request("/api/agents/runs?team=discovery", undefined, {
      DOMEGGOOK_API_KEY: "test",
    });
    assert.equal(logs.status, 200);
    const body = await logs.json();
    assert.ok(body.runs.some((run) => run.id === data.run.id));
  } finally {
    stub.restore();
  }
});

test("POST /api/agents/run audit reports ready/review/block counts", async () => {
  const stub = stubFetch();
  try {
    const result = await runAgent(
      { DOMEGGOOK_API_KEY: "test" },
      "audit",
      { origin: "https://app.example", fetcher: globalThis.fetch },
    );
    assert.equal(result.run.team, "audit");
    assert.match(result.run.summary, /ready \d+ · review \d+ · block \d+/);
    assert.ok(result.run.metrics.readyCount >= 1);
    assert.ok(result.status.queue.verdictCounts.ready >= 1);
  } finally {
    stub.restore();
  }
});

test("registration run never calls the Coupang gateway", async () => {
  const stub = stubFetch();
  try {
    const result = await runAgent(
      wingEnv,
      "registration",
      { origin: "https://app.example", registeredToday: "2", fetcher: globalThis.fetch },
    );
    assert.match(result.run.summary, /이 실행은 후보만 계산하며 WING에 등록하지 않습니다/);
    assert.equal(result.run.metrics.verdictCounts !== null, true);
    assert.equal(
      stub.calls.some((url) => url.includes("api-gateway.coupang.com")),
      false,
    );
  } finally {
    stub.restore();
  }
});

test("monitoring run records the real WING 403 and the rejected egress IP", async () => {
  const stub = stubFetch({ wingStatus: 403 });
  try {
    const result = await runAgent(wingEnv, "monitoring", {
      origin: "https://app.example",
      fetcher: globalThis.fetch,
    });
    assert.equal(result.run.state, "blocked");
    assert.equal(result.run.metrics.probe.status, 403);
    assert.equal(result.run.metrics.probe.egressIp, "104.23.160.35");
    assert.equal(result.run.metrics.probe.reachable, false);
    assert.equal(result.run.findings.length, 5);
    assert.equal(result.status.monitoring.lastProbe.egressIp, "104.23.160.35");
    assert.match(result.status.teams[3].headline, /104\.23\.160\.35/);
  } finally {
    stub.restore();
  }
});

test("monitoring run without WING keys stays unverified instead of inventing a probe", async () => {
  const stub = stubFetch();
  try {
    const result = await runAgent({}, "monitoring", {
      origin: "https://app.example",
      fetcher: globalThis.fetch,
    });
    assert.equal(result.run.metrics.probe.configured, false);
    assert.equal(result.run.metrics.probe.reachable, false);
    assert.equal(result.run.metrics.probe.egressIp, null);
    assert.equal(
      stub.calls.some((url) => url.includes("api-gateway.coupang.com")),
      false,
    );
  } finally {
    stub.restore();
  }
});

test("agent run rejects unknown teams and unsupported methods", async () => {
  const unknown = await request("/api/agents/run", post({ team: "pricing" }));
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /알 수 없는 에이전트 팀/);

  const noJson = await request("/api/agents/run", { method: "POST", body: "{}" });
  assert.equal(noJson.status, 415);

  const wrong = await request("/api/agents/run", undefined);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("allow"), "POST");

  const statusPost = await request("/api/agents/status", post({}));
  assert.equal(statusPost.status, 405);
  assert.equal(statusPost.headers.get("allow"), "GET");
});

test("POST /api/agents/runs records an external bridge check log", async () => {
  const response = await request(
    "/api/agents/runs",
    post({
      team: "monitoring",
      action: "피클 브릿지 판매·품절 점검",
      state: "ok",
      summary: "판매중 14건 중 품절 0건, 가격역전 0건.",
      findings: ["판매중 14건 확인", "가격역전 없음"],
    }),
  );
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.run.team, "monitoring");
  assert.equal(data.run.source, "external");

  const logs = await request("/api/agents/runs?limit=5");
  const body = await logs.json();
  assert.ok(body.runs.some((run) => run.id === data.run.id));

  const invalid = await request(
    "/api/agents/runs",
    post({ team: "monitoring", action: "" }),
  );
  assert.equal(invalid.status, 400);
  const badTeam = await request("/api/agents/runs", post({ team: "cs", action: "점검" }));
  assert.equal(badTeam.status, 400);
});

test("run logs keep newest first and are capped", async () => {
  const origin = "https://logs.example";
  for (let index = 0; index < 5; index++)
    await recordRun(
      {},
      {
        team: "audit",
        action: "테스트 " + index,
        summary: "s" + index,
        finishedAt: new Date(Date.now() + index * 1000).toISOString(),
      },
      { origin },
    );
  const runs = await listRuns(origin, { limit: 3 });
  assert.equal(runs.length, 3);
  assert.equal(runs[0].action, "테스트 4");
  assert.equal(runs[2].action, "테스트 2");
});

test("IP and banned keywords are counted apart from review keywords", () => {
  const products = [
    {
      id: "a",
      name: "나이키 에어맥스 운동화",
      sourceId: "domeggook",
      sourceName: "도매꾹",
      wholesalePrice: 50000,
      shippingFee: 3000,
      minOrder: 1,
      inStock: true,
      rank: 1,
    },
    {
      id: "b",
      name: "전기 온열 찜질기",
      sourceId: "domeggook",
      sourceName: "도매꾹",
      wholesalePrice: 30000,
      shippingFee: 3000,
      minOrder: 1,
      inStock: true,
      rank: 2,
    },
    {
      id: "c",
      name: "주방 수납 트레이",
      sourceId: "domeggook",
      sourceName: "도매꾹",
      wholesalePrice: 12000,
      shippingFee: 3000,
      minOrder: 1,
      inStock: true,
      rank: 3,
    },
  ];
  const queue = buildRegistrationQueue(products, { limit: "3" });
  assert.equal(queue.verdictCounts.block, 1);
  assert.equal(queue.verdictCounts.review, 1);
  assert.equal(queue.verdictCounts.ready, 1);
  assert.deepEqual(queue.blockedKeywords, [{ word: "나이키", count: 1 }]);
  const blocked = queue.candidates.find((item) => item.verdict === "block");
  assert.deepEqual(blocked.blockWords, ["나이키"]);
});
