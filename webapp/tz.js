// Centralised timezone utilities.
//
// Storage contract (what goes into Supabase):
//   Blocked_Time  — date and starttime/endtime stored as UTC strings ("2026-06-17", "20:00:00").
//   Teacher_Availability — starttime/endtime stored in the teacher's LOCAL timezone.
//     Reason: weekly availability is a recurring LOCAL-time concept. DST shifts the UTC offset
//     twice a year and PST sessions after ~4 pm would cross UTC midnight, breaking day-of-week
//     matching. The available_teachers RPC converts UTC session times to the teacher's IANA
//     timezone before comparing, so availability checks remain correct across DST transitions.
//
// Display contract:
//   All date/time values shown to users are converted to their local timezone via fmtLocalDateTime.

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

// Populate a <select> with common timezones shown as abbreviations.
// Option value is the IANA name so DST is handled correctly in the DB.
function buildTzSelect(selectEl, currentTz) {
    const TZ_LIST = [
        { tz: 'Pacific/Midway',           label: 'SST  — Samoa Standard Time       (UTC−11)' },
        { tz: 'Pacific/Honolulu',          label: 'HST  — Hawaii Standard Time      (UTC−10)' },
        { tz: 'America/Anchorage',         label: 'AKST — Alaska Time               (UTC−9)'  },
        { tz: 'America/Los_Angeles',       label: 'PST  — Pacific Time              (UTC−8)'  },
        { tz: 'America/Phoenix',           label: 'MST  — Mountain Time (no DST)    (UTC−7)'  },
        { tz: 'America/Denver',            label: 'MDT  — Mountain Time             (UTC−7)'  },
        { tz: 'America/Chicago',           label: 'CST  — Central Time              (UTC−6)'  },
        { tz: 'America/New_York',          label: 'EST  — Eastern Time              (UTC−5)'  },
        { tz: 'America/Halifax',           label: 'AST  — Atlantic Time             (UTC−4)'  },
        { tz: 'America/St_Johns',          label: 'NST  — Newfoundland Time         (UTC−3:30)'},
        { tz: 'America/Sao_Paulo',         label: 'BRT  — Brazil Time               (UTC−3)'  },
        { tz: 'Atlantic/Azores',           label: 'AZOT — Azores Time               (UTC−1)'  },
        { tz: 'UTC',                        label: 'UTC  — Coordinated Universal Time(UTC+0)'  },
        { tz: 'Europe/London',             label: 'GMT  — Greenwich Mean Time       (UTC+0)'  },
        { tz: 'Europe/Paris',              label: 'CET  — Central European Time     (UTC+1)'  },
        { tz: 'Europe/Helsinki',           label: 'EET  — Eastern European Time     (UTC+2)'  },
        { tz: 'Europe/Moscow',             label: 'MSK  — Moscow Time               (UTC+3)'  },
        { tz: 'Asia/Dubai',                label: 'GST  — Gulf Standard Time        (UTC+4)'  },
        { tz: 'Asia/Karachi',              label: 'PKT  — Pakistan Time             (UTC+5)'  },
        { tz: 'Asia/Kolkata',              label: 'IST  — India Standard Time       (UTC+5:30)'},
        { tz: 'Asia/Dhaka',                label: 'BST  — Bangladesh Time           (UTC+6)'  },
        { tz: 'Asia/Bangkok',              label: 'ICT  — Indochina Time            (UTC+7)'  },
        { tz: 'Asia/Shanghai',             label: 'CST  — China Standard Time       (UTC+8)'  },
        { tz: 'Asia/Singapore',            label: 'SGT  — Singapore Time            (UTC+8)'  },
        { tz: 'Asia/Tokyo',                label: 'JST  — Japan Standard Time       (UTC+9)'  },
        { tz: 'Australia/Darwin',          label: 'ACST — Australian Central Time   (UTC+9:30)'},
        { tz: 'Australia/Sydney',          label: 'AEST — Australian Eastern Time   (UTC+10)' },
        { tz: 'Pacific/Auckland',          label: 'NZST — New Zealand Time          (UTC+12)' },
    ];

    selectEl.innerHTML = '';
    let matched = false;
    for (const { tz, label } of TZ_LIST) {
        const opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = label;
        if (tz === currentTz) { opt.selected = true; matched = true; }
        selectEl.appendChild(opt);
    }
    if (currentTz && !matched) {
        const opt = document.createElement('option');
        opt.value = currentTz; opt.textContent = currentTz; opt.selected = true;
        selectEl.prepend(opt);
    }
}
