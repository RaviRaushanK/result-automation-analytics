'use strict';
(() => {
  const button = document.getElementById('replayImportCelebration');
  const header = document.querySelector('.import-success-header');
  if (!button || !header) return;
  const celebration = header.querySelector?.('.import-celebration');
  const main = header.closest?.('.main-content');
  function syncBounds() {
    if (!main || !celebration) return;
    const left = Math.max(0, Math.min(window.innerWidth, main.getBoundingClientRect().left));
    celebration.style.setProperty('--celebration-left', left + 'px');
  }
  if (main && celebration) {
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(main);
    window.addEventListener('resize', syncBounds);
    main.addEventListener('transitionend', syncBounds);
  }
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function syncMotion() { button.hidden = motion.matches; }
  syncMotion();
  motion.addEventListener('change', syncMotion);
  button.addEventListener('click', () => {
    if (motion.matches) return;
    syncBounds();
    header.getAnimations({ subtree: true }).forEach(animation => {
      if (['import-confetti', 'import-confirm', 'import-check'].includes(animation.animationName)) {
        animation.cancel();
        animation.play();
      }
    });
  });
})();
