// 全局配置
// 模式：github-direct（团队成员各自用 GitHub 账号 OAuth 直连仓库，无需服务器/域名）
(function () {
  window.APP_CONFIG = window.APP_CONFIG || {};
  const CFG = window.APP_CONFIG;

  CFG.MODE = 'github-direct';

  // ↓↓↓ GitHub OAuth App 的 Client ID（Device Flow 免密钥，非机密，可公开）↓↓↓
  // 在 github.com/settings/developers 新建 OAuth App 后，把那串 Client ID 粘到这里。
  CFG.GITHUB_CLIENT_ID = 'Ov23li2zcpzs4aSXcvaN';

  CFG.GITHUB_OWNER = 'Vendor-Team';
  CFG.GITHUB_REPO = 'Vendor-Team';
  CFG.GITHUB_BRANCH = 'main';

  // 兼容旧版：若未来想用 Cloudflare Worker 兜底，填此处地址；留空则纯直连。
  CFG.GITHUB_WORKER_URL = '';
})();
