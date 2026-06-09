// Line-based diff rendering (used by the backups preview and the save modal).
function renderDiff(current, backup) {
  renderDiffInto(document.getElementById('diff-content'), current, backup);
}

function renderDiffInto(container, oldText, newText) {
  container.textContent = '';
  const a = oldText.split('\n'), b = newText.split('\n');
  const ops = diffLines(a, b);
  let aLn = 1, bLn = 1, changes = 0;
  ops.forEach(op => {
    const d = document.createElement('div');
    if (op.type === 'equal') { d.style.cssText = 'color:#555'; d.textContent = ` ${String(aLn).padStart(3)} ${op.line}`; aLn++; bLn++; }
    else if (op.type === 'delete') { d.style.cssText = 'color:#ef5350;background:#3d1b1b'; d.textContent = `-${String(aLn).padStart(3)} ${op.line}`; aLn++; changes++; }
    else { d.style.cssText = 'color:#66bb6a;background:#1b3d1b'; d.textContent = `+${String(bLn).padStart(3)} ${op.line}`; bLn++; changes++; }
    container.appendChild(d);
  });
  if (changes === 0) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#8b949e;font-style:italic';
    d.textContent = '(no differences)';
    container.appendChild(d);
  }
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
