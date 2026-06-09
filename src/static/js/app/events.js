// Global keyboard shortcuts, CSP-safe event delegation, and app bootstrap.
// This script must load LAST: it calls init().

document.addEventListener('keydown', e => { if (e.key === 'Escape') { stopLogs(); document.querySelectorAll('.panel').forEach(p=>p.classList.remove('open')); document.querySelectorAll('[id^="panel-btn-"]').forEach(b=>b.classList.remove('panel-active')); document.getElementById('search-bar').classList.remove('open'); document.getElementById('save-diff-modal').classList.remove('open'); } });

// Cmd/Ctrl+F opens the find/replace bar (capture phase to preempt the editor).
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); window.toggleSearch(); }
}, true);

// --- Event delegation (CSP-safe: no inline handlers) ---
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-panel],[data-tab],[data-close],[data-ptab]');
  if (!t) return;
  if (t.dataset.tab) { window.switchTab(t.dataset.tab, t); return; }
  if (t.dataset.panel) { window.togglePanel(t.dataset.panel); return; }
  if (t.dataset.close) { window.closePanel(t.dataset.close); return; }
  if (t.dataset.ptab) { window.showPreviewTab(t.dataset.ptab); return; }
  switch (t.dataset.act) {
    case 'validate': return window.doValidate();
    case 'save': return window.doSave();
    case 'find': return window.toggleSearch();
    case 'search-next': return window.searchNext();
    case 'replace-one': return window.replaceOne();
    case 'replace-all': return window.replaceAll();
    case 'search-close': return window.closeSearch();
    case 'restore-preview': return window.restoreFromPreview();
    case 'rollback-preview': return window.rollbackFromPreview();
    case 'close-preview': return window.closePreview();
    case 'confirm-save': return window.resolveSaveModal(true);
    case 'cancel-save': return window.resolveSaveModal(false);
  }
});
document.getElementById('search-input').addEventListener('input', () => window.doSearch());

init();
