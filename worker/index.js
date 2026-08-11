// Cloudflare Worker —— 团队看板的上传代理（方案 A 生产版）
// 职责：接收前端传来的 Excel/CSV（或浏览器解析好的 JSON），提交进 GitHub 仓库 data/ 目录。
// 安全：token 只存在于 Worker 环境变量/secret，前端永不直接接触。无常开服务器，按需触发。
// 暴露路由（与本地 gh-proxy 一致）：
//   POST /api/gh/upload        { file(CSV) 或 json, domain, by }
//   GET  /api/gh/data/:domain
//   GET  /api/gh/meta
//   GET  /api/gh/mode

const DATA_DIR = 'data';

// ---------- 工具 ----------
function sanitize(s) {
  return (s || '').toString().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'data';
}
function b64decode(b64) {
  b64 = (b64 || '').replace(/\s/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function csvParse(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length);
  if (!lines.length) return { columns: [], rows: [] };
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  };
  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const c = parseLine(l); const o = {}; header.forEach((h, idx) => { o[h] = c[idx] ?? null; }); return o;
  });
  return { columns: header, rows };
}
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ---------- GitHub Contents API ----------
function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'dash-worker',
    Accept: 'application/vnd.github+json',
  };
}
async function ghGet(path, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`);
  const j = await r.json();
  return { text: b64decode(j.content), sha: j.sha };
}
async function ghPut(path, b64, sha, message, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const body = { message, content: b64, branch: env.GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`GitHub PUT ${path} ${r.status} ${t.slice(0, 200)}`); }
  return r.json();
}

// ---------- 路由处理 ----------
async function onUpload(request, env) {
  const form = await request.formData();
  const domain = sanitize(form.get('domain') || 'data');
  const by = (form.get('by') || '匿名').toString().slice(0, 30);

  let columns, rows;
  const jsonField = form.get('json');
  if (jsonField) {
    const obj = JSON.parse(jsonField);
    columns = Array.isArray(obj.columns) ? obj.columns : [];
    rows = Array.isArray(obj.rows) ? obj.rows : [];
  } else {
    const file = form.get('file');
    if (!file) throw new Error('缺少文件或 json');
    const text = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
    const parsed = csvParse(text);
    columns = parsed.columns; rows = parsed.rows;
  }
  if (!rows.length) throw new Error('数据为空，请检查文件');

  const payload = { domain, columns, rows, by, updatedAt: new Date().toISOString() };
  const dataPath = `${DATA_DIR}/${domain}.json`;
  const existing = await ghGet(dataPath, env).catch(() => null);
  await ghPut(dataPath, b64encode(JSON.stringify(payload)), existing?.sha, `更新 ${domain}（${by}）`, env);

  // 更新索引，便于 /api/gh/meta 廉价列出
  const idxPath = `${DATA_DIR}/index.json`;
  let index = {};
  const idxExisting = await ghGet(idxPath, env).catch(() => null);
  if (idxExisting) { try { index = JSON.parse(idxExisting.text); } catch {} }
  index[domain] = { domain, rows: rows.length, columns, by, updatedAt: payload.updatedAt };
  await ghPut(idxPath, b64encode(JSON.stringify(index, null, 2)), idxExisting?.sha, `index ${domain}`, env);

  return { ok: true, mode: 'github', domain, rows: rows.length, columns, updatedAt: payload.updatedAt, by };
}

async function onData(domain, env) {
  const c = await ghGet(`${DATA_DIR}/${sanitize(domain)}.json`, env);
  if (!c) throw new Error('该域暂无数据');
  const obj = JSON.parse(c.text);
  return { ok: true, mode: 'github', domain: obj.domain, columns: obj.columns, rows: obj.rows, by: obj.by, updatedAt: obj.updatedAt };
}

async function onMeta(env) {
  const c = await ghGet(`${DATA_DIR}/index.json`, env).catch(() => null);
  const index = c ? JSON.parse(c.text) : {};
  return { ok: true, mode: 'github', list: Object.values(index).filter((v) => v && v.domain) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      if (p === '/api/gh/upload' && request.method === 'POST') {
        return json(await onUpload(request, env), 200, cors);
      }
      let m;
      if ((m = p.match(/^\/api\/gh\/data\/([\w-]+)$/)) && request.method === 'GET') {
        return json(await onData(m[1], env), 200, cors);
      }
      if (p === '/api/gh/meta' && request.method === 'GET') return json(await onMeta(env), 200, cors);
      if (p === '/api/gh/mode' && request.method === 'GET') return json({ mode: 'github' }, 200, cors);
      return json({ ok: false, error: 'not found: ' + p }, 404, cors);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, cors);
    }
  },
};
