// Popup logic: load/save settings, ping background, and send a test message to the active tab.

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
  saveBtn.addEventListener("click", async () => {
    const data = await saveSettings();
    const result = await chrome.runtime.sendMessage({ type: "booking:submit" });
    console.log('Booking result:', result);
    // Optionally close popup or show toast; for now, keep it open
  });
}

// Removed 'test' button handler (button not present in popup.html)

const overrideBtn = $("overrideNextDay");
if (overrideBtn) {
  overrideBtn.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "override:next-day" });
      console.log("Override response:", res);
    } catch (e) {
      console.warn("Override failed", e);
    }
  });
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
