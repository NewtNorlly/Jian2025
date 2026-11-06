(() => {
  const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
  const bad = [];
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const h = decodeURIComponent(a.getAttribute('href').slice(1));
    if (h && !ids.has(h)) bad.push(h);
  });
  const dup = {};
  [...document.querySelectorAll('[id]')].forEach((e) => (dup[e.id] = (dup[e.id] || 0) + 1));
  const dups = Object.entries(dup).filter(([, v]) => v > 1);
  return JSON.stringify({
    brokenCount: bad.length,
    broken: [...new Set(bad)].slice(0, 8),
    dupIds: dups.slice(0, 5),
    visibleH1: document.querySelectorAll('h1:not(.sr-only)').length,
    ext: document.querySelectorAll('a[target="_blank"]').length,
    tables: document.querySelectorAll('table').length,
    figures: document.querySelectorAll('.plate').length,
    h2: document.querySelectorAll('.ch-title').length,
  });
})();
