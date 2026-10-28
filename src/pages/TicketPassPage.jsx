import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useEventData } from '../hooks/useEventData';
import QRCode from 'qrcode';
import { getGoogleCalendarUrl, downloadIcsCalendar } from '../utils/calendar';
import WalletModal from '../components/WalletModal';
import { encodePassToken, decodePassToken } from '../utils/passToken';
import { sanitizeCssColor } from '../utils/security';

export default function TicketPassPage() {
    const { orderId } = useParams();
    const [searchParams] = useSearchParams();
    const { orders, events, recordOrder, checkInTicket } = useEventData();

    const [selectedTicketIndex, setSelectedTicketIndex] = useState(0);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [copiedLink, setCopiedLink] = useState(false);
    const [checkInMessage, setCheckInMessage] = useState('');
    const [walletModalState, setWalletModalState] = useState({ isOpen: false, type: 'apple' });

    // Locate the order in local state
    const order = (orders || []).find(o => o.orderId === orderId);
    const event = order ? (events || []).find(e => e.id === order.eventId) : null;

    // Automatically hydrate the order if opening on a new device (e.g. from confirmation email)
    useEffect(() => {
        const passParam = searchParams.get('pass');
        if (!order && passParam && recordOrder) {
            const decodedOrder = decodePassToken(passParam);
            if (decodedOrder && String(decodedOrder.orderId) === String(orderId)) {
                recordOrder(decodedOrder);
            }
        }
    }, [order, orderId, searchParams, recordOrder]);

    // Expand tickets if older order structure was missing them
    const tickets = useMemo(() => {
        if (!order) return [];
        if (order.tickets && order.tickets.length > 0) return order.tickets;
        const list = [];
        let counter = 1;
        (order.items || []).forEach(item => {
            for (let q = 0; q < item.quantity; q++) {
                list.push({
                    ticketId: `${order.orderId}-${String(counter).padStart(2, '0')}`,
                    name: item.name,
                    price: item.price,
                    note: item.note || '',
                    checkInStatus: 'valid',
                    checkedInAt: null
                });
                counter++;
            }
        });
        return list;
    }, [order]);

    // Derive active ticket index from query param or manual selection
    const activeTicketIndex = useMemo(() => {
        const targetTicketId = searchParams.get('ticketId');
        if (targetTicketId && tickets.length > 0) {
            const idx = tickets.findIndex(t => t.ticketId === targetTicketId);
            if (idx !== -1) return idx;
        }
        return selectedTicketIndex < tickets.length ? selectedTicketIndex : 0;
    }, [searchParams, tickets, selectedTicketIndex]);

    const currentTicket = tickets[activeTicketIndex] || tickets[0];

    // Generate Scannable QR Code for current ticket pass
    useEffect(() => {
        if (!order || !currentTicket) return;

        // The QR code contains a direct verification URL that opens this ticket pass and verifies it
        const passToken = encodePassToken(order);
        const passQuery = passToken ? `&pass=${encodeURIComponent(passToken)}` : '';
        const verifyUrl = `${window.location.origin}/tickets/${order.orderId}?ticketId=${currentTicket.ticketId}&checkin=1${passQuery}`;

        QRCode.toDataURL(verifyUrl, {
            width: 280,
            margin: 2,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            },
            errorCorrectionLevel: 'H'
        })
            .then(url => setQrCodeDataUrl(url))
            .catch(err => console.error('Failed to generate ticket QR code:', err));
    }, [order, currentTicket]);

    if (!order) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center' }}>
                <div className="glass-panel" style={{ padding: '48px 32px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎟️</div>
                    <h2 style={{ marginBottom: '12px' }}>Accessing Your Ticket</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '20px', lineHeight: '1.6' }}>
                        No local ticket order was found for Order ID: <code style={{ color: 'var(--accent-primary)' }}>{orderId}</code> on this browser.
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '28px', lineHeight: '1.5' }}>
                        If you received an order confirmation email, please tap the <strong>"View & Access Digital Tickets"</strong> button inside that email to automatically sync your tickets to this device.
                    </p>
                    <Link to="/portal" className="btn btn-primary">
                        Browse Events
                    </Link>
                </div>
            </div>
        );
    }

    const themeColors = event?.palette || order?.eventPalette || { dominant: 'rgb(236, 72, 153)', palette: [] };
    const dominantColor = sanitizeCssColor(themeColors.dominant, 'var(--accent-primary)');

    const handleCopyTicketLink = () => {
        const passToken = encodePassToken(order);
        const passQuery = passToken ? `&pass=${encodeURIComponent(passToken)}` : '';
        const url = `${window.location.origin}/tickets/${order.orderId}?ticketId=${currentTicket?.ticketId || ''}${passQuery}`;
        navigator.clipboard.writeText(url);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
    };

    const handleStaffCheckIn = () => {
        if (!currentTicket) return;

        if (currentTicket.checkInStatus === 'checked_in') {
            setCheckInMessage('⚠️ This ticket has already been used and checked in!');
            setTimeout(() => setCheckInMessage(''), 3500);
            return;
        }

        checkInTicket(order.orderId, currentTicket.ticketId);
        setCheckInMessage('✅ Ticket successfully checked in! Entry granted.');
        setTimeout(() => setCheckInMessage(''), 3500);
    };

    const isCheckedIn = currentTicket?.checkInStatus === 'checked_in';

    return (
        <div className="animate-fade-in" style={{ maxWidth: '480px', margin: '20px auto 80px', padding: '0 16px' }}>
            {/* Top Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <Link to={`/event/${order.eventId}`} style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ← Back to Event
                </Link>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={handleCopyTicketLink}
                        style={{
                            background: copiedLink ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid ' + (copiedLink ? 'var(--success)' : 'var(--border-color)'),
                            color: copiedLink ? 'var(--success)' : '#fff',
                            borderRadius: '20px',
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <span>🔗</span>
                        <span>{copiedLink ? 'Link Copied!' : 'Copy Ticket Link'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => window.print()}
                        style={{
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid var(--border-color)',
                            color: '#fff',
                            borderRadius: '20px',
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            cursor: 'pointer'
                        }}
                    >
                        🖨️ Print
                    </button>
                </div>
            </div>

            {/* Multiple Tickets Selector */}
            {tickets.length > 1 && (
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', textAlign: 'center' }}>
                        Your Order Contains <strong>{tickets.length} Tickets</strong> (Select to view):
                    </div>
                    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                        {tickets.map((t, idx) => (
                            <button
                                key={t.ticketId}
                                type="button"
                                onClick={() => setSelectedTicketIndex(idx)}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '12px',
                                    border: '1px solid ' + (activeTicketIndex === idx ? dominantColor : 'rgba(255,255,255,0.1)'),
                                    background: activeTicketIndex === idx ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
                                    color: activeTicketIndex === idx ? '#fff' : 'var(--text-muted)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: activeTicketIndex === idx ? 600 : 400,
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '2px'
                                }}
                            >
                                <span>Pass #{idx + 1}</span>
                                <span style={{ fontSize: '0.72rem', color: t.checkInStatus === 'checked_in' ? 'var(--accent-secondary)' : 'var(--success)' }}>
                                    {t.checkInStatus === 'checked_in' ? '● Checked In' : '● Valid'}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Check-In Feedback Banner */}
            {checkInMessage && (
                <div style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                    background: checkInMessage.startsWith('✅') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid ' + (checkInMessage.startsWith('✅') ? 'var(--success)' : 'rgba(239, 68, 68, 0.4)'),
                    color: '#fff'
                }}>
                    {checkInMessage}
                </div>
            )}

            {/* The Ticket Pass Card */}
            <div style={{
                background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.95) 100%)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
                overflow: 'hidden',
                position: 'relative'
            }}>
                {/* Event Glow Header */}
                <div style={{
                    padding: '24px',
                    background: `linear-gradient(135deg, ${dominantColor} 0%, rgba(139, 92, 246, 0.6) 100%)`,
                    color: '#fff',
                    position: 'relative'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', background: 'rgba(0,0,0,0.3)', padding: '4px 10px', borderRadius: '12px' }}>
                            Ticket Lite Official Pass
                        </span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            Pass {activeTicketIndex + 1} of {tickets.length}
                        </span>
                    </div>

                    <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '8px 0 4px', textShadow: '0 2px 10px rgba(0,0,0,0.4)', lineHeight: 1.2 }}>
                        {order.eventTitle}
                    </h2>

                    <p style={{ margin: 0, opacity: 0.9, fontSize: '0.9rem' }}>
                        {event?.date ? (isNaN(new Date(event.date)) ? event.date : new Date(event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : 'Event Date TBA'}
                        {event?.location ? ` • ${event.location}` : ''}
                    </p>
                </div>

                {/* Ticket Body */}
                <div style={{ padding: '24px' }}>
                    {/* Ticket Class & Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
                                Admission Tier
                            </div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff' }}>
                                🎫 {currentTicket?.name || 'General Admission'}
                            </div>
                            {currentTicket?.note && (
                                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: 1.35 }}>
                                    {currentTicket.note}
                                </p>
                            )}
                        </div>

                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
                                Status
                            </div>
                            <span style={{
                                display: 'inline-block',
                                padding: '4px 12px',
                                borderRadius: '20px',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                background: isCheckedIn ? 'rgba(139, 92, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                                border: '1px solid ' + (isCheckedIn ? 'var(--accent-secondary)' : 'var(--success)'),
                                color: isCheckedIn ? 'var(--accent-secondary)' : 'var(--success)'
                            }}>
                                {isCheckedIn ? 'CHECKED IN' : 'VALID'}
                            </span>
                        </div>
                    </div>

                    {/* QR Code Container */}
                    <div style={{
                        background: '#ffffff',
                        borderRadius: '16px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                        marginBottom: '20px'
                    }}>
                        {qrCodeDataUrl ? (
                            <img
                                src={qrCodeDataUrl}
                                alt="Ticket QR Code"
                                style={{ width: '220px', height: '220px', display: 'block' }}
                            />
                        ) : (
                            <div style={{ width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                                Generating QR Pass...
                            </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', marginTop: '4px' }}>
                            Scan at venue gate for entry
                        </div>
                    </div>

                    {/* Pass Identifiers */}
                    <div style={{
                        background: 'rgba(0,0,0,0.25)',
                        border: '1px dashed rgba(255,255,255,0.12)',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        fontSize: '0.85rem',
                        marginBottom: '20px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Ticket Pass ID</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '1px' }}>
                                {currentTicket?.ticketId}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>12-Digit Order ID</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                #{order.orderId}
                            </span>
                        </div>
                        {currentTicket?.checkedInAt && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-secondary)' }}>
                                <span>Checked In Time</span>
                                <span>{new Date(currentTicket.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )}
                    </div>

                    {/* Venue Staff Check-In Simulator */}
                    <div style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        padding: '16px',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            Venue Staff Check-In Action:
                        </div>
                        <button
                            type="button"
                            onClick={handleStaffCheckIn}
                            style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: '8px',
                                border: 'none',
                                background: isCheckedIn ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {isCheckedIn ? '✓ Verified & Checked In' : '📷 Simulate Venue Staff Check-In'}
                        </button>
                    </div>
                </div>
            </div>

            {/* 1-Tap Calendar Integration */}
            <div style={{
                marginTop: '16px',
                padding: '16px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                textAlign: 'center'
            }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.5px' }}>
                    📅 ADD EVENT TO PHONE CALENDAR
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={() => {
                            const ticketUrl = `${window.location.origin}/tickets/${order.orderId}?ticketId=${currentTicket?.ticketId || ''}`;
                            downloadIcsCalendar({
                                title: order.eventTitle,
                                description: `Tickets for ${order.eventTitle} (${currentTicket?.name || 'General Admission'})`,
                                location: event?.location || 'Venue',
                                date: event?.date,
                                ticketUrl
                            });
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: '#fff',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <span>🍏</span>
                        <span>Apple / iOS</span>
                    </button>

                    <a
                        href={getGoogleCalendarUrl({
                            title: order.eventTitle,
                            description: `Tickets for ${order.eventTitle} (${currentTicket?.name || 'General Admission'})`,
                            location: event?.location || 'Venue',
                            date: event?.date,
                            ticketUrl: `${window.location.origin}/tickets/${order.orderId}?ticketId=${currentTicket?.ticketId || ''}`
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: '#fff',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            textDecoration: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <span>📅</span>
                        <span>Google</span>
                    </a>
                </div>
            </div>

            {/* Mobile Wallet Integration */}
            <div style={{
                marginTop: '16px',
                padding: '16px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                textAlign: 'center'
            }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.5px' }}>
                    📲 SAVE PASS TO MOBILE WALLET
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={() => setWalletModalState({ isOpen: true, type: 'apple' })}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '12px 14px',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: '#000000',
                            color: '#fff',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <span style={{ fontSize: '1.05rem' }}></span>
                        <span>Apple Wallet</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setWalletModalState({ isOpen: true, type: 'google' })}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '12px 14px',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: '#000000',
                            color: '#fff',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <span style={{ fontSize: '1.05rem' }}>💳</span>
                        <span>Google Wallet</span>
                    </button>
                </div>
            </div>

            {/* Hyperlink Info Footer */}
            <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <span>Stored in shareable hyperlink: </span>
                <span style={{ color: 'var(--accent-primary)', wordBreak: 'break-all' }}>
                    {`/tickets/${order.orderId}`}
                </span>
            </div>

            {/* Wallet Pass Preview Modal */}
            <WalletModal
                isOpen={walletModalState.isOpen}
                walletType={walletModalState.type}
                order={order}
                ticket={currentTicket}
                event={event}
                onClose={() => setWalletModalState({ isOpen: false, type: 'apple' })}
            />
        </div>
    );
}
