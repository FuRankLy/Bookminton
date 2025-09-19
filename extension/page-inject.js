// Page context code: runs on platform.aklbadminton.com and can access page JS. Communicate via window.postMessage only.
(function () {
  const originTag = 'page-inject';

  function sendToExtension(payload) {
    window.postMessage({ __bm: true, correlationId: Date.now() + ':' + Math.random(), payload }, '*');
  }

  // Example: listen for releases or DOM states
  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    // Example ping to background to verify bridge
    sendToExtension({ type: 'ping' });
  });
})();
