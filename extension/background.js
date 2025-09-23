// Service worker: alarms, message routing, notifications

const SETTINGS_KEY = 'bookminton:settings';
let currentSettings = null;
const PENDING_JOBS_KEY = 'bookminton:pendingJobs';

/**
 * Load user settings from chrome.storage.sync into the in-memory cache.
 * Populates defaults for any missing fields.
 */
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

/**
 * Convert a Date to a local ISO-like string without timezone, e.g. 2025-09-21T19:00:00
 */
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

/**
 * Perform a login against AKL Badminton and attempt to create a booking.
 * Returns a structured result with status, messages, time range, and terminal flag.
 */
async function submitBooking(overrides) {
  await loadSettings();
  const s = { ...(currentSettings || {}), ...(overrides || {}) };
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
  const loginOk = await doLogin(email, password);
  if (!loginOk.ok) {
    return loginOk;
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

  const { code, respText } = await postBooking(form);

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

/**
 * Create a one-off alarm by name that fires at the given timestamp (ms since epoch).
 */
function scheduleAlarm(name = 'bookminton:tick', whenMs = Date.now() + 60_000) {
  chrome.alarms.create(name, { when: whenMs });
}

/**
 * Attempt login only; used by pending-midnight to pre-auth before midnight.
 */
async function doLogin(email, password) {
  try {
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
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Perform the booking POST with provided form data.
 */
async function postBooking(form) {
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
  return { code, respText };
}

/**
 * Compute start/end and form for a booking attempt.
 */
function buildBookingForm({ bookingDate, timeStart, duration, courtNumber }) {
  const [yyyy, mm, dd] = bookingDate.split('-').map((x) => parseInt(x, 10));
  const [hh, min] = timeStart.split(':').map((x) => parseInt(x, 10));
  const start = new Date(yyyy, (mm - 1), dd, hh, min, 0, 0);
  const end = new Date(start.getTime() + Number(duration) * 60_000);
  const startIso = toLocalIsoNoTZ(start);
  const endIso = toLocalIsoNoTZ(end);
  const facilityId = String(courtNumber);
  const form = new URLSearchParams();
  form.set('payment_method', 'Account');
  form.set('start', startIso);
  form.set('end', endIso);
  form.set('facility', facilityId);
  form.set('entity_type', 'Casual');
  form.set('entity', '');
  form.set('requiresTerms', 'true');
  form.set('agreedToTerms', 'true');
  form.set('chargeConfirmed', 'false');
  return { form, startIso, endIso, facilityId };
}

/**
 * Normalize booking response text -> message and terminal flag.
 */
function interpretBookingResponse(code, respText) {
  let message = `Booking HTTP status: ${code}`;
  let terminal = false;
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
  return { message, terminal };
}

/** Pending jobs storage helpers */
async function getPendingJobs() {
  const data = await chrome.storage.local.get({ [PENDING_JOBS_KEY]: [] });
  return data[PENDING_JOBS_KEY] || [];
}
async function savePendingJobs(jobs) {
  await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
}
async function addPendingJob(job) {
  const jobs = await getPendingJobs();
  jobs.push(job);
  await savePendingJobs(jobs);
}
async function updatePendingJob(id, updates) {
  const jobs = await getPendingJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...updates };
    await savePendingJobs(jobs);
    return jobs[idx];
  }
  return null;
}
async function removePendingJob(id) {
  const jobs = await getPendingJobs();
  const next = jobs.filter(j => j.id !== id);
  await savePendingJobs(next);
}

/** Alarm naming helpers */
function alarmNameMidnightLogin(id) { return `bookminton:midnight:login:${id}`; }
function alarmNameMidnightBook(id) { return `bookminton:midnight:book:${id}`; }
function alarmNameRetry(id) { return `bookminton:retry:${id}`; }

/** Schedule alarms for a midnight job (login at 23:59:40, book at 00:00:00). */
function scheduleMidnightAlarms(jobId) {
  const now = new Date();
  const loginAt = new Date();
  loginAt.setHours(23, 59, 40, 0);
  const midnight = new Date(now);
  midnight.setDate(now.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const loginWhen = Math.max(loginAt.getTime(), Date.now() + 1000);
  chrome.alarms.create(alarmNameMidnightLogin(jobId), { when: loginWhen });
  chrome.alarms.create(alarmNameMidnightBook(jobId), { when: midnight.getTime() });
}

/** Schedule retry alarm for a cancellation job (every ~1 minute; 10s not supported by alarms). */
function scheduleRetryAlarm(jobId) {
  chrome.alarms.create(alarmNameRetry(jobId), { periodInMinutes: 1, when: Date.now() + 1000 });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Preload settings when the extension is installed/updated
  await loadSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  // Reload settings on browser startup
  await loadSettings();
});

// Central message router for popup/content/page communications
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'settings:update':
      // Update in-memory settings cache
      currentSettings = msg.payload || currentSettings;
      sendResponse({ ok: true });
      break;
    case 'ping':
      // Simple liveness check
      sendResponse({ pong: true, from: 'background' });
      break;
    case 'notify':
      // Show a basic notification
      showNotification(msg.title || 'Bookminton', msg.message || '');
      sendResponse({ ok: true });
      break;
    case 'booking:submit': {
      // Trigger booking flow; respond asynchronously
      submitBooking()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // async response
    }
    case 'booking:reserve': {
      // Try to book; if fails for specific reasons, schedule a pending job
      submitBooking()
        .then(async (res) => {
          if (res?.ok) { sendResponse(res); return; }
          const s = currentSettings || {};
          const jobBase = {
            id: Date.now() + ':' + Math.random().toString(36).slice(2),
            createdAt: Date.now(),
            type: '',
            status: 'active',
            booking: {
              bookingDate: s.bookingDate,
              timeStart: s.timeStart,
              duration: s.duration,
              courtNumber: s.courtNumber,
            },
          };
          let scheduled = null;
          if (res?.message?.includes('Too early to book')) {
            // Pending Booking (Midnight)
            const job = { ...jobBase, type: 'midnight' };
            await addPendingJob(job);
            scheduleMidnightAlarms(job.id);
            scheduled = { type: 'midnight', id: job.id };
            showNotification('Bookminton', 'Pending Booking scheduled for midnight.');
          } else if (res?.message?.includes('Time slot already taken')) {
            // Pending Booking (Cancellation)
            const job = { ...jobBase, type: 'cancellation' };
            await addPendingJob(job);
            scheduleRetryAlarm(job.id);
            scheduled = { type: 'cancellation', id: job.id };
            showNotification('Bookminton', 'Pending Booking scheduled: will retry periodically.');
          }
          sendResponse({ ...res, pendingScheduled: scheduled });
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // async response
    }
    case 'pending:list': {
      (async () => {
        const list = await getPendingJobs();
        sendResponse({ ok: true, list });
      })();
      return true;
    }
    case 'pending:cancel': {
      (async () => {
        const id = msg.id;
        if (!id) { sendResponse({ ok: false, error: 'Missing id' }); return; }
        // Cancel alarms
        chrome.alarms.clear(alarmNameMidnightLogin(id));
        chrome.alarms.clear(alarmNameMidnightBook(id));
        chrome.alarms.clear(alarmNameRetry(id));
        await removePendingJob(id);
        sendResponse({ ok: true });
      })();
      return true;
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
          // Prefer content-script path; fall back to scripting.executeScript if bridge fails
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
  // React only to Bookminton alarms
  if (!alarm?.name?.startsWith('bookminton')) return;
  await loadSettings();
  const name = alarm.name || '';
  try {
    if (name.startsWith('bookminton:midnight:login:')) {
      // Pre-login
      const email = currentSettings?.email;
      const password = currentSettings?.password;
      if (email && password) await doLogin(email, password);
    } else if (name.startsWith('bookminton:midnight:book:')) {
      const id = name.split(':').pop();
      const jobs = await getPendingJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) return;
      const { form, startIso, endIso, facilityId } = buildBookingForm(job.booking);
      const { code, respText } = await postBooking(form);
      const { message } = interpretBookingResponse(code, respText);
      if (message.startsWith('Booking succeeded')) {
        showNotification('Bookminton', 'Midnight booking succeeded');
        // Clear job and alarms
        chrome.alarms.clear(alarmNameMidnightLogin(id));
        chrome.alarms.clear(alarmNameMidnightBook(id));
        await removePendingJob(id);
      } else {
        showNotification('Bookminton', `Midnight booking attempt: ${message}`);
        // Keep job for manual management
      }
    } else if (name.startsWith('bookminton:retry:')) {
      const id = name.split(':').pop();
      const jobs = await getPendingJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) return;
      const { form } = buildBookingForm(job.booking);
      const { code, respText } = await postBooking(form);
      const { message } = interpretBookingResponse(code, respText);
      if (message.startsWith('Booking succeeded')) {
        showNotification('Bookminton', 'Cancellation booking succeeded');
        chrome.alarms.clear(alarmNameRetry(id));
        await removePendingJob(id);
      } else {
        // Keep retrying; notify occasionally (suppress noisy spam)
        // No action needed; alarm is periodic
      }
    }
  } catch (e) {
    // Swallow errors to avoid breaking alarm handling
  }
});

/**
 * Show a basic browser notification with the extension's icon.
 */
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
