// Cloudflare Pages Functions 格式
// 路径: /functions/api/records.js
// 自动映射到 URL: /api/records
//
// 数据模型（一天一条记录）:
//   {
//     "2026-06-09": {
//       "types": ["力量", "有氧"],
//       "note": "上午力量训练，下午跑步 30 分钟",
//       "time": "20:15:30"
//     }
//   }
//
// 认证：
//   所有请求需要 Authorization: Bearer <token>
//   - 用户 token（从 /api/auth 获取，30 天有效）：可读可写可删
//   - STATS_TOKEN（环境变量配置，永不过期）：只读
//
// 环境变量:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   APP_SECRET（同 auth.js）
//   STATS_TOKEN

import { verifyToken } from './auth.js';

const KEY = 'exercise:records';

const ALLOWED_TYPES = ['力量', '有氧', '阻抗', '日常'];

// ============== 工具 ==============
function pad2(n) { return String(n).padStart(2, '0'); }

// 服务器当前 UTC 时间对应的"今天"
function serverTodayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// 按用户时区计算"今天"（tzOffsetMinutes: 北京=480, 纽约=-300, UTC=0）
// 前端传 tzOffset: -new Date().getTimezoneOffset()
function userTodayStr(tzOffsetMinutes) {
  const offset = Number(tzOffsetMinutes) || 0;
  const localMs = Date.now() + offset * 60 * 1000;
  const d = new Date(localMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function timeStr() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function isToday(date) { return date === serverTodayStr(); }
function isFutureInUserTz(date, tzOffsetMinutes) {
  return date > userTodayStr(tzOffsetMinutes);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// 把存储的旧/新格式统一转成新格式
function normalizeRecord(raw) {
  if (!raw) return null;
  // 旧格式: { time, note } (没有 types)
  if (raw.types === undefined && raw.note !== undefined) {
    return {
      types: ['日常'],
      note: String(raw.note || ''),
      time: String(raw.time || '00:00:00'),
    };
  }
  // 新格式
  if (Array.isArray(raw.types)) {
    return {
      types: raw.types.filter(t => ALLOWED_TYPES.includes(t)),
      note: String(raw.note || ''),
      time: String(raw.time || '00:00:00'),
    };
  }
  return null;
}

function validateTypes(types) {
  if (!Array.isArray(types)) return null;
  const valid = types.filter(t => ALLOWED_TYPES.includes(t));
  if (valid.length === 0) return null;
  return [...new Set(valid)];
}

// ============== 认证 ==============
async function authenticate(request, env, requireWrite) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'missing' };

  const token = match[1].trim();

  // 写/删：只接受用户 token
  if (requireWrite) {
    if (!env.APP_SECRET) return { ok: false, reason: 'no-secret' };
    return await verifyToken(env.APP_SECRET, token);
  }

  // 读：先试 STATS_TOKEN
  if (env.STATS_TOKEN && token.length === env.STATS_TOKEN.length) {
    let match2 = true;
    for (let i = 0; i < token.length; i++) {
      if (token[i] !== env.STATS_TOKEN[i]) match2 = false;
    }
    if (match2) return { ok: true, payload: { sub: 'stats', readOnly: true } };
  }

  // 再试用户 token
  if (env.APP_SECRET) {
    return await verifyToken(env.APP_SECRET, token);
  }
  return { ok: false, reason: 'no-secret' };
}

// ============== Upstash REST ==============
async function redis(env, command, ...args) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash 环境变量未配置');
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

// ============== 业务 ==============
async function getAllRecords(env) {
  const result = await redis(env, 'hgetall', KEY);
  const records = [];
  const arr = result.result || [];
  for (let i = 0; i < arr.length; i += 2) {
    const date = arr[i];
    try {
      const norm = normalizeRecord(JSON.parse(arr[i + 1]));
      if (norm) records.push({ date, ...norm });
    } catch (e) {
      console.error('parse error', e);
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}

async function saveRecord(env, date, types, note, clientTime) {
  // 优先用前端传来的时间（已按用户时区算好）
  // 兼容旧调用：按服务器 UTC 时间补一个
  let time;
  if (clientTime && /^\d{2}:\d{2}:\d{2}$/.test(clientTime)) {
    time = clientTime;
  } else {
    time = isToday(date) ? timeStr() : '12:00:00';
  }
  const value = JSON.stringify({ types, note, time });
  await redis(env, 'hset', KEY, date, value);
  return { date, types, note, time };
}

async function deleteRecord(env, date) {
  // 先确认存在（避免无意义的 hdel）
  const existing = await redis(env, 'hexists', KEY, date);
  if (existing.result === 0) {
    return { ok: false, reason: 'not-found' };
  }
  await redis(env, 'hdel', KEY, date);
  return { ok: true, date };
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

  // 认证
  const isWrite = request.method === 'POST' || request.method === 'DELETE';
  const auth = await authenticate(request, env, isWrite);
  if (!auth.ok) {
    return unauthorized(auth.reason);
  }

  // 环境变量检查
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return jsonResponse({ ok: false, error: '服务器未配置 Upstash 环境变量' }, 500);
  }

  try {
    // === GET: 读所有记录 ===
    if (request.method === 'GET') {
      const records = await getAllRecords(env);
      return jsonResponse({ ok: true, records, allowedTypes: ALLOWED_TYPES });
    }

    // === POST: 创建/覆盖 ===
    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}

      const date = String(body.date || serverTodayStr());
      // 简单日期校验
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return jsonResponse({ ok: false, error: '日期格式错误，应为 YYYY-MM-DD' }, 400);
      }
      // 用用户时区判断"今天"，避免跨时区误判未来日期
      const tzOffset = Number(body.tzOffset) || 0;
      if (isFutureInUserTz(date, tzOffset)) {
        const userToday = userTodayStr(tzOffset);
        return jsonResponse({
          ok: false,
          error: `不能打卡未来日期（你所在时区的今天是 ${userToday}）`,
        }, 400);
      }

      const types = validateTypes(body.types);
      if (!types) {
        return jsonResponse({
          ok: false,
          error: `请至少选择一个运动类型（${ALLOWED_TYPES.join('/')}）`,
        }, 400);
      }

      const note = String(body.note || '').slice(0, 200);
      const record = await saveRecord(env, date, types, note, body.time);
      return jsonResponse({ ok: true, record });
    }

    // === DELETE: 删某天 ===
    if (request.method === 'DELETE') {
      const date = url.searchParams.get('date') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return jsonResponse({ ok: false, error: '日期格式错误' }, 400);
      }
      const result = await deleteRecord(env, date);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: '该日期没有打卡记录' }, 404);
      }
      return jsonResponse({ ok: true, date });
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('Handler error:', e);
    return jsonResponse({ ok: false, error: e.message }, 500);
  }
}
