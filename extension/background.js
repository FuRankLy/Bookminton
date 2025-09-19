// Service worker: alarms, message routing, notifications

const SETTINGS_KEY = 'bookminton:settings';
let currentSettings = null;

async function loadSettings() {
  const defaults = {
    email: '',
    password: '',
  bookingDate: '',
    timeStart: '19:00',
    duration: 60,
  courtNumber: '1',
    autoBook: false,
  };
  const data = await chrome.storage.sync.get(defaults);
  currentSettings = data;
}

function scheduleAlarm(name = 'bookminton:tick', whenMs = Date.now() + 60_000) {
  chrome.alarms.create(name, { when: whenMs });
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'settings:update':
      currentSettings = msg.payload || currentSettings;
      sendResponse({ ok: true });
      break;
    case 'ping':
      sendResponse({ pong: true, from: 'background' });
      break;
    case 'notify':
      showNotification(msg.title || 'Bookminton', msg.message || '');
      sendResponse({ ok: true });
      break;
    case 'override:next-day': {
      // Forward to the active tab (content script) to manipulate the page DOM
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        const url = tab?.url || '';
        const allowed = url.startsWith('https://platform.aklbadminton.com/booking');
        if (!allowed) {
          sendResponse({ ok: false, error: 'Open the booking page first' });
          return;
        }
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'override:next-day' }, async (resp) => {
            if (chrome.runtime.lastError || !resp) {
              try {
                const [result] = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => {
                    const el = document.querySelector('#calendar-next');
                    if (!el) return { ok: false, error: '#calendar-next not found' };
                    el.classList.remove('disabled');
                    el.removeAttribute('disabled');
                    el.setAttribute('aria-disabled', 'false');
                    el.style.pointerEvents = 'auto';
                    el.style.opacity = '';
                    return { ok: true };
                  },
                });
                sendResponse(result?.result || { ok: false, error: 'No result' });
              } catch (e) {
                sendResponse({ ok: false, error: String(e) });
              }
            } else {
              sendResponse(resp);
            }
          });
        } else {
          sendResponse({ ok: false, error: 'No active tab' });
        }
      });
      return true; // async response
    }
    default:
      // no-op
      break;
  }
  // returning true allows async sendResponse, but we respond sync here
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name?.startsWith('bookminton')) return;
  await loadSettings();
  // TODO: potentially message active tabs to check state or trigger actions
});

function showNotification(title, message) {
  if (!title && !message) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 0,
  });
}
