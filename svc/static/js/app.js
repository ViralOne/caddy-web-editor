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
  if (name === 'sites') loadSites();
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

async function loadSites() {
  const res = await fetch('/api/sites'); const data = await res.json();
  const list = document.getElementById('sites-list'); list.textContent = '';
  if (!data.sites.length) { list.textContent = 'No sites found.'; return; }
  const header = document.createElement('div'); header.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;gap:8px';
  const checkAllBtn = document.createElement('button'); checkAllBtn.className = 'btn btn-secondary'; checkAllBtn.textContent = 'Check All'; checkAllBtn.onclick = () => checkAllHealth(data.sites); header.appendChild(checkAllBtn);
  const legend = document.createElement('span'); legend.style.cssText = 'font-size:10px;color:#607d8b'; legend.textContent = 'Green=OK | Orange=Auth required | Red=Down'; header.appendChild(legend);
  list.appendChild(header);
  data.sites.forEach(s => {
    const card = document.createElement('div'); card.className = 'site-card';
    const domainEl = document.createElement('div'); domainEl.className = 'domain'; domainEl.textContent = s.domain; card.appendChild(domainEl);
    const backend = document.createElement('div'); backend.className = 'backend'; backend.textContent = s.backend || '(no reverse_proxy)'; card.appendChild(backend);
    const actions = document.createElement('div'); actions.className = 'actions';
    const btn = document.createElement('button'); btn.className = 'btn btn-secondary'; btn.textContent = 'Check'; btn.onclick = () => checkHealth(s.domain, btn); actions.appendChild(btn);
    const badge = document.createElement('span'); badge.className = 'health-badge unknown'; badge.id = `health-${s.domain.replace(/\./g,'-')}`; badge.textContent = '?'; actions.appendChild(badge);
    const removeBtn = document.createElement('button'); removeBtn.className = 'btn btn-danger'; removeBtn.textContent = 'Remove'; removeBtn.onclick = () => removeSite(s.domain); actions.appendChild(removeBtn);
    card.appendChild(actions);
    const hint = document.createElement('div'); hint.className = 'health-hint'; hint.id = `hint-${s.domain.replace(/\./g,'-')}`; card.appendChild(hint);
    list.appendChild(card);
  });
}

function removeSite(domain) {
  if (!confirm(`Remove "${domain}"?\nUnsaved until you click Save & Reload.`)) return;
  const lines = getContent().split('\n');
  let startIdx = -1, braceDepth = 0, endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (startIdx === -1) { if (stripped.startsWith(domain) && stripped.endsWith('{')) { startIdx = i; braceDepth = 1; } }
    else { braceDepth += (stripped.match(/\{/g)||[]).length; braceDepth -= (stripped.match(/\}/g)||[]).length; if (braceDepth <= 0) { endIdx = i; break; } }
  }
  if (startIdx === -1) { alert('Could not find site block.'); return; }
  lines.splice(startIdx, endIdx - startIdx + 1);
  if (lines[startIdx] === '') lines.splice(startIdx, 1);
  setContent(lines.join('\n')); setDot('yellow'); setStatus(`Removed ${domain} (unsaved)`, 'info'); loadSites();
}

async function checkHealth(domain, btn) {
  btn.textContent = '...';
  const res = await fetch('/api/health-check', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: domain}) });
  const data = await res.json(); btn.textContent = 'Check';
  const badge = document.getElementById(`health-${domain.replace(/\./g,'-')}`);
  const hint = document.getElementById(`hint-${domain.replace(/\./g,'-')}`);
  const ms = Math.round((data.time||0)*1000);
  if (!data.ok || data.code === 0) { badge.className = 'health-badge down'; badge.textContent = 'unreachable'; hint.textContent = data.error || 'Connection failed'; }
  else if (data.code >= 200 && data.code < 400) { badge.className = 'health-badge up'; badge.textContent = `${data.code} (${ms}ms)`; hint.textContent = ''; }
  else if (data.code === 401 || data.code === 403) { badge.className = 'health-badge auth'; badge.textContent = `${data.code} (${ms}ms)`; hint.textContent = 'Reachable — app requires authentication'; }
  else if (data.code >= 500) { badge.className = 'health-badge down'; badge.textContent = `${data.code} (${ms}ms)`; hint.textContent = 'Server error'; }
  else { badge.className = 'health-badge auth'; badge.textContent = `${data.code} (${ms}ms)`; hint.textContent = 'Unexpected status'; }
}

async function checkAllHealth(sites) { for (const s of sites) { const btn = document.querySelector(`#health-${s.domain.replace(/\./g,'-')}`).parentElement.querySelector('.btn-secondary'); await checkHealth(s.domain, btn); } }

window.addSite = function() {
  const domain = document.getElementById('new-domain').value.trim();
  const backend = document.getElementById('new-backend').value.trim();
  if (!domain || !backend) { alert('Fill in domain and backend'); return; }
  setContent(getContent() + `\n${domain} {\n    reverse_proxy ${backend}\n}\n`);
  setDot('yellow'); setStatus(`Added ${domain} (unsaved)`, 'info');
  document.getElementById('new-domain').value = ''; document.getElementById('new-backend').value = '';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-editor').classList.add('active'); document.querySelectorAll('.tab')[0].classList.add('active');
};

window.togglePanel = function(name) {
  const panel = document.getElementById(`panel-${name}`); const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('[id^="panel-btn-"]').forEach(b => b.classList.remove('panel-active'));
  if (!isOpen) {
    panel.classList.add('open');
    const btn = document.getElementById(`panel-btn-${name}`);
    if (btn) btn.classList.add('panel-active');
    if (name==='backups') loadBackups(); if (name==='audit') loadAudit(); if (name==='status') loadStatusPanel(); if (name==='snippets') loadSnippets(); if (name==='ssl') loadSSL();
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

// SSL panel
async function loadSSL() {
  const body = document.getElementById('ssl-body'); body.textContent = 'Checking certificates...';
  const res = await fetch('/api/ssl'); const data = await res.json();
  body.textContent = '';
  if (!data.certs.length) { body.textContent = 'No domains found in Caddyfile.'; return; }
  data.certs.forEach(c => {
    const card = document.createElement('div'); card.className = 'status-card';
    card.style.borderLeft = `3px solid ${c.status === 'ok' ? '#66bb6a' : c.status === 'warning' ? '#ffa726' : '#ef5350'}`;
    const domain = document.createElement('div'); domain.style.cssText = 'font-weight:600;color:#4fc3f7;font-size:12px'; domain.textContent = c.domain;
    card.appendChild(domain);
    if (c.valid) {
      const info = document.createElement('div'); info.className = 'value'; info.style.fontSize = '11px';
      info.textContent = `Issuer: ${c.issuer} | Expires: ${c.expires.split('T')[0]} (${c.days_left} days)`;
      card.appendChild(info);
    } else {
      const err = document.createElement('div'); err.className = 'value'; err.style.cssText = 'font-size:11px;color:#ef5350';
      err.textContent = c.error || 'Could not check certificate';
      card.appendChild(err);
    }
    body.appendChild(card);
  });
}

// Metrics tab
async function loadMetrics() {
  const body = document.getElementById('metrics-body'); body.textContent = 'Loading...';
  const res = await fetch('/api/metrics'); const data = await res.json();
  body.textContent = '';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px';

  const cards = [
    ['Sites', data.site_count, '#4fc3f7'],
    ['Total Saves', data.total_saves, '#66bb6a'],
    ['Saves Today', data.saves_today, '#ffa726'],
    ['Total Logins', data.total_logins, '#ce93d8'],
    ['Unique Users', data.unique_users, '#4fc3f7'],
    ['Backups', data.backup_count, '#90a4ae'],
    ['Config Lines', data.config_lines, '#607d8b'],
  ];

  cards.forEach(([label, value, color]) => {
    const card = document.createElement('div'); card.className = 'status-card';
    card.style.textAlign = 'center';
    const val = document.createElement('div'); val.style.cssText = `font-size:28px;font-weight:700;color:${color};margin:8px 0`;
    val.textContent = value;
    const lbl = document.createElement('label'); lbl.textContent = label;
    card.appendChild(lbl); card.appendChild(val);
    grid.appendChild(card);
  });
  body.appendChild(grid);

  if (data.last_modified) {
    const footer = document.createElement('div'); footer.style.cssText = 'font-size:11px;color:#546e7a';
    footer.textContent = `Last config change: ${data.last_modified}`;
    body.appendChild(footer);
  }
}

init();
