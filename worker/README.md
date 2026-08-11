# 上传代理（Cloudflare Worker）部署指南

这个 Worker 是「GitHub 仓库当数据库」方案的生产核心：前端把 Excel/CSV 交给它，它用 token 把文件提交进你们的 GitHub 仓库；看板再从仓库读数据。**token 只存在于 Worker 的 secret 里，前端拿不到。**

## 一、你们要做的（GitHub 侧）

1. **建组织**：用团队邮箱登录 github.com → 右上角 `+` → *New organization* → 起个名（如 `team-dash`）。
2. **关于「成员」——重要澄清**：**普通传数据的同事不需要进组织、也不需要 GitHub 账号。** 他们只是打开你们发布的网页链接、点上传，文件经 Worker 提交进仓库，全程不碰 GitHub。只有**少数几个管仓库 / 管 token 的管理员**才需要进组织（*Settings → People* 把这几个人加进来即可）。所以这里的「加成员」指的是管理员，不是所有用看板的人。
3. **建仓库**：组织下 *New repository*（先 private 也行；要开 Pages 公开就后面改 public），记下 `组织名/仓库名`。
4. **建 Fine-grained PAT**（只给这个仓库、只给 Contents 写权限）：
   - 右上角头像 → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate*。
   - Repository access 选你们刚建的仓库。
   - Permissions → *Contents* 设成 **Read and write**。
   - 生成后**复制 token**（只显示一次）。
5. **仓库里建一个 `data/` 目录**：随便传一个文件进去（比如 `data/.gitkeep`），Worker 之后会自动往里写 `数据域.json` 和 `index.json`。

## 二、部署 Worker

> 需要 Node 环境。Cloudflare 账号免费（每天 10 万次请求额度，团队完全够用）。

```bash
cd dashboard-app/worker
npm install -g wrangler        # 若没装
wrangler login                # 浏览器授权 Cloudflare
wrangler secret put GITHUB_TOKEN   # 粘贴第 4 步复制的 token
# 编辑 wrangler.toml，把 GITHUB_OWNER / GITHUB_REPO 改成你们的
wrangler deploy
```

部署完会得到一个地址，形如 `https://dash-upload-proxy.xxx.workers.dev`。

## 三、前端指向 Worker

打开 `dashboard-app/public/js/config.js`，把 `API_BASE` 改成上面的 Worker 地址：

```js
window.APP_CONFIG.API_BASE = 'https://dash-upload-proxy.xxx.workers.dev';
```

（留空则默认用本地 Node 服务，方便开发。）

## 四、发布看板页面（GitHub Pages）

把 `dashboard-app/public/` 整个目录的内容推到仓库的 `gh-pages` 分支（或仓库根目录开启 Pages），大家访问 `https://组织名.github.io/仓库名/` 即可使用。

- 上传页 `/upload2.html` → 选域 → 传 Excel/CSV → 经 Worker 存进仓库。
- 看板页 `/mydata.html` → 选域 → 读仓库最新数据出 KPI/图表。

## 五、安全红线

- **token 永远只在 Worker secret 里**，不要写进任何前端代码或提交到仓库。
- 若链接外泄担心被乱传，可给 Worker 加一个简单口令校验（在 `onUpload` 里判断 `form.get('key')`），不影响「有链接就能看」。
- 仓库建议 private；Pages 站点可单独设公开。

## 六、本地调试（不走 GitHub）

保持 `API_BASE` 为空，本地 `cd dashboard-app && PORT=8080 node server.js`，上传会写到本地 `repo-data/`（兜底模式），方便没联网时开发。
