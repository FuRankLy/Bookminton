// Content script: inject page script and bridge messages between page context and extension

(function () {
  if (location.hostname !== 'platform.aklbadminton.com' || !location.pathname.startsWith('/booking')) return;
  const INJECT_ID = 'bookminton-page-inject';

  // Inject the page-level script so it can access site JS context
  function injectScript() {
    if (document.getElementById(INJECT_ID)) return;
    const s = document.createElement('script');
    s.id = INJECT_ID;
    s.type = 'text/javascript';
    s.src = chrome.runtime.getURL('page-inject.js');
    (document.head || document.documentElement).appendChild(s);
  }

  // Bridge: window <-> content <-> background
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || !msg.__bm) return;
    // Relay to background and echo response back into the page
    chrome.runtime.sendMessage(msg.payload, (resp) => {
      // relay response back to page
      window.postMessage({ __bm_resp: true, correlationId: msg.correlationId, payload: resp }, '*');
    });
  });

  // Handle messages from the extension (popup/background)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'ping') {
      sendResponse({ pong: true, from: 'content' });
      return; // synchronous
    }
    if (msg?.type === 'override:next-day') {
      try {
        let changed = 0;
        const clean = (el) => {
          if (!el) return false;
          let c = 0;
          const classes = ['disabled','fc-state-disabled','fc-button-disabled'];
          classes.forEach(cls => { if (el.classList?.contains(cls)) { el.classList.remove(cls); c++; } });
          if (el.hasAttribute?.('disabled')) { el.removeAttribute('disabled'); c++; }
          if (el.hasAttribute?.('aria-disabled')) { el.setAttribute('aria-disabled','false'); c++; }
          try { el.disabled = false; } catch {}
          if (el.style) { el.style.pointerEvents = 'auto'; el.style.opacity = ''; }
          return c > 0;
        };

        // Enable next-day buttons across FC versions
        const nextCandidates = [
          document.getElementById('calendar-next'),
          ...document.querySelectorAll('.fc-next-button, button.fc-next-button, .fc-toolbar button[aria-label="next"]')
        ];
        let enabledNext = 0;
        nextCandidates.forEach(btn => { if (btn && clean(btn)) enabledNext++; });
        changed += enabledNext;

        // Also enable calendar day cells: <td class="disabled day">5</td> -> <td class="day">5</td>
        let enabledCells = 0;
        const cells = document.querySelectorAll('td.disabled, td.disabled.day, .fc-day.disabled, .fc-daygrid-day.disabled');
        cells.forEach((cell) => {
          let changedCell = clean(cell);
          // Force Bootstrap-style day class present
          try { if (!cell.classList.contains('day')) { cell.classList.add('day'); changedCell = true; } } catch {}
          // Also clean nested interactive elements
          const nested = cell.querySelectorAll('button, a');
          nested.forEach((el) => { if (clean(el)) changedCell = true; });
          if (changedCell) enabledCells++;
        });
        changed += enabledCells;

        if (changed === 0) {
          sendResponse({ ok: false, error: 'No target elements found', enabledNext, enabledCells });
        } else {
          sendResponse({ ok: true, changed, enabledNext, enabledCells });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return; // synchronous
    }
  });

  injectScript();
})();
