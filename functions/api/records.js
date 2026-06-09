// Cloudflare Pages Functions 格式
// 路径: /functions/api/records.js
// 自动映射到 URL: /api/records
//
// 认证：
//   所有请求需要 Authorization: Bearer <token>
//   - 用户 token（从 /api/auth 获取，30 天有效）：可读可写
//   - STATS_TOKEN（环境变量配置，永不过期）：只读（用于 GitHub Actions 拉战绩）
//
// 环境变量:
//   UPSTASH_REDIS_REST_URL    - Upstash 控制台里复制
//   UPSTASH_REDIS_REST_TOKEN  - Upstash 控制台里复制
//   APP_SECRET                - HMAC 签名密钥（必须和 auth.js 用同一个）
//   STATS_TOKEN               - GitHub Actions 用的只读 token

import { verifyToken } from './auth.js';

const KEY = 'exercise:records';

// ============== 工具函数 ==============
function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeStr() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function unauthorized(reason) {
  return jsonResponse({ ok: false, error: '未授权', reason }, 401);
}

// ============== 认证 ==============
async function authenticate(request, env, requireWrite) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'missing' };

  const token = match[1].trim();

  // 写操作只接受用户 token
  // 读操作接受用户 token 或 STATS_TOKEN
  if (requireWrite) {
    if (!env.APP_SECRET) return { ok: false, reason: 'no-secret' };
    return await verifyToken(env.APP_SECRET, token);
  }

  // 读：先看是不是 STATS_TOKEN（明文比较，时间恒定）
  if (env.STATS_TOKEN && token.length === env.STATS_TOKEN.length) {
    let match2 = true;
    for (let i = 0; i < token.length; i++) {
      if (token[i] !== env.STATS_TOKEN[i]) match2 = false;
    }
    if (match2) return { ok: true, payload: { sub: 'stats', readOnly: true } };
  }

  // 不是 stats token，再验用户 token
  if (env.APP_SECRET) {
    return await verifyToken(env.APP_SECRET, token);
  }

  return { ok: false, reason: 'no-secret' };
}

// ============== Upstash REST ==============
async function redis(env, command, ...args) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Upstash 环境变量未配置');
  }
  const path = [command, ...args].map(a => encodeURIComponent(a)).join('/');
  const resp = await fetch(`${url}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upstash ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ============== 业务逻辑 ==============
async function getAllRecords(env) {
  const result = await redis(env, 'hgetall', KEY);
  const records = [];
  const arr = result.result || [];
  for (let i = 0; i < arr.length; i += 2) {
    const date = arr[i];
    try {
      const obj = JSON.parse(arr[i + 1]);
      records.push({ date, time: obj.time, note: obj.note || '' });
    } catch (e) {
      console.error('parse error', e);
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}

async function addRecord(env, note) {
  const date = todayStr();
  const time = timeStr();

  // 防重复：同一天只能打一次
  const existing = await redis(env, 'hget', KEY, date);
  if (existing && existing.result) {
    return { alreadyPunched: true };
  }

  const value = JSON.stringify({
    time,
    note: String(note || '').slice(0, 200),
  });
  await redis(env, 'hset', KEY, date, value);
  return { record: { date, time, note: note || '' } };
}

// ============== Handler ==============
export async function onRequest(context) {
  const { request, env } = context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  // 健康检查（无需认证）
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.has('health')) {
    return jsonResponse({ ok: true, time: new Date().toISOString() });
  }

  // 认证：读接受用户 token / stats token；写只接受用户 token
  const requireWrite = request.method === 'POST';
  const auth = await authenticate(request, env, requireWrite);
  if (!auth.ok) {
    return unauthorized(auth.reason);
  }

  // 环境变量检查
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return jsonResponse({
      ok: false,
      error: '服务器未配置 Upstash 环境变量',
    }, 500);
  }

  try {
    if (request.method === 'GET') {
      const records = await getAllRecords(env);
      return jsonResponse({ ok: true, records });
    }

    if (request.method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        // 忽略 JSON 解析错误
      }
      const note = body.note || '';
      const result = await addRecord(env, note);

      if (result.alreadyPunched) {
        return jsonResponse({
          ok: false,
          alreadyPunched: true,
          error: '今天已经打过卡了',
        });
      }
      return jsonResponse({ ok: true, record: result.record });
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('Handler error:', e);
    return jsonResponse({ ok: false, error: e.message }, 500);
  }
}
