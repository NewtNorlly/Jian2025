/* ==========================================================================
   Jian2025 · 阅读定位脚本
   只做三件事：进度线、当前章、右缘刻度。不劫持滚动，不做动画。
   ========================================================================== */
(function () {
  'use strict';

  var bar = document.getElementById('progressBar');
  var nowEl = document.getElementById('nowChapter');
  var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapter'));
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumb'));

  if (!bar || !chapters.length) return;

  var byKey = {};
  thumbs.forEach(function (t) {
    byKey[t.getAttribute('data-target')] = t;
  });

  var currentKey = null;
  var ticking = false;

  function labelOf(sec) {
    var tit = sec.querySelector('.ch-title');
    if (!tit) return '';
    return tit.textContent.replace('§', '').trim();
  }

  function update() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(1, Math.max(0, y / h)) : 0;
    bar.style.width = (p * 100).toFixed(2) + '%';

    var probe = y + window.innerHeight * 0.35;
    var active = chapters[0];
    var lo = 0;
    var hi = chapters.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (chapters[mid].offsetTop <= probe) {
        active = chapters[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    var key = active ? active.id : null;
    if (key && key !== currentKey) {
      currentKey = key;
      if (nowEl) nowEl.textContent = labelOf(active);
      for (var i = 0; i < thumbs.length; i++) {
        thumbs[i].classList.toggle('is-active', thumbs[i] === byKey[key]);
      }
    }
  }

  window.addEventListener(
    'scroll',
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  window.addEventListener('resize', update);
  update();
})();
