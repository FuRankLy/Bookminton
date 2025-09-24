// Popup logic: load/save settings, trigger booking, check availability, and pending UI
import { createPendingUI } from './pending.js';

const $ = (id) => document.getElementById(id);

const defaultSettings = {
  email: "",
  password: "",
  bookingDate: "",
  timeStart: "19:00",
  duration: 60,
  courtNumber: "1",
  autoBook: false,
};

/**
 * Load settings from storage and populate popup inputs.
 */
async function loadSettings() {
  const data = await chrome.storage.sync.get(defaultSettings);
  Object.entries(defaultSettings).forEach(([key]) => {
    const el = $(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(data[key]);
    else el.value = data[key] ?? defaultSettings[key];
  });
}

/**
 * Read input values and persist to chrome.storage.sync.
 * Returns the saved object.
 */
async function saveSettings() {
  const data = {};
  Object.keys(defaultSettings).forEach((key) => {
    const el = $(key);
    if (!el) return;
    data[key] = el.type === 'checkbox' ? el.checked : el.value;
  });
  await chrome.storage.sync.set(data);
  return data;
}

// Book
const saveBtn = $("save");
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    await saveSettings();
    const result = await chrome.runtime.sendMessage({ type: 'booking:submit' });
    const box = $("status");
    if (!box) return;
    box.hidden = false;
    box.classList.remove('success','error');
    if (result?.ok) {
      box.classList.add('success');
      const details = [
        result.message,
        result.startIso ? `Start: ${result.startIso}` : '',
        result.endIso ? `End: ${result.endIso}` : '',
        result.facilityId ? `Court: ${result.facilityId}` : '',
      ].filter(Boolean).join('\n');
      box.textContent = details;
    } else {
      box.classList.add('error');
      const lines = [
        result?.message || 'Booking failed',
        result?.error ? `Error: ${result.error}` : '',
        typeof result?.code !== 'undefined' ? `Status: ${result.code}` : '',
      ].filter(Boolean);
      box.textContent = lines.join('\n');
    }
  });
}

// Override next day
const overrideBtn = $("overrideNextDay");
if (overrideBtn) {
  overrideBtn.addEventListener('click', async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'override:next-day' });
      console.log('Override response:', res);
    } catch (e) {
      console.warn('Override failed', e);
    }
  });
}

// Reserve (pending booking)
const reserveBtn = $("reserve");
if (reserveBtn) {
  reserveBtn.addEventListener('click', async () => {
    await saveSettings();
    const res = await chrome.runtime.sendMessage({ type: 'booking:reserve' });
    const box = $("status");
    if (!box) return;
    box.hidden = false;
    box.classList.remove('success','error');
    const lines = [];
    if (res?.ok) {
      box.classList.add('success');
      lines.push(res.message || 'Booking succeeded');
    } else {
      box.classList.add('error');
      lines.push(res?.message || 'Booking failed');
      if (res?.pendingScheduled) {
        const t = res.pendingScheduled.type === 'midnight' ? 'Midnight' : 'Cancellation';
        lines.push(`Pending booking scheduled (${t}).`);
      }
      if (res?.error) lines.push(`Error: ${res.error}`);
      if (typeof res?.code !== 'undefined') lines.push(`Status: ${res.code}`);
    }
    box.textContent = lines.filter(Boolean).join('\n');
  });
}

// Check availability
const checkBtn = $("checkAvailability");
if (checkBtn) {
  checkBtn.addEventListener('click', async () => {
    const s = await saveSettings();
    const status = $("status");
    const setStatus = (cls, lines) => {
      if (!status) return;
      status.hidden = false;
      status.classList.remove('success','error');
      status.classList.add(cls);
      status.textContent = lines.filter(Boolean).join('\n');
    };

    try {
      const dateStr = s.bookingDate;
      if (!dateStr) { setStatus('error', ['Please select a date']); return; }
  const res = await chrome.runtime.sendMessage({ type: 'availability:collect', date: dateStr, timeStart: s.timeStart, duration: parseInt(s.duration, 10) || 60 });
      if (!res?.ok) { setStatus('error', [res?.message || 'Failed to collect availability', res?.error || '']); return; }

      const parseHM = (hm) => {
        const [h,m] = String(hm).split(':').map(x=>parseInt(x,10));
        return h*60 + m;
      };
      const startMin = parseHM(s.timeStart);
      const duration = parseInt(s.duration, 10) || 60;
      const endMin = startMin + duration;

      // Prefer server-computed free list if present
      if (Array.isArray(res.freeCourtNames) || Array.isArray(res.freeCourtIndices)) {
        const names = (res.freeCourtNames && res.freeCourtNames.length)
          ? res.freeCourtNames
          : (res.freeCourtIndices || []).map((i) => {
              if (Array.isArray(res.courts) && res.courts[i]?.name) return res.courts[i].name;
              if (Array.isArray(res.facilities) && res.facilities[i]?.name) return res.facilities[i].name;
              return String((i ?? 0) + 1);
            });
        const endStr = (() => {
          const [h,m] = String(s.timeStart).split(':').map(x=>parseInt(x,10));
          const startMin = h*60 + m;
          const endMin = startMin + (parseInt(s.duration,10)||60);
          return `${('0'+Math.floor(endMin/60)).slice(-2)}:${('0'+(endMin%60)).slice(-2)}`;
        })();
        if (!names.length) {
          setStatus('error', [`No courts free on ${dateStr} from ${s.timeStart} for ${s.duration}m.`]);
        } else {
          setStatus('success', [
            `Free courts on ${dateStr}, ${s.timeStart}-${endStr}`,
            names.join(', ')
          ]);
        }
        return;
      }

      let courtsCount = 0;
      const occupied = new Map();
      if (Array.isArray(res.bookings)) {
        res.bookings.forEach(b => {
          const ci = typeof b.courtIndex === 'number' ? b.courtIndex : null;
          if (ci == null) return;
          const st = b.start ? parseHM(b.start) : null;
          const en = b.end ? parseHM(b.end) : null;
          if (st == null || en == null) return;
          if (!occupied.has(ci)) occupied.set(ci, []);
          occupied.get(ci).push([st, en]);
          courtsCount = Math.max(courtsCount, ci + 1);
        });
      } else if (Array.isArray(res.courts)) {
        courtsCount = res.courts.length;
      } else if (Array.isArray(res.facilities)) {
        courtsCount = res.facilities.length;
      }
      if (!courtsCount) { courtsCount = Math.max(occupied.size, 12); }

      const courtName = (idx) => {
        if (Array.isArray(res.courts) && res.courts[idx]?.name) return res.courts[idx].name;
        if (Array.isArray(res.facilities) && res.facilities[idx]?.name) return res.facilities[idx].name;
        return String(idx + 1);
      };

      const overlaps = (a,b) => a[0] < b[1] && b[0] < a[1];
      const windowRange = [startMin, endMin];
      const free = [];
      for (let i = 0; i < courtsCount; i++) {
        const ranges = occupied.get(i) || [];
        const hasConflict = ranges.some(r => overlaps(r, windowRange));
        if (!hasConflict) free.push(i);
      }

      if (free.length === 0) {
        setStatus('error', [`No courts free on ${dateStr} from ${s.timeStart} for ${duration}m.`]);
      } else {
        const names = free.map(ci => courtName(ci));
        const endStr = `${('0'+Math.floor(endMin/60)).slice(-2)}:${('0'+(endMin%60)).slice(-2)}`;
        setStatus('success', [
          `Free courts on ${dateStr}, ${s.timeStart}-${endStr}`,
          names.join(', ')
        ]);
      }
    } catch (e) {
      setStatus('error', ['Error while checking availability', String(e)]);
    }
  });
}

// Pending modal
const pendingBtn = $("pendingBookings");
const pendingUI = createPendingUI();
if (pendingBtn) {
  pendingBtn.addEventListener('click', () => pendingUI.open());
}

// Date default
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const dateEl = $("bookingDate");
if (dateEl && !dateEl.value) {
  dateEl.value = `${yyyy}-${mm}-${dd}`;
}
loadSettings();

// Show password (press and hold)
const pwdInput = $("password");
const showBtn = $("showPassword");
if (pwdInput && showBtn) {
  const show = () => { pwdInput.type = 'text'; };
  const hide = () => { pwdInput.type = 'password'; };
  showBtn.addEventListener('mousedown', show);
  document.addEventListener('mouseup', hide);
  showBtn.addEventListener('mouseleave', hide);
  showBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); show(); } });
  showBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hide(); } });
  showBtn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
  showBtn.addEventListener('touchend', hide);
  showBtn.addEventListener('touchcancel', hide);
}
