# -*- coding: utf-8 -*-
"""
运动打卡提醒 - GitHub Actions 版
================================
由 .github/workflows/daily-reminder.yml 调用

环境变量:
  WX_APPTOKEN    - WxPusher 应用的 appToken
  WX_UID         - 你的 WxPusher UID（在公众号「WxPusher 微信推送」里绑定后获取）
  CHECKIN_URL    - 打卡页完整 URL（不要带末尾斜杠）
  STATS_TOKEN    - 打卡页后端的只读 token
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta


def fetch_records(base_url, stats_token):
    """从打卡页后端拉取所有记录（用 stats token 认证）"""
    req = urllib.request.Request(
        f"{base_url}/api/records",
        headers={"Authorization": f"Bearer {stats_token}"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def calc_streak(records):
    """计算连续天数和累计天数，以及今日是否已打卡"""
    if not records:
        return {"streak": 0, "total": 0, "today_punched": False}

    total = len(records)
    today = datetime.now().strftime("%Y-%m-%d")
    today_punched = any(r["date"] == today for r in records)

    dates = sorted({r["date"] for r in records}, reverse=True)
    streak = 0
    expected = datetime.now().date()
    if dates and dates[0] != expected.strftime("%Y-%m-%d"):
        expected = expected - timedelta(days=1)
    for d in dates:
        if d == expected.strftime("%Y-%m-%d"):
            streak += 1
            expected = expected - timedelta(days=1)
        else:
            break
    return {"streak": streak, "total": total, "today_punched": today_punched}


def build_message(checkin_url, stats):
    """构造推送文案（Markdown 格式，WxPusher 用 contentType=2 渲染为 HTML）"""
    s, t = stats["streak"], stats["total"]
    if t == 0:
        stats_line = "📊 还没有打卡记录，从今天开始！"
    else:
        stats_line = f"📊 战绩：🔥 连续 <b>{s}</b> 天 ｜ 📅 累计 <b>{t}</b> 天"
        if stats["today_punched"]:
            stats_line += "<br/>> ✅ 今天已打卡，明日继续～"

    now = datetime.now()
    # WxPusher 的 contentType=2 期望 HTML 格式，把 Markdown 标签转成 HTML
    return f"""<h1>🏃 运动时间到啦！</h1>
<blockquote>现在是 <b>{now:%H:%M}</b>，坚持运动，做更好的自己 💪</blockquote>
<p>{stats_line}</p>
<hr/>
<h3>👉 <a href="{checkin_url}">点我打卡</a></h3>
<p>打开页面 → 点 "✅ 今日打卡" 即可（可加备注）</p>
"""


def send_wxpusher(app_token, uid, summary, content):
    """通过 WxPusher 发送微信消息

    contentType:
      1 = 纯文本
      2 = HTML（推荐，支持链接/加粗/换行）
      3 = Markdown
    """
    payload = json.dumps({
        "appToken": app_token,
        "content": content,
        "summary": summary[:20],  # 微信通知预览，最多 20 字
        "contentType": 2,
        "uids": [uid],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://wxpusher.zjiecode.com/api/send/message",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    app_token = os.environ.get("WX_APPTOKEN", "").strip()
    uid = os.environ.get("WX_UID", "").strip()
    checkin_url = os.environ.get("CHECKIN_URL", "").strip().rstrip("/")
    stats_token = os.environ.get("STATS_TOKEN", "").strip()

    if not app_token or not uid:
        print("❌ 缺少环境变量 WX_APPTOKEN 或 WX_UID")
        sys.exit(1)
    if not checkin_url:
        print("❌ 缺少环境变量 CHECKIN_URL")
        sys.exit(1)
    if not stats_token:
        print("❌ 缺少环境变量 STATS_TOKEN")
        sys.exit(1)

    # 拉取战绩
    try:
        data = fetch_records(checkin_url, stats_token)
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "unknown"))
        stats = calc_streak(data.get("records", []))
    except Exception as e:
        print(f"⚠️ 拉取战绩失败: {e}")
        stats = {"streak": 0, "total": 0, "today_punched": False}

    # 发送
    msg = build_message(checkin_url, stats)
    try:
        result = send_wxpusher(app_token, uid, "🏃 运动打卡提醒", msg)
        if result.get("code") == 1000:
            # data 是个数组，每个元素的 status 字段说明这一条推送的状态
            data_list = result.get("data") or []
            ok_count = sum(1 for d in data_list if d.get("code") == 1000)
            print(f"✅ WxPusher 推送成功（{ok_count}/{len(data_list)} 个用户送达）")
        else:
            print(f"❌ 发送失败: code={result.get('code')}, message={result.get('msg')}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ 推送异常: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
