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
