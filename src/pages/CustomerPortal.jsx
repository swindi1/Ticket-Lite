import React from 'react';
import { Link } from 'react-router-dom';
import { useEventData } from '../hooks/useEventData';
import { sanitizeCssColor, sanitizeImageUrl } from '../utils/security';

export default function CustomerPortal() {
    const { events } = useEventData();

    return (
        <div className="animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <h1 className="gradient-text" style={{ textAlign: 'center', marginBottom: '16px' }}>Upcoming Featured Events</h1>
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '60px' }}>Discover and buy tickets for the best events in your area.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '32px' }}>
                {events.map(event => {
                    const safeImage = sanitizeImageUrl(event.image);
                    const safeDominant = sanitizeCssColor(event.palette?.dominant, 'var(--accent-primary)');
                    return (
                    <div key={event.id} className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
                        <div style={{
                            height: '160px',
                            background: safeImage
                                ? `url("${safeImage}") center/cover no-repeat`
                                : `linear-gradient(45deg, ${safeDominant}, var(--accent-secondary))`
                        }}></div>
                        <div style={{ padding: '24px' }}>
                            <h3 style={{ marginBottom: '8px' }}>{event.title}</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '24px' }}>{event.date}</p>
                            <Link to={`/event/${event.id}`} className="btn btn-primary" style={{ width: '100%' }}>View & Buy Tickets</Link>
                        </div>
                    </div>
                    );
                })}

                {events.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
                        <p style={{ color: 'var(--text-muted)' }}>No upcoming events found. Check back later!</p>
                    </div>
                )}
            </div>
        </div>
    );
}
