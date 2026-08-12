// upload2.js —— 分域上传（Supabase 行级存储，增量合并，分批写入）
const form = document.getElementById('upForm');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const btn = document.getElementById('submitBtn');
const byInput = document.getElementById('by');
const fileInput = document.getElementById('file');
const fileTagInput = document.getElementById('fileTag');
const keyColSelect = document.getElementById('keyCol');
const keyWrap = document.getElementById('keyWrap');

let parsedRows = [];
let parsedColumns = [];

// 浏览器端解析 Excel（已本地化 vendor/xlsx.full.min.js），避免走 CDN
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Excel 解析库加载失败'));
    document.head.appendChild(s);
  });
}

// 默认更新人：上次填过就记住
if (DB.getUploader()) byInput.value = DB.getUploader();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getRowKey(row, keyField, idx) {
  let key = keyField && row[keyField] != null ? String(row[keyField]) : '';
  if (!key) key = '__idx_' + idx; // 空唯一键兜底，避免互相冲突
  return key;
}

// 按唯一键去重：同一文件内重复订单只保留最后一条
function dedupeRows(rows, keyField) {
  const seen = new Map();
  let dupCount = 0;
  rows.forEach((row, idx) => {
    const k = getRowKey(row, keyField, idx);
    if (seen.has(k)) dupCount++;
    seen.set(k, row); // 保留最后一条
  });
  return { rows: Array.from(seen.values()), dupCount };
}

async function parseFile(file) {
  const isCsv = /\.csv$/i.test(file.name);
  let columns = [], rows = [];
  if (isCsv) {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.length) throw new Error('CSV 中没有数据行');
    columns = parsed[0];
    rows = parsed.slice(1).map((r) => {
      const o = {};
      columns.forEach((c, i) => (o[c] = r[i] ?? null));
      return o;
    });
  } else {
    const XLSX = await loadSheetJS();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
    columns = rows.length ? Object.keys(rows[0]) : [];
    if (!rows.length) throw new Error('Excel 中没有数据行');
  }
  return { rows, columns };
}

// 文件选择后：解析并显示"唯一键列"下拉
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) { keyWrap.style.display = 'none'; parsedRows = []; parsedColumns = []; return; }
  statusEl.textContent = '解析预览中…';
  btn.disabled = true;
  try {
    const { rows, columns } = await parseFile(file);
    parsedRows = rows;
    parsedColumns = columns;
    if (!fileTagInput.value) fileTagInput.value = file.name.replace(/\.[^.]+$/, '');
    keyColSelect.innerHTML = columns.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    const last = DB.getLastMergeKey();
    if (last && columns.includes(last)) keyColSelect.value = last;
    keyWrap.style.display = 'block';
    statusEl.textContent = `已解析 ${rows.length.toLocaleString()} 行 / ${columns.length} 列，请选"订单唯一键"列再上传`;
  } catch (err) {
    statusEl.textContent = '解析失败';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<div class="err">❌ ${err.message}</div>`;
    parsedRows = []; parsedColumns = [];
    keyWrap.style.display = 'none';
  } finally {
    btn.disabled = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) { statusEl.textContent = '请先选文件'; return; }
  if (!parsedRows.length) { statusEl.textContent = '文件尚未解析，请重新选择文件'; return; }

  const domain = document.getElementById('domain').value;
  const by = byInput.value.trim() || '匿名';
  DB.setUploader(by);
  const key = keyColSelect.value || parsedColumns[0] || '';
  const fileTag = fileTagInput.value.trim() || file.name.replace(/\.[^.]+$/, '') || '未命名批次';

  // 同一文件内按唯一键去重，避免 upsert 报错：ON CONFLICT DO UPDATE command cannot affect row a second time
  const { rows: uniqueRows, dupCount } = dedupeRows(parsedRows, key);
  if (!uniqueRows.length) { statusEl.textContent = '去重后没有有效数据'; return; }

  const payload = { by, updatedAt: new Date().toISOString(), rows: uniqueRows };

  btn.disabled = true;
  statusEl.textContent = '上传中…';
  try {
    const total = await DB.writeDomain(domain, payload, {
      key,
      fileTag,
      onProgress: (written, totalRows) => {
        statusEl.textContent = `已写入 ${written.toLocaleString()} / ${totalRows.toLocaleString()} 行…`;
      },
    });
    DB.setLastMergeKey(key);
    statusEl.textContent = '已存入 ✓';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="ok" style="font-weight:600;margin-bottom:8px">✅ 存入成功（云端数据库 · 增量合并）</div>
      <div class="muted" style="font-size:13px;line-height:1.9">
        数据域：<b>${domain}</b><br/>
        文件 / 批次：<b>${fileTag}</b>（以后可在「我的数据」里单独删除这份）<br/>
        行数：<b>${total.toLocaleString()}</b> ｜ 列数：<b>${parsedColumns.length}</b><br/>
        ${dupCount ? `去重：已合并 <b>${dupCount}</b> 个重复订单（保留最后一条）<br/>` : ''}
        唯一键列：<b>${key}</b>（同键会覆盖，不同键会追加）<br/>
        更新人：<b>${by}</b> ｜ 时间：${new Date(payload.updatedAt).toLocaleString()}<br/>
        字段：${parsedColumns.join('、')}
      </div>`;
  } catch (err) {
    statusEl.textContent = '失败';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<div class="err">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

// 极简 CSV 解析（支持引号包裹、转义、逗号换行）
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
