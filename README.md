# 团队数据看板（GitHub OAuth 直连 · 零服务器）

任何人打开链接即可 **分域上传 Excel/CSV**，看板立即读取。零成本、无需服务器/域名、不依赖任何人的电脑常开。上传时每位成员用自己的 GitHub 账号登录（团队自行注册即可）。

## 工作原理

- 前端用 GitHub **Device Flow**（OAuth，免密钥）登录，浏览器拿到各自的 token，只存在自己的 localStorage。
- 上传时直接调用 GitHub Contents API，把数据写进仓库 `data/<域>.json`（同域覆盖更新）。
- 读取时也走同一个接口；公开仓库可匿名读，所以**查看无需登录**，只有**上传需要登录**。
- 因为全程只碰 `github.com`（已确认国内可访问），避开了 `workers.dev` 被墙的问题。

## 仓库结构

```
/                      静态站点（GitHub Pages 发布这个）
  index.html           首页
  upload2.html         上传数据（分域，需登录）
  mydata.html          我的数据看板（查看无需登录）
  css/style.css        样式
  js/
    config.js          配置（填 GITHUB_CLIENT_ID / 仓库信息）
    github-api.js      OAuth 登录 + 仓库读写核心模块
    upload2.js / mydata.js  页面逻辑
  vendor/              chart.umd.min.js（图表）、xlsx.full.min.js（Excel 解析，已本地化）
  data/                数据目录（上传结果写到这里 *.json）
```

## 上线步骤

### 1. 建 GitHub OAuth App（一次性）
1. 打开 `https://github.com/settings/developers` → **New OAuth App**
2. Application name：`Vendor Dashboard`
3. Homepage URL：`https://vendor-team.github.io/Vendor-Team/`
4. Authorization callback URL：同样填上面的 Pages 地址（Device Flow 实际不用，但表单必填）
5. 创建后复制 **Client ID**

### 2. 把 Client ID 填进前端
打开 `js/config.js`，把 `GITHUB_CLIENT_ID` 的 `'__GH_CLIENT_ID__'` 换成复制的 Client ID。提交即可。

> 无需任何密钥、无需服务器。`client_id` 本就是公开值。

### 3. 开启 GitHub Pages（若还没开）
仓库 Settings → Pages → Source 选 `main` 分支、`/(root)` → Save。几分钟后访问 `https://vendor-team.github.io/Vendor-Team/`。

## 成员怎么用

1. 打开 `https://vendor-team.github.io/Vendor-Team/upload2.html`
2. 点「用 GitHub 登录」→ 复制验证码 → 打开 GitHub 授权页粘贴并 Authorize → 浏览器自动完成登录
3. 选数据域、传 Excel/CSV → 存入仓库
4. 打开 `mydata.html` 选同一域即可看到刚传的数据与图表

## 数据域

- `sales` 销售域 / `returns` 退货域 / `price` 价格域 / `inventory` 库存域
- 同域重复上传 = 覆盖更新，并记录「更新人 / 时间」。

## 安全说明

- 每位成员的 token 仅存在各自浏览器，不外泄；token 权限为 `public_repo`（仅公开仓库读写）。
- 查看数据无需登录（公开仓库匿名可读）；上传必须登录，便于追溯更新人。
- 若未来要把仓库设为私有，需把 OAuth scope 改为 `repo`，并在 OAuth App 审批成员。
- 团队访客（只看数据）无需 GitHub 账号。
