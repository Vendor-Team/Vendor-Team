(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  const btn = document.getElementById('themeToggle');
  function updateLabel() {
    if (!btn) return;
    btn.textContent = root.getAttribute('data-theme') === 'dark' ? '浅色模式' : '深色模式';
  }
  updateLabel();

  if (btn) btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateLabel();
    if (window.__refreshChart) window.__refreshChart();
  });
})();
