// mydata.js —— 读取仓库数据并出 KPI / 图表（GitHub OAuth 直连）
let chart = null;
const isNum = (v) => v !== null && v !== '' && v !== undefined && !isNaN(Number(String(v).replace(/[,%$]/g, '')));
const toNum = (v) => Number(String(v).replace(/[,%$]/g, ''));

function firstTextCol(cols, rows) {
  for (const c of cols) {
    const sample = rows.slice(0, 20).filter((r) => r[c] !== null && r[c] !== '');
    if (sample.length && sample.every((r) => !isNum(r[c]))) return c;
  }
  return cols[0];
}
function firstNumCol(cols, rows) {
  for (const c of cols) {
    const sample = rows.slice(0, 20).filter((r) => r[c] !== null && r[c] !== '');
    if (sample.length && sample.some((r) => isNum(r[c]))) return c;
  }
  return null;
}

async function load() {
  const domain = document.getElementById('domain').value;
  const board = document.getElementById('board');
  const empty = document.getElementById('empty');
  const updated = document.getElementById('updated');
  document.getElementById('loadBtn').textContent = '读取中…';
  try {
    const data = await GH.readDomain(domain); // 公开仓库可匿名读，登录后带 token 也可
    if (!data || !data.rows || !data.rows.length) {
      board.style.display = 'none';
      empty.style.display = 'block';
      empty.querySelector('p').textContent = '该域还没有数据，去上传一份吧。';
      updated.textContent = '';
      return;
    }
    empty.style.display = 'none';
    board.style.display = 'block';

    const cols = data.columns || (data.rows[0] ? Object.keys(data.rows[0]) : []);
    const rows = data.rows;
    const textCol = firstTextCol(cols, rows);
    const numCol = firstNumCol(cols, rows);

    // KPI
    const kpis = [
      { label: '数据域', val: domain, sub: '' },
      { label: '行数', val: rows.length.toLocaleString(), sub: cols.length + ' 列' },
      { label: '更新人', val: (data.by || '—'), sub: '' },
    ];
    if (numCol) {
      const sum = rows.reduce((s, r) => s + (isNum(r[numCol]) ? toNum(r[numCol]) : 0), 0);
      kpis.push({ label: numCol + ' 合计', val: sum.toLocaleString(), sub: '首数值列' });
      const avg = sum / rows.length;
      kpis.push({ label: numCol + ' 均值', val: avg.toLocaleString(undefined, { maximumFractionDigits: 1 }), sub: '平均' });
    }
    document.getElementById('kpis').innerHTML = kpis.map((k) => `
      <div class="kpi glass">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val" style="font-size:26px;font-weight:700">${k.val}</div>
        <div class="kpi-sub muted">${k.sub || ''}</div>
      </div>`).join('');

    // 柱状图：文本列 top15 × 数值列
    const agg = {};
    rows.forEach((r) => {
      const k = r[textCol]; if (k == null) return;
      agg[k] = (agg[k] || 0) + (numCol && isNum(r[numCol]) ? toNum(r[numCol]) : 1);
    });
    const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const dark = document.body.classList.contains('dark');
    const grid = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const tick = dark ? '#cbd5e1' : '#475569';
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('barChart'), {
      type: 'bar',
      data: {
        labels: top.map((t) => String(t[0]).slice(0, 14)),
        datasets: [{ label: numCol || '计数', data: top.map((t) => t[1]),
          backgroundColor: 'rgba(129,140,248,.75)', borderRadius: 6 }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: grid }, ticks: { color: tick } }, y: { grid: { color: grid }, ticks: { color: tick } } },
      },
    });
    document.getElementById('chartTitle').textContent = `${textCol} × ${numCol || '计数'}（Top 15）`;

    // 表格预览
    const head = '<tr>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
    const body = rows.slice(0, 50).map((r) => '<tr>' + cols.map((c) => `<td>${r[c] == null ? '' : r[c]}</td>`).join('') + '</tr>').join('');
    document.getElementById('tableWrap').innerHTML = `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;

    updated.textContent = '更新于 ' + new Date(data.updatedAt || Date.now()).toLocaleString() + '（GitHub 仓库）';
  } catch (e) {
    board.style.display = 'none'; empty.style.display = 'block';
    empty.querySelector('p').textContent = '读取失败：' + e.message;
  } finally {
    document.getElementById('loadBtn').textContent = '读取数据';
  }
}

// 登录态（查看无需登录；登录后仅用于记录上传人）
GH.mountAuth('authGate', {
  note: '查看数据无需登录；登录用于上传时记录更新人',
  allowLogout: true,
});

document.getElementById('loadBtn').addEventListener('click', load);
document.getElementById('domain').addEventListener('change', load);
load();
