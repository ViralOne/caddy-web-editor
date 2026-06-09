// Logs tab: poll the Caddy log file and tail it incrementally.
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
      hint.textContent = `No log file at ${data.path}.\n\nAdd a global log directive to your Caddyfile:\n\n{\n    log default {\n        output file ${data.path}\n        format json\n    }\n}\n\nThe caddy-logs volume is already shared between containers. Logs appear after the first request hits Caddy.`;
      body.appendChild(hint);
      logsPos = null;
      return;
    }
    logsPos = data.pos;
    if (data.lines && data.lines.length) {
      const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      const frag = document.createDocumentFragment();
      data.lines.forEach(line => { const d = document.createElement('div'); d.className = 'log-line'; d.textContent = line; frag.appendChild(d); });
      body.appendChild(frag);
      while (body.children.length > 1000) body.removeChild(body.firstChild);
      if (atBottom) body.scrollTop = body.scrollHeight;
    }
  } catch (e) { /* keep polling */ }
}
function startLogs() { stopLogs(); const body = document.getElementById('logs-body'); body.textContent = ''; logsPos = null; pollLogs(); logsTimer = setInterval(pollLogs, 3000); }
function stopLogs() { if (logsTimer) { clearInterval(logsTimer); logsTimer = null; } }
