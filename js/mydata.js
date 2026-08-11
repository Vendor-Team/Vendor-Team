// mydata.js —— 读取云端数据并出 KPI / 图表（Supabase 行级存储，无需登录）
let chart = null;
const isNum = (v) => v !== null && v !== '' && v !== undefined && !isNaN(Number(String(v).replace(/[,%$]/g, '')));
const toNum = (v) => Number(String(v).replace(/[,%$]/g, ''));
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function setEmpty(msg, showBoard) {
  document.getElementById('board').style.display = showBoard ? 'block' : 'none';
  document.getElementById('empty').style.display = showBoard ? 'none' : 'block';
  document.getElementById('empty').querySelector('p').textContent = msg;
  document.getElementById('updated').textContent = '';
  document.getElementById('fileList').style.display = 'none';
}

async function load() {
  const domain = document.getElementById('domain').value;
  const board = document.getElementById('board');
  const empty = document.getElementById('empty');
  const updated = document.getElementById('updated');
  document.getElementById('loadBtn').textContent = '读取中…';
  try {
    const data = await DB.readDomain(domain); // 匿名可读（已配置 RLS）
    if (!data || !data.rows || !data.rows.length) {
      setEmpty('该域还没有数据，去上传一份吧。', false);
      return;
    }
    empty.style.display = 'none';
    board.style.display = 'block';

    const rows = data.rows;
    const cols = rows[0] ? Object.keys(rows[0]) : [];
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

    // 已上传文件列表（可单独删除）
    renderFileList(domain, data.files);

    updated.textContent = '更新于 ' + new Date(data.updatedAt || Date.now()).toLocaleString() + '（云端数据库）';
  } catch (e) {
    setEmpty('读取失败：' + e.message, false);
  } finally {
    document.getElementById('loadBtn').textContent = '读取数据';
  }
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
load();
