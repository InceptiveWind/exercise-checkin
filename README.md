# 刘峰的运动打卡

每天 20:00 自动微信提醒打卡，手机 H5 页面上点击打卡，数据存云端。
**全免费、零服务器、不依赖电脑常开。**

---

## 🏗 架构图

```
┌──────────────────┐   cron (北京 20:00)   ┌──────────────────┐
│  GitHub Actions  │ ────────────────────▶ │  Server酱 推送    │
│  (云端 cron)      │                       │  微信             │
└────────┬─────────┘                       └──────────────────┘
         │ 带 STATS_TOKEN (只读)
         │ 拉战绩
         ▼
┌──────────────────┐                       ┌──────────────────┐
│  Cloudflare Pages │ ◀──── 用户点链接 ─────│  你的手机微信     │
│  - 静态 H5 页面   │                       └──────────────────┘
│  - Functions API  │
│  - 密码登录       │
└────────┬─────────┘
         │ 读写
         ▼
┌──────────────────┐
│  Upstash Redis   │
│  (云端数据库)    │
└──────────────────┘
```

---

## 📦 用到的服务

| 服务 | 用途 | 免费额度 | 注册地址 |
|------|------|----------|----------|
| **GitHub** | 存代码 + 跑定时任务 | 2000 min/月 | https://github.com |
| **Cloudflare Pages** | 部署前端 + API | 无限 | https://dash.cloudflare.com |
| **Upstash Redis** | 云端数据库 | 10k 请求/天 | https://console.upstash.com |
| **Server酱** | 微信推送 | 5 次/天 | https://sct.ftqq.com |

---

## 📁 项目结构

```
exercise-checkin/
├── index.html                       # 移动端 H5 打卡页面
├── functions/api/
│   ├── auth.js                      # 密码登录，签发 HMAC token
│   ├── records.js                   # 打卡记录 CRUD（GET/POST/DELETE）
│   └── debug.js                     # 调试用，列出当前函数能拿到的 env vars
├── .github/
│   ├── workflows/daily-reminder.yml # GitHub Actions 定时任务
│   └── scripts/send_reminder.py     # 推送逻辑
├── vercel.json                      # 早期 Vercel 配置（已弃用，留作历史）
└── README.md                        # 本文件
```

---

## 🔐 Cloudflare Pages 环境变量

去 Cloudflare Dashboard → Pages → 项目 → Settings → Environment variables。

**生产环境（Production）必加：**

| 变量 | 作用 | 示例 |
|------|------|------|
| `APP_PASSWORD` | 用户登录密码（明文）| `lf850913` |
| `APP_SECRET` | HMAC token 签名密钥（64 字符随机）| 用 `python -c "import secrets; print(secrets.token_hex(32))"` 生成 |
| `STATS_TOKEN` | GitHub Actions 用的只读 token（64 字符随机）| 同上方法生成 |
| `UPSTASH_REDIS_REST_URL` | Upstash REST API 地址 | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST API 密钥 | Upstash 控制台复制 |

⚠️ 范围要勾 **Production**（或选 All environments）。
⚠️ 改完 env vars **必须 Retry deployment** 才生效。

---

## 🔐 GitHub Secrets

去 GitHub 仓库 → Settings → Secrets and variables → Actions。

| 名称 | 值 |
|------|-----|
| `SENDKEY` | Server酱 提供的 SendKey |
| `CHECKIN_URL` | Cloudflare Pages 给的域名，如 `https://xxx.pages.dev` |
| `STATS_TOKEN` | **必须和 Cloudflare Pages 里那个完全一样** |

---

## 🗄 数据模型

Upstash Redis 里用 Hash 存：

```
Key:   exercise:records
Field: 日期 (YYYY-MM-DD)
Value: {
  "types": ["力量", "有氧"],   // 运动类型数组
  "note": "上午力量，下午跑步", // 备注
  "time": "20:15:30"           // 打卡时间；补卡固定 "12:00:00"
}
```

**一天一条记录**，多种运动类型共享一条备注。

---

## 🚀 从零部署步骤

### 1. 准备账号
依次注册 GitHub / Cloudflare / Upstash / Server酱，登录后**关掉页面别关账号**。

### 2. 推代码到 GitHub
```bash
cd exercise-app
git init && git add . && git commit -m "init"
git remote add origin https://github.com/你的用户名/exercise-checkin.git
git push -u origin main
```

### 3. 创建 Upstash Redis
- 登录 console.upstash.com
- Create Database
- Type: **Regional**（重要）
- Region: **AP-Southeast-1**（新加坡，国内访问最快）
- TLS: 勾上
- 创建后复制 **REST API** 的 URL 和 Token

### 4. 创建 Cloudflare Pages 项目
- dash.cloudflare.com → Workers 和 Pages → Pages → **Connect to Git**
- 选仓库 `exercise-checkin`
- 构建设置：
  - Framework preset: **None**
  - Build command: **留空**
  - Build output directory: **留空**
- 加 5 个 env vars（见上表）
- Save and Deploy

### 5. 加 GitHub Secrets
- 仓库 → Settings → Secrets and variables → Actions
- 加 3 个 secrets：`SENDKEY` / `CHECKIN_URL` / `STATS_TOKEN`

### 6. 验证
- 访问 Pages 域名 → 应看到密码框
- 输密码 → 进入打卡页
- 测试打卡 / 编辑 / 删除
- 手动 Run workflow（Actions 标签 → Run workflow）→ 微信应收到推送

---

## 🛠 日常维护

| 想做的事 | 怎么操作 |
|----------|----------|
| 改提醒时间 | 编辑 `.github/workflows/daily-reminder.yml` 的 cron 表达式（指定 `timezone: 'Asia/Shanghai'`）|
| 改主题切换时间 | 编辑 `index.html` 的 `isTimeBasedDark()` 函数 |
| 改密码 | Cloudflare Pages → Settings → Environment variables → 改 `APP_PASSWORD` → Retry deployment |
| 换密钥 | 用 Python 生成新的 `secrets.token_hex(32)`，**同时**更新 Cloudflare 和 GitHub 两边的 `STATS_TOKEN` |
| 查看函数拿到了哪些 env vars | 访问 `https://你的域名.pages.dev/api/debug` |
| 修改后部署 | `git push` → Cloudflare 自动重 deploy |

---

## ⚠️ 已知坑

1. **Vercel 域名在国内被 DNS 污染**（`*.vercel.app` 解析到 Facebook IP），所以没用 Vercel。Cloudflare Pages 在国内访问稳定。
2. **`package.json` 不能有**（即使空），否则 Cloudflare Pages 会装 workerd（119MB），超出 25MB 资产上限。
3. **不要把 `package.json` / `node_modules` 加进去**——本项目用纯标准库实现 Pages Functions，零依赖。
4. **GitHub Actions 的 timezone**：2026 年起 cron 支持 `timezone: 'Asia/Shanghai'` 字段直接指定时区，**不再需要 UTC 换算**。
5. **跨时区打卡**：补卡和"今天"的判断都用 `tzOffset`，北京/纽约/UTC 用户都能正确处理。
6. **Worker 域名（`*.workers.dev`）和 Pages 域名（`*.pages.dev`）是两回事**，别混。

---

## 🔄 数据迁移说明

如果从旧版本（一天一条 `note`）升级：
- API 读老数据时**自动包装**成 `types: ["日常"]`
- 写的时候**只写新格式**
- 旧记录可以直接在页面上"编辑"改成新格式

---

## 📝 历史

- 最初版本：Vercel + Upstash（被 DNS 污染弃用）
- 当前版本：Cloudflare Pages + Upstash + GitHub Actions

---

## 🆘 出问题怎么办

| 现象 | 检查 |
|------|------|
| 打开页面 404 | Cloudflare Pages → Deployments 看构建日志 |
| 提示"服务器未配置密码或密钥" | 访问 `/api/debug` 看 env vars 是否齐全；确认勾了 Production；改完记得 Retry |
| 收不到微信推送 | Server酱 公众号有没有过期；检查 GitHub Actions 日志 |
| 月历翻到未来日期 | 正常，未来日期灰色不可点 |
| 改完代码没生效 | 看 Cloudflare Pages Deployments 是否触发；必要时手动 Retry |

---

最后更新：2026-06
