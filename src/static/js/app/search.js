// Find / replace bar.
window.doSearch = function() { const q = document.getElementById('search-input').value; if (!q) { document.getElementById('match-count').textContent = ''; return; } const m = (getContent().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'))||[]).length; document.getElementById('match-count').textContent = `${m} match${m!==1?'es':''}`; };
window.searchNext = function() { const q = document.getElementById('search-input').value; if (!q) return; const content = getContent(); const cur = editorView.state.selection.main.head; let idx = content.toLowerCase().indexOf(q.toLowerCase(), cur); if (idx < 0) idx = content.toLowerCase().indexOf(q.toLowerCase()); if (idx >= 0) { editorView.dispatch({ selection: {anchor: idx, head: idx + q.length} }); editorView.scrollPosIntoView(idx); } };
window.toggleSearch = function() { const b = document.getElementById('search-bar'); b.classList.toggle('open'); if (b.classList.contains('open')) document.getElementById('search-input').focus(); };
window.closeSearch = function() { document.getElementById('search-bar').classList.remove('open'); };
window.replaceOne = function() {
  const q = document.getElementById('search-input').value; if (!q) return;
  const r = document.getElementById('replace-input').value;
  const sel = editorView.state.selection.main;
  const selText = getContent().slice(sel.from, sel.to);
  if (sel.from !== sel.to && selText.toLowerCase() === q.toLowerCase()) {
    editorView.dispatch({ changes: { from: sel.from, to: sel.to, insert: r }, selection: { anchor: sel.from + r.length } });
    setDot('yellow');
  }
  window.searchNext();
  window.doSearch();
};
window.replaceAll = function() {
  const q = document.getElementById('search-input').value; if (!q) return;
  const r = document.getElementById('replace-input').value;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
  const content = getContent();
  const next = content.replace(re, r);
  if (next !== content) { setContent(next); setDot('yellow'); setStatus('Replaced all matches', 'info'); }
  window.doSearch();
};
