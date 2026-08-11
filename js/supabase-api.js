// supabase-api.js —— 行级存储：每个 (domain, row_key) 一条记录
// 优势：大表不超时、支持按唯一键增量合并、支持一键清空某域。
window.DB = (function () {
  const CFG = window.APP_CONFIG || {};
  const URL = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_ANON_KEY;
  const TABLE = 'domain_data';
  const BATCH = 500; // 每批写入 500 行，避免 Supabase 免费版 statement timeout

  const UPLOADER_KEY = 'vendor_uploader_v1';
  const MERGE_KEY_KEY = 'vendor_merge_key_v1';
  const getUploader = () => localStorage.getItem(UPLOADER_KEY) || '';
  const setUploader = (n) => { if (n) localStorage.setItem(UPLOADER_KEY, n); };
  const getLastMergeKey = () => localStorage.getItem(MERGE_KEY_KEY) || '';
  const setLastMergeKey = (k) => { if (k) localStorage.setItem(MERGE_KEY_KEY, k); };

  async function req(method, query, body, prefer) {
    if (!URL || !KEY || URL.indexOf('YOUR_PROJECT') >= 0) {
      throw new Error(' Supabase 未配置：请在 js/config.js 填入 SUPABASE_URL 与 SUPABASE_ANON_KEY');
    }
    const headers = {
      'apikey': KEY,
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (prefer || method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = prefer || 'resolution=merge-duplicates, return=minimal';
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

  // 读取某域全部行；返回 { by, updatedAt, rows }
  async function readDomain(domain) {
    const r = await req('GET', '?domain=eq.' + encodeURIComponent(domain) +
      '&select=domain,row_key,uploader,updated_at,row_data&order=row_key');
    const items = await r.json();
    if (!Array.isArray(items) || !items.length) return null;
    const rows = items.map(it => it.row_data);
    return {
      by: items[0].uploader,
      updatedAt: items[items.length - 1].updated_at,
      rows,
    };
  }

  // 写入/增量合并：
  // options.key 指定用哪一列作为 row_key（如订单号）；新 key 追加，已存在 key 更新，未传到的保留。
  // options.onProgress(written, total) 可选进度回调。
  async function writeDomain(domain, payload, options) {
    options = options || {};
    const keyField = options.key || '';
    const uploader = payload.by || '';
    const now = new Date().toISOString();
    const rows = payload.rows || [];
    if (!rows.length) return 0;

    const bodies = rows.map((row, idx) => {
      let key = keyField && row[keyField] != null ? String(row[keyField]) : '';
      if (!key) key = String(idx + 1); // 兜底：行号
      return {
        domain,
        row_key: key,
        uploader,
        updated_at: now,
        row_data: row,
      };
    });

    let written = 0;
    for (let i = 0; i < bodies.length; i += BATCH) {
      const batch = bodies.slice(i, i + BATCH);
      await req('POST', '?on_conflict=domain,row_key', batch,
        'resolution=merge-duplicates, return=minimal');
      written += batch.length;
      if (options.onProgress) options.onProgress(written, bodies.length);
    }
    return written;
  }

  // 删除某域全部行
  async function deleteDomain(domain) {
    await req('DELETE', '?domain=eq.' + encodeURIComponent(domain));
    return true;
  }

  return {
    readDomain, writeDomain, deleteDomain,
    getUploader, setUploader, getLastMergeKey, setLastMergeKey,
  };
})();
