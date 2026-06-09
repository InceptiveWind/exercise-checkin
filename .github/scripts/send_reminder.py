# -*- coding: utf-8 -*-
"""
运动打卡提醒 - GitHub Actions 版
================================
由 .github/workflows/daily-reminder.yml 调用

环境变量:
  SENDKEY       - Server酱 SendKey
  CHECKIN_URL   - 打卡页完整 URL（不要带末尾斜杠）
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta


def fetch_records(base_url):
    """从打卡页后端拉取所有记录"""
    with urllib.request.urlopen(f"{base_url}/api/records", timeout=8) as r:
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
    """构造推送文案"""
    s, t = stats["streak"], stats["total"]
    if t == 0:
        stats_line = "📊 还没有打卡记录，从今天开始！"
    else:
        stats_line = f"📊 战绩：🔥 连续 **{s}** 天 ｜ 📅 累计 **{t}** 天"
        if stats["today_punched"]:
            stats_line += "\n> ✅ 今天已打卡，明日继续～"

    now = datetime.now()
    return f"""# 🏃 运动时间到啦！

> 现在是 **{now:%H:%M}**，坚持运动，做更好的自己 💪

{stats_line}

---

### 👉 [点我打卡]({checkin_url})

打开页面 → 点 "✅ 今日打卡" 即可（可加备注）
"""


def send_wechat(sendkey, title, content):
    """通过 Server酱 发送微信消息"""
    payload = urllib.parse.urlencode({"title": title, "desp": content}).encode("utf-8")
    req = urllib.request.Request(
        f"https://sctapi.ftqq.com/{sendkey}.send",
        data=payload,
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    sendkey = os.environ.get("SENDKEY", "").strip()
    checkin_url = os.environ.get("CHECKIN_URL", "").strip().rstrip("/")

    if not sendkey or not checkin_url:
        print("❌ 缺少环境变量 SENDKEY 或 CHECKIN_URL")
        sys.exit(1)

    # 拉取战绩
    try:
        data = fetch_records(checkin_url)
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "unknown"))
        stats = calc_streak(data.get("records", []))
    except Exception as e:
        print(f"⚠️ 拉取战绩失败: {e}")
        stats = {"streak": 0, "total": 0, "today_punched": False}

    # 发送
    msg = build_message(checkin_url, stats)
    try:
        result = send_wechat(sendkey, "🏃 运动打卡提醒", msg)
        # Server酱 成功响应是 code=0（HTTP 状态是 200，但 body 里的 code 才是关键）
        code = result.get("code")
        if code in (0, 200):
            print(f"✅ 微信提醒已发送（Server酱 code={code}）")
        else:
            print(f"❌ 发送失败: code={code}, message={result.get('message')}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ 推送异常: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
