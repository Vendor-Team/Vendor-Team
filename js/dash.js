// dash.js —— 大盘流量与销售转化
// 固定读取「流量域」数据，自动识别日期/店铺/销售额/销量/UV 等字段，
// 输出 KPI 卡片（vs 上期）+ 趋势图 + 店铺对比 + 明细表。

const charts = {};
const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6', '#14b8a6', '#a855f7'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{4})[-/年.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-01';
  return null;
}
function toMonth(v) {
  const d = parseDate(v);
  return d ? d.slice(0, 7) : '';
}

function findCol(cols, patterns) {
  for (const p of patterns) {
    const c = cols.find((x) => p.test(x));
    if (c) return c;
  }
  return null;
}

// 流量域字段智能识别
const KEYMAP = {
  sales:   [/销售额/, /GMV/i, /成交金额/, /营收/, /收入/],
  qty:     [/^销量$/, /销量/, /数量$/, /件数/, /订单数/],
  order:   [/^订单$/, /订单数/],
  uv:      [/^平台UV$/i, /平台uv/i, /平台访客/, /总UV$/i, /总uv/i, /^UV$/i, /^访客数$/],
  shopUv:  [/^店铺UV$/i, /店铺uv/i, /店铺访客/],
  date:    [/^日期$/, /时间/],
  shop:    [/^店铺$/, /门店/],
};

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    tick: dark ? '#cbd5e1' : '#475569',
    text: dark ? '#e7eaf2' : '#1f2430',
  };
}

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function drawTrend(canvasId, labels, datasets, yTitle) {
  destroyChart(canvasId);
  const t = themeColors();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { color: t.tick } } },
      scales: {
        x: { grid: { color: t.grid }, ticks: { color: t.tick, maxRotation: 45, minRotation: 0 } },
        y: { grid: { color: t.grid }, ticks: { color: t.tick }, title: { display: !!yTitle, text: yTitle, color: t.tick } },
      },
    },
  });
}

function drawBar(canvasId, labels, data, title, horizontal = true) {
  destroyChart(canvasId);
  const t = themeColors();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: labels.map((l) => String(l).slice(0, 14)),
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

// 日期运算辅助
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

let allRows = [];
let km = {};
let currentRows = [];
let prevRows = [];

function getFieldSum(rows, field) {
  if (!field) return 0;
  return rows.reduce((s, r) => s + cleanNum(r[field]), 0);
}

function getFieldAvg(rows, field) {
  if (!field || !rows.length) return 0;
  return getFieldSum(rows, field) / rows.length;
}

function getUniqueDays(rows, dateField) {
  if (!dateField) return 0;
  return new Set(rows.map((r) => parseDate(r[dateField])).filter(Boolean)).size || rows.length;
}

function calcChange(cur, prev) {
  if (!prev) return { pct: 0, sign: 0 };
  const change = cur - prev;
  const pct = prev ? (change / Math.abs(prev)) * 100 : 0;
  return { change, pct, sign: Math.sign(change) };
}

function fmtMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 100000000) return '¥' + (n / 100000000).toFixed(2) + '亿';
  if (abs >= 10000) return '¥' + (n / 10000).toFixed(2) + '万';
  return '¥' + Math.round(n).toLocaleString();
}
function fmtNum(n) {
  const abs = Math.abs(n);
  if (abs >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (abs >= 10000) return (n / 10000).toFixed(2) + '万';
  return Math.round(n).toLocaleString();
}

function renderKpis() {
  const days = getUniqueDays(currentRows, km.date) || 1;
  const prevDays = getUniqueDays(prevRows, km.date) || 1;

  const curSales = getFieldSum(currentRows, km.sales);
  const prevSales = getFieldSum(prevRows, km.sales);
  const curQty = getFieldSum(currentRows, km.qty || km.order);
  const prevQty = getFieldSum(prevRows, km.qty || km.order);
  const curAvgSales = curSales / days;
  const prevAvgSales = prevSales / prevDays;
  const curUv = getFieldSum(currentRows, km.uv);
  const prevUv = getFieldSum(prevRows, km.uv);
  const curAvgUv = curUv / days;
  const prevAvgUv = prevUv / prevDays;
  const curShopUv = getFieldSum(currentRows, km.shopUv);
  const prevShopUv = getFieldSum(prevRows, km.shopUv);
  const curAvgShopUv = curShopUv / days;
  const prevAvgShopUv = prevShopUv / prevDays;

  const kpis = [
    { label: '总销售额', cur: curSales, prev: prevSales, fmt: fmtMoney, has: !!km.sales },
    { label: '总销量', cur: curQty, prev: prevQty, fmt: fmtNum, has: !!(km.qty || km.order) },
    { label: '日均销售额', cur: curAvgSales, prev: prevAvgSales, fmt: fmtMoney, has: !!km.sales },
    { label: '日均平台UV', cur: curAvgUv, prev: prevAvgUv, fmt: fmtNum, has: !!km.uv },
    { label: '日均店铺UV', cur: curAvgShopUv, prev: prevAvgShopUv, fmt: fmtNum, has: !!km.shopUv },
  ];

  document.getElementById('kpis').innerHTML = kpis.map((k) => {
    if (!k.has) return '';
    const ch = calcChange(k.cur, k.prev);
    const arrow = ch.sign > 0 ? '↑' : ch.sign < 0 ? '↓' : '—';
    const colorClass = ch.sign > 0 ? 'up' : ch.sign < 0 ? 'down' : 'flat';
    const pctText = Math.abs(ch.pct).toFixed(1) + '%';
    return `
      <div class="kpi glass ${colorClass}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val">${k.fmt(k.cur)}</div>
        <div class="kpi-change"><span class="arrow">${arrow}</span> ${pctText} vs 上期</div>
      </div>`;
  }).join('');
}

function seriesByDate(rows, dateField, valField, fillDates) {
  if (!dateField || !valField) return { labels: [], data: [] };
  const map = {};
  fillDates.forEach((d) => map[d] = 0);
  rows.forEach((r) => {
    const d = parseDate(r[dateField]);
    if (!d || !map.hasOwnProperty(d)) return;
    map[d] += cleanNum(r[valField]);
  });
  return { labels: fillDates, data: fillDates.map((d) => Math.round(map[d] || 0)) };
}

function dateRange(start, end) {
  const res = [];
  let cur = start;
  while (cur <= end) {
    res.push(cur);
    cur = addDays(cur, 1);
  }
  return res;
}

function renderTrends() {
  const sd = document.getElementById('startDate').value;
  const ed = document.getElementById('endDate').value;
  const dates = (sd && ed) ? dateRange(sd, ed) : [];

  // 销售额趋势
  if (km.sales && dates.length) {
    const cur = seriesByDate(currentRows, km.date, km.sales, dates);
    const prev = seriesByDate(prevRows, km.date, km.sales, dates);
    drawTrend('trendSales', cur.labels, [
      { label: '本期', data: cur.data, borderColor: PALETTE[0], backgroundColor: PALETTE[0] + '22', fill: true, tension: .3 },
      { label: '上期', data: prev.data, borderColor: '#94a3b8', backgroundColor: 'transparent', fill: false, tension: .3, borderDash: [5, 5] },
    ], '销售额');
  } else {
    destroyChart('trendSales');
  }

  // UV 趋势
  if (km.uv && dates.length) {
    const cur = seriesByDate(currentRows, km.date, km.uv, dates);
    const prev = seriesByDate(prevRows, km.date, km.uv, dates);
    drawTrend('trendUv', cur.labels, [
      { label: '本期', data: cur.data, borderColor: PALETTE[3], backgroundColor: PALETTE[3] + '22', fill: true, tension: .3 },
      { label: '上期', data: prev.data, borderColor: '#94a3b8', backgroundColor: 'transparent', fill: false, tension: .3, borderDash: [5, 5] },
    ], 'UV');
  } else {
    destroyChart('trendUv');
  }

  // 销量趋势
  if ((km.qty || km.order) && dates.length) {
    const field = km.qty || km.order;
    const cur = seriesByDate(currentRows, km.date, field, dates);
    const prev = seriesByDate(prevRows, km.date, field, dates);
    drawTrend('trendQty', cur.labels, [
      { label: '本期', data: cur.data, borderColor: PALETTE[4], backgroundColor: PALETTE[4] + '22', fill: true, tension: .3 },
      { label: '上期', data: prev.data, borderColor: '#94a3b8', backgroundColor: 'transparent', fill: false, tension: .3, borderDash: [5, 5] },
    ], '销量');
  } else {
    destroyChart('trendQty');
  }
}

function renderShopCompare() {
  if (!km.shop) { destroyChart('shopChart'); return; }
  const dim = km.shop;
  const metric = km.sales || km.uv || km.qty || km.order;
  if (!metric) { destroyChart('shopChart'); return; }
  const map = {};
  currentRows.forEach((r) => {
    const k = r[dim];
    if (k == null || k === '') return;
    map[k] = (map[k] || 0) + cleanNum(r[metric]);
  });
  const arr = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  drawBar('shopChart', arr.map((x) => x[0]), arr.map((x) => Math.round(x[1])), metric);
}

function renderTable() {
  const cols = Object.keys(currentRows[0] || {}).filter((c) => c !== '__fileTag' && c !== '__month' && c !== '__date');
  const showCols = cols.slice(0, 12);
  const head = '<tr>' + showCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
  const body = currentRows.slice(0, 100).map((r) => '<tr>' + showCols.map((c) => `<td>${r[c] == null ? '' : escapeHtml(r[c])}</td>`).join('') + '</tr>').join('');
  document.getElementById('tableWrap').innerHTML = `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderAll() {
  renderKpis();
  renderTrends();
  renderShopCompare();
  renderTable();
}

function applyDateRangeFilter(rows) {
  const sd = document.getElementById('startDate').value;
  const ed = document.getElementById('endDate').value;
  if (!km.date || (!sd && !ed)) return rows;
  return rows.filter((r) => {
    const d = parseDate(r[km.date]);
    if (!d) return false;
    if (sd && d < sd) return false;
    if (ed && d > ed) return false;
    return true;
  });
}

function applyShopFilter(rows) {
  const shop = document.getElementById('shopFilter').value;
  if (!km.shop || !shop) return rows;
  return rows.filter((r) => String(r[km.shop]) === shop);
}

function computePrevRange(sd, ed, mode) {
  if (!sd || !ed) return { sd: null, ed: null };
  const len = diffDays(sd, ed);
  if (mode === 'yoy') {
    // 同比：去年同一天，长度相同
    const prevSd = (parseInt(sd.slice(0, 4)) - 1) + sd.slice(4);
    const prevEd = (parseInt(ed.slice(0, 4)) - 1) + ed.slice(4);
    return { sd: prevSd, ed: prevEd };
  }
  // 环比：往前推同样长度
  const prevEd = addDays(sd, -1);
  const prevSd = addDays(prevEd, -len);
  return { sd: prevSd, ed: prevEd };
}

function filterByRange(rows, sd, ed) {
  if (!km.date || (!sd && !ed)) return rows;
  return rows.filter((r) => {
    const d = parseDate(r[km.date]);
    if (!d) return false;
    if (sd && d < sd) return false;
    if (ed && d > ed) return false;
    return true;
  });
}

async function load() {
  document.getElementById('loadBtn').textContent = '查询中…';
  document.getElementById('loadBtn').disabled = true;
  try {
    const data = await DB.readDomain('traffic');
    if (!data || !data.rows || !data.rows.length) {
      document.getElementById('board').style.display = 'none';
      document.getElementById('empty').style.display = 'block';
      return;
    }

    allRows = data.rows;
    const cols = Object.keys(allRows[0] || {}).filter((c) => c !== '__fileTag');
    km = {};
    for (const k in KEYMAP) km[k] = findCol(cols, KEYMAP[k]);

    // 填充店铺下拉（全量）
    const shopSel = document.getElementById('shopFilter');
    const curShop = shopSel.value;
    if (km.shop) {
      const shops = [...new Set(allRows.map((r) => r[km.shop]).filter((x) => x != null && x !== ''))].sort();
      shopSel.innerHTML = `<option value="">全部店铺（${shops.length}个）</option>` + shops.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      if (shops.includes(curShop)) shopSel.value = curShop;
    } else {
      shopSel.innerHTML = '<option value="">（无店铺列）</option>';
    }

    // 默认日期范围：有数据的最大连续/最近区间
    const sdInput = document.getElementById('startDate');
    const edInput = document.getElementById('endDate');
    if (km.date && (!sdInput.value || !edInput.value)) {
      const dates = allRows.map((r) => parseDate(r[km.date])).filter(Boolean).sort();
      if (dates.length) {
        edInput.value = dates[dates.length - 1];
        sdInput.value = dates[0];
      }
    }

    const mode = document.getElementById('compareMode').value || 'mom';
    const sd = sdInput.value;
    const ed = edInput.value;
    const prev = computePrevRange(sd, ed, mode);

    // 先按店铺筛选（当前和上期都应用相同店铺条件）
    const shopFiltered = applyShopFilter(allRows);
    currentRows = filterByRange(shopFiltered, sd, ed);
    prevRows = filterByRange(shopFiltered, prev.sd, prev.ed);

    if (!currentRows.length) {
      document.getElementById('board').style.display = 'none';
      document.getElementById('empty').style.display = 'block';
      document.getElementById('empty').querySelector('p').textContent = '当前筛选条件下没有数据，调整一下日期或店铺再试。';
      return;
    }

    document.getElementById('empty').style.display = 'none';
    document.getElementById('board').style.display = 'block';
    renderAll();

    document.getElementById('updated').textContent = '更新于 ' + new Date(data.updatedAt || Date.now()).toLocaleString() + '（云端数据库 · 流量域）';
  } catch (e) {
    document.getElementById('board').style.display = 'none';
    document.getElementById('empty').style.display = 'block';
    document.getElementById('empty').querySelector('p').textContent = '读取失败：' + e.message;
  } finally {
    document.getElementById('loadBtn').textContent = '查询';
    document.getElementById('loadBtn').disabled = false;
  }
}

// 导出当前数据
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter((c) => !c.startsWith('__'));
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => {
    const v = r[c] == null ? '' : String(r[c]).replace(/"/g, '""');
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
  }).join(','));
  return [head, ...body].join('\n');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv() {
  if (!currentRows.length) return alert('没有可导出的数据');
  download('流量大盘.csv', '\uFEFF' + toCsv(currentRows), 'text/csv;charset=utf-8;');
}
function exportExcel() {
  if (!currentRows.length) return alert('没有可导出的数据');
  const html = `<table>${toCsv(currentRows).split('\n').map((row, i) => `<tr>${row.split(',').map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  download('流量大盘.xls', '\uFEFF' + html, 'application/vnd.ms-excel;charset=utf-8;');
}

window.__refreshChart = function () {
  Object.values(charts).forEach((c) => c && c.update());
};

// 侧边栏 section 切换
const SEC_META = {
  overview: ['大盘流量与销售转化', '流量与销售趋势总览'],
  category: ['品类产品分析', '品类销售与结构分析'],
  spu: ['SPU 分析', 'SPU 销售明细与排行'],
  lifecycle: ['生命周期分析', '产品生命周期对比'],
};
document.querySelectorAll('.side-nav a').forEach((a) => {
  a.addEventListener('click', () => {
    const sec = a.getAttribute('data-sec');
    if (!SEC_META[sec]) return;
    document.querySelectorAll('.side-nav a').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    document.getElementById('sec-' + sec).classList.add('active');
    document.getElementById('secTitle').textContent = SEC_META[sec][0];
    document.getElementById('secSub').textContent = SEC_META[sec][1];
  });
});

document.getElementById('loadBtn').addEventListener('click', load);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('exportExcel').addEventListener('click', exportExcel);
['startDate', 'endDate', 'shopFilter', 'compareMode'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => { if (allRows.length) load(); });
});

load();
