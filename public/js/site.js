(() => {
  // Sections rise in as they enter the screen. Content is visible without script; with reduced motion nothing moves.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = document.querySelectorAll('main .shelf, main .souq-band, main .steps-band, main .help-band, main .product, main .cart-layout');
  if (!calm && 'IntersectionObserver' in window && parts.length) {
    document.documentElement.classList.add('reveal-ready');
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    parts.forEach((el) => seen.observe(el));
    // Inside a section, cards follow one another by a beat.
    document.querySelectorAll('main .grid, main .cat-grid, main .how, main .souq-strip').forEach((group) => {
      [...group.children].forEach((child, i) => { child.style.transitionDelay = `${120 + (i % 4) * 70}ms`; });
    });
  }

  // Product thumbnails swap the main picture.
  const main = document.querySelector('.gallery .arch img');
  document.querySelectorAll('.thumbs .thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      if (!main) return;
      main.src = thumb.dataset.src;
      document.querySelectorAll('.thumbs .thumb').forEach((t) => t.classList.toggle('current', t === thumb));
    });
  });
})();
