// 全局配置
// 模式：supabase（免费云端数据库，无需服务器 / 域名 / 登录）
(function () {
  window.APP_CONFIG = window.APP_CONFIG || {};
  const CFG = window.APP_CONFIG;

  CFG.MODE = 'supabase';

  // ↓↓↓ 在 supabase.com 建好项目后，把这两项填进来 ↓↓↓
  // 位置：Project Settings → API
  //   - Project URL      → 形如 https://xxxxxxxx.supabase.co
  //   - anon public key  → 一长串 eyJhbGci...
  CFG.SUPABASE_URL = 'https://kpszeaneoobuxcqeropj.supabase.co';
  CFG.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwc3plYW5lb29idXhjcWVyb3BqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MzY2MjksImV4cCI6MjEwMjAxMjYyOX0.I0YQB3JwbLxlJ1rUcxXmUdmvzVmsJAKVsZKHN4kWR4k';
})();
