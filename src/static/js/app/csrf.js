// CSRF: attach the session token to every state-changing request.
// Must load before any other script that issues a fetch.
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    opts.headers = Object.assign({}, opts.headers, { 'X-CSRF-Token': CSRF_TOKEN });
  }
  return _origFetch(url, opts);
};
