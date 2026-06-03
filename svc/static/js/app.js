const { basicSetup, EditorView, EditorState, keymap, oneDark, StreamLanguage } = window.CM;

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
        keymap.of([{ key: 'Mod-s', run: () => { doSave(); return true; } }]),
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
};

window.doValidate = async function() {
  setStatus('Validating...', 'info'); hideWarnings();
  const res = await fetch('/api/validate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: getContent()}) });
  const data = await res.json();
  if (data.valid && !data.warnings.length) { setStatus('Valid config', 'ok'); setDot('green'); }
  else if (data.valid && data.warnings.length) { setStatus('Valid with warnings', 'ok'); setDot('yellow'); showWarnings(data.warnings); }
  else { setStatus(data.message, 'err'); setDot('red'); }
};

window.doSave = async function() {
  setStatus('Validating before save...', 'info');
  const content = getContent();
  const valRes = await fetch('/api/validate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content}) });
  const valData = await valRes.json();
  if (!valData.valid) { setStatus(valData.message, 'err'); setDot('red'); alert('Cannot save: config is invalid.\n\n' + valData.message); return; }
  if (valData.warnings && valData.warnings.length) { showWarnings(valData.warnings); setDot('red'); setStatus('Fix warnings before saving', 'err'); alert('Cannot save: fix warnings first.\n\n' + valData.warnings.join('\n')); return; }
  if (!confirm('Config is valid. Save and reload Caddy?')) return;
  setStatus('Saving...', 'info');
  const res = await fetch('/api/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content}) });
  const data = await res.json();
  if (data.ok) { setStatus(data.message, 'ok'); setDot('green'); originalContent = content; lastSavedTime = Date.now(); lastSavedBy = document.getElementById('user-info').textContent; updateLastSaved(); hideWarnings(); }
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
  if (!isOpen) { panel.classList.add('open'); if (name==='backups') loadBackups(); if (name==='audit') loadAudit(); if (name==='status') loadStatusPanel(); if (name==='snippets') loadSnippets(); }
};
window.closePanel = function(name) { document.getElementById(`panel-${name}`).classList.remove('open'); };

let previewBackupContent = '';
async function loadBackups() {
  const res = await fetch('/api/backups'); const data = await res.json();
  document.getElementById('backup-preview').style.display = 'none'; document.getElementById('backups-list').style.display = 'block';
  const list = document.getElementById('backups-list'); list.textContent = '';
  if (!data.backups.length) { list.textContent = 'No backups yet.'; return; }
  data.backups.forEach(b => {
    const card = document.createElement('div'); card.className = 'snippet-card'; card.onclick = () => previewBackup(b);
    const name = document.createElement('div'); name.className = 'name'; name.textContent = b.replace('Caddyfile.','');
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = 'Click to preview';
    card.appendChild(name); card.appendChild(desc); list.appendChild(card);
  });
}
async function previewBackup(name) {
  const res = await fetch(`/api/backups/${name}`); const data = await res.json(); previewBackupContent = data.content;
  document.getElementById('backups-list').style.display = 'none'; document.getElementById('backup-preview').style.display = 'block';
  document.getElementById('preview-name').textContent = name.replace('Caddyfile.','');
  document.getElementById('preview-content').textContent = data.content;
  renderDiff(getContent(), data.content); window.showPreviewTab('diff');
}
window.showPreviewTab = function(tab) { document.getElementById('preview-content').style.display = tab==='preview'?'block':'none'; document.getElementById('diff-content').style.display = tab==='diff'?'block':'none'; };
window.closePreview = function() { document.getElementById('backup-preview').style.display = 'none'; document.getElementById('backups-list').style.display = 'block'; };
window.restoreFromPreview = function() { setContent(previewBackupContent); setStatus('Backup loaded (unsaved)', 'info'); setDot('yellow'); window.closePanel('backups'); };

function renderDiff(current, backup) {
  const container = document.getElementById('diff-content'); container.textContent = '';
  const cl = current.split('\n'), bl = backup.split('\n'), max = Math.max(cl.length, bl.length);
  for (let i = 0; i < max; i++) {
    const cur = cl[i], bak = bl[i], ln = String(i+1).padStart(3,' ');
    if (cur === undefined) { const d = document.createElement('div'); d.style.cssText='color:#66bb6a;background:#1b3d1b'; d.textContent=`+${ln} ${bak}`; container.appendChild(d); }
    else if (bak === undefined) { const d = document.createElement('div'); d.style.cssText='color:#ef5350;background:#3d1b1b'; d.textContent=`-${ln} ${cur}`; container.appendChild(d); }
    else if (cur !== bak) { const r = document.createElement('div'); r.style.cssText='color:#ef5350;background:#3d1b1b'; r.textContent=`-${ln} ${cur}`; container.appendChild(r); const a = document.createElement('div'); a.style.cssText='color:#66bb6a;background:#1b3d1b'; a.textContent=`+${ln} ${bak}`; container.appendChild(a); }
    else { const d = document.createElement('div'); d.style.cssText='color:#555'; d.textContent=` ${ln} ${cur}`; container.appendChild(d); }
  }
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

document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.panel').forEach(p=>p.classList.remove('open')); document.getElementById('search-bar').classList.remove('open'); } });

init();
