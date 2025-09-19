// Content script: inject page script and bridge messages between page context and extension

(function () {
  if (location.hostname !== 'platform.aklbadminton.com') return;
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
  });

  injectScript();
})();
