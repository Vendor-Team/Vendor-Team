// upload2.js —— 分域上传（Supabase 行级存储，增量合并，分批写入）
const form = document.getElementById('upForm');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const btn = document.getElementById('submitBtn');
const byInput = document.getElementById('by');
const fileInput = document.getElementById('file');
const fileTagInput = document.getElementById('fileTag');
const keyChecks = document.getElementById('keyChecks');
const keyAutoHint = document.getElementById('keyAutoHint');
const keyWrap = document.getElementById('keyWrap');
const KEY_SEP = '||';

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

function getRowKey(row, keyFields, idx) {
  const parts = (keyFields || []).map((f) => (row[f] != null ? String(row[f]) : ''));
  const key = parts.join(KEY_SEP);
  return key || ('__idx_' + idx); // 空唯一键兜底，避免互相冲突
}

// 按唯一键去重：同一文件内重复记录只保留最后一条
function dedupeRows(rows, keyFields) {
  const seen = new Map();
  let dupCount = 0;
  rows.forEach((row, idx) => {
    const k = getRowKey(row, keyFields, idx);
    if (seen.has(k)) dupCount++;
    seen.set(k, row); // 保留最后一条
  });
  return { rows: Array.from(seen.values()), dupCount };
}

// 模糊匹配列名（依次尝试候选规则，命中第一个即返回）
function findCol(columns, candidates) {
  for (const cand of candidates) {
    const re = cand instanceof RegExp ? cand : new RegExp(cand);
    const found = columns.find((c) => re.test(c.trim()));
    if (found) return found;
  }
  return '';
}

function parseLastMergeKeys() {
  const last = DB.getLastMergeKey();
  if (!last) return null;
  return last.split(KEY_SEP).map((s) => s.trim()).filter(Boolean);
}

// 按数据域给出默认唯一键列：
//  销售域 → 订单（支持"订单号"）
//  流量域 → 日期 + 店铺（复合键）
//  其他域 / 用户上次手动选过的 → 沿用
function computeDefaultKeys(columns, domain) {
  const last = parseLastMergeKeys();
  if (last && last.length && last.every((k) => columns.includes(k))) return last;
  if (domain === 'sales') {
    const o = findCol(columns, [/^订单$/, /订单/]);
    return o ? [o] : [];
  }
  if (domain === 'traffic') {
    const keys = [];
    const date = findCol(columns, [/^日期$/, /日期/, /^dt$/i, /date/i]);
    const shop = findCol(columns, [/^店铺$/, /店铺/, /门店/, /store/i, /shop/i]);
    if (date) keys.push(date);
    if (shop) keys.push(shop);
    return keys;
  }
  return [];
}

function renderKeyChecks(columns, defaultKeys, domain) {
  const sel = new Set(defaultKeys);
  keyChecks.innerHTML = columns.map((c) => {
    const on = sel.has(c) ? ' checked' : '';
    return `<label class="${on ? 'on' : ''}"><input type="checkbox" value="${escapeHtml(c)}"${on}/>${escapeHtml(c)}</label>`;
  }).join('');
  keyChecks.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => cb.parentElement.classList.toggle('on', cb.checked));
  });
  const label = domain === 'sales' ? '销售域' : domain === 'traffic' ? '流量域' : '上次选择';
  keyAutoHint.innerHTML = defaultKeys.length
    ? `已按「${label}」默认选中：<b>${defaultKeys.join(' + ')}</b>`
    : '未找到推荐列，请手动勾选（不选则用第一列）';
}

function getSelectedKeys() {
  const checked = Array.from(keyChecks.querySelectorAll('input[type=checkbox]:checked')).map((cb) => cb.value);
  return checked.length ? checked : [parsedColumns[0]];
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
    const domain = document.getElementById('domain').value;
    const defaultKeys = computeDefaultKeys(columns, domain);
    renderKeyChecks(columns, defaultKeys, domain);
    keyWrap.style.display = 'block';
    statusEl.textContent = `已解析 ${rows.length.toLocaleString()} 行 / ${columns.length} 列，请选择唯一键列再上传`;
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

// 切换数据域时，若已解析过文件则刷新默认唯一键列
document.getElementById('domain').addEventListener('change', () => {
  if (!parsedColumns.length) return;
  const domain = document.getElementById('domain').value;
  const defaultKeys = computeDefaultKeys(parsedColumns, domain);
  renderKeyChecks(parsedColumns, defaultKeys, domain);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) { statusEl.textContent = '请先选文件'; return; }
  if (!parsedRows.length) { statusEl.textContent = '文件尚未解析，请重新选择文件'; return; }

  const domain = document.getElementById('domain').value;
  const by = byInput.value.trim() || '匿名';
  DB.setUploader(by);
  const key = getSelectedKeys();
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
    DB.setLastMergeKey(key.join(KEY_SEP));
    statusEl.textContent = '已存入 ✓';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="ok" style="font-weight:600;margin-bottom:8px">✅ 存入成功（云端数据库 · 增量合并）</div>
      <div class="muted" style="font-size:13px;line-height:1.9">
        数据域：<b>${domain}</b><br/>
        文件 / 批次：<b>${fileTag}</b>（以后可在「我的数据」里单独删除这份）<br/>
        行数：<b>${total.toLocaleString()}</b> ｜ 列数：<b>${parsedColumns.length}</b><br/>
        ${dupCount ? `去重：已合并 <b>${dupCount}</b> 个重复记录（保留最后一条）<br/>` : ''}
        唯一键列：<b>${key.join(' + ')}</b>（同键会覆盖，不同键会追加）<br/>
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
