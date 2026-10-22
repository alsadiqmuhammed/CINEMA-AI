(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia('(min-width: 1001px)');

  // The pinned scenes: the name holds still while the reel passes through its frame,
  // and the category cards cross the held photograph. Progress is how far the tall section has scrolled.
  const poster = document.querySelector('.poster');
  const track = poster?.querySelector('.reel-track');
  const reel = poster?.querySelector('.reel');
  const showcase = document.querySelector('.showcase');
  const cards = showcase?.querySelector('.cards');
  const progress = (section) => {
    const box = section.getBoundingClientRect();
    const run = box.height - innerHeight;
    return run > 0 ? Math.min(1, Math.max(0, -box.top / run)) : 0;
  };
  let queued = false;
  const paint = () => {
    queued = false;
    const live = wide.matches && !calm.matches;
    if (track && reel) {
      const travel = Math.max(0, track.scrollHeight - reel.clientHeight);
      track.style.transform = live ? `translateY(${-progress(poster) * travel}px)` : '';
    }
    if (cards) {
      // Right to left: the row starts at the right edge and slides right to bring the rest in.
      const travel = Math.max(0, cards.scrollWidth - innerWidth);
      cards.style.transform = live ? `translateX(${progress(showcase) * travel}px)` : '';
    }
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  if (track || cards) {
    addEventListener('scroll', ask, { passive: true });
    addEventListener('resize', ask);
    wide.addEventListener('change', ask);
    calm.addEventListener('change', ask);
    paint();
  }

  // The new arrivals: the row nearest the middle of the screen (or the one under the pointer) shows its picture.
  const picks = [...document.querySelectorAll('.pick')];
  const images = [...document.querySelectorAll('.pick-image')];
  const choose = (id) => {
    picks.forEach((p) => p.classList.toggle('active', p.dataset.pick === id));
    images.forEach((img) => img.classList.toggle('active', img.dataset.pick === id));
  };
  picks.forEach((pick) => {
    pick.addEventListener('mouseenter', () => choose(pick.dataset.pick));
    pick.addEventListener('focusin', () => choose(pick.dataset.pick));
  });
  if (picks.length && 'IntersectionObserver' in window) {
    const middle = new IntersectionObserver((entries) => {
      const hit = entries.find((e) => e.isIntersecting);
      if (hit) choose(hit.target.dataset.pick);
    }, { rootMargin: '-45% 0px -45% 0px' });
    picks.forEach((p) => middle.observe(p));
  }

  // The live thing: delivery time and fee for the chosen governorate.
  const estimate = document.querySelector('[data-estimate]');
  if (estimate) {
    const select = estimate.querySelector('select');
    const out = estimate.querySelector('output');
    const show = () => {
      const days = select.selectedOptions[0]?.dataset.days ?? '';
      out.replaceChildren(Object.assign(document.createElement('b'), { textContent: days }), ' ', estimate.dataset.fee);
    };
    select.addEventListener('change', show);
    show();
  }

  // Quiet entrances for what sits below the first screen. Without script, or with reduced motion, it is simply there.
  const parts = document.querySelectorAll('.picklist-body, .estimate > *, .band, main .grid > *, .shelf');
  if (!calm.matches && 'IntersectionObserver' in window && parts.length) {
    document.documentElement.classList.add('reveal-ready');
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    parts.forEach((el, i) => {
      el.classList.add('rise');
      if (el.parentElement?.classList.contains('grid')) el.style.transitionDelay = `${(i % 4) * 60}ms`;
      seen.observe(el);
    });
  }

  // Product thumbnails swap the main picture.
  const main = document.querySelector('.gallery .frame img');
  document.querySelectorAll('.thumbs .thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      if (!main) return;
      main.src = thumb.dataset.src;
      document.querySelectorAll('.thumbs .thumb').forEach((t) => t.classList.toggle('current', t === thumb));
    });
  });
})();
