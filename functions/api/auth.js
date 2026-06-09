// Cloudflare Pages Function: 登录验证
// 路径: /functions/api/auth.js
//
// POST /api/auth  body: { "password": "xxx" }
// 成功: { "ok": true, "token": "xxx.xxx", "expiresAt": 1234567890 }
// 失败: 401 { "ok": false, "error": "密码错误" }
//
// 环境变量:
//   APP_PASSWORD  - 用户密码（明文，部署时设置）
//   APP_SECRET    - HMAC 签名密钥（用于签发和验证 token）

// ============== Token 工具 ==============
function base64urlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data),
  );
  return base64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret, data, signature) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(data),
  );
}

// 签发 token（载荷: { sub, exp }）
export async function signToken(secret, subject, ttlSeconds) {
  const payload = {
    sub: subject,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, payloadB64);
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: payload.exp,
  };
}

// 验证 token，返回 { ok, payload } 或 { ok: false, reason }
export async function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'malformed' };
  }
  const [payloadB64, sig] = parts;
  try {
    const valid = await hmacVerify(secret, payloadB64, sig);
    if (!valid) return { ok: false, reason: 'bad-signature' };
    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }
}

// ============== CORS ==============
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

// ============== Handler ==============
export async function onRequest(context) {
  const { request, env } = context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  // 配置检查
  if (!env.APP_PASSWORD || !env.APP_SECRET) {
    return jsonResponse({
      ok: false,
      error: '服务器未配置密码或密钥',
    }, 500);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  // 读取 body
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: '无效的请求体' }, 400);
  }

  const password = String(body.password || '');

  // 简单长度校验（避免长字符串攻击）
  if (password.length === 0 || password.length > 100) {
    return jsonResponse({ ok: false, error: '密码错误' }, 401);
  }

  // 密码对比（用时间恒定比较，防时序攻击）
  let match = true;
  if (password.length !== env.APP_PASSWORD.length) {
    match = false;
  } else {
    for (let i = 0; i < password.length; i++) {
      if (password[i] !== env.APP_PASSWORD[i]) match = false;
    }
  }

  if (!match) {
    return jsonResponse({ ok: false, error: '密码错误' }, 401);
  }

  // 签发 30 天有效的 token
  const { token, expiresAt } = await signToken(env.APP_SECRET, 'user', 30 * 86400);

  return jsonResponse({
    ok: true,
    token,
    expiresAt,
  });
}
