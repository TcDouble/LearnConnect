// Centralised timezone utilities.
// All times in Blocked_Time are stored as UTC; Teacher_Availability is stored
// in the teacher's own local timezone (matched server-side via available_teachers RPC).

const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Display a UTC date + time in the viewer's local timezone.
function fmtLocalDateTime(utcDate, utcTime) {
    if (!utcDate || !utcTime) return '—';
    const dt = new Date(`${utcDate}T${utcTime.slice(0, 5)}:00Z`);
    return dt.toLocaleString('en-US', {
        timeZone: USER_TZ,
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}

// Display a UTC time only (needs the date to cross DST boundaries correctly).
function fmtLocalTime(utcDate, utcTime) {
    if (!utcTime) return '—';
    const dt = new Date(`${utcDate || '1970-01-01'}T${utcTime.slice(0, 5)}:00Z`);
    return dt.toLocaleString('en-US', { timeZone: USER_TZ, hour: 'numeric', minute: '2-digit' });
}

// Convert a local date string (YYYY-MM-DD) + time string (HH:MM) to UTC.
function localToUTC(localDateStr, localTimeStr) {
    const dt = new Date(`${localDateStr}T${localTimeStr}:00`);
    return {
        date: dt.toISOString().slice(0, 10),
        time: dt.toISOString().slice(11, 16),
        iso:  dt.toISOString()
    };
}

// Format the UTC equivalent of a local date+time for a small "stored as" hint.
// e.g. fmtUTCDateTime('2026-06-22', '10:00') → 'Mon, 22 Jun 2026 18:00 UTC'
function fmtUTCDateTime(localDateStr, localTimeStr) {
    if (!localDateStr || !localTimeStr) return '';
    try {
        const dt = new Date(`${localDateStr}T${localTimeStr}:00`);
        if (isNaN(dt)) return '';
        const pad = n => String(n).padStart(2, '0');
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${days[dt.getUTCDay()]}, ${pad(dt.getUTCDate())} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())} UTC`;
    } catch { return ''; }
}

// Populate a <select> with all IANA timezones sorted by current UTC offset.
// Option value is the IANA name (e.g. "America/Los_Angeles").
function buildTzSelect(selectEl, currentTz) {
    const now = new Date();
    const allTzs = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
           'America/Anchorage','Pacific/Honolulu','Europe/London','Europe/Paris','Europe/Berlin',
           'Europe/Moscow','Asia/Dubai','Asia/Kolkata','Asia/Bangkok','Asia/Shanghai',
           'Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];

    const items = allTzs.map(tz => {
        try {
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now);
            const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
            const m = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
            const offsetMin = m ? (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3] || '0')) : 0;
            return { tz, offsetMin, label: `${offsetStr} — ${tz.replace(/_/g, ' ')}` };
        } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.offsetMin !== b.offsetMin ? a.offsetMin - b.offsetMin : a.tz.localeCompare(b.tz));

    selectEl.innerHTML = '';
    for (const { tz, label } of items) {
        const opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = label;
        if (tz === currentTz) opt.selected = true;
        selectEl.appendChild(opt);
    }
    if (currentTz && !selectEl.value) {
        const opt = document.createElement('option');
        opt.value = currentTz; opt.textContent = currentTz; opt.selected = true;
        selectEl.prepend(opt);
    }
}
