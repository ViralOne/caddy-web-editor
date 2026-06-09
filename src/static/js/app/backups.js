// Backups panel: list, preview, diff, load-to-editor, and rollback+reload.
let previewBackupContent = '';
let currentPreviewName = '';

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
  const res = await fetch(`/api/backups/${name}`); const data = await res.json(); previewBackupContent = data.content; currentPreviewName = name;
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
window.rollbackFromPreview = async function() {
  if (!currentPreviewName) return;
  const label = currentPreviewName.replace('Caddyfile.', '');
  if (!confirm(`Restore backup ${label} AND reload Caddy now?\n\nThis replaces the live config immediately.`)) return;
  setStatus('Restoring + reloading...', 'info'); setDot('yellow');
  const res = await fetch(`/api/backups/${currentPreviewName}/restore`, { method: 'POST', headers: {'Content-Type': 'application/json'} });
  const data = await res.json();
  if (data.ok) {
    const restored = data.content || previewBackupContent;
    setContent(restored); originalContent = restored; if (data.version) currentVersion = data.version;
    setStatus(data.message, 'ok'); setDot('green');
    lastSavedTime = Date.now(); lastSavedBy = document.getElementById('user-info').textContent; updateLastSaved();
    window.closePanel('backups');
  } else {
    setStatus(data.message || 'Restore failed', 'err'); setDot('red');
    alert('Restore failed: ' + (data.message || 'unknown error'));
  }
};
