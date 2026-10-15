/**
 * Calendar utilities for 1-tap Google Calendar and Apple/iOS Calendar integration
 */

function parseEventDates(dateStr) {
    if (!dateStr) {
        const start = new Date();
        start.setDate(start.getDate() + 7);
        start.setHours(20, 0, 0, 0);
        const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
        return { start, end };
    }

    let start = new Date(dateStr);
    if (isNaN(start.getTime())) {
        const cleaned = String(dateStr).replace(/•/g, ' ').replace(/(st|nd|rd|th)/gi, '');
        start = new Date(cleaned);
        if (isNaN(start.getTime())) {
            const currentYear = new Date().getFullYear();
            start = new Date(`${cleaned} ${currentYear}`);
        }
    }

    if (isNaN(start.getTime())) {
        start = new Date();
        start.setDate(start.getDate() + 7);
        start.setHours(20, 0, 0, 0);
    }

    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000); // 4 hour duration
    return { start, end };
}

function toUtcIso(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcsText(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Generates a 1-tap Google Calendar web intent URL
 */
export function getGoogleCalendarUrl({ title, description, location, date, ticketUrl }) {
    const { start, end } = parseEventDates(date);
    const details = `${description ? description + '\n\n' : ''}🎟️ Access Your Digital Ticket Pass:\n${ticketUrl || ''}\n\nPresent your ticket QR code at the venue gate for check-in.`;

    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: title || 'Event Tickets',
        dates: `${toUtcIso(start)}/${toUtcIso(end)}`,
        details: details,
        location: location || 'Event Venue'
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Triggers a 1-tap Apple / iOS Calendar (.ics) download & native prompt
 */
export function downloadIcsCalendar({ title, description, location, date, ticketUrl }) {
    const { start, end } = parseEventDates(date);
    const details = `${description ? description + '\n\n' : ''}🎟️ Access Your Digital Ticket Pass:\n${ticketUrl || ''}\n\nPresent your ticket QR code at the venue gate for check-in.`;

    const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}@vtix.app`;
    const dtstamp = toUtcIso(new Date());
    const dtstart = toUtcIso(start);
    const dtend = toUtcIso(end);

    const icsLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//V-Tix Lite//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${escapeIcsText(title || 'Event')}`,
        `DESCRIPTION:${escapeIcsText(details)}`,
        `LOCATION:${escapeIcsText(location || 'Venue')}`,
        ...(ticketUrl ? [`URL:${ticketUrl}`] : []),
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
    ];

    const icsContent = icsLines.join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanFilename = (title || 'event').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    link.setAttribute('download', `${cleanFilename}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
