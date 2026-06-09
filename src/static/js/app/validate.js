// Validate / Save flow, the pre-save diff modal, and warnings UI.

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

  // Pre-save live diff: show editor (new) vs the config currently on disk (current).
  let live = originalContent;
  try { const lr = await fetch('/api/caddyfile'); const ld = await lr.json(); live = ld.content; } catch (e) {}
  renderDiffInto(document.getElementById('save-diff-content'), live, content);
  const proceed = await openSaveModal();
  if (!proceed) { setStatus('Save cancelled', 'info'); return; }

  setStatus('Saving...', 'info');
  const res = await fetch('/api/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content, version: currentVersion}) });
  if (res.status === 409) {
    const d = await res.json();
    setStatus('Save blocked: file changed on disk', 'err'); setDot('red');
    if (confirm((d.message || 'The config changed on disk.') + '\n\nReload the latest version now? (Your unsaved edits will be lost.)')) { await loadCaddyfile(); }
    return;
  }
  const data = await res.json();
  if (data.ok) { if (data.content) setContent(data.content); originalContent = data.content || content; if (data.version) currentVersion = data.version; setStatus(data.message, 'ok'); setDot('green'); lastSavedTime = Date.now(); lastSavedBy = document.getElementById('user-info').textContent; updateLastSaved(); hideWarnings(); }
  else { setStatus(data.message, 'err'); setDot('red'); }
};

// --- Save diff modal (promise-based confirm) ---
let _saveResolver = null;
function openSaveModal() {
  document.getElementById('save-diff-modal').classList.add('open');
  return new Promise(resolve => { _saveResolver = resolve; });
}
window.resolveSaveModal = function(value) {
  document.getElementById('save-diff-modal').classList.remove('open');
  if (_saveResolver) { _saveResolver(value); _saveResolver = null; }
};

function showWarnings(warnings) {
  const el = document.getElementById('warnings'); el.textContent = '';
  warnings.forEach(w => { const div = document.createElement('div'); div.textContent = '⚠ ' + w; el.appendChild(div); });
  el.classList.add('show');
}
function hideWarnings() { document.getElementById('warnings').classList.remove('show'); }
