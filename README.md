# 运动打卡 - 部署指南

完整流程：每天 20:00 → 电脑 Python 脚本推送微信 → 微信里点链接 → 手机 H5 页面打卡 → 数据存 Upstash Redis。

部署只需要 4 步，全程 20 分钟左右。

## 你需要注册的账号（全部免费）

| 服务 | 用途 | 注册 |
|------|------|------|
| **GitHub** | 存放代码 | https://github.com （邮箱注册） |
| **Vercel** | 部署前端 + API | https://vercel.com （用 GitHub 登录） |
| **Upstash** | Redis 数据库 | https://upstash.com （用 GitHub 登录） |
| **Server酱** | 微信推送 | https://sct.ftqq.com/ （微信扫码） |

---

## 步骤 1：创建 GitHub 仓库

1. 打开 https://github.com/new
2. Repository name: `exercise-checkin`（随便起）
3. 选 `Public` 或 `Private` 都行
4. **不要**勾选 Add README / .gitignore
5. 点 Create repository
6. 按页面提示把本地代码 push 上去：

```bash
cd exercise-app
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/exercise-checkin.git
git push -u origin main
```

> 没装 git 的话先装：https://git-scm.com/download/win

## 步骤 2：创建 Upstash Redis 数据库

1. 打开 https://console.upstash.com/ ，用 GitHub 登录
2. 点 **Create Database**
3. 填写：
   - Name: `exercise`
   - Type: **Regional**（国内访问稍快）
   - Region: 选 `ap-northeast-1` (东京) 或 `ap-southeast-1` (新加坡)
   - TLS: 勾选
4. 点 Create
5. 进入数据库详情页，往下滚到 **REST API** 部分
6. 复制这两个值（点眼睛图标显示 token）：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

⚠️ **这两个值先保存到记事本，待会要用**

## 步骤 3：部署到 Vercel

1. 打开 https://vercel.com/new ，用 GitHub 登录
2. 找到刚才创建的 `exercise-checkin` 仓库，点 **Import**
3. 展开 **Environment Variables**（环境变量），添加：
   - Name: `UPSTASH_REDIS_REST_URL`，Value: 步骤 2 复制的 URL
   - Name: `UPSTASH_REDIS_REST_TOKEN`，Value: 步骤 2 复制的 Token
4. 点 **Deploy**
5. 等待 1-2 分钟，部署完成会显示一个域名，类似：
   ```
   https://exercise-checkin-xxx.vercel.app
   ```
6. **复制这个域名，待会要用**

### 验证部署
浏览器打开 `https://你的域名.vercel.app`，应该能看到打卡页面。
打开 `https://你的域名.vercel.app/api/records?health=1` 应该返回 `{"ok":true,...}`。

## 步骤 4：配置 Server酱 推送

1. 打开 https://sct.ftqq.com/ 微信扫码登录，复制 SendKey
2. 编辑本地的 `exercise_reminder.py`，改两处：
   ```python
   CHECKIN_URL = "https://你的域名.vercel.app"  # 步骤 3 的域名
   # ...配置 SendKey...
   ```
3. 测试一次：
   ```bash
   python exercise_reminder.py test
   ```
   微信收到的消息里应该带有打卡链接，点击应该能直接打开打卡页

## 完整流程

```
20:00  电脑上的 exercise_reminder.py 触发
  ↓
Server酱 推送微信消息：
  "🏃 该运动了！👉 https://你的域名.vercel.app"
  ↓
你点链接 → 微信内置浏览器打开打卡页
  ↓
点"✅ 今日打卡" + 写运动内容
  ↓
数据写入 Upstash Redis
  ↓
页面刷新，显示 ✅ 已打卡 + 连续 N 天
```

## 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 移动端 H5 打卡页面 |
| `api/records.js` | Vercel Serverless API，读写 Redis |
| `vercel.json` | Vercel 配置 |
| `package.json` | 项目元信息（无依赖） |
| `.gitignore` | Git 忽略规则 |

## 常见问题

**Q: 部署后打开页面是 404？**
A: 等 1 分钟再刷新，Vercel 冷启动需要时间。

**Q: API 返回 "Upstash 环境变量未配置"？**
A: 去 Vercel 项目 → Settings → Environment Variables 检查两个变量是否都加上了，加完后要重新部署一次（Deployments → 选最新 → Redeploy）。

**Q: 微信里打开页面提示"非微信官方网页"？**
A: 用 Vercel 默认域名可能会被微信拦截。解决办法：
1. 在 Vercel 绑个自己的域名（一行 CNAME 解析）
2. 或者用 Server酱 的"消息原文"里放一个短链

**Q: 每天 20:00 电脑必须开着吗？**
A: 是的，发送推送需要跑 Python 脚本。后面可以加 Windows 任务计划程序开机自启。

**Q: 想换提醒时间？**
A: 改 `exercise_reminder.py` 里的 `REMIND_TIME`。

**Q: 数据安全吗？**
A: 数据在 Upstash 公开网络上，但只有知道 URL 的人能访问（GET 无副作用，POST 才会写）。如果担心，可以加一个简单的 Token 验证。
