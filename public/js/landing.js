document.addEventListener('DOMContentLoaded', function () {
  // Trigger CSS animations after DOM is ready
  const bg = document.querySelector('.landing-bg');
  if (bg) {
    bg.classList.add('animate');
  }
});