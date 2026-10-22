(() => {
  document.documentElement.classList.add('js');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia('(min-width: 1001px)');

  // The pinned scenes: the name holds still while the reel passes through its frame,
  // and the category cards cross the held photograph. Progress is how far the tall section has scrolled.
  const poster = document.querySelector('.poster');
  const track = poster?.querySelector('.reel-track');
  const reel = poster?.querySelector('.reel');
  const showcase = document.querySelector('.showcase');
  const cards = showcase?.querySelector('.cards');
  const bar = showcase?.querySelector('.showcase-progress span');
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
      if (bar) bar.style.scale = `${live ? progress(showcase) : 0} 1`;
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
      out.replaceChildren(Object.assign(document.createElement('b'), { textContent: days }), Object.assign(document.createElement('span'), { textContent: `التوصيل ${estimate.dataset.fee}` }));
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
  const thumbs = [...document.querySelectorAll('.thumbs .thumb')];
  thumbs.forEach((thumb, i) => {
    thumb.setAttribute('aria-pressed', String(i === 0));
    thumb.addEventListener('click', () => {
      if (!main) return;
      main.src = thumb.dataset.src;
      thumbs.forEach((t) => { t.classList.toggle('current', t === thumb); t.setAttribute('aria-pressed', String(t === thumb)); });
    });
  });

  // On the home page the name is already on the poster; the bar's copy waits until the poster has passed.
  const wordmark = document.querySelector('.wordmark');
  const posterTitle = document.querySelector('.poster-title');
  // On phones the header folds its links away while reading down, and brings them back on the way up.
  const header = document.querySelector('.bar');
  let lastY = scrollY;
  addEventListener('scroll', () => {
    header?.classList.toggle('tucked', scrollY > 160 && scrollY > lastY);
    lastY = scrollY;
  }, { passive: true });

  if (wordmark && posterTitle && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => wordmark.classList.toggle('hushed', e.isIntersecting)).observe(posterTitle);
  }

  // A tab into a pinned row brings its section into view.
  document.querySelectorAll('.cat-card, .reel-frame').forEach((card) => {
    card.addEventListener('focus', () => {
      const section = card.closest('.poster, .showcase');
      if (!section || !wide.matches || calm.matches) return;
      const row = [...card.parentElement.children];
      const share = row.indexOf(card) / Math.max(1, row.length - 1);
      scrollTo({ top: section.offsetTop + share * (section.offsetHeight - innerHeight) });
    });
  });

  // The header search folds into its button on small screens: the first tap opens it.
  const barSearch = document.querySelector('.bar-search');
  if (barSearch) {
    const field = barSearch.querySelector('input');
    barSearch.addEventListener('submit', (event) => {
      if (field.value.trim()) return;
      event.preventDefault();
      barSearch.classList.add('open');
      field.focus();
    });
    field.addEventListener('blur', () => { if (!field.value.trim()) barSearch.classList.remove('open'); });
  }

  // Sorting applies as soon as it is chosen.
  document.querySelector('#sort')?.addEventListener('change', (event) => event.target.form.submit());

  // Toasts close by hand too.
  const closeToasts = (event) => { if (event.target.closest('.toast-close')) event.target.closest('.toast').remove(); };
  document.addEventListener('click', closeToasts);

  // Adding to the cart stays on the page: the count updates and a toast confirms. Without script the form posts as before.
  const count = document.querySelector('#cart-count');
  const cartButton = document.querySelector('.cart-button');
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!form.matches('.quick-add, .buy-form') || !window.fetch) return;
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { 'X-Requested-With': 'fetch' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      count.textContent = data.count;
      cartButton.setAttribute('aria-label', `السلة، فيها ${data.count} منتج`);
      cartButton.classList.remove('tick'); void cartButton.offsetWidth; cartButton.classList.add('tick');
      document.querySelector('.toast')?.remove();
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.innerHTML = '<span>انضاف للسلة</span><a href="/cart">شوف السلة</a><a href="/checkout" class="toast-go">كمّل الطلب</a><button type="button" class="toast-close" aria-label="سد التنبيه">×</button>';
      document.body.append(toast);
    } catch {
      form.submit();
    } finally {
      button.disabled = false;
    }
  });

  // Checkout: the delivery time for the chosen governorate, and the details remembered on this device for next time.
  const city = document.querySelector('[data-days-for]');
  if (city) {
    const note = document.getElementById(city.dataset.daysFor);
    const say = () => { const days = city.selectedOptions[0]?.dataset.days; note.textContent = days ? `يوصلك ${days}` : ''; };
    city.addEventListener('change', say);
  }
  const remembered = document.querySelector('form[data-remember]');
  if (remembered) {
    const KEY = 'soug-checkout';
    const fields = ['name', 'phone', 'city', 'address'];
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const name of fields) {
        const el = remembered.elements[name];
        if (el && !el.value && saved[name]) el.value = saved[name];
      }
      city?.dispatchEvent(new Event('change'));
    } catch { /* storage blocked: the form simply starts empty */ }
    remembered.addEventListener('submit', () => {
      try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(fields.map((n) => [n, remembered.elements[n]?.value ?? ''])))); } catch { /* not saved, nothing lost */ }
    });
  }

  // Copy the order number.
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'انسخ ✓'; } catch { /* clipboard blocked */ }
    });
  });
})();
