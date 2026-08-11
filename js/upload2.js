// upload2.js —— 分域上传逻辑（兼容本地 Node 服务 / Cloudflare Worker）
const API = window.__API || '';
const form = document.getElementById('upForm');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const btn = document.getElementById('submitBtn');
const modeTag = document.getElementById('modeTag');

fetch(API + '/api/gh/mode')
  .then((r) => r.json())
  .then((m) => {
    const github = m.mode === 'github';
    modeTag.textContent = '模式：' + (github ? '真 GitHub 仓库' : '本地兜底（演示）') + (API ? ' · 线上' : ' · 本地');
    modeTag.className = 'tag ' + (github ? 'up' : 'flat');
  })
  .catch(() => { modeTag.textContent = '模式：未知'; });

// 浏览器端解析 xlsx（CDN 动态加载 SheetJS），转成 JSON 上传，避免 Worker 依赖重库
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Excel 解析库加载失败，请联网或改用 CSV'));
    document.head.appendChild(s);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('file');
  const file = fileInput.files[0];
  if (!file) { statusEl.textContent = '请先选文件'; return; }

  const fd = new FormData();
  fd.append('domain', document.getElementById('domain').value);
  fd.append('by', document.getElementById('by').value);

  // CSV：直接传文件；xlsx/xls：浏览器解析成 JSON 再传（两种后端都支持）
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv) {
    fd.append('file', file);
  } else {
    btn.disabled = true; statusEl.textContent = '解析 Excel 中…';
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
      const columns = rows.length ? Object.keys(rows[0]) : [];
      if (!rows.length) throw new Error('Excel 中没有数据行');
      fd.append('json', JSON.stringify({ columns, rows }));
    } catch (err) {
      statusEl.textContent = '失败';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<div style="color:#dc2626">❌ ${err.message}</div>`;
      btn.disabled = false;
      return;
    }
  }

  btn.disabled = true;
  statusEl.textContent = '上传中…';
  try {
    const r = await fetch(API + '/api/gh/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.ok) {
      statusEl.textContent = '已存入仓库 ✓';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px">✅ 存入成功（${j.mode === 'github' ? '已提交到 GitHub 仓库' : '已写入本地仓库'}）</div>
        <div class="muted" style="font-size:13px;line-height:1.9">
          数据域：<b>${j.domain}</b><br/>
          行数：<b>${j.rows}</b> ｜ 列数：<b>${(j.columns || []).length}</b><br/>
          更新人：<b>${j.by}</b> ｜ 时间：${new Date(j.updatedAt).toLocaleString()}<br/>
          字段：${(j.columns || []).join('、')}
        </div>`;
    } else {
      statusEl.textContent = '失败';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<div style="color:#dc2626">❌ ${j.error}</div>`;
    }
  } catch (err) {
    statusEl.textContent = '网络错误';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<div style="color:#dc2626">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});
