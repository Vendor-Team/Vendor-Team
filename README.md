# 团队数据看板（方案 A：GitHub 仓库当数据库）

任何人打开链接即可 **分域上传 Excel/CSV**，看板立即读取，无需登录。零成本、不依赖任何人的电脑常开。

## 仓库结构

```
/                      静态站点（GitHub Pages 发布这个）
  index.html           首页
  upload2.html         上传数据（分域）
  mydata.html          我的数据看板
  css/style.css        样式
  js/                  前端逻辑（config.js 里填 Worker 地址）
  vendor/chart.umd.min.js  图表库
  data/                数据目录（Worker 把上传结果写到这里 *.json）
/worker                Cloudflare Worker 上传代理源码（持有 token，前端碰不到）
```

> 本地开发用的 Node 服务（server.js / dash-api.js / gh-proxy.js）不进本仓库，仅用于本地调试。

## 三步上线

1. **部署上传代理（Cloudflare Worker）**
   按 `worker/README.md`：建 Fine-grained PAT（仅本仓库 Contents 写权限）→ `wrangler deploy` → 记下 Worker 地址（如 `https://dash-upload-proxy.xxx.workers.dev`）。
   这一步是必需的：GitHub Pages 是纯静态，没有它就无法写入数据。

2. **把 Worker 地址填进前端**
   打开 `js/config.js`，把 `API_BASE` 改成你的 Worker 地址（或临时用 `?api=https://...` 覆盖）。改完提交。

3. **开启 GitHub Pages**
   仓库 Settings → Pages → Source 选 `main` 分支、`/(root)` → Save。
   几分钟后访问 `https://<组织>.github.io/<仓库>/` 即可。

## 数据域

上传时按域归口，避免互相覆盖：
- `sales` 销售域
- `returns` 退货域
- `price` 价格域
- `inventory` 库存域

同域重复上传 = 覆盖更新，并记录「更新人 / 时间」。

## 安全说明

- 写入口的 token 只在 Cloudflare Worker（服务端）持有，前端永不直接接触。
- 公开写入口靠「链接不外泄」防乱传。如需更强管控，可给 Worker 加一个简单的访问口令。
- 普通传数据的同事只是网页访客，不需要 GitHub 账号、不用进组织。
