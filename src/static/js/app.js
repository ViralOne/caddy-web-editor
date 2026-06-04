const { basicSetup, EditorView, EditorState, keymap, oneDark, StreamLanguage, indentWithTab } = window.CM;

const caddyfileLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^"[^"]*"/)) return 'string';
    if (stream.match(/^\{|\}/)) return 'bracket';
    if (stream.match(/^\b(reverse_proxy|header|encode|file_server|root|try_files|redir|respond|log|basicauth|rate_limit|import|tls|route|handle|handle_path|rewrite|uri)\b/)) return 'keyword';
    if (stream.match(/^\b(email|auto_https|servers|admin|debug|order|storage|acme_ca|on_demand_tls)\b/)) return 'atom';
    if (stream.match(/^\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/)) return 'number';
    if (stream.match(/^\blocalhost:\d+\b/)) return 'number';
    stream.next();
    return null;
  }
});

let editorView;
let originalContent = '';
let lastSavedTime = null;
let lastSavedBy = '';

function getContent() { return editorView.state.doc.toString(); }
function setContent(text) { editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text } }); }

function initEditor(content) {
  editorView = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        oneDark,
        caddyfileLanguage,
        EditorView.updateListener.of(update => {
          if (update.docChanged) setDot(getContent() !== originalContent ? 'yellow' : 'green');
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            document.getElementById('cursor-pos').textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
          }
        }),
        keymap.of([
          { key: 'Mod-s', run: () => { doSave(); return true; } },
          indentWithTab,
        ]),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: '13px' },
          '.cm-gutters': { background: '#0d1117', borderRight: '1px solid #21262d' },
        }),
      ],
    }),
    parent: document.getElementById('cm-editor'),
  });
}

window.addEventListener('beforeunload', (e) => {
  if (editorView && getContent() !== originalContent) { e.preventDefault(); e.returnValue = ''; }
});

function updateLastSaved() {
  if (!lastSavedTime) return;
  const el = document.getElementById('last-saved');
  const diff = Math.floor((Date.now() - lastSavedTime) / 1000);
  let text = diff < 5 ? 'just now' : diff < 60 ? `${diff}s ago` : diff < 3600 ? `${Math.floor(diff/60)}m ago` : `${Math.floor(diff/3600)}h ago`;
  el.textContent = `Saved ${text}` + (lastSavedBy ? ` by ${lastSavedBy}` : '');
}
setInterval(updateLastSaved, 10000);

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
  if (!editorView) initEditor(data.content); else setContent(data.content);
  setStatus('Loaded', 'ok');
}

window.switchTab = function(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab-content#tab-${name}`).classList.add('active');
  event.target.classList.add('active');
  if (name === 'metrics') loadMetrics();
};

window.doValidate = async function() {
  setStatus('Validating + formatting...', 'info'); hideWarnings();
  const res = await fetch('/api/validate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: getContent()}) });
  const data = await res.json();
  if (data.formatted) { setContent(data.formatted); setStatus('Formatted + valid', 'ok'); setDot('green'); }
  else if (data.valid && !data.warnings.length) { setStatus('Valid config', 'ok'); setDot('green'); }
  else if (data.valid && data.warnings.length) { setStatus('Valid with warnings', 'ok'); setDot('yellow'); showWarnings(data.warnings); }
  else { setStatus(data.message, 'err'); setDot('red'); }
};

window.doSave = async function() {
  setStatus('Validating before save...', 'info');
  const content = getContent();
  const valRes = await fetch('/api/validate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content}) });
  const valData = await valRes.json();
  if (!valData.valid) { setStatus(valData.message, 'err'); setDot('red'); alert('Cannot save: config is invalid.\n\n' + valData.message); return; }
  if (valData.warnings && valData.warnings.length) { showWarnings(valData.warnings); setDot('yellow'); setStatus('Warnings found (review before saving)', 'warn'); if (!confirm('Warnings found:\n\n' + valData.warnings.join('\n') + '\n\nSave anyway?')) return; }
  if (!confirm('Config is valid. Save and reload Caddy?')) return;
  setStatus('Saving...', 'info');
  const res = await fetch('/api/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content}) });
  const data = await res.json();
  if (data.ok) { if (data.content) setContent(data.content); originalContent = data.content || content; setStatus(data.message, 'ok'); setDot('green'); lastSavedTime = Date.now(); lastSavedBy = document.getElementById('user-info').textContent; updateLastSaved(); hideWarnings(); }
  else { setStatus(data.message, 'err'); setDot('red'); }
};

function showWarnings(warnings) {
  const el = document.getElementById('warnings'); el.textContent = '';
  warnings.forEach(w => { const div = document.createElement('div'); div.textContent = '⚠ ' + w; el.appendChild(div); });
  el.classList.add('show');
}
function hideWarnings() { document.getElementById('warnings').classList.remove('show'); }

// --- Metrics Tab ---

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function loadMetrics() {
  const body = document.getElementById('metrics-body');
  body.textContent = 'Loading metrics...';

  const [metricsRes, trafficRes, upstreamsRes] = await Promise.all([
    fetch('/api/metrics'),
    fetch('/api/traffic'),
    fetch('/api/upstreams'),
  ]);

  const metrics = await metricsRes.json();
  const traffic = await trafficRes.json();
  const upstreams = await upstreamsRes.json();

  body.textContent = '';

  // --- Overview Cards ---
  const overviewSection = el('div', 'metrics-section');
  overviewSection.appendChild(el('div', 'section-title', 'Overview'));

  const overviewGrid = el('div', 'metrics-grid');
  const totalReqs = traffic.totals ? traffic.totals.requests : 0;
  const totalErrs = traffic.totals ? traffic.totals.errors : 0;
  const inFlight = traffic.totals ? traffic.totals.in_flight : 0;
  const bytesIn = traffic.totals ? traffic.totals.bytes_in : 0;
  const bytesOut = traffic.totals ? traffic.totals.bytes_out : 0;
  const errorRate = totalReqs > 0 ? (totalErrs / totalReqs * 100).toFixed(1) : '0.0';

  overviewGrid.appendChild(metricCard('Total Requests', totalReqs.toLocaleString(), '#4fc3f7'));
  overviewGrid.appendChild(metricCard('Error Rate', errorRate + '%', parseFloat(errorRate) > 5 ? '#ef5350' : '#66bb6a'));
  overviewGrid.appendChild(metricCard('In Flight', inFlight.toString(), '#ce93d8'));
  overviewGrid.appendChild(metricCard('Bandwidth In', formatBytes(bytesIn), '#ffa726'));
  overviewGrid.appendChild(metricCard('Bandwidth Out', formatBytes(bytesOut), '#4fc3f7'));
  overviewGrid.appendChild(metricCard('Sites', metrics.site_count.toString(), '#66bb6a'));
  overviewGrid.appendChild(metricCard('Total Saves', metrics.total_saves.toString(), '#90a4ae'));
  overviewGrid.appendChild(metricCard('Backups', metrics.backup_count.toString(), '#607d8b'));

  overviewSection.appendChild(overviewGrid);
  body.appendChild(overviewSection);

  // --- Upstreams ---
  const upstreamSection = el('div', 'metrics-section');
  upstreamSection.appendChild(el('div', 'section-title', 'Upstream Backends'));

  if (upstreams.error) {
    upstreamSection.appendChild(el('div', 'metrics-hint', upstreams.error));
  }

  if (upstreams.upstreams && upstreams.upstreams.length > 0) {
    const table = el('div', 'upstream-table');
    const header = el('div', 'upstream-row upstream-header');
    header.appendChild(el('span', 'upstream-cell', 'Address'));
    header.appendChild(el('span', 'upstream-cell', 'Active Reqs'));
    header.appendChild(el('span', 'upstream-cell', 'Fails'));
    header.appendChild(el('span', 'upstream-cell', 'Health'));
    table.appendChild(header);

    upstreams.upstreams.forEach(u => {
      const row = el('div', 'upstream-row');
      row.appendChild(el('span', 'upstream-cell upstream-addr', u.address));
      row.appendChild(el('span', 'upstream-cell', (u.num_requests || 0).toString()));

      const failCell = el('span', 'upstream-cell');
      failCell.textContent = (u.fails || 0).toString();
      if (u.fails > 0) failCell.style.color = '#ef5350';
      row.appendChild(failCell);

      const healthVal = traffic.upstreams_healthy ? traffic.upstreams_healthy[u.address] : undefined;
      const healthCell = el('span', 'upstream-cell');
      const badge = document.createElement('span');
      if (healthVal === 1) { badge.className = 'health-badge up'; badge.textContent = 'healthy'; }
      else if (healthVal === 0) { badge.className = 'health-badge down'; badge.textContent = 'unhealthy'; }
      else {
        badge.className = 'health-badge unknown has-tooltip';
        badge.textContent = 'n/a';
        const tooltip = el('span', 'badge-tooltip', 'No active health check. Add inside reverse_proxy { }:\n\nreverse_proxy 10.0.0.1:8080 {\n    health_uri /\n    health_interval 30s\n}');
        badge.appendChild(tooltip);
      }
      healthCell.appendChild(badge);
      row.appendChild(healthCell);

      table.appendChild(row);
    });
    upstreamSection.appendChild(table);
  } else if (!upstreams.error) {
    upstreamSection.appendChild(el('div', 'metrics-hint', 'No upstreams registered. Caddy reports upstreams only after traffic flows through reverse_proxy.'));
  }

  body.appendChild(upstreamSection);

  // --- Per-Site Traffic ---
  const sitesSection = el('div', 'metrics-section');
  sitesSection.appendChild(el('div', 'section-title', 'Per-Site Traffic'));

  if (traffic.error && !Object.keys(traffic.sites).length) {
    const hint = el('div', 'metrics-hint');
    hint.textContent = traffic.error;
    sitesSection.appendChild(hint);
  } else if (Object.keys(traffic.sites).length === 0) {
    sitesSection.appendChild(el('div', 'metrics-hint', 'No traffic recorded yet. Metrics appear after requests flow through Caddy.'));
  } else {
    const serverDomains = traffic.server_domains || {};
    const sorted = Object.entries(traffic.sites).sort((a, b) => b[1].requests - a[1].requests);
    sorted.forEach(([server, data]) => {
      const card = el('div', 'site-metric-card');

      const headerDiv = el('div', 'site-metric-header');
      const domains = serverDomains[server];
      const portMatch = domains && domains.length > 0 ? null : server;
      let titleText;
      if (domains && domains.length > 0) {
        const isHTTPS = data.bytes_out > 0 || server === 'srv0';
        titleText = (server === 'srv0' ? 'HTTPS (:443)' : server === 'srv1' ? 'HTTP (:80)' : server);
      } else {
        titleText = server;
      }
      headerDiv.appendChild(el('span', 'site-metric-name', titleText));
      if (data.error_rate > 0) {
        const errBadge = el('span', data.error_rate > 5 ? 'site-metric-err high' : 'site-metric-err low');
        errBadge.textContent = data.error_rate + '% errors';
        headerDiv.appendChild(errBadge);
      }
      card.appendChild(headerDiv);

      if (domains && domains.length > 0) {
        const domainList = el('div', 'site-metric-domains');
        domainList.textContent = domains.join(', ');
        card.appendChild(domainList);
      }

      const stats = el('div', 'site-metric-stats');
      stats.appendChild(statPill('Requests', data.requests.toLocaleString(), '#4fc3f7'));
      stats.appendChild(statPill('Avg Latency', data.avg_latency_ms + ' ms', data.avg_latency_ms > 1000 ? '#ef5350' : data.avg_latency_ms > 300 ? '#ffa726' : '#66bb6a'));
      stats.appendChild(statPill('5xx Errors', data.errors.toString(), data.errors > 0 ? '#ef5350' : '#66bb6a'));
      stats.appendChild(statPill('In', formatBytes(data.bytes_in), '#90a4ae'));
      stats.appendChild(statPill('Out', formatBytes(data.bytes_out), '#90a4ae'));
      card.appendChild(stats);

      sitesSection.appendChild(card);
    });
  }

  body.appendChild(sitesSection);

  // --- Editor Activity ---
  const activitySection = el('div', 'metrics-section');
  activitySection.appendChild(el('div', 'section-title', 'Editor Activity'));
  const actGrid = el('div', 'metrics-grid');
  actGrid.appendChild(metricCard('Saves Today', metrics.saves_today.toString(), '#ffa726'));
  actGrid.appendChild(metricCard('Total Logins', metrics.total_logins.toString(), '#ce93d8'));
  actGrid.appendChild(metricCard('Unique Users', metrics.unique_users.toString(), '#4fc3f7'));
  actGrid.appendChild(metricCard('Config Lines', metrics.config_lines.toString(), '#607d8b'));
  activitySection.appendChild(actGrid);
  if (metrics.last_modified) {
    activitySection.appendChild(el('div', 'metrics-footer', 'Last config change: ' + metrics.last_modified));
  }
  body.appendChild(activitySection);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function metricCard(label, value, color) {
  const card = el('div', 'metric-card');
  const lbl = el('div', 'metric-label', label);
  const val = el('div', 'metric-value');
  val.textContent = value;
  val.style.color = color;
  card.appendChild(lbl);
  card.appendChild(val);
  return card;
}

function statPill(label, value, color) {
  const pill = el('span', 'stat-pill');
  pill.appendChild(el('span', 'stat-pill-label', label));
  const val = el('span', 'stat-pill-value');
  val.textContent = value;
  val.style.color = color;
  pill.appendChild(val);
  return pill;
}

// --- Panels ---

window.togglePanel = function(name) {
  const panel = document.getElementById(`panel-${name}`); const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('[id^="panel-btn-"]').forEach(b => b.classList.remove('panel-active'));
  if (!isOpen) {
    panel.classList.add('open');
    const btn = document.getElementById(`panel-btn-${name}`);
    if (btn) btn.classList.add('panel-active');
    if (name==='backups') loadBackups(); if (name==='audit') loadAudit(); if (name==='status') loadStatusPanel(); if (name==='snippets') loadSnippets();
  }
};
window.closePanel = function(name) {
  document.getElementById(`panel-${name}`).classList.remove('open');
  document.querySelectorAll('[id^="panel-btn-"]').forEach(b => b.classList.remove('panel-active'));
};

let previewBackupContent = '';
async function loadBackups() {
  const res = await fetch('/api/backups'); const data = await res.json();
  document.getElementById('backup-preview').style.display = 'none'; document.getElementById('backups-list').style.display = 'block';
  const list = document.getElementById('backups-list'); list.textContent = '';
  if (!data.backups.length) { list.textContent = 'No backups yet.'; return; }
  data.backups.forEach(b => {
    const card = document.createElement('div'); card.className = 'snippet-card';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%';
    const left = document.createElement('div'); left.style.cursor = 'pointer'; left.style.flex = '1'; left.onclick = () => previewBackup(b);
    const name = document.createElement('div'); name.className = 'name'; name.textContent = b.replace('Caddyfile.','');
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = 'Click to preview';
    left.appendChild(name); left.appendChild(desc);
    const delBtn = document.createElement('button'); delBtn.className = 'btn btn-danger'; delBtn.textContent = 'Delete';
    delBtn.style.cssText = 'padding:3px 8px;font-size:10px;margin-left:8px';
    delBtn.onclick = async (e) => { e.stopPropagation(); if (!confirm(`Delete backup ${b.replace('Caddyfile.','')}?`)) return; const r = await fetch(`/api/backups/${b}`, {method:'DELETE'}); if (r.ok) loadBackups(); };
    row.appendChild(left); row.appendChild(delBtn); card.appendChild(row);
    list.appendChild(card);
  });
}
async function previewBackup(name) {
  const res = await fetch(`/api/backups/${name}`); const data = await res.json(); previewBackupContent = data.content;
  document.getElementById('backups-list').style.display = 'none'; document.getElementById('backup-preview').style.display = 'block';
  document.getElementById('preview-name').textContent = name.replace('Caddyfile.','');
  document.getElementById('preview-content').textContent = data.content;
  renderDiff(getContent(), data.content); window.showPreviewTab('diff');
}
window.showPreviewTab = function(tab) {
  document.getElementById('preview-content').style.display = tab==='preview'?'block':'none';
  document.getElementById('diff-content').style.display = tab==='diff'?'block':'none';
  document.getElementById('tab-btn-preview').classList.toggle('active', tab==='preview');
  document.getElementById('tab-btn-diff').classList.toggle('active', tab==='diff');
};
window.closePreview = function() { document.getElementById('backup-preview').style.display = 'none'; document.getElementById('backups-list').style.display = 'block'; };
window.restoreFromPreview = function() { setContent(previewBackupContent); setStatus('Backup loaded (unsaved)', 'info'); setDot('yellow'); window.closePanel('backups'); };

function renderDiff(current, backup) {
  const container = document.getElementById('diff-content'); container.textContent = '';
  const a = current.split('\n'), b = backup.split('\n');
  const ops = diffLines(a, b);
  let aLn = 1, bLn = 1;
  ops.forEach(op => {
    const d = document.createElement('div');
    if (op.type === 'equal') { d.style.cssText = 'color:#555'; d.textContent = ` ${String(aLn).padStart(3)} ${op.line}`; aLn++; bLn++; }
    else if (op.type === 'delete') { d.style.cssText = 'color:#ef5350;background:#3d1b1b'; d.textContent = `-${String(aLn).padStart(3)} ${op.line}`; aLn++; }
    else { d.style.cssText = 'color:#66bb6a;background:#1b3d1b'; d.textContent = `+${String(bLn).padStart(3)} ${op.line}`; bLn++; }
    container.appendChild(d);
  });
}

function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) { ops.unshift({type:'equal', line: a[i-1]}); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.unshift({type:'insert', line: b[j-1]}); j--; }
    else { ops.unshift({type:'delete', line: a[i-1]}); i--; }
  }
  return ops;
}

async function loadAudit() {
  const res = await fetch('/api/audit'); const data = await res.json();
  const list = document.getElementById('audit-list'); list.textContent = '';
  if (!data.entries.length) { list.textContent = 'No activity yet.'; return; }
  data.entries.forEach(e => {
    const item = document.createElement('div'); item.className = 'audit-item';
    const action = document.createElement('span'); action.className = 'action'; action.textContent = e.action;
    const user = document.createElement('span'); user.className = 'user'; user.textContent = ' ' + e.user;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = e.time + ' ' + (e.detail||'');
    item.appendChild(action); item.appendChild(user); item.appendChild(document.createElement('br')); item.appendChild(time); list.appendChild(item);
  });
}

async function loadStatusPanel() {
  const res = await fetch('/api/status'); const data = await res.json();
  const body = document.getElementById('status-body'); body.textContent = '';
  [['Caddy Version',data.caddy_version],['Config Valid',data.config_valid?'Valid':'Invalid'],['Config Path',data.config_path],['Last Modified',data.last_modified]].forEach(([label,value]) => {
    const card = document.createElement('div'); card.className = 'status-card';
    const lbl = document.createElement('label'); lbl.textContent = label;
    const val = document.createElement('div'); val.className = 'value'; val.textContent = value;
    if (label === 'Config Valid') val.style.color = data.config_valid ? '#66bb6a' : '#ef5350';
    card.appendChild(lbl); card.appendChild(val); body.appendChild(card);
  });
}

async function loadSnippets() {
  const res = await fetch('/api/snippets'); const data = await res.json();
  const list = document.getElementById('snippets-list'); list.textContent = '';
  data.snippets.forEach(s => {
    const card = document.createElement('div'); card.className = 'snippet-card'; card.onclick = () => insertSnippet(s.code);
    const name = document.createElement('div'); name.className = 'name'; name.textContent = s.name;
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = s.description;
    card.appendChild(name); card.appendChild(desc); list.appendChild(card);
  });
}
function insertSnippet(code) { const pos = editorView.state.selection.main.head; editorView.dispatch({ changes: { from: pos, insert: code } }); setDot('yellow'); window.closePanel('snippets'); }

window.doSearch = function() { const q = document.getElementById('search-input').value; if (!q) { document.getElementById('match-count').textContent = ''; return; } const m = (getContent().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'))||[]).length; document.getElementById('match-count').textContent = `${m} match${m!==1?'es':''}`; };
window.searchNext = function() { const q = document.getElementById('search-input').value; if (!q) return; const content = getContent(); const cur = editorView.state.selection.main.head; let idx = content.toLowerCase().indexOf(q.toLowerCase(), cur); if (idx < 0) idx = content.toLowerCase().indexOf(q.toLowerCase()); if (idx >= 0) { editorView.dispatch({ selection: {anchor: idx, head: idx + q.length} }); editorView.scrollPosIntoView(idx); } };

function setStatus(msg, cls) { const el = document.getElementById('status-msg'); el.textContent = msg; el.className = 'status-msg ' + (cls||''); }
function setDot(c) { document.getElementById('status-dot').className = 'status-dot ' + c; }

document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.panel').forEach(p=>p.classList.remove('open')); document.querySelectorAll('[id^="panel-btn-"]').forEach(b=>b.classList.remove('panel-active')); document.getElementById('search-bar').classList.remove('open'); } });

init();
