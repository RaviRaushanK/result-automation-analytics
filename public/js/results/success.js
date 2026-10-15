'use strict';
(() => {
  const button = document.getElementById('replayImportCelebration');
  const header = document.querySelector('.import-success-header');
  if (!button || !header) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function syncMotion() { button.hidden = motion.matches; }
  syncMotion();
  motion.addEventListener('change', syncMotion);
  button.addEventListener('click', () => {
    if (motion.matches) return;
    header.getAnimations({ subtree: true }).forEach(animation => {
      if (['import-confetti', 'import-confirm', 'import-check'].includes(animation.animationName)) {
        animation.cancel();
        animation.play();
      }
    });
  });
})();
