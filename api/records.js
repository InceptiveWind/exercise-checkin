// Vercel Serverless Function: 打卡记录读写
// 存储后端: Upstash Redis (REST API)
//
// 环境变量（在 Vercel 项目里设置）:
//   UPSTASH_REDIS_REST_URL    - Upstash 控制台里复制
//   UPSTASH_REDIS_REST_TOKEN  - Upstash 控制台里复制

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'exercise:records';

// ---- 工具函数 ----
function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeStr() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ---- Upstash REST ----
async function redis(command, ...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error('Upstash 环境变量未配置');
  }
  const path = [command, ...args].map(a => encodeURIComponent(a)).join('/');
  const url = `${UPSTASH_URL}/${path}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upstash ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ---- 业务处理 ----
async function getAllRecords() {
  const result = await redis('hgetall', KEY);
  // Upstash REST HGETALL 返回 { result: ["k1","v1","k2","v2",...] }
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

async function addRecord(note) {
  const date = todayStr();
  const time = timeStr();

  // 防重复：同一天只能打一次
  const existing = await redis('hget', KEY, date);
  if (existing && existing.result) {
    return { alreadyPunched: true };
  }

  const value = JSON.stringify({
    time,
    note: String(note || '').slice(0, 200),
  });
  await redis('hset', KEY, date, value);
  return { record: { date, time, note: note || '' } };
}

// ---- Handler ----
export default async function handler(req, res) {
  // CORS（理论上同源不需要，但加上更稳）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 健康检查
  if (req.method === 'GET' && req.query.health) {
    return res.status(200).json({ ok: true, time: new Date().toISOString() });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: '服务器未配置 Upstash 环境变量，请联系管理员',
    });
  }

  try {
    if (req.method === 'GET') {
      const records = await getAllRecords();
      return res.status(200).json({ ok: true, records });
    }

    if (req.method === 'POST') {
      const { note = '' } = req.body || {};
      const result = await addRecord(note);
      if (result.alreadyPunched) {
        return res.status(200).json({
          ok: false,
          alreadyPunched: true,
          error: '今天已经打过卡了',
        });
      }
      return res.status(200).json({ ok: true, record: result.record });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
