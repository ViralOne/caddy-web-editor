// Logs panel: poll the Caddy log file and tail it incrementally.
let logsPos = null, logsTimer = null;

async function pollLogs() {
  try {
    const res = await fetch('/api/logs' + (logsPos != null ? `?pos=${logsPos}` : ''));
    const data = await res.json();
    const body = document.getElementById('logs-body');
    if (!data.exists) {
      body.textContent = '';
      const hint = el('div', 'metrics-hint');
      hint.style.whiteSpace = 'pre-wrap';
      hint.textContent = `No log file at ${data.path}.\n\nConfigure Caddy to write logs to a file and share it with this container, e.g. in your Caddyfile:\n\nyourdomain.com {\n    log {\n        output file ${data.path}\n    }\n}\n\nThen mount the log directory into both the Caddy and editor containers (and set CADDY_LOG_FILE if the path differs).`;
      body.appendChild(hint);
      logsPos = null;
      return;
    }
    logsPos = data.pos;
    if (data.lines && data.lines.length) {
      const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      data.lines.forEach(line => { const d = document.createElement('div'); d.className = 'log-line'; d.textContent = line; body.appendChild(d); });
      while (body.children.length > 1000) body.removeChild(body.firstChild);
      if (atBottom) body.scrollTop = body.scrollHeight;
    }
  } catch (e) { /* keep polling */ }
}
function startLogs() { const body = document.getElementById('logs-body'); body.textContent = 'Loading logs...'; logsPos = null; body.textContent = ''; pollLogs(); logsTimer = setInterval(pollLogs, 2000); }
function stopLogs() { if (logsTimer) { clearInterval(logsTimer); logsTimer = null; } }
