// 全局配置：API 基址（生产必填）
// 留空 '' = 使用同源本地 Node 服务（开发 / 兜底模式）
// 部署到 GitHub Pages 后，必须改成你的 Cloudflare Worker 地址（仓库当数据库）：
//   window.APP_CONFIG.API_BASE = 'https://dash-upload-proxy.xxx.workers.dev';
// 临时覆盖：在网址后加 ?api=https://xxx.workers.dev
// ⚠️ 没填 Worker 地址时，上传 / 读取会失败（Pages 是纯静态，没有后端）。
(function () {
  window.APP_CONFIG = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  let base = window.APP_CONFIG.API_BASE || '';
  if (params.get('api')) base = params.get('api');
  window.__API = base;
})();
