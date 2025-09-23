// Popup logic: load/save settings, trigger booking, and optionally override next-day lock on the site.
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
    if (el.type === "checkbox") {
      el.checked = Boolean(data[key]);
    } else {
      el.value = data[key] ?? defaultSettings[key];
    }
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
    data[key] = el.type === "checkbox" ? el.checked : el.value;
  });
  await chrome.storage.sync.set(data);
  return data;
}

const saveBtn = $("save");
if (saveBtn) {
  // On click: save settings and ask background to submit a booking
  saveBtn.addEventListener("click", async () => {
    const data = await saveSettings();
    const result = await chrome.runtime.sendMessage({ type: "booking:submit" });
    console.log('Booking result:', result);
    const box = $("status");
    if (box) {
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
    }
  });
}

const overrideBtn = $("overrideNextDay");
if (overrideBtn) {
  // Try enabling next-day navigation/elements on the booking site
  overrideBtn.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "override:next-day" });
      console.log("Override response:", res);
    } catch (e) {
      console.warn("Override failed", e);
    }
  });
}

// Reserve button: attempts to book; if blocked, schedules a pending job (midnight/cancellation)
const reserveBtn = $("reserve");
if (reserveBtn) {
  reserveBtn.addEventListener("click", async () => {
    await saveSettings();
    const res = await chrome.runtime.sendMessage({ type: "booking:reserve" });
    const box = $("status");
    if (box) {
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
    }
  });
}

// Pending Booking UI module
const pendingBtn = $("pendingBookings");
const pendingUI = createPendingUI();
if (pendingBtn) {
  pendingBtn.addEventListener('click', () => pendingUI.open());
}

// Initialize with today's date as default if unset
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const dateEl = $("bookingDate");
if (dateEl && !dateEl.value) {
  dateEl.value = `${yyyy}-${mm}-${dd}`;
}
loadSettings();
