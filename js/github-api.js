// github-api.js —— 纯前端 GitHub OAuth（Device Flow，免密钥）+ 仓库读写
// 每个成员在浏览器里各自完成 GitHub 登录，token 只存在自己的 localStorage，不外泄。
window.GH = (function () {
  const CFG = window.APP_CONFIG || {};
  const TOKEN_KEY = 'vendor_gh_token_v1';
  const USER_KEY = 'vendor_gh_user_v1';
  const SCOPE = 'public_repo'; // 仅公开仓库读写（本仓库为 public）

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const getLogin = () => localStorage.getItem(USER_KEY) || '';
  const setLogin = (u) => (u ? localStorage.setItem(USER_KEY, u) : localStorage.removeItem(USER_KEY));
  const logout = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };
  const isLoggedIn = () => !!getToken();

  // unicode 安全的 base64（GitHub Contents API 要求 base64 传输，需支持中文）
  const b64Enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64Dec = (b64) => decodeURIComponent(escape(atob(b64)));

  // ---------- Device Flow 登录 ----------
  async function startDeviceFlow() {
    const r = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: CFG.GITHUB_CLIENT_ID, scope: SCOPE }),
    });
    if (!r.ok) throw new Error('获取设备码失败 (' + r.status + ')');
    return r.json(); // { device_code, user_code, verification_uri, expires_in, interval }
  }

  async function pollToken(device_code, interval = 5) {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    let wait = Math.max(interval || 5, 1) * 1000;
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(wait);
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          client_id: CFG.GITHUB_CLIENT_ID,
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const d = await r.json();
      if (d.access_token) { setToken(d.access_token); await refreshLogin(); return d.access_token; }
      if (d.error === 'authorization_pending') continue;
      if (d.error === 'slow_down') { wait *= 2; continue; }
      if (d.error === 'expired_token') throw new Error('设备码已过期，请重新登录');
      if (d.error === 'access_denied') throw new Error('你取消了授权');
      throw new Error('授权失败：' + (d.error_description || d.error));
    }
    throw new Error('授权超时，请重试');
  }

  async function refreshLogin() {
    const t = getToken(); if (!t) return '';
    try {
      const r = await fetch('https://api.github.com/user', {
        headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + t },
      });
      if (r.ok) { const u = await r.json(); setLogin(u.login); return u.login; }
    } catch (e) {}
    return getLogin();
  }

  // ---------- 仓库读写（GitHub Contents API） ----------
  // 读某个数据域；401/403 自动回退匿名（公开仓库可匿名读）；404 返回 null
  async function readDomain(domain) {
    const path = 'data/' + domain + '.json';
    const url = `https://api.github.com/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/contents/${path}?ref=${CFG.GITHUB_BRANCH}`;
    const headers = { 'Accept': 'application/vnd.github+json' };
    const tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const r = await fetch(url, { headers });
    if (r.status === 404) return null;
    if ((r.status === 401 || r.status === 403) && tok) {
      // token 失效，重试匿名
      const r2 = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
      if (r2.status === 404) return null;
      if (!r2.ok) throw new Error('读取失败 (' + r2.status + ')');
      const d = await r2.json();
      return decodeContent(d);
    }
    if (!r.ok) throw new Error('读取失败 (' + r.status + ')');
    const d = await r.json();
    return decodeContent(d);
  }

  function decodeContent(d) {
    let content;
    try { content = JSON.parse(b64Dec(d.content)); }
    catch (e) { throw new Error('数据解析失败'); }
    return content;
  }

  // 写某个数据域（同域覆盖）；payload 结构：{ by, updatedAt, columns, rows }
  async function writeDomain(domain, payload) {
    const tok = getToken();
    if (!tok) throw new Error('请先登录 GitHub 再上传');
    const path = 'data/' + domain + '.json';
    const base = `https://api.github.com/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/contents/${path}`;
    let sha = null;
    try {
      const r = await fetch(base + '?ref=' + CFG.GITHUB_BRANCH, {
        headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + tok },
      });
      if (r.ok) { const d = await r.json(); sha = d.sha; }
    } catch (e) { /* 新文件没有 sha，忽略 */ }

    const body = {
      message: `数据更新 · ${domain} · ${payload.by || '匿名'}`,
      content: b64Enc(JSON.stringify(payload, null, 2)),
      branch: CFG.GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const r = await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = '写入失败 (' + r.status + ')';
      try { const e = await r.json(); if (e.message) msg += '：' + e.message; } catch (x) {}
      throw new Error(msg);
    }
    return r.json();
  }

  // ---------- 登录态 UI ----------
  function mountAuth(containerId, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el) { if (opts.onLogin) opts.onLogin(getLogin()); return; }
    function render() {
      if (isLoggedIn()) {
        const login = getLogin() || 'GitHub';
        el.innerHTML = `<span class="tag up">✓ 已登录 ${login}</span>` +
          (opts.allowLogout !== false ? ` <button class="linkbtn" id="ghLogout">退出</button>` : '');
        const lo = document.getElementById('ghLogout');
        if (lo) lo.onclick = () => { logout(); render(); if (opts.onLogout) opts.onLogout(); };
        if (opts.onLogin) opts.onLogin(login);
      } else {
        el.innerHTML = `<span class="tag flat">未登录</span> <button class="btn primary sm" id="ghLogin">用 GitHub 登录</button>` +
          (opts.note ? `<span class="muted" style="margin-left:8px;font-size:12px">${opts.note}</span>` : '');
        const btn = document.getElementById('ghLogin');
        if (btn) btn.onclick = () => startLogin(el, render);
      }
    }
    render();
    if (isLoggedIn()) refreshLogin().then(render);
  }

  function startLogin(el, render) {
    (async () => {
      try {
        const dev = await startDeviceFlow();
        const code = dev.user_code;
        const uri = dev.verification_uri;
        el.innerHTML = `
          <div class="gate glass">
            <div style="font-weight:600;margin-bottom:6px">① 复制这组验证码：</div>
            <div class="codebox" id="ghCode">${code}</div>
            <div style="margin-top:8px">② <a href="${uri}" target="_blank" rel="noopener" class="linkbtn">打开 GitHub 授权页 ↗</a>，粘贴验证码并点 <b>Authorize</b>。</div>
            <div id="ghPoll" class="muted" style="margin-top:10px;font-size:13px">⏳ 正在等待你在另一个标签页完成授权…（不要关这个页面）</div>
          </div>`;
        await pollToken(dev.device_code, dev.interval);
        el.innerHTML = '<span class="tag up">✓ 登录成功</span>';
        setTimeout(render, 300);
      } catch (e) {
        el.innerHTML = `<div class="err">登录失败：${e.message} <button class="linkbtn" onclick="location.reload()">重试</button></div>`;
      }
    })();
  }

  return {
    isLoggedIn, getToken, getLogin, logout,
    startDeviceFlow, pollToken, refreshLogin,
    readDomain, writeDomain, mountAuth,
  };
})();
