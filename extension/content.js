// Content script: inject page script and bridge messages between page context and extension

(function () {
  if (location.hostname !== 'platform.aklbadminton.com' || !location.pathname.startsWith('/booking')) return;
  const INJECT_ID = 'bookminton-page-inject';

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
    // Relay to background
    chrome.runtime.sendMessage(msg.payload, (resp) => {
      // relay response back to page
      window.postMessage({ __bm_resp: true, correlationId: msg.correlationId, payload: resp }, '*');
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'ping') {
      sendResponse({ pong: true, from: 'content' });
      return; // synchronous
    }
    if (msg?.type === 'override:next-day') {
      try {
        let changed = 0;
        const el = document.querySelector('#calendar-next');
        if (el) {
          el.classList.remove('disabled');
          el.removeAttribute('disabled');
          el.setAttribute('aria-disabled', 'false');
          el.style.pointerEvents = 'auto';
          el.style.opacity = '';
          changed++;
        }

        // Also enable calendar day cells: <td class="disabled day">5</td> -> <td class="day">5</td>
        const cells = document.querySelectorAll('td.disabled.day');
        cells.forEach((cell) => {
          cell.classList.remove('disabled');
          cell.removeAttribute('aria-disabled');
          cell.style.pointerEvents = 'auto';
          cell.style.opacity = '';
          changed++;
        });

        if (changed === 0) {
          sendResponse({ ok: false, error: 'No target elements found' });
        } else {
          sendResponse({ ok: true, changed });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return; // synchronous
    }
  });

  injectScript();
})();
