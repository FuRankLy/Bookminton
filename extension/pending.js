// Pending bookings UI module
export function createPendingUI() {
  let overlay;

  function ensureOverlay() {
    overlay = document.getElementById('pendingModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pendingModal';
      overlay.hidden = true;
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = '#0006';
  overlay.style.display = 'none'; // fully hidden by default
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
  overlay.style.pointerEvents = 'none'; // do not block clicks when closed
      document.body.appendChild(overlay);
    }
  }

  async function open() {
    ensureOverlay();
  overlay.hidden = false;
  overlay.style.display = 'flex'; // show overlay
  overlay.style.pointerEvents = 'auto'; // block background while open
    // Load HTML shell
    const html = await fetch(chrome.runtime.getURL('pending.html')).then(r => r.text());
    overlay.innerHTML = html;
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
    const closeBtn = overlay.querySelector('#pendingClose');
    const refreshBtn = overlay.querySelector('#pendingRefresh');
    if (closeBtn) closeBtn.addEventListener('click', close, { once: true });
    if (refreshBtn) refreshBtn.addEventListener('click', load);
    await load();
  }

  function close() {
    if (!overlay) return;
  overlay.hidden = true;
  overlay.style.pointerEvents = 'none'; // allow background interaction again
  overlay.style.display = 'none'; // fully hide
    overlay.innerHTML = '';
    overlay.removeEventListener('click', onOverlayClick);
    document.removeEventListener('keydown', onKeydown);
  }

  async function load() {
    const body = overlay?.querySelector('#pendingBody');
    if (!body) return;
    body.textContent = 'Loading…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'pending:list' });
      if (!res?.ok) {
        body.textContent = res?.error || 'Failed to load pending bookings';
        return;
      }
      render(body, res.list || []);
    } catch (e) {
      body.textContent = String(e);
    }
  }

  function render(container, items) {
    if (!items.length) {
      container.textContent = 'No pending bookings';
      return;
    }
    container.innerHTML = '';
    items.forEach((it) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '6px 0';

  const label = document.createElement('div');
  const typeLabel = it.type === 'midnight' ? 'Midnight' : 'Cancellation';
  const attempts = it.attemptCount ? ` • tries: ${it.attemptCount}` : '';
  const last = it.lastCheckAt ? ` • last: ${new Date(it.lastCheckAt).toLocaleTimeString()}` : '';
  label.textContent = `${typeLabel} — ${it.booking.bookingDate} ${it.booking.timeStart} (Court ${it.booking.courtNumber})${attempts}${last}`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'pending:cancel', id: it.id });
        await load();
      });

      actions.appendChild(cancelBtn);
      row.appendChild(label);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function onOverlayClick(e) {
    const panel = overlay.querySelector('[role="dialog"]');
    if (panel && !panel.contains(e.target)) {
      close();
    }
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  return { open, close };
}
