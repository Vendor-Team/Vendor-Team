(function () {
  const root = document.documentElement;
  const embed = new URLSearchParams(location.search).has('embed');
  // 内嵌模式：隐藏自带顶栏与主题按钮，由外壳统一控制
  if (embed) document.body.classList.add('embed');

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

  // 内嵌页：接收外壳广播的主题
  if (embed) {
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'theme' && e.data.theme) {
        root.setAttribute('data-theme', e.data.theme);
        localStorage.setItem('theme', e.data.theme);
        updateLabel();
        if (window.__refreshChart) window.__refreshChart();
      }
    });
  }

  if (btn) btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateLabel();
    if (window.__refreshChart) window.__refreshChart();
    // 外壳：把主题广播给所有内嵌 iframe
    if (window.self === window.top) {
      document.querySelectorAll('iframe.stage').forEach((f) => {
        try { f.contentWindow.postMessage({ type: 'theme', theme: next }, '*'); } catch (_) {}
      });
    }
  });
})();
