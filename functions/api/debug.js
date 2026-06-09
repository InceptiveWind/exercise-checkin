// Cloudflare Pages Function: 调试端点
// 路径: /functions/api/debug.js
// 作用: 列出当前 function 能拿到的所有 env vars（值打码）
// 部署后访问: https://你的域名.pages.dev/api/debug

function maskValue(v) {
  if (typeof v !== 'string') return `<${typeof v}>`;
  if (v.length === 0) return '(empty)';
  if (v.length <= 6) return '***';
  return v.slice(0, 3) + '***' + v.slice(-3);
}

export async function onRequest(context) {
  const { env } = context;
  const keys = Object.keys(env).sort();
  return new Response(
    JSON.stringify({
      ok: true,
      envVarCount: keys.length,
      envVars: keys.map(k => ({ name: k, value: maskValue(env[k]) })),
    }, null, 2),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
