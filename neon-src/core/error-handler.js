
window.addEventListener('error', (e) => {
  const el = document.getElementById('loading');
  if (el){ el.style.color='#ff6b6b'; el.textContent='⚠ '+(e.message||'script error')+(e.lineno?'  (line '+e.lineno+')':''); }
});
window.addEventListener('unhandledrejection', (e) => {
  const message=String(e.reason?.message||e.reason||'');
  if(/message channel closed|asynchronous response/i.test(message))e.preventDefault();
});
