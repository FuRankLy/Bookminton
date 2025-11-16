// Service worker: alarms, message routing, notifications
import { collectAvailabilityForDate } from './availability.js';

const SETTINGS_KEY = 'bookminton:settings';
let currentSettings = null;
const PENDING_JOBS_KEY = 'bookminton:pendingJobs';
const AVAIL_KEY = 'bookminton:availability';

// --- Availability via API feed (preferred) ---
async function fetchBookingFeed(startDate, endDate) {
  const ts = Date.now();
  const url = `https://platform.aklbadminton.com/api/booking/feed?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}&_=${ts}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'include',
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  try { return await res.json(); } catch { return JSON.parse(await res.text()); }
}

function addDays(isoYmd, days) {
  const [y,m,d] = isoYmd.split('-').map(n=>parseInt(n,10));
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n)=>String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
}

function isoToHM(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n)=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeFeedToBookings(feed) {
  const items = Array.isArray(feed) ? feed : (Array.isArray(feed?.events) ? feed.events : (Array.isArray(feed?.data) ? feed.data : []));
  const bookings = [];
  const namesByIdx = new Map();
  const guessCourtIndex = (evt) => {
    const candidates = [evt.court, evt.courtId, evt.court_id, evt.facility, evt.facilityId, evt.facility_id, evt.resourceId, evt.resource_id, evt.resource?.id];
    for (const c of candidates) {
      const num = typeof c === 'string' ? parseInt(c,10) : (typeof c === 'number' ? c : NaN);
      if (!Number.isNaN(num) && num >= 1 && num <= 64) return num - 1;
    }
    const name = evt.facility_name || evt.facilityName || evt.facility?.name || evt.resource?.title || evt.resource?.name || evt.title;
    if (name && typeof name === 'string') {
      const m = name.match(/court\s*(\d{1,2})/i) || name.match(/\b(\d{1,2})\b/);
      if (m) { const num = parseInt(m[1],10); if (!Number.isNaN(num)) return num - 1; }
    }
    return null;
  };
  for (const evt of items) {
    const startIso = evt.start || evt.start_time || evt.startTime || evt.begin;
    const endIso = evt.end || evt.end_time || evt.endTime || evt.finish;
    const start = isoToHM(startIso);
    const end = isoToHM(endIso);
    const idx = guessCourtIndex(evt);
    if (start && end && idx != null) {
      const title = evt.title || evt.name || evt.facility_name || null;
      bookings.push({ courtIndex: idx, start, end, title });
      const courtName = evt.facility_name || evt.facility?.name || evt.resource?.title || null;
      if (courtName && !namesByIdx.has(idx)) namesByIdx.set(idx, courtName);
    }
  }
  const courts = [];
  if (namesByIdx.size) {
    const maxIdx = Math.max(...Array.from(namesByIdx.keys()));
    for (let i=0; i<=maxIdx; i++) courts.push({ index: i, name: namesByIdx.get(i) || null });
  }
  return { bookings, courts };
}

async function collectAvailabilityViaFeed(dateStr) {
  const start = dateStr;
  const end = addDays(dateStr, 1);
  const feed = await fetchBookingFeed(start, end);
  const norm = normalizeFeedToBookings(feed);
  return { ok: true, date: dateStr, via: 'feed', facilities: [], courts: norm.courts || [], bookings: norm.bookings || [] };
}

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

  // Login
  const loginOk = await doLogin(email, password);
  if (!loginOk.ok) {
    return loginOk;
  }

  // Book
  const { form, startIso, endIso, facilityId } = buildBookingForm({ bookingDate, timeStart, duration, courtNumber });

  const { code, respText } = await postBooking(form);
  const { message, terminal } = interpretBookingResponse(code, respText);

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

// Compute free courts for a given time window from bookings
function computeFreeCourts(data, timeStart, duration, preferredCourtNumber) {
  if (!data || !Array.isArray(data.bookings) || !timeStart || !duration) return data;
  const parseHM = (hm) => {
    const [h,m] = String(hm).split(':').map(x=>parseInt(x,10));
    return h*60 + m;
  };
  const overlaps = (a,b) => a[0] < b[1] && b[0] < a[1];
  const startMin = parseHM(timeStart);
  const endMin = startMin + Number(duration);
  let courtsCount = 0;
  const occupied = new Map();
  data.bookings.forEach(b => {
    const ci = typeof b.courtIndex === 'number' ? b.courtIndex : null;
    if (ci == null) return;
    const st = b.start ? parseHM(b.start) : null;
    const en = b.end ? parseHM(b.end) : null;
    if (st == null || en == null) return;
    if (!occupied.has(ci)) occupied.set(ci, []);
    occupied.get(ci).push([st, en]);
    courtsCount = Math.max(courtsCount, ci + 1);
  });
  if (!courtsCount) {
    if (Array.isArray(data.courts)) courtsCount = data.courts.length;
    else if (Array.isArray(data.facilities)) courtsCount = data.facilities.length;
    else courtsCount = Math.max(occupied.size, 12);
  }
  const windowRange = [startMin, endMin];
  const free = [];
  for (let i = 0; i < courtsCount; i++) {
    const ranges = occupied.get(i) || [];
    const hasConflict = ranges.some(r => overlaps(r, windowRange));
    if (!hasConflict) free.push(i);
  }
  const courtName = (idx) => {
    if (Array.isArray(data.courts) && data.courts[idx]?.name) return data.courts[idx].name;
    if (Array.isArray(data.facilities) && data.facilities[idx]?.name) return data.facilities[idx].name;
    return String(idx + 1);
  };
  data.freeCourtIndices = free;
  data.freeCourtNames = free.map(courtName);
  data.window = { start: timeStart, end: `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}` };
  data.isAnyCourtFree = free.length > 0;
  if (preferredCourtNumber && Number.isFinite(preferredCourtNumber)) {
    const idx = preferredCourtNumber - 1;
    data.isDesiredCourtFree = free.includes(idx);
    data.desiredCourt = { number: preferredCourtNumber, name: courtName(idx) };
  }
  return data;
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

/** Schedule alarms for a midnight job (login at 23:59:45, book at 00:00:00). */
function scheduleMidnightAlarms(jobId) {
  const now = new Date();
  const loginAt = new Date();
  loginAt.setHours(23, 59, 45, 0); // 15 seconds before midnight
  const midnight = new Date(now);
  midnight.setDate(now.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const loginWhen = Math.max(loginAt.getTime(), Date.now() + 1000);
  chrome.alarms.create(alarmNameMidnightLogin(jobId), { when: loginWhen });
  chrome.alarms.create(alarmNameMidnightBook(jobId), { when: midnight.getTime() });
}

/** Schedule the next retry alarm for a cancellation job (~every 10 seconds, one-off reschedule). */
function scheduleRetryAlarm(jobId, delayMs = 10_000) {
  const name = alarmNameRetry(jobId);
  chrome.alarms.clear(name, () => {
    chrome.alarms.create(name, { when: Date.now() + Math.max(1000, delayMs) });
  });
}

/** Ensure periodic alarms exist for all active cancellation jobs (idempotent). */
async function ensureCancellationAlarms() {
  try {
    const jobs = await getPendingJobs();
    const cancels = jobs.filter(j => j.status !== 'cancelled' && j.type === 'cancellation');
    // Fetch existing alarms once to minimize API calls
    const existing = await new Promise((resolve) => chrome.alarms.getAll(resolve));
    const existingNames = new Set((existing || []).map(a => a.name));
    for (const j of cancels) {
      const name = alarmNameRetry(j.id);
      if (!existingNames.has(name)) {
  scheduleRetryAlarm(j.id, 10_000);
      }
    }
  } catch (_) {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // Preload settings when the extension is installed/updated
  await loadSettings();
  // Re-establish periodic alarms for active cancellation jobs
  await ensureCancellationAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  // Reload settings on browser startup
  await loadSettings();
  // Re-establish periodic alarms for active cancellation jobs
  await ensureCancellationAlarms();
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
      scheduleRetryAlarm(job.id, 10_000);
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
                    const nextCandidates = [
                      document.getElementById('calendar-next'),
                      ...document.querySelectorAll('.fc-next-button, button.fc-next-button, .fc-toolbar button[aria-label="next"]')
                    ];
                    let enabledNext = 0;
                    nextCandidates.forEach(btn => { if (btn && clean(btn)) enabledNext++; });
                    // Enable disabled day cells too
                    let enabledCells = 0;
                    const cells = document.querySelectorAll('td.disabled, td.disabled.day, .fc-day.disabled, .fc-daygrid-day.disabled');
                    cells.forEach((cell) => {
                      let changedCell = clean(cell);
                      try { if (!cell.classList.contains('day')) { cell.classList.add('day'); changedCell = true; } } catch {}
                      const nested = cell.querySelectorAll('button, a');
                      nested.forEach((el) => { if (clean(el)) changedCell = true; });
                      if (changedCell) enabledCells++;
                    });
                    return (enabledNext || enabledCells)
                      ? { ok: true, enabledNext, enabledCells }
                      : { ok: false, error: 'No targets found' };
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
    case 'availability:collect': {
      (async () => {
        try {
          await loadSettings();
          const { email, password } = currentSettings || {};
          const loginRes = await doLogin(email, password);
          if (!loginRes.ok) { sendResponse(loginRes); return; }
          const dateStr = msg.date;
          const timeStart = msg.timeStart;
          const duration = Number(msg.duration);
          const preferredCourt = msg.courtNumber ? Number(msg.courtNumber) : (currentSettings?.courtNumber ? Number(currentSettings.courtNumber) : null);
          // Prefer API feed to avoid opening/refreshing tabs
          let data = await collectAvailabilityViaFeed(dateStr).catch(() => null);
          if (!data || !Array.isArray(data.bookings)) {
            data = await collectAvailabilityForDate(dateStr);
          }
          // Optionally compute free courts for a given time window
          if (data?.ok && Array.isArray(data.bookings) && timeStart && duration) {
            computeFreeCourts(data, timeStart, duration, preferredCourt);
          }
          if (data?.ok && dateStr) {
            await saveAvailability(dateStr, data);
          }
          sendResponse(data);
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    case 'availability:get': {
      (async () => {
        try {
          const dateStr = msg.date;
          if (dateStr) {
            const item = await getAvailability(dateStr);
            sendResponse({ ok: true, date: dateStr, data: item || null });
          } else {
            const all = await chrome.storage.local.get({ [AVAIL_KEY]: {} });
            sendResponse({ ok: true, all: all[AVAIL_KEY] || {} });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
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
      const prefix = 'bookminton:midnight:book:';
      const id = name.slice(prefix.length);
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
      const prefix = 'bookminton:retry:';
      const id = name.slice(prefix.length);
      const jobs = await getPendingJobs();
      const job = jobs.find(j => j.id === id);
      if (!job) return;
      // Update last check timestamp and attempt counter for visibility in UI
      try {
        const nextAttempt = (job.attemptCount || 0) + 1;
        await updatePendingJob(id, { lastCheckAt: Date.now(), attemptCount: nextAttempt });
      } catch(_) {}
      try {
        // Ensure login before retrying booking
        const email = currentSettings?.email;
        const password = currentSettings?.password;
        if (email && password) await doLogin(email, password);

        const { bookingDate, timeStart, duration, courtNumber } = job.booking || {};
        if (!bookingDate || !timeStart || !duration || !courtNumber) { scheduleRetryAlarm(id, 10_000); return; }

        // Build the same booking request and attempt it
        const { form } = buildBookingForm({ bookingDate, timeStart, duration, courtNumber });
        const { code, respText } = await postBooking(form);
        const { message } = interpretBookingResponse(code, respText);
        if (message.startsWith('Booking succeeded')) {
          showNotification('Bookminton', 'Cancellation booking succeeded');
          chrome.alarms.clear(alarmNameRetry(id));
          await removePendingJob(id);
        } else {
          // Not successful yet; schedule another check in ~10s
          scheduleRetryAlarm(id, 10_000);
        }
      } catch (_) {
        // On any error, try again shortly
        scheduleRetryAlarm(id, 10_000);
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

// Availability storage helpers
async function saveAvailability(dateStr, dataset) {
  const data = await chrome.storage.local.get({ [AVAIL_KEY]: {} });
  const map = data[AVAIL_KEY] || {};
  map[dateStr] = dataset;
  await chrome.storage.local.set({ [AVAIL_KEY]: map });
}
async function getAvailability(dateStr) {
  const data = await chrome.storage.local.get({ [AVAIL_KEY]: {} });
  return (data[AVAIL_KEY] || {})[dateStr];
}
