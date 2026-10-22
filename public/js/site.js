(() => {
  document.documentElement.classList.add('js');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  // Shelves scroll sideways; the arrows move them by most of a screen and dim at either end.
  document.querySelectorAll('.shelf').forEach((shelf) => {
    const row = shelf.querySelector('[data-shelf]');
    const paddles = [...shelf.querySelectorAll('.paddle')];
    if (!row || !paddles.length) return;
    // In right-to-left pages scrollLeft runs from 0 to negative.
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const at = Math.abs(row.scrollLeft);
      paddles[0].disabled = at < 4;
      paddles[1].disabled = at > max - 4;
      shelf.querySelector('.paddles').hidden = max < 4;
    };
    paddles.forEach((paddle) => paddle.addEventListener('click', () => {
      row.scrollBy({ left: -Number(paddle.dataset.dir) * row.clientWidth * 0.8, behavior: calm.matches ? 'auto' : 'smooth' });
    }));
    row.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    update();
  });

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
  const parts = document.querySelectorAll('.shelf, .help-card, .faq-home, main .grid > *');
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
      if (el.parentElement?.classList.contains('grid')) el.style.transitionDelay = `${(i % 3) * 60}ms`;
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
      main.removeAttribute('srcset');
      main.src = thumb.dataset.src;
      thumbs.forEach((t) => { t.classList.toggle('current', t === thumb); t.setAttribute('aria-pressed', String(t === thumb)); });
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

  // The phone menu closes on Escape.
  const menu = document.querySelector('.gnav-menu');
  menu?.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });

  // Sorting applies as soon as it is chosen.
  document.querySelector('#sort')?.addEventListener('change', (event) => event.target.form.submit());

  // Toasts close by hand too.
  document.addEventListener('click', (event) => { if (event.target.closest('.toast-close')) event.target.closest('.toast').remove(); });

  // Adding to the bag stays on the page: the count updates and a toast confirms. Without script the form posts as before.
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
      count.hidden = !data.count;
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
    city.addEventListener('change', () => { const days = city.selectedOptions[0]?.dataset.days; note.textContent = days ? `يوصلك ${days}` : ''; });
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

  // The order button says it is working and cannot be pressed twice.
  document.querySelectorAll('[data-busy]').forEach((button) => {
    button.form?.addEventListener('submit', () => {
      setTimeout(() => { button.disabled = true; button.textContent = button.dataset.busy; });
    });
  });

  // The chat button steps aside at the footer, where its links already are.
  const footer = document.querySelector('.footer');
  if (footer && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => document.querySelector('.chat-fab')?.classList.toggle('away', e.isIntersecting)).observe(footer);
  }

  // Copy the order number.
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'انسخ ✓'; } catch { /* clipboard blocked */ }
    });
  });
})();
