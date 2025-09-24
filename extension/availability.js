// Availability collection module: opens the booking page, navigates to a date, scrapes slots

const BOOKING_URL = 'https://platform.aklbadminton.com/booking';

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const [tab] = await chrome.tabs.query({ id: tabId });
      const done = tab && (tab.status === 'complete');
      const expired = Date.now() - start > timeoutMs;
      if (done || expired) {
        clearInterval(timer);
        resolve(Boolean(done));
      }
    }, 200);
  });
}

async function ensureBookingTab() {
  const tabs = await chrome.tabs.query({ url: BOOKING_URL + '*' });
  // Prefer a non-active tab to avoid affecting user's visible page
  let tab = tabs?.find(t => !t.active);
  if (!tab) {
    // If only an active tab exists, create a new inactive one
    tab = await chrome.tabs.create({ url: BOOKING_URL, active: false });
    await waitForTabComplete(tab.id);
  } else if (tab.status !== 'complete') {
    await waitForTabComplete(tab.id);
  }
  return tab.id;
}

async function injectCollectScript(tabId, dateStr) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [dateStr],
    func: async (targetDateStr) => {
      try {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      function toISODate(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      }

      const pad2 = (n) => String(n).padStart(2, '0');
      function addDays(isoYmd, days) {
        const [y,m,d] = isoYmd.split('-').map(x=>parseInt(x,10));
        const dt = new Date(y, m-1, d);
        dt.setDate(dt.getDate() + days);
        return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
      }

      function getCurrentDateStr() {
        // 1) Prefer FullCalendar API if present
        try {
          const $ = window.jQuery || window.$;
          if ($ && typeof $("#calendar").fullCalendar === 'function') {
            const m = $("#calendar").fullCalendar('getDate');
            if (m && typeof m.toDate === 'function') return toISODate(m.toDate());
            if (m && m._d instanceof Date) return toISODate(m._d);
          }
        } catch {}
        // 2) Try toolbar header text
        const h = document.querySelector('.fc-toolbar .fc-center h2');
        if (h && h.textContent) {
          const parsed = Date.parse(h.textContent.trim());
          if (!Number.isNaN(parsed)) return toISODate(new Date(parsed));
        }
        // 3) Try explicit data on #calendar
        const cal = document.querySelector('#calendar');
        const v = cal?.getAttribute('data-default-date');
        if (v && /\d{4}-\d{2}-\d{2}/.test(v)) return v;
        // 4) Fallback legacy #date label
        const label = document.querySelector('#date');
        if (label) {
          const parsed = Date.parse(label.textContent || '');
          if (!Number.isNaN(parsed)) return toISODate(new Date(parsed));
        }
        return null;
      }

      async function gotoDate(target) {
        const cur0 = getCurrentDateStr();
        if (cur0 === target) return true;

        // Prefer FullCalendar API navigation if available
        try {
          const $ = window.jQuery || window.$;
          if ($ && typeof $("#calendar").fullCalendar === 'function') {
            let done = false;
            const onRendered = () => { done = true; };
            $("#calendar").on('viewRender', onRendered);
            $("#calendar").fullCalendar('gotoDate', target);
            // Wait up to ~2s for render
            for (let i = 0; i < 20; i++) {
              await sleep(100);
              const cur = getCurrentDateStr();
              if (cur === target || done) break;
            }
            $("#calendar").off('viewRender', onRendered);
            return getCurrentDateStr() === target;
          }
        } catch {}

        // Fallback to clicking prev/next (try several common selectors)
        let guard = 60; // allow more steps
        const pickNext = () => document.getElementById('calendar-next')
          || document.querySelector('.fc-next-button, button.fc-next-button, .fc-toolbar button[aria-label="next"]');
        const pickPrev = () => document.getElementById('calendar-prev')
          || document.querySelector('.fc-prev-button, button.fc-prev-button, .fc-toolbar button[aria-label="prev"]');
        let next = pickNext();
        let prev = pickPrev();
        if (!next || !prev) return false;
        let lastCur = cur0;
        while (guard-- > 0) {
          const cur = getCurrentDateStr();
          if (cur === target) return true;
          if (!cur) return false;
          const c = new Date(cur + 'T00:00:00');
          const t = new Date(target + 'T00:00:00');
          if (t > c) { next = pickNext() || next; next?.click(); } else { prev = pickPrev() || prev; prev?.click(); }
          await sleep(400);
          const after = getCurrentDateStr();
          // If date didn't change, backoff a bit to let async renders/requests happen
          if (after === lastCur) await sleep(300);
          lastCur = after;
        }
        return getCurrentDateStr() === target;
      }

      // Parse "6:00 AM - 8:00 AM" to { start: "06:00", end: "08:00" }
      function parseTimeRange(fullLabel) {
        if (!fullLabel || typeof fullLabel !== 'string') return { start: null, end: null };
        const parts = fullLabel.split(' - ').map(s => s.trim());
        const to24h = (t) => {
          // Expect formats like "6:00 AM" or "12:00 PM"
          const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
          if (!m) return null;
          let hh = parseInt(m[1], 10);
          const mm = m[2];
          const ampm = m[3].toUpperCase();
          if (ampm === 'AM') {
            if (hh === 12) hh = 0;
          } else {
            if (hh !== 12) hh += 12;
          }
          return String(hh).padStart(2, '0') + ':' + mm;
        };
        if (parts.length === 2) {
          return { start: to24h(parts[0]), end: to24h(parts[1]) };
        }
        return { start: null, end: null };
      }

      // Try the API feed first: same-origin fetch will include cookies
      async function fetchBookingFeed(startDate, endDate) {
        const ts = Date.now();
        const url = `https://platform.aklbadminton.com/api/booking/feed?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}&_=${ts}`;
        const res = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
        try {
          return await res.json();
        } catch {
          // Some endpoints may return text; try to parse manually
          const t = await res.text();
          return JSON.parse(t);
        }
      }

      function isoToHM(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }

      // Normalize feed events -> { bookings: [{ courtIndex, start, end, title }], courts }
      function normalizeFeedToBookings(feed) {
        const items = Array.isArray(feed) ? feed : (Array.isArray(feed?.events) ? feed.events : (Array.isArray(feed?.data) ? feed.data : []));
        const bookings = [];
        const namesByIdx = new Map();
        const guessCourtIndex = (evt) => {
          const candidates = [
            evt.court, evt.courtId, evt.court_id,
            evt.facility, evt.facilityId, evt.facility_id,
            evt.resourceId, evt.resource_id,
            evt.resource?.id,
          ];
          for (const c of candidates) {
            // If numeric 1..12, map to index-1
            const num = typeof c === 'string' ? parseInt(c, 10) : (typeof c === 'number' ? c : NaN);
            if (!Number.isNaN(num) && num >= 1 && num <= 64) return num - 1;
          }
          // Try name fields like "Court 3"
          const name = evt.facility_name || evt.facilityName || evt.facility?.name || evt.resource?.title || evt.resource?.name || evt.title;
          if (name && typeof name === 'string') {
            const m = name.match(/court\s*(\d{1,2})/i) || name.match(/\b(\d{1,2})\b/);
            if (m) {
              const num = parseInt(m[1], 10);
              if (!Number.isNaN(num)) return num - 1;
            }
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
        // Build courts array if names available
        const courts = [];
        if (namesByIdx.size) {
          const maxIdx = Math.max(...Array.from(namesByIdx.keys()));
          for (let i = 0; i <= maxIdx; i++) {
            courts.push({ index: i, name: namesByIdx.get(i) || null });
          }
        }
        return { bookings, courts };
      }

      function collectFromFullCalendarGrid() {
        // Each .fc-content-col corresponds to a court column in DOM order (1..12)
        const skeleton = document.querySelector('.fc-content-skeleton');
        if (!skeleton) return null;
        const columns = Array.from(skeleton.querySelectorAll('.fc-content-col'));
        if (!columns.length) return null;
        const bookings = [];
        columns.forEach((col, idx) => {
          const events = col.querySelectorAll('.fc-event-container a.fc-time-grid-event');
          events.forEach((a) => {
            const timeEl = a.querySelector('.fc-time');
            const titleEl = a.querySelector('.fc-title');
            const dataFull = timeEl?.getAttribute('data-full') || '';
            const dataStart = timeEl?.getAttribute('data-start') || '';
            const time = parseTimeRange(dataFull);
            bookings.push({
              courtIndex: idx, // 0-based; court number = idx+1
              startLabel: dataStart || null,
              rangeLabel: dataFull || null,
              start: time.start,
              end: time.end,
              title: titleEl?.textContent?.trim() || null,
              cssShort: a.classList.contains('fc-short') || false,
            });
          });
        });
        return { columns: columns.length, bookings };
      }

      async function collectSlotsViaFeed(targetDate) {
        try {
          const start = targetDate;
          const end = addDays(targetDate, 1);
          const feed = await fetchBookingFeed(start, end);
          const norm = normalizeFeedToBookings(feed);
          if (Array.isArray(norm.bookings) && norm.bookings.length) {
            return { via: 'feed', facilities: [], courts: norm.courts || [], bookings: norm.bookings };
          }
          return null;
        } catch (_) {
          return null;
        }
      }

      function collectSlotsViaDom() {
        const facilities = (window.__serverData && window.__serverData.facilities) || [];
        // Preferred: parse FullCalendar grid shown in provided HTML snippet
        const grid = collectFromFullCalendarGrid();
        if (grid) {
          // Attempt to attach facility names if counts align
          let courts = [];
          if (Array.isArray(facilities) && facilities.length === grid.columns) {
            courts = facilities.map((f, i) => ({ index: i, id: f.id ?? null, name: f.name ?? null }));
          } else {
            courts = Array.from({ length: grid.columns }, (_, i) => ({ index: i }));
          }
          return { facilities, courts, bookings: grid.bookings };
        }

        // Fallback: legacy clickable slot elements with data-start/data-end
        const slots = [];
        const candidates = Array.from(document.querySelectorAll('a[data-start][data-end], [data-start][data-end]'));
        for (const el of candidates) {
          const start = el.getAttribute('data-start');
          const end = el.getAttribute('data-end');
          let facility = el.getAttribute('data-facility') || el.getAttribute('data-facility-id') || '';
          if (!facility) {
            const owner = el.closest('[data-facility],[data-facility-id]');
            facility = owner?.getAttribute('data-facility') || owner?.getAttribute('data-facility-id') || '';
          }
          const cls = el.className || '';
          const available = !(cls.includes('disabled') || cls.includes('unavailable'));
          if (start && end) slots.push({ facilityId: facility || null, start, end, available });
        }
        if (slots.length) return { facilities, slots };
        // Nothing found
        return { facilities, courts: [], bookings: [] };
      }

      // First navigate the page's calendar to the target date, then scrape the FullCalendar skeleton.
      let navigated = await gotoDate(targetDateStr).catch(() => false);
      // Give the calendar a brief moment to render columns/events after navigation
      for (let i = 0; i < 20; i++) {
        const hasCols = document.querySelector('.fc-content-skeleton .fc-content-col');
        if (hasCols) break;
        await sleep(100);
      }
      let dataset = collectSlotsViaDom();
      // If DOM scraping produced nothing (e.g., structure changed), fall back to API feed
      if (!dataset || (!dataset.bookings && !dataset.slots)) {
        const viaFeed = await collectSlotsViaFeed(targetDateStr);
        if (viaFeed) {
          dataset = viaFeed;
          dataset.via = 'feed';
        } else {
          dataset = { facilities: [], courts: [], bookings: [], via: 'none' };
        }
      } else {
        dataset.via = 'dom';
      }
      return {
        ok: true,
        date: targetDateStr,
        navigated,
        ...dataset,
        counts: dataset.bookings
          ? { total: dataset.bookings.length }
          : { total: dataset.slots.length, available: dataset.slots.filter(s => s.available).length },
      };
      } catch (err) {
        return { ok: false, date: targetDateStr, error: String(err) };
      }
    },
  });
  return result;
}

export async function collectAvailabilityForDate(dateStr) {
  if (!/\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return { ok: false, error: 'Invalid date format, expected YYYY-MM-DD' };
  }
  const tabId = await ensureBookingTab();
  try {
  // Ensure the booking page is freshly loaded after login so session cookies apply
  await chrome.tabs.update(tabId, { url: BOOKING_URL, active: false });
  await waitForTabComplete(tabId);
    const data = await injectCollectScript(tabId, dateStr);
    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
