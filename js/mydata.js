// mydata.js —— 智能销售看板（Supabase 行级存储，无需登录）
// 自动识别销售明细字段：销售额/毛利/毛利率/数量/订单号/日期/店铺/品类/销售等级
// 支持按数据源批次(fileTag) 与 月份 筛选；兼容 $ % , 等格式的数值清洗。

const charts = {}; // 保存所有 Chart 实例，重绘前 destroy
const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 数值清洗：兼容 $、￥、%、逗号、空格
const cleanNum = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[,%$￥\s¥]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
const isNumLike = (v) => {
  if (v == null || v === '') return false;
  return !isNaN(Number(String(v).replace(/[,%$￥\s¥]/g, '')));
};
// 日期 → YYYY-MM
function toMonth(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})[-/年](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
  return s.slice(0, 7);
}

// 在列名中按优先级匹配
function findCol(cols, patterns) {
  for (const p of patterns) {
    const c = cols.find((x) => p.test(x));
    if (c) return c;
  }
  return null;
}
const KEYMAP = {
  sales: [/销售额/],
  profit: [/^毛利$/, /毛利(?!率)/],
  margin: [/毛利率/],
  qty: [/数量/],
  order: [/^订单$/, /订单(?!类型|号)/],
  date: [/日期|时间|下单日期/],
  shop: [/店铺/],
  cat: [/品类/],
  grade: [/销售等级|等级/],
};

function setEmpty(msg) {
  document.getElementById('board').style.display = 'none';
  document.getElementById('empty').style.display = 'block';
  document.getElementById('empty').querySelector('p').textContent = msg;
  document.getElementById('updated').textContent = '';
  document.getElementById('fileList').style.display = 'none';
}

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    tick: dark ? '#cbd5e1' : '#475569',
    text: dark ? '#e7eaf2' : '#1f2430',
  };
}

function drawBar(canvasId, labels, data, title, horizontal = true) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const t = themeColors();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: labels.map((l) => String(l).slice(0, 16)),
      datasets: [{
        label: title, data,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + Number(c.parsed.x ?? c.parsed.y).toLocaleString() } } },
      scales: {
        x: { grid: { color: t.grid }, ticks: { color: t.tick } },
        y: { grid: { color: t.grid }, ticks: { color: t.tick } },
      },
    },
  });
}

function drawDoughnut(canvasId, labels, data) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const t = themeColors();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    data: {
      labels: labels.map((l) => String(l).slice(0, 16)),
      datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: t.text, borderWidth: 2 }],
    },
    options: {
      plugins: { legend: { position: 'right', labels: { color: t.tick, boxWidth: 12 } } },
    },
  });
}

// 按某文本列聚合某数值列（或计数），返回 topN
function aggregate(rows, dimCol, valCol, topN = 10) {
  const map = {};
  rows.forEach((r) => {
    const k = r[dimCol];
    if (k == null || k === '') return;
    const v = valCol ? cleanNum(r[valCol]) : 1;
    map[k] = (map[k] || 0) + v;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, topN);
}

let lastRows = null, lastKm = null;

function renderCharts(rows, km) {
  // 先把 4 个图表容器都恢复显示，再按需隐藏
  ['shopChart', 'monthChart', 'catChart', 'gradeChart'].forEach((id) => {
    document.getElementById(id).parentElement.style.display = '';
  });
  const aggBy = (dim, top = 10) => aggregate(rows, dim, km.sales, top);
  if (km.shop) {
    const d = aggBy(km.shop, 12);
    drawBar('shopChart', d.map((x) => x[0]), d.map((x) => Math.round(x[1])), '销售额');
  } else { document.getElementById('shopChart').parentElement.style.display = 'none'; }

  if (km.date) {
    const months = {};
    rows.forEach((r) => { const m = r.__month; if (m) months[m] = (months[m] || 0) + (km.sales ? cleanNum(r[km.sales]) : 1); });
    const ml = Object.keys(months).sort();
    drawBar('monthChart', ml, ml.map((m) => Math.round(months[m])), '销售额', false);
  } else { document.getElementById('monthChart').parentElement.style.display = 'none'; }

  if (km.cat) {
    const d = aggBy(km.cat, 10);
    drawBar('catChart', d.map((x) => x[0]), d.map((x) => Math.round(x[1])), '销售额');
  } else { document.getElementById('catChart').parentElement.style.display = 'none'; }

  if (km.grade) {
    const d = aggregate(rows, km.grade, null, 8);
    drawDoughnut('gradeChart', d.map((x) => x[0]), d.map((x) => x[1]));
  } else { document.getElementById('gradeChart').parentElement.style.display = 'none'; }
}

// 切换主题时由 app.js 调用，仅重绘图表（不重新请求数据库）
window.__refreshChart = function () {
  if (lastRows && lastKm) renderCharts(lastRows, lastKm);
};

async function load() {
  const domain = document.getElementById('domain').value;
  const ftFilter = document.getElementById('fileTagFilter').value;
  const moFilter = document.getElementById('monthFilter').value;
  document.getElementById('loadBtn').textContent = '读取中…';
  document.getElementById('loadBtn').disabled = true;
  try {
    const data = await DB.readDomain(domain);
    if (!data || !data.rows || !data.rows.length) {
      setEmpty('该域还没有数据，去上传一份吧。');
      return;
    }
    let rows = data.rows;
    // 筛选：数据源批次
    if (ftFilter) rows = rows.filter((r) => r.__fileTag === ftFilter);

    const cols = Object.keys(rows[0] || {}).filter((c) => c !== '__fileTag');
    const km = {};
    for (const k in KEYMAP) km[k] = findCol(cols, KEYMAP[k]);

    // 解析月份（用于月份筛选 + 图表）
    if (km.date) rows.forEach((r) => { r.__month = toMonth(r[km.date]); });
    if (moFilter) rows = rows.filter((r) => r.__month === moFilter);
    if (!rows.length) {
      setEmpty('在当前筛选条件下没有数据，换个筛选试试。');
      return;
    }

    document.getElementById('empty').style.display = 'none';
    document.getElementById('board').style.display = 'block';

    // ---------- KPI ----------
    const totalSales = km.sales ? rows.reduce((s, r) => s + cleanNum(r[km.sales]), 0) : 0;
    const totalProfit = km.profit ? rows.reduce((s, r) => s + cleanNum(r[km.profit]), 0) : 0;
    const totalQty = km.qty ? rows.reduce((s, r) => s + cleanNum(r[km.qty]), 0) : 0;
    const orderSet = km.order ? new Set(rows.map((r) => r[km.order]).filter((x) => x != null && x !== '')) : null;
    const orderCount = orderSet ? orderSet.size : rows.length;
    // 加权毛利率：总毛利 / 总销售额；否则取毛利率列均值
    let avgMargin;
    if (totalSales > 0 && totalProfit > 0) avgMargin = (totalProfit / totalSales) * 100;
    else if (km.margin) {
      const ms = rows.map((r) => cleanNum(r[km.margin])).filter((x) => x > 0);
      avgMargin = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
    } else avgMargin = 0;

    const fmtMoney = (n) => '¥' + Math.round(n).toLocaleString();
    const kpis = [
      { label: '总销售额', val: fmtMoney(totalSales), sub: km.sales || '—' },
      { label: '订单数', val: orderCount.toLocaleString(), sub: km.order ? '按订单号去重' : '按行计' },
      { label: '总毛利', val: fmtMoney(totalProfit), sub: km.profit || '—' },
      { label: '加权毛利率', val: avgMargin.toFixed(1) + '%', sub: '毛利/销售额' },
      { label: '总销量', val: totalQty.toLocaleString(), sub: km.qty || '—' },
    ];
    document.getElementById('kpis').innerHTML = kpis.map((k) => `
      <div class="kpi glass">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val" style="font-size:24px;font-weight:700">${k.val}</div>
        <div class="kpi-sub muted">${k.sub || ''}</div>
      </div>`).join('');

    // ---------- 图表 ----------
    renderCharts(rows, km);
    lastRows = rows; lastKm = km;

    // ---------- 明细表（前 50 行，去掉内部字段） ----------
    const showCols = cols.slice(0, 12);
    const head = '<tr>' + showCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
    const body = rows.slice(0, 50).map((r) => '<tr>' + showCols.map((c) => `<td>${r[c] == null ? '' : escapeHtml(r[c])}</td>`).join('') + '</tr>').join('');
    document.getElementById('tableWrap').innerHTML = `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;

    // ---------- 文件列表（可单独删除） ----------
    renderFileList(domain, data.files);

    // ---------- 填充筛选器 ----------
    fillFilters(data.files, rows, km);

    document.getElementById('updated').textContent =
      '更新于 ' + new Date(data.updatedAt || Date.now()).toLocaleString() + '（云端数据库）';
  } catch (e) {
    setEmpty('读取失败：' + e.message);
  } finally {
    document.getElementById('loadBtn').textContent = '读取数据';
    document.getElementById('loadBtn').disabled = false;
  }
}

function fillFilters(files, rows, km) {
  const ftSel = document.getElementById('fileTagFilter');
  const curFt = ftSel.value;
  ftSel.innerHTML = '<option value="">全部</option>' +
    (files || []).map((f) => `<option value="${escapeHtml(f.fileTag)}">${escapeHtml(f.fileTag)}（${f.count}）</option>`).join('');
  if ([...ftSel.options].some((o) => o.value === curFt)) ftSel.value = curFt;

  const moSel = document.getElementById('monthFilter');
  const curMo = moSel.value;
  const months = [];
  if (km.date) rows.forEach((r) => { if (r.__month && !months.includes(r.__month)) months.push(r.__month); });
  months.sort();
  moSel.innerHTML = '<option value="">全部</option>' +
    months.map((m) => `<option value="${m}">${m}</option>`).join('');
  if ([...moSel.options].some((o) => o.value === curMo)) moSel.value = curMo;
}

function renderFileList(domain, files) {
  const wrap = document.getElementById('fileList');
  const body = document.getElementById('fileListBody');
  if (!files || !files.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  body.innerHTML = files.map((f) => `
    <div class="file-row">
      <span class="file-meta"><b>${escapeHtml(f.fileTag)}</b> · ${f.count} 行 · ${new Date(f.updatedAt).toLocaleString()}</span>
      <button class="btn danger sm" data-tag="${escapeHtml(f.fileTag)}">删除这份</button>
    </div>`).join('');
  body.querySelectorAll('button[data-tag]').forEach((b) => {
    b.addEventListener('click', () => deleteFile(domain, b.getAttribute('data-tag')));
  });
}

async function deleteFile(domain, fileTag) {
  if (!confirm(`确定要删除文件「${fileTag}」这份数据吗？\n只删这一份，同域其他文件不受影响。删除后无法恢复。`)) return;
  try {
    await DB.deleteFile(domain, fileTag);
    await load();
  } catch (e) {
    alert('删除失败：' + e.message);
  }
}

document.getElementById('loadBtn').addEventListener('click', load);
document.getElementById('domain').addEventListener('change', load);
document.getElementById('fileTagFilter').addEventListener('change', load);
document.getElementById('monthFilter').addEventListener('change', load);
load();
