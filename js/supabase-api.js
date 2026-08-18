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

  // 读取某域全部行；返回 { by, updatedAt, rows, files }
  // Supabase REST 默认单次最多返回 1000 行，这里用 limit/offset 循环拉取。
  // options.fileTag 可指定只读某个上传批次；options.onProgress(count) 进度回调。
  async function readDomain(domain, options) {
    options = options || {};
    const pageSize = 1000;
    const allItems = [];
    let offset = 0;
    const fileTagQ = options.fileTag
      ? '&file_tag=eq.' + encodeURIComponent(options.fileTag)
      : '';
    while (true) {
      const r = await req('GET', '?domain=eq.' + encodeURIComponent(domain) +
        fileTagQ +
        '&select=domain,row_key,uploader,updated_at,row_data,file_tag&order=row_key' +
        '&limit=' + pageSize + '&offset=' + offset);
      const items = await r.json();
      if (!Array.isArray(items) || !items.length) break;
      allItems.push(...items);
      if (items.length < pageSize) break;
      offset += pageSize;
      if (options.onProgress) options.onProgress(allItems.length);
    }

    if (!allItems.length) return null;
    const items = allItems;
    const filesMap = {};
    items.forEach((it) => {
      const ft = it.file_tag || '未命名批次';
      if (!filesMap[ft]) filesMap[ft] = { fileTag: ft, count: 0, updatedAt: it.updated_at };
      filesMap[ft].count++;
      if (it.updated_at > filesMap[ft].updatedAt) filesMap[ft].updatedAt = it.updated_at;
    });
    const files = Object.values(filesMap).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rows = items.map((it) => {
      const rd = Object.assign({}, it.row_data || {});
      rd.__fileTag = it.file_tag || '未命名批次';
      return rd;
    });
    return {
      by: items[0].uploader,
      updatedAt: items[items.length - 1].updated_at,
      files,
      rows,
    };
  }

  // 写入/增量合并：
  // options.key 指定用哪些列作为 row_key（可传字符串或数组；多列用 || 拼接成复合键，如 日期||店铺）；
  // 新 key 追加，已存在 key 更新，未传到的保留。
  // ★ 全量写入，无数量上限：按 BATCH 行一批循环 POST 直到写完，禁止加"最多 N 行"截断 ★
  // options.onProgress(written, total) 可选进度回调。
  async function writeDomain(domain, payload, options) {
    options = options || {};
    const keyFields = Array.isArray(options.key) ? options.key : (options.key ? [options.key] : []);
    const uploader = payload.by || '';
    const now = new Date().toISOString();
    const rows = payload.rows || [];
    if (!rows.length) return 0;

    const fileTag = options.fileTag || '未命名批次';
    const SEP = '||';

    // 双保险：再次按 row_key 去重，同一批内同一键只保留最后一条
    const uniqueMap = new Map();
    rows.forEach((row, idx) => {
      const key = keyFields.length
        ? keyFields.map((f) => (row[f] != null ? String(row[f]) : '')).join(SEP)
        : String(idx + 1); // 兜底：行号
      uniqueMap.set(key, { row, idx });
    });

    const bodies = Array.from(uniqueMap.entries()).map(([key, { row }]) => ({
      domain,
      row_key: key,
      uploader,
      updated_at: now,
      file_tag: fileTag,
      row_data: row,
    }));

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

  // 删除某域内某个文件（批次）的全部行
  async function deleteFile(domain, fileTag) {
    await req('DELETE', '?domain=eq.' + encodeURIComponent(domain) +
      '&file_tag=eq.' + encodeURIComponent(fileTag));
    return true;
  }

  // 列出某域所有上传批次（按更新时间倒序，去重）。
  // 这里必须全量读取 file_tag/updated_at，只读最近 1000 行会导致大域里只看到最新批次。
  async function listFileTags(domain) {
    const pageSize = 1000;
    const allItems = [];
    let offset = 0;
    while (true) {
      const r = await req('GET', '?domain=eq.' + encodeURIComponent(domain) +
        '&select=file_tag,updated_at&order=updated_at.desc' +
        '&limit=' + pageSize + '&offset=' + offset);
      const items = await r.json();
      if (!Array.isArray(items) || !items.length) break;
      allItems.push(...items);
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    const map = {};
    allItems.forEach((it) => {
      const ft = it.file_tag || '未命名批次';
      if (!map[ft] || it.updated_at > map[ft].updatedAt) {
        map[ft] = { fileTag: ft, updatedAt: it.updated_at, count: 0 };
      }
      map[ft].count++;
    });
    return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return {
    readDomain, writeDomain, deleteDomain, deleteFile, listFileTags,
    getUploader, setUploader, getLastMergeKey, setLastMergeKey,
  };
})();
