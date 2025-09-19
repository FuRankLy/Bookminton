// Popup logic: load/save settings, ping background, and send a test message to the active tab.

const $ = (id) => document.getElementById(id);

const defaultSettings = {
  email: "",
  password: "",
  bookingDate: "", // YYYY-MM-DD
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

$("save").addEventListener("click", async () => {
  const data = await saveSettings();
  await chrome.runtime.sendMessage({ type: "settings:update", payload: data });
  window.close();
});

$("test").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "ping" }, (resp) => {
      console.log("Ping response:", resp);
    });
  }
});

$("overrideNextDay").addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: "override:next-day" });
    console.log("Override response:", res);
  } catch (e) {
    console.warn("Override failed", e);
  }
});

// Initialize
// Initialize with today's date as default if unset
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
$("bookingDate").value = `${yyyy}-${mm}-${dd}`;
loadSettings();
