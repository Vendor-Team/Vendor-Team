# 团队数据看板（Supabase 云端数据库 · 零服务器）

任何人打开链接即可 **分域上传 Excel/CSV**，看板立即读取。零成本、无需服务器/域名、不依赖任何人的电脑常开、**无需注册或登录**。数据存在 Supabase 免费云端 Postgres。

## 工作原理

- 前端用 **Supabase REST API** 直连云端数据库（免费套餐永久可用）。
- 上传时把数据 upsert 进 `domain_data` 表（按 `domain` 主键，同域覆盖更新，记录更新人/时间）。
- 读取也走同一个接口，**匿名即可读**，所以上传、查看都不需要登录。
- 前端只暴露 Supabase 的 **anon public key**（本就设计为公开），真正的安全靠 Supabase 的 **RLS 行级权限** 控制。

## 仓库结构

```
/                      静态站点（GitHub Pages 发布这个）
  index.html           首页
  upload2.html         上传数据（分域，无需登录）
  mydata.html          我的数据看板（查看无需登录）
  css/style.css        样式
  js/
    config.js          配置（填 SUPABASE_URL / SUPABASE_ANON_KEY）
    supabase-api.js    云端数据库读写核心模块
    upload2.js / mydata.js  页面逻辑
  vendor/              chart.umd.min.js（图表）、xlsx.full.min.js（Excel 解析，已本地化）
```

## 上线步骤

### 1. 建 Supabase 项目（一次性，免费）
1. 打开 `https://supabase.com` → **Start your project** → 注册/登录。
2. **New project**：
   - Name：`vendor-dashboard`
   - Database password：系统生成，复制保存（前端用不到）
   - Region：选 **Singapore**（离国内最近）
3. 项目就绪后：左侧 **Project Settings → API**，复制两项：
   - **Project URL**（形如 `https://xxxxxxxx.supabase.co`）
   - **anon public key**（一长串 `eyJhbGci...`）

### 2. 建数据表 + 开放匿名读写
1. 左侧 **Table Editor → New table**：
   - Name：`domain_data`
   - 勾选 **Enable Row Level Security (RLS)**
   - 列：

     | Name | Type | Default | Primary |
     |---|---|---|---|
     | `domain` | `text` | — | ✅ |
     | `uploader` | `text` | — | 否 |
     | `updated_at` | `timestamptz` | `now()` | 否 |
     | `rows` | `jsonb` | `'[]'::jsonb` | 否 |
2. 建表后点 **Policies** → 创建 4 条策略（Target roles 填 `anon`）：
   - `Allow anon select`：SELECT，Using `true`
   - `Allow anon insert`：INSERT，With check `true`
   - `Allow anon update`：UPDATE，Using `true` + With check `true`
   - `Allow anon delete`：DELETE，Using `true`（可选）

### 3. 把 URL 和 key 填进前端
打开 `js/config.js`，把 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 换成你的真实值，提交即可。

### 4. 开启 GitHub Pages（若还没开）
仓库 Settings → Pages → Source 选 `main` 分支、`/(root)` → Save。访问 `https://vendor-team.github.io/Vendor-Team/`。

## 成员怎么用

1. 打开 `https://vendor-team.github.io/Vendor-Team/upload2.html`
2. 选数据域、填「更新人」（可选，会记住）、传 Excel/CSV → 存入云端
3. 打开 `mydata.html` 选同一域即可看到刚传的数据与图表

## 数据域

- `sales` 销售域 / `returns` 退货域 / `price` 价格域 / `inventory` 库存域
- 同域重复上传 = 覆盖更新，并记录「更新人 / 时间」。

## 安全说明

- 前端只用 Supabase **anon public key**（公开值，可安全暴露）。写权限靠 RLS 策略限制为 `anon` 角色。
- 任何拿到链接的人都能读写（和之前"有链接即可用"需求一致）；若以后要限制，可在 Supabase 把 RLS 改成只允许登录用户。
- 免费套餐额度：500MB 数据库 + 每周 5 万次请求，小团队足够。
