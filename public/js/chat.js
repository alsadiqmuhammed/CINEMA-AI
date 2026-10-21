(() => {
  const root = document.getElementById('chat-root');
  if (!root) return;
  const storeName = document.querySelector('.brand')?.textContent.trim() || 'المتجر';

  root.innerHTML = `
    <button class="chat-fab" type="button" aria-expanded="false" aria-controls="chat-panel">
      <span class="dot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg></span>
      <span class="label">تحتاج مساعدة؟</span>
    </button>
    <section class="chat-panel" id="chat-panel" role="dialog" aria-label="المحادثة مع المساعد">
      <div class="chat-head"><div><strong></strong><small>يجاوبك على المنتجات والطلبات</small></div><button type="button" aria-label="إغلاق المحادثة">×</button></div>
      <div class="chat-log" aria-live="polite"></div>
      <p class="chat-note" hidden></p>
      <form class="chat-form"><input name="message" autocomplete="off" maxlength="1000" placeholder="اكتب رسالتك…" aria-label="رسالتك" required><button class="btn primary" type="submit">إرسال</button></form>
    </section>`;

  root.querySelector('.chat-head strong').textContent = `مساعد ${storeName}`;
  const fab = root.querySelector('.chat-fab');
  const panel = root.querySelector('.chat-panel');
  const log = root.querySelector('.chat-log');
  const note = root.querySelector('.chat-note');
  const form = root.querySelector('.chat-form');
  const input = form.elements.message;
  let lastId = 0;
  let pollTimer = null;
  const seen = new Set();

  // Render text safely and turn URLs into links.
  function addMessage(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    if (typeof m.id === 'number' && m.id > lastId) lastId = m.id;
    const el = document.createElement('div');
    el.className = `chat-msg ${m.role}`;
    for (const part of m.content.split(/(https?:\/\/[^\s]+)/g)) {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part;
        a.textContent = part.includes('/cart/open/') ? 'افتح السلة وأكمل الطلب' : part;
        el.append(a);
      } else {
        el.append(document.createTextNode(part));
      }
    }
    log.append(el);
    log.scrollTop = log.scrollHeight;
  }

  function setMode(mode) {
    note.hidden = mode !== 'human';
    note.textContent = 'تم تحويلك لواحد من الفريق، راح يرد عليك هنا.';
  }

  async function poll() {
    try {
      const res = await fetch(`/api/chat?after=${lastId}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      data.messages.forEach(addMessage);
      setMode(data.mode);
    } catch { /* offline; next poll retries */ }
  }

  function open(state) {
    panel.classList.toggle('open', state);
    fab.setAttribute('aria-expanded', String(state));
    clearInterval(pollTimer);
    if (state) {
      poll().then(() => {
        if (!log.children.length) addMessage({ id: -1, role: 'bot', content: 'هلا بيك! اسألني عن أي منتج، أو دزلي رقم طلبك ورقم هاتفك حتى أتتبعه.' });
      });
      pollTimer = setInterval(poll, 8000);
      input.focus();
    }
  }

  fab.addEventListener('click', () => open(!panel.classList.contains('open')));
  root.querySelector('.chat-head button').addEventListener('click', () => open(false));
  // Any "ask the assistant" button on the page opens the same panel.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-chat]')) open(true);
  });

  // The "added to cart" toast comes from ?added=1; drop it from the address so a refresh doesn't repeat it.
  const params = new URLSearchParams(location.search);
  if (params.has('added')) {
    params.delete('added');
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    const button = form.querySelector('button');
    button.disabled = true;
    const typing = document.createElement('div');
    typing.className = 'chat-msg bot typing';
    typing.setAttribute('aria-label', 'المساعد يكتب');
    typing.textContent = '…';
    log.append(typing);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      typing.remove();
      if (!res.ok) {
        addMessage({ id: `e${Date.now()}`, role: 'bot', content: data.error ?? 'تعذر الإرسال، حاول مرة ثانية.' });
      } else {
        data.messages.forEach(addMessage);
        setMode(data.mode);
      }
    } catch {
      typing.remove();
      addMessage({ id: `e${Date.now()}`, role: 'bot', content: 'تعذر الاتصال، تأكد من الإنترنت وحاول مرة ثانية.' });
    } finally {
      button.disabled = false;
      input.focus();
    }
  });

  // Save checkout contact early so an abandoned cart can be followed up.
  const checkout = document.querySelector('form[action="/checkout"]');
  if (checkout) {
    checkout.elements.phone?.addEventListener('change', () => {
      const body = new URLSearchParams({ _csrf: checkout.elements._csrf.value, phone: checkout.elements.phone.value, email: checkout.elements.email?.value ?? '' });
      fetch('/cart/contact', { method: 'POST', body, credentials: 'same-origin' }).catch(() => {});
    });
  }
})();
