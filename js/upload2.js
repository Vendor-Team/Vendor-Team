// upload2.js —— 分域上传（GitHub OAuth 直连，无服务器）
const form = document.getElementById('upForm');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const btn = document.getElementById('submitBtn');
const byInput = document.getElementById('by');

// 未登录时禁用提交，登录后由 mountAuth 的 onLogin 解锁
btn.disabled = true;

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

GH.mountAuth('authGate', {
  note: '上传前需用 GitHub 账号登录（团队自行注册即可）',
  onLogin: (login) => {
    btn.disabled = false;
    if (login && !byInput.value) byInput.value = login; // 默认更新人 = 登录账号
  },
  onLogout: () => { btn.disabled = true; },
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!GH.isLoggedIn()) { statusEl.textContent = '请先登录 GitHub'; return; }

  const fileInput = document.getElementById('file');
  const file = fileInput.files[0];
  if (!file) { statusEl.textContent = '请先选文件'; return; }

  const domain = document.getElementById('domain').value;
  const by = byInput.value.trim() || GH.getLogin() || '匿名';

  const isCsv = /\.csv$/i.test(file.name);
  let columns = [], rows = [];
  try {
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
      btn.disabled = true; statusEl.textContent = '解析 Excel 中…';
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
      columns = rows.length ? Object.keys(rows[0]) : [];
      if (!rows.length) throw new Error('Excel 中没有数据行');
    }
  } catch (err) {
    statusEl.textContent = '失败';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<div class="err">❌ ${err.message}</div>`;
    btn.disabled = false;
    return;
  }

  const payload = { by, updatedAt: new Date().toISOString(), columns, rows };

  btn.disabled = true;
  statusEl.textContent = '上传中…';
  try {
    await GH.writeDomain(domain, payload);
    statusEl.textContent = '已存入仓库 ✓';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="ok" style="font-weight:600;margin-bottom:8px">✅ 存入成功（已提交到 GitHub 仓库 · ${(window.APP_CONFIG || {}).GITHUB_REPO || 'Vendor-Team'}）</div>
      <div class="muted" style="font-size:13px;line-height:1.9">
        数据域：<b>${domain}</b><br/>
        行数：<b>${rows.length}</b> ｜ 列数：<b>${columns.length}</b><br/>
        更新人：<b>${by}</b> ｜ 时间：${new Date(payload.updatedAt).toLocaleString()}<br/>
        字段：${columns.join('、')}
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
