/**
 * Coupang Seller AI Agent - Cloudflare Worker Entrypoint
 */

import { renderDashboardHtml } from './ui.js';
import { calculateCoupangPrice } from './margin.js';
import { generateProductSeo } from './prompt.js';

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
