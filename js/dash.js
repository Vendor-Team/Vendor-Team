// dash.js —— 大盘流量与销售转化（对标 vendor-dash 大盘模块）
// 智能识别日期 / 数值 / 维度列；时间序列趋势 + 多指标叠加 + 维度对比；
// 支持日期范围、店铺、数据源批次筛选；兼容 $ % , 等数值格式。

const charts = {};
const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6', '#14b8a6', '#a855f7'];

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

// 日期解析 → YYYY-MM-DD（用于范围筛选）；返回 null 表示无法解析
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{4})[-/年.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-01';
  return null;
}
// 日期 → YYYY-MM（用于趋势 x 轴按月）
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
const KEYMAP = {
  sales: [/销售额/],
  profit: [/^毛利$/, /毛利(?!率)/],
  margin: [/毛利率/],
  qty: [/数量|销量/],
  order: [/^订单$/, /订单(?!类型|号)/],
  date: [/日期|时间|下单日期/],
  shop: [/店铺/],
  cat: [/品类|类目/],
  grade: [/销售等级|等级/],
};

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    tick: dark ? '#cbd5e1' : '#475569',
    text: dark ? '#e7eaf2' : '#1f2430',
  };
}

// 找出所有"数值列"（多数行可解析为数字）
function numColsOf(cols, rows) {
  return cols.filter((c) => {
    const sample = rows.slice(0, 30).filter((r) => r[c] != null && r[c] !== '');
    if (!sample.length) return false;
    return sample.filter((v) => isNumLike(v)).length / sample.length >= 0.6;
  });
}

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

let last = null; // { rows, km, numCols }

function renderAll() {
  if (!last) return;
  const { rows, km, numCols } = last;
  const metricSel = document.getElementById('metricSel');
  const metric = metricSel.value || km.sales || numCols[0];
  const split = document.getElementById('splitShop').checked;
  const shopFilter = document.getElementById('shopFilter').value;

  // ---------- KPI ----------
  const totalSales = km.sales ? rows.reduce((s, r) => s + cleanNum(r[km.sales]), 0) : 0;
  const totalProfit = km.profit ? rows.reduce((s, r) => s + cleanNum(r[km.profit]), 0) : 0;
  const totalQty = km.qty ? rows.reduce((s, r) => s + cleanNum(r[km.qty]), 0) : 0;
  const orderSet = km.order ? new Set(rows.map((r) => r[km.order]).filter((x) => x != null && x !== '')) : null;
  const orderCount = orderSet ? orderSet.size : rows.length;
  let avgMargin;
  if (totalSales > 0 && totalProfit > 0) avgMargin = (totalProfit / totalSales) * 100;
  else if (km.margin) {
    const ms = rows.map((r) => cleanNum(r[km.margin])).filter((x) => x > 0);
    avgMargin = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
  } else avgMargin = 0;

  const fmtMoney = (n) => '¥' + Math.round(n).toLocaleString();
  const kpis = [
    { label: '总销售额', val: totalSales ? fmtMoney(totalSales) : '—', sub: km.sales || '—' },
    { label: '订单数', val: orderCount.toLocaleString(), sub: km.order ? '按订单号去重' : '按行计' },
    { label: '总毛利', val: totalProfit ? fmtMoney(totalProfit) : '—', sub: km.profit || '—' },
    { label: '加权毛利率', val: avgMargin.toFixed(1) + '%', sub: '毛利/销售额' },
    { label: '总销量', val: totalQty ? totalQty.toLocaleString() : '—', sub: km.qty || '—' },
  ];
  document.getElementById('kpis').innerHTML = kpis.map((k) => `
    <div class="kpi glass">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val" style="font-size:24px;font-weight:700">${k.val}</div>
      <div class="kpi-sub muted">${k.sub || ''}</div>
    </div>`).join('');

  // ---------- 趋势图 ----------
  const trendTitle = document.getElementById('trendTitle');
  if (km.date) {
    trendTitle.textContent = (metric || '主指标') + ' 趋势';
    if (split && km.shop && !shopFilter) {
      // 按店铺分线
      const shops = [...new Set(rows.map((r) => r[km.shop]).filter((x) => x != null && x !== ''))].slice(0, 8);
      const months = [...new Set(rows.map((r) => r.__month).filter(Boolean))].sort();
      const datasets = shops.map((sh, i) => {
        const series = months.map((m) => {
          const sub = rows.filter((r) => r[km.shop] === sh && r.__month === m);
          return Math.round(sub.reduce((s, r) => s + cleanNum(r[metric]), 0));
        });
        return { label: sh, data: series, borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '33', fill: false, tension: .3 };
      });
      drawTrend('trendChart', months, datasets, metric);
    } else {
      // 单条线
      const months = [...new Set(rows.map((r) => r.__month).filter(Boolean))].sort();
      const series = months.map((m) => Math.round(rows.filter((r) => r.__month === m).reduce((s, r) => s + cleanNum(r[metric]), 0)));
      drawTrend('trendChart', months, [{ label: metric, data: series, borderColor: PALETTE[0], backgroundColor: PALETTE[0] + '33', fill: true, tension: .3 }], metric);
    }
  } else {
    document.getElementById('trendChart').parentElement.style.display = 'none';
    trendTitle.textContent = '无日期列，无法出趋势';
  }

  // ---------- 维度对比（店铺 Top / 品类 Top） ----------
  const dimTitle = document.getElementById('dimTitle');
  let dimCol = null;
  if (km.shop) dimCol = km.shop; else if (km.cat) dimCol = km.cat;
  if (dimCol) {
    dimTitle.textContent = (dimCol) + ' Top';
    const d = aggregate(rows, dimCol, metric, 8);
    drawBar('dimChart', d.map((x) => x[0]), d.map((x) => Math.round(x[1])), metric);
  } else {
    document.getElementById('dimChart').parentElement.style.display = 'none';
  }

  // ---------- 多指标叠加 ----------
  const multiCols = [km.sales, km.profit, km.qty].filter(Boolean).filter((c) => numCols.includes(c));
  if (km.date && multiCols.length >= 2) {
    const months = [...new Set(rows.map((r) => r.__month).filter(Boolean))].sort();
    const datasets = multiCols.map((c, i) => ({
      label: c,
      data: months.map((m) => Math.round(rows.filter((r) => r.__month === m).reduce((s, r) => s + cleanNum(r[c]), 0))),
      borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '22', fill: false, tension: .3,
    }));
    drawTrend('multiChart', months, datasets, '数值');
  } else {
    document.getElementById('multiChart').parentElement.style.display = 'none';
  }

  // ---------- 明细表 ----------
  const cols = Object.keys(rows[0] || {}).filter((c) => c !== '__fileTag' && c !== '__month');
  const showCols = cols.slice(0, 12);
  const head = '<tr>' + showCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
  const body = rows.slice(0, 100).map((r) => '<tr>' + showCols.map((c) => `<td>${r[c] == null ? '' : escapeHtml(r[c])}</td>`).join('') + '</tr>').join('');
  document.getElementById('tableWrap').innerHTML = `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

async function load() {
  const domain = document.getElementById('domain').value;
  document.getElementById('loadBtn').textContent = '查询中…';
  document.getElementById('loadBtn').disabled = true;
  try {
    const data = await DB.readDomain(domain);
    if (!data || !data.rows || !data.rows.length) {
      document.getElementById('board').style.display = 'none';
      document.getElementById('empty').style.display = 'block';
      document.getElementById('empty').querySelector('p').textContent = '该域还没有数据，去上传一份吧。';
      return;
    }

    let rows = data.rows;
    // 数据源批次筛选
    const ft = document.getElementById('fileTagFilter').value;
    if (ft) rows = rows.filter((r) => r.__fileTag === ft);

    const cols = Object.keys(rows[0] || {}).filter((c) => c !== '__fileTag');
    const km = {};
    for (const k in KEYMAP) km[k] = findCol(cols, KEYMAP[k]);

    // 解析月份 + 日期
    if (km.date) rows.forEach((r) => { r.__month = toMonth(r[km.date]); r.__date = parseDate(r[km.date]); });

    // 日期范围筛选
    const sd = document.getElementById('startDate').value;
    const ed = document.getElementById('endDate').value;
    if (km.date && (sd || ed)) {
      rows = rows.filter((r) => {
        if (!r.__date) return false;
        if (sd && r.__date < sd) return false;
        if (ed && r.__date > ed) return false;
        return true;
      });
    }
    // 店铺筛选
    const shop = document.getElementById('shopFilter').value;
    if (km.shop && shop) rows = rows.filter((r) => r[km.shop] === shop);

    if (!rows.length) {
      document.getElementById('board').style.display = 'none';
      document.getElementById('empty').style.display = 'block';
      document.getElementById('empty').querySelector('p').textContent = '当前筛选条件下没有数据，调整一下筛选再试。';
      return;
    }

    const numCols = numColsOf(cols, rows);
    last = { rows, km, numCols };

    // 填充店铺下拉
    const shopSel = document.getElementById('shopFilter');
    const curShop = shopSel.value;
    if (km.shop) {
      const shops = [...new Set(rows.map((r) => r[km.shop]).filter((x) => x != null && x !== ''))].sort();
      shopSel.innerHTML = '<option value="">全部店铺</option>' + shops.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    } else {
      shopSel.innerHTML = '<option value="">（无店铺列）</option>';
    }
    if ([...shopSel.options].some((o) => o.value === curShop)) shopSel.value = curShop;

    // 填充数据源批次
    const ftSel = document.getElementById('fileTagFilter');
    const curFt = ftSel.value;
    ftSel.innerHTML = '<option value="">全部</option>' + (data.files || []).map((f) => `<option value="${escapeHtml(f.fileTag)}">${escapeHtml(f.fileTag)}（${f.count}）</option>`).join('');
    if ([...ftSel.options].some((o) => o.value === curFt)) ftSel.value = curFt;

    // 填充主指标下拉（数值列）
    const metricSel = document.getElementById('metricSel');
    const curMetric = metricSel.value;
    const defaultMetric = km.sales || numCols[0] || '';
    metricSel.innerHTML = numCols.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (curMetric && numCols.includes(curMetric)) metricSel.value = curMetric;
    else metricSel.value = defaultMetric;

    document.getElementById('empty').style.display = 'none';
    document.getElementById('board').style.display = 'block';
    renderAll();

    document.getElementById('updated').textContent = '更新于 ' + new Date(data.updatedAt || Date.now()).toLocaleString() + '（云端数据库）';
  } catch (e) {
    document.getElementById('board').style.display = 'none';
    document.getElementById('empty').style.display = 'block';
    document.getElementById('empty').querySelector('p').textContent = '读取失败：' + e.message;
  } finally {
    document.getElementById('loadBtn').textContent = '查询';
    document.getElementById('loadBtn').disabled = false;
  }
}

window.__refreshChart = function () { if (last) renderAll(); };

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
    if (!SEC_META[sec]) return; // 交给外层统一外壳处理（上传/我的数据等）
    document.querySelectorAll('.side-nav a').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    document.getElementById('sec-' + sec).classList.add('active');
    document.getElementById('secTitle').textContent = SEC_META[sec][0];
    document.getElementById('secSub').textContent = SEC_META[sec][1];
  });
});

['loadBtn', 'domain', 'fileTagFilter', 'startDate', 'endDate', 'shopFilter', 'metricSel', 'splitShop']
  .forEach((id) => document.getElementById(id).addEventListener('change', () => {
    if (id === 'metricSel' || id === 'splitShop' || id === 'shopFilter') { if (last) renderAll(); }
    else load();
  }));
document.getElementById('loadBtn').addEventListener('click', load);

load();
