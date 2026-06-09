// Bootstrap: load the current user + Caddyfile, and tab switching.
async function init() {
  const res = await fetch('/api/me');
  if (res.status === 401) { window.location.href = '/login'; return; }
  const user = await res.json();
  document.getElementById('user-info').textContent = user.email;
  await loadCaddyfile();
}

async function loadCaddyfile() {
  const res = await fetch('/api/caddyfile');
  if (res.status === 401) { window.location.href = '/login'; return; }
  const data = await res.json();
  originalContent = data.content;
  currentVersion = data.version || '';
  if (!editorView) initEditor(data.content); else setContent(data.content);
  setStatus('Loaded', 'ok');
}

window.switchTab = function(name, tabEl) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab-content#tab-${name}`).classList.add('active');
  if (tabEl) tabEl.classList.add('active');
  else document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');
  if (name === 'metrics') loadMetrics();
};
