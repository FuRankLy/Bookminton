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

function toLocalIsoNoTZ(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

async function submitBooking() {
  await loadSettings();
  const s = currentSettings || {};
  const { email, password, bookingDate, timeStart, duration, courtNumber } = s;
  if (!email || !password || !bookingDate || !timeStart || !duration || !courtNumber) {
    return { ok: false, error: 'Missing required settings' };
  }

  // Build start/end ISO strings in local time without timezone
  const [yyyy, mm, dd] = bookingDate.split('-').map((x) => parseInt(x, 10));
  const [hh, min] = timeStart.split(':').map((x) => parseInt(x, 10));
  const start = new Date(yyyy, (mm - 1), dd, hh, min, 0, 0);
  const end = new Date(start.getTime() + Number(duration) * 60_000);
  const startIso = toLocalIsoNoTZ(start);
  const endIso = toLocalIsoNoTZ(end);

  // Login
  const loginBody = new URLSearchParams();
  loginBody.set('email', email);
  loginBody.set('password', password);
  const loginRes = await fetch('https://platform.aklbadminton.com/account/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString(),
    credentials: 'include',
    redirect: 'follow',
  });
  if (!(loginRes.status === 200 || loginRes.status === 302)) {
    const body = await loginRes.text().catch(() => '');
    return { ok: false, error: `Login failed: ${loginRes.status}`, body };
  }

  // Book
  const facilityId = String(courtNumber); // Assumption: facility id matches court number 1–12
  const form = new URLSearchParams();
  form.set('payment_method', 'Account');
  form.set('start', startIso);
  form.set('end', endIso);
  form.set('facility', facilityId);
  form.set('entity_type', 'Casual');
  form.set('entity', '');
  form.set('requiresTerms', 'true');
  const agreedToTerms = 'true';
  form.set('agreedToTerms', agreedToTerms);
  form.set('chargeConfirmed', 'false');

  const bookRes = await fetch('https://platform.aklbadminton.com/api/booking', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://platform.aklbadminton.com',
      'Referer': 'https://platform.aklbadminton.com/booking',
    },
    body: form.toString(),
    credentials: 'include',
    redirect: 'follow',
  });
  const respText = await bookRes.text().catch(() => '');
  const code = bookRes.status;

  let message = `Booking HTTP status: ${code}`;
  let terminal = false; // whether user should stop retrying
  if (respText.includes('Sorry, this time is unavailable.')) {
    message = 'Booking failed: Time slot already taken.';
    terminal = true;
  } else if (respText.includes('Members cannot book courts more than 14 days in advance.')) {
    message = 'Booking failed: Too early to book.';
  } else if (respText.includes('Invalid payment method - please select another.')) {
    message = 'Booking failed: Low Balance';
    terminal = true;
  } else if (respText.includes('Bookings cannot exceed two hours in any 6 hour window.')) {
    message = 'Booking failed: Exceeds 2 hours in 6 hour window.';
    terminal = true;
  } else if (respText.includes('"redirect"')) {
    message = 'Booking succeeded!';
    terminal = true;
  } else if (code === 401) {
    message = 'Wrong Login, please check your username and password.';
    terminal = true;
  } else {
    message = `Booking response not recognized. Status ${code}`;
  }

  showNotification('Bookminton', message);
  return { ok: message.startsWith('Booking succeeded'), code, message, startIso, endIso, facilityId, terminal, body: respText };
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
    case 'booking:submit': {
      submitBooking()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // async response
    }
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
