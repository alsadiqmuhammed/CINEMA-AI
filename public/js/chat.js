(() => {
  const root = document.getElementById('chat-root');
  if (!root) return;

  root.innerHTML = `
    <button class="btn primary chat-fab" type="button" aria-expanded="false" aria-controls="chat-panel">💬 تحتاج مساعدة؟</button>
    <section class="chat-panel" id="chat-panel" role="dialog" aria-label="المحادثة">
      <div class="chat-head"><span>مساعد المتجر</span><button type="button" aria-label="إغلاق">×</button></div>
      <div class="chat-log" aria-live="polite"></div>
      <p class="chat-note" hidden></p>
      <form class="chat-form"><input name="message" autocomplete="off" maxlength="1000" placeholder="اكتب رسالتك…" aria-label="رسالتك" required><button class="btn primary" type="submit">إرسال</button></form>
    </section>`;

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
    note.textContent = 'تم تحويلك لأحد أعضاء الفريق، بيرد عليك هنا.';
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
        if (!log.children.length) addMessage({ id: -1, role: 'bot', content: 'هلا! اسألني عن أي منتج، أو أرسل رقم طلبك وجوالك لتتبعه.' });
      });
      pollTimer = setInterval(poll, 8000);
      input.focus();
    }
  }

  fab.addEventListener('click', () => open(!panel.classList.contains('open')));
  root.querySelector('.chat-head button').addEventListener('click', () => open(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    const button = form.querySelector('button');
    button.disabled = true;
    const typing = document.createElement('div');
    typing.className = 'chat-msg bot';
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
