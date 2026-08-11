// supabase-api.js —— 纯前端直连 Supabase（免费，无需后端 / 域名 / 登录）
// 数据存云端 Postgres，前端用 anon key + REST API 读写。
// 匿名即可读写（需在 Supabase 侧配置 RLS 允许 anon 全表操作）。
window.DB = (function () {
  const CFG = window.APP_CONFIG || {};
  const URL = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_ANON_KEY;
  const TABLE = 'domain_data';

  // 上传人：本地记住，避免每次重输
  const UPLOADER_KEY = 'vendor_uploader_v1';
  const getUploader = () => localStorage.getItem(UPLOADER_KEY) || '';
  const setUploader = (n) => { if (n) localStorage.setItem(UPLOADER_KEY, n); };

  async function req(method, query, body) {
    if (!URL || !KEY || URL.indexOf('YOUR_PROJECT') >= 0) {
      throw new Error(' Supabase 未配置：请在 js/config.js 填入 SUPABASE_URL 与 SUPABASE_ANON_KEY');
    }
    const headers = {
      'apikey': KEY,
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = 'resolution=merge-duplicates, return=minimal';
    }
    const r = await fetch(URL + '/rest/v1/' + TABLE + (query || ''), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let msg = '请求失败 (' + r.status + ')';
      try { const e = await r.json(); if (e && e.message) msg += '：' + e.message; } catch (x) {}
      throw new Error(msg);
    }
    return r;
  }

  // 读取某域数据；返回 null 表示还没有
  async function readDomain(domain) {
    const r = await req('GET', '?domain=eq.' + encodeURIComponent(domain) +
      '&select=domain,uploader,updated_at,rows');
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const d = rows[0];
    return { by: d.uploader, updatedAt: d.updated_at, rows: d.rows || [] };
  }

  // 写入（同域覆盖 upsert）
  async function writeDomain(domain, payload) {
    await req('POST', '?on_conflict=domain', [{
      domain,
      uploader: payload.by || '',
      updated_at: new Date().toISOString(),
      rows: payload.rows,
    }]);
    return true;
  }

  return { readDomain, writeDomain, getUploader, setUploader };
})();
