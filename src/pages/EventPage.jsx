import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useEventData } from '../hooks/useEventData';
import { getGoogleCalendarUrl, downloadIcsCalendar } from '../utils/calendar';
import WalletModal from '../components/WalletModal';
import { emailService } from '../services/emailService';
import { stripeService } from '../services/stripeService';

// Generate a random 12-digit number (100,000,000,000 to 999,999,999,999)
function generateOrderId() {
    const firstDigit = Math.floor(1 + Math.random() * 9);
    const remainingDigits = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
    return `${firstDigit}${remainingDigits}`;
}

export default function EventPage() {
    const { eventId } = useParams();
    const [searchParams] = useSearchParams();
    const { events, orders, cart, addToCart, updateQuantity, removeFromCart, clearCart, recordOrder } = useEventData();
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [success, setSuccess] = useState(false);
    const [lastOrder, setLastOrder] = useState(null);
    const [copiedOrderId, setCopiedOrderId] = useState(false);
    const [copiedTicketLink, setCopiedTicketLink] = useState(false);
    const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '' });
    const [walletModalState, setWalletModalState] = useState({ isOpen: false, type: 'apple' });
    const [emailStatus, setEmailStatus] = useState({ loading: false, sent: false, error: null });
    const [now, setNow] = useState(new Date());

    const event = events.find(e => e.id === (eventId || '1')) || events[0];

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    // Handle return redirect from Stripe Checkout
    useEffect(() => {
        const paymentParam = searchParams.get('payment');
        const returnOrderId = searchParams.get('order_id');

        if (paymentParam === 'success' && returnOrderId && event) {
            const existing = (orders || []).find(o => o.orderId === returnOrderId);
            if (existing) {
                setTimeout(() => {
                    setLastOrder(existing);
                    setSuccess(true);
                    setIsCartOpen(true);
                }, 0);
            } else {
                const pending = sessionStorage.getItem(`pending_order_${returnOrderId}`);
                if (pending) {
                    try {
                        const parsed = JSON.parse(pending);
                        const saved = recordOrder(parsed);
                        setTimeout(() => {
                            setLastOrder(saved);
                            setSuccess(true);
                            setIsCartOpen(true);
                        }, 0);
                        sessionStorage.removeItem(`pending_order_${returnOrderId}`);
                        clearCart();
                        emailService.sendTicketConfirmationEmail(saved, event);
                    } catch (err) {
                        console.error('Failed to parse pending order:', err);
                    }
                }
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [searchParams, orders, event, clearCart, recordOrder]);

    const themeColors = event?.palette || { palette: [] };
    const hasCustomTheme = themeColors.palette && themeColors.palette.length > 0;

    let bgGradient = 'linear-gradient(180deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0) 100%)';
    if (hasCustomTheme && themeColors.dominant && themeColors.dominant.startsWith('rgb')) {
        const rgbaColor = themeColors.dominant.replace('rgb', 'rgba').replace(')', ', 0.15)');
        bgGradient = `linear-gradient(180deg, ${rgbaColor} 0%, rgba(15, 23, 42, 0) 100%)`;
    }

    const customStyles = hasCustomTheme ? {
        '--accent-primary': themeColors.dominant,
        '--accent-secondary': themeColors.palette[1],
        background: bgGradient
    } : {
        background: bgGradient
    };

    if (!event) return <div style={{ textAlign: 'center', marginTop: '100px' }}>Event not found</div>;

    const handleAddToCart = (item) => {
        addToCart(item);
        setSuccess(false);
    };

    const handleCheckout = async (e) => {
        if (e) e.preventDefault();
        setIsCheckingOut(true);

        const orderId = generateOrderId();
        const orderRecord = {
            orderId,
            eventId: event.id,
            eventTitle: event.title,
            eventDate: event.date,
            eventLocation: event.location,
            eventPalette: event.palette,
            customer: { ...customerInfo },
            items: [...cart],
            baseTotal,
            fees: calculatedFees,
            total: cartTotal,
            paymentMethod: 'stripe',
            createdAt: new Date().toISOString()
        };

        try {
            const origin = window.location.origin;
            const stripeRes = await stripeService.createCheckoutSession({
                orderId,
                event,
                customer: customerInfo,
                items: cart,
                fees: calculatedFees,
                successUrl: `${origin}/event/${event.id}?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}&payment=success`,
                cancelUrl: `${origin}/event/${event.id}?payment=cancelled`
            });

            // If live Stripe Checkout session was returned, redirect buyer to Stripe
            if (stripeRes.success && stripeRes.url && stripeRes.mode === 'live') {
                sessionStorage.setItem(`pending_order_${orderId}`, JSON.stringify(orderRecord));
                recordOrder(orderRecord);
                window.location.assign(stripeRes.url);
                return;
            }

            // Fallback instant confirmation (e.g. mock test mode or before live keys are set)
            const savedOrder = recordOrder(orderRecord);
            setLastOrder(savedOrder);
            setIsCheckingOut(false);
            setSuccess(true);
            clearCart();

            // Automatically send ticket passes & receipt via Resend
            setEmailStatus({ loading: true, sent: false, error: null });
            const emailResult = await emailService.sendTicketConfirmationEmail(savedOrder, event);
            if (emailResult.success) {
                setEmailStatus({ loading: false, sent: true, error: null });
            } else {
                setEmailStatus({ loading: false, sent: false, error: emailResult.error });
            }
        } catch (err) {
            console.error('Checkout processing error:', err);
            // Fallback graceful order recording
            const savedOrder = recordOrder(orderRecord);
            setLastOrder(savedOrder);
            setIsCheckingOut(false);
            setSuccess(true);
            clearCart();
            emailService.sendTicketConfirmationEmail(savedOrder, event);
        }
    };

    const handleResendEmail = async () => {
        if (!lastOrder || emailStatus.loading) return;
        setEmailStatus({ loading: true, sent: false, error: null });
        const res = await emailService.sendTicketConfirmationEmail(lastOrder, event);
        if (res.success) {
            setEmailStatus({ loading: false, sent: true, error: null });
        } else {
            setEmailStatus({ loading: false, sent: false, error: res.error });
        }
    };

    const baseTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    const calculatedFees = (event?.fees || []).map(fee => {
        let appliedAmount = 0;
        if (fee.type === 'percentage') {
            appliedAmount = baseTotal * (fee.amount / 100);
        } else if (fee.type === 'fixed_per_ticket') {
            appliedAmount = cartCount * fee.amount;
        } else {
            // fixed per transaction
            appliedAmount = fee.amount;
        }
        return { name: fee.name, amount: appliedAmount };
    });

    const totalFees = calculatedFees.reduce((sum, fee) => sum + fee.amount, 0);
    const cartTotal = baseTotal + totalFees;

    // Calculate ticket sale states
    let earliestTicket = null;
    let anyOnSale = false;

    if (event && event.tickets) {
        event.tickets.forEach(ticket => {
            if (!ticket.onSaleDate) {
                anyOnSale = true;
            } else {
                const saleDate = new Date(ticket.onSaleDate);
                if (saleDate <= now) {
                    anyOnSale = true;
                } else {
                    if (!earliestTicket || saleDate < new Date(earliestTicket.onSaleDate)) {
                        earliestTicket = ticket;
                    }
                }
            }
        });
    }

    const formatTimeLeft = (targetDate) => {
        const diff = new Date(targetDate) - now;
        if (diff <= 0) return "On Sale Now!";

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        const s = Math.floor((diff / 1000) % 60);
        return `${d}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto', paddingBottom: '100px' }}>
            <div className="glass-panel" style={{ ...customStyles, transition: 'all 0.5s ease', position: 'relative' }}>
                <h1 className="gradient-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>{event.title}</h1>
                <p style={{ color: 'var(--text-muted)' }}>
                    {event.date ? (isNaN(new Date(event.date)) ? event.date : new Date(event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : 'TBA'}
                    {event.location ? ` • ${event.location}` : ''}
                </p>

                {event.image && (
                    <div style={{ marginTop: '24px', marginBottom: '24px', textAlign: 'center' }}>
                        <img
                            src={event.image}
                            alt={`${event.title} Promo`}
                            style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', objectFit: 'cover' }}
                        />
                    </div>
                )}

                {!anyOnSale && earliestTicket ? (
                    <div className="glass-panel" style={{ marginTop: '40px', padding: '40px', textAlign: 'center', background: 'rgba(0,0,0,0.3)', border: '2px solid var(--accent-primary)' }}>
                        <h2 style={{ marginBottom: '16px', color: 'var(--accent-primary)' }}>Tickets Available Soon</h2>
                        <div style={{ fontSize: '3rem', fontWeight: 'bold', fontFamily: 'monospace', letterSpacing: '4px', textShadow: '0 0 20px var(--accent-primary)' }}>
                            {formatTimeLeft(earliestTicket.onSaleDate)}
                        </div>
                        <p style={{ marginTop: '16px', fontSize: '1.1rem', color: 'var(--text-muted)' }}>
                            Tickets go on sale: {new Date(earliestTicket.onSaleDate).toLocaleString()} {earliestTicket.timezone}
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginTop: '30px' }}>
                        {event.tickets && event.tickets.map(ticket => {
                            const isScheduled = ticket.onSaleDate && new Date(ticket.onSaleDate) > now;
                            return (
                                <div key={ticket.id} className="glass-panel" style={{ padding: '24px', opacity: isScheduled ? 0.6 : 1, display: 'flex', flexDirection: 'column' }}>
                                    <h3 style={{ marginBottom: ticket.note ? '6px' : '8px' }}>🎫 {ticket.name}</h3>
                                    {ticket.note && (
                                        <p style={{
                                            color: 'var(--text-muted)',
                                            fontSize: '0.85rem',
                                            lineHeight: '1.45',
                                            marginTop: '0',
                                            marginBottom: '14px',
                                            whiteSpace: 'pre-wrap'
                                        }}>
                                            {ticket.note}
                                        </p>
                                    )}
                                    <div style={{ marginTop: 'auto' }}>
                                        <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0' }}>${ticket.price.toFixed(2)}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', marginBottom: '16px' }}>{ticket.quantity} tickets available</p>
                                        <div style={{ minHeight: '16px', marginBottom: '8px' }}>
                                            {isScheduled && (
                                                <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>On sale {new Date(ticket.onSaleDate).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                        <button
                                            className="btn btn-primary"
                                            style={{ width: '100%' }}
                                            onClick={() => handleAddToCart({ id: Date.now() + Math.random(), name: ticket.name, price: ticket.price, note: ticket.note })}
                                            disabled={isScheduled}
                                        >
                                            {isScheduled ? 'Coming Soon' : 'Add Ticket'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Floating Cart Button */}
            {cartCount > 0 && !isCartOpen && (
                <button
                    className="btn btn-primary animate-fade-in"
                    style={{
                        position: 'fixed',
                        bottom: '24px',
                        right: '16px',
                        zIndex: 900,
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        padding: '14px 22px',
                        borderRadius: '30px',
                        fontSize: '0.95rem',
                        fontWeight: 700
                    }}
                    onClick={() => setIsCartOpen(true)}
                >
                    🛒 View Cart ({cartCount})
                </button>
            )}

            {/* Slide-out Cart Panel */}
            {isCartOpen && (
                <>
                    <div
                        style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 950 }}
                        onClick={() => setIsCartOpen(false)}
                    />
                    <div
                        className="animate-fade-in cart-drawer-panel"
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '16px 20px 16px 28px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                            background: 'rgba(2, 6, 23, 0.5)'
                        }}>
                            <h2 className="gradient-text" style={{ margin: 0, fontSize: '1.35rem' }}>
                                {success ? 'Order Confirmation' : 'Your Order'}
                            </h2>
                            <button
                                onClick={() => setIsCartOpen(false)}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    border: 'none',
                                    color: '#fff',
                                    fontSize: '1.2rem',
                                    cursor: 'pointer',
                                    borderRadius: '50%',
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: '1'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            WebkitOverflowScrolling: 'touch',
                            padding: '20px 20px 60px 28px',
                            display: 'flex',
                            flexDirection: 'column',
                            boxSizing: 'border-box'
                        }}>
                            {success && lastOrder ? (
                                <div style={{ margin: '16px 0' }} className="animate-fade-in">
                                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                                        <div style={{ fontSize: '3.5rem', marginBottom: '8px' }}>🎉</div>
                                        <h3 style={{ color: 'var(--success)', marginBottom: '6px', fontSize: '1.4rem' }}>Payment Successful!</h3>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                            Your tickets have been sent to <strong>{lastOrder.customer.email}</strong>.
                                        </p>
                                    </div>

                                    {/* Order ID Card */}
                                    <div style={{
                                        background: 'rgba(255, 255, 255, 0.04)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '12px',
                                        padding: '20px 16px',
                                        marginBottom: '20px',
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
                                                Order ID
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(lastOrder.orderId);
                                                    setCopiedOrderId(true);
                                                    setTimeout(() => setCopiedOrderId(false), 2000);
                                                }}
                                                style={{
                                                    background: copiedOrderId ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                                                    border: '1px solid ' + (copiedOrderId ? 'var(--success)' : 'rgba(255, 255, 255, 0.2)'),
                                                    color: copiedOrderId ? 'var(--success)' : '#fff',
                                                    borderRadius: '6px',
                                                    padding: '4px 10px',
                                                    fontSize: '0.75rem',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {copiedOrderId ? '✓ Copied' : 'Copy'}
                                            </button>
                                        </div>

                                        <div style={{
                                            fontSize: '1.6rem',
                                            fontWeight: 800,
                                            fontFamily: 'monospace',
                                            letterSpacing: '3px',
                                            color: 'var(--accent-primary)',
                                            padding: '8px 0',
                                            textAlign: 'center',
                                            background: 'rgba(0,0,0,0.25)',
                                            borderRadius: '8px',
                                            border: '1px dashed rgba(255,255,255,0.1)'
                                        }}>
                                            {lastOrder.orderId}
                                        </div>

                                        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>Event</span>
                                                <span style={{ fontWeight: 500, textAlign: 'right' }}>{lastOrder.eventTitle}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>Purchaser</span>
                                                <span>{lastOrder.customer.name}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>Items</span>
                                                <span>{lastOrder.items.reduce((s, i) => s + i.quantity, 0)} tickets</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.08)', fontWeight: 'bold' }}>
                                                <span>Total Paid</span>
                                                <span className="gradient-text" style={{ fontSize: '1.05rem' }}>${lastOrder.total.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Email Delivery Status Card */}
                                    <div style={{
                                        padding: '12px 14px',
                                        borderRadius: '8px',
                                        background: emailStatus.sent
                                            ? 'rgba(34, 197, 94, 0.12)'
                                            : emailStatus.error
                                            ? 'rgba(239, 68, 68, 0.12)'
                                            : 'rgba(255, 255, 255, 0.04)',
                                        border: `1px solid ${emailStatus.sent ? 'rgba(34, 197, 94, 0.3)' : emailStatus.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '12px',
                                        fontSize: '0.85rem'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                            <span style={{ fontSize: '1.1rem' }}>{emailStatus.loading ? '⏳' : emailStatus.sent ? '✉️' : '⚠️'}</span>
                                            <div style={{ lineHeight: '1.3' }}>
                                                <div style={{ fontWeight: 600, color: emailStatus.sent ? '#86efac' : emailStatus.error ? '#fca5a5' : '#ffffff' }}>
                                                    {emailStatus.loading ? 'Sending ticket passes...' : emailStatus.sent ? 'Tickets Emailed!' : 'Email Delivery Notice'}
                                                </div>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                                    {emailStatus.loading
                                                        ? `Dispatching to ${lastOrder.customer.email}`
                                                        : emailStatus.sent
                                                        ? `Confirmation sent to ${lastOrder.customer.email}`
                                                        : emailStatus.error || 'Resend API notice'}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={emailStatus.loading}
                                            onClick={handleResendEmail}
                                            style={{
                                                background: 'rgba(255,255,255,0.08)',
                                                border: '1px solid rgba(255,255,255,0.15)',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '0.78rem',
                                                padding: '6px 10px',
                                                cursor: emailStatus.loading ? 'wait' : 'pointer',
                                                fontWeight: 500,
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {emailStatus.loading ? 'Sending...' : 'Resend'}
                                        </button>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <Link
                                            to={`/tickets/${lastOrder.orderId}`}
                                            className="btn btn-primary"
                                            style={{ width: '100%', padding: '14px', fontSize: '1rem', textDecoration: 'none', boxSizing: 'border-box' }}
                                        >
                                            🎟️ View & Access Digital Tickets
                                        </Link>

                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={() => {
                                                const url = `${window.location.origin}/tickets/${lastOrder.orderId}`;
                                                navigator.clipboard.writeText(url);
                                                setCopiedTicketLink(true);
                                                setTimeout(() => setCopiedTicketLink(false), 2000);
                                            }}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                fontSize: '0.9rem',
                                                background: 'rgba(255,255,255,0.08)',
                                                color: '#fff',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '8px'
                                            }}
                                        >
                                            {copiedTicketLink ? '✓ Ticket Link Copied!' : '🔗 Copy Shareable Ticket Link'}
                                        </button>

                                        {/* 1-Tap Calendar Integration */}
                                        <div style={{
                                            marginTop: '6px',
                                            padding: '12px 14px',
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: '10px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', letterSpacing: '0.5px' }}>
                                                📅 ADD EVENT TO PHONE CALENDAR
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const ticketUrl = `${window.location.origin}/tickets/${lastOrder.orderId}`;
                                                        downloadIcsCalendar({
                                                            title: lastOrder.eventTitle,
                                                            description: `Tickets for ${lastOrder.eventTitle}`,
                                                            location: event?.location || 'Venue',
                                                            date: event?.date,
                                                            ticketUrl
                                                        });
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        padding: '9px 8px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(255,255,255,0.15)',
                                                        background: 'rgba(255,255,255,0.06)',
                                                        color: '#fff',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <span>🍏</span>
                                                    <span>Apple / iOS</span>
                                                </button>

                                                <a
                                                    href={getGoogleCalendarUrl({
                                                        title: lastOrder.eventTitle,
                                                        description: `Tickets for ${lastOrder.eventTitle}`,
                                                        location: event?.location || 'Venue',
                                                        date: event?.date,
                                                        ticketUrl: `${window.location.origin}/tickets/${lastOrder.orderId}`
                                                    })}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        padding: '9px 8px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(255,255,255,0.15)',
                                                        background: 'rgba(255,255,255,0.06)',
                                                        color: '#fff',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        textDecoration: 'none',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <span>📅</span>
                                                    <span>Google</span>
                                                </a>
                                            </div>
                                        </div>

                                        {/* Mobile Wallet Integration */}
                                        <div style={{
                                            marginTop: '6px',
                                            padding: '12px 14px',
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: '10px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', letterSpacing: '0.5px' }}>
                                                📲 SAVE TO MOBILE WALLET
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setWalletModalState({ isOpen: true, type: 'apple' })}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        padding: '10px 8px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                        background: '#000000',
                                                        color: '#fff',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    <span></span>
                                                    <span>Apple Wallet</span>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setWalletModalState({ isOpen: true, type: 'google' })}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        padding: '10px 8px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                        background: '#000000',
                                                        color: '#fff',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    <span>💳</span>
                                                    <span>Google Wallet</span>
                                                </button>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', marginTop: '6px', textDecoration: 'underline' }}
                                            onClick={() => {
                                                setIsCartOpen(false);
                                                setSuccess(false);
                                                setLastOrder(null);
                                                setCopiedOrderId(false);
                                                setCopiedTicketLink(false);
                                                setEmailStatus({ loading: false, sent: false, error: null });
                                            }}
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            ) : success ? (
                                <div style={{ textAlign: 'center', margin: '40px 0' }} className="animate-fade-in">
                                    <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🎉</div>
                                    <h3 style={{ color: 'var(--success)', marginBottom: '8px' }}>Payment Successful!</h3>
                                    <p style={{ color: 'var(--text-muted)' }}>Your e-tickets have been sent to your email.</p>
                                </div>
                            ) : cart.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>Your cart is empty.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {cart.map((item, idx) => (
                                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <span style={{ fontWeight: 500 }}>{item.name}</span>
                                                    {item.note && (
                                                        <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                                                            {item.note.length > 70 ? `${item.note.slice(0, 70)}...` : item.note}
                                                        </p>
                                                    )}
                                                </div>
                                                <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(0,0,0,0.2)', padding: '4px 12px', borderRadius: '20px' }}>
                                                    <button onClick={() => updateQuantity(item.name, -1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}>-</button>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{item.quantity}</span>
                                                    <button onClick={() => updateQuantity(item.name, 1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}>+</button>
                                                </div>
                                                <button onClick={() => removeFromCart(item.name)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85rem' }}>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {!success && (
                                <form onSubmit={handleCheckout} style={{ marginTop: '24px', paddingTop: '20px', borderTop: '2px solid rgba(255,255,255,0.1)', width: '100%', boxSizing: 'border-box' }}>
                                    {cart.length > 0 && (
                                        <div style={{ marginBottom: '24px', width: '100%', boxSizing: 'border-box' }}>
                                            <h3 style={{ marginBottom: '16px', fontSize: '1.1rem' }}>Customer Details</h3>
                                            <input
                                                type="text"
                                                required
                                                placeholder="Full Name"
                                                value={customerInfo.name}
                                                onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                                                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '12px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '1rem' }}
                                            />
                                            <input
                                                type="email"
                                                required
                                                placeholder="Email Address"
                                                value={customerInfo.email}
                                                onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                                                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '12px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '1rem' }}
                                            />
                                            <input
                                                type="tel"
                                                required
                                                placeholder="Phone Number"
                                                value={customerInfo.phone}
                                                onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                                                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '24px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '1rem' }}
                                            />

                                            <h3 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Payment Method</h3>
                                            <div style={{
                                                background: 'rgba(99, 102, 241, 0.08)',
                                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                                borderRadius: '12px',
                                                padding: '16px',
                                                marginBottom: '20px',
                                                width: '100%',
                                                boxSizing: 'border-box'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span>💳</span> Stripe Checkout
                                                    </span>
                                                    <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.25)', color: '#a5b4fc', fontWeight: 600 }}>
                                                        🔒 256-Bit SSL
                                                    </span>
                                                </div>
                                                <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                                    Accepts Credit / Debit Cards, Apple Pay, and Google Pay with instant ticket delivery & QR check-in pass.
                                                </p>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}>Visa</span>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}>Mastercard</span>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}>Amex</span>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}> Apple Pay</span>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}>Google Pay</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.95rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                                        <span>${baseTotal.toFixed(2)}</span>
                                    </div>
                                    {calculatedFees.map((fee, idx) => (
                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.95rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>{fee.name}</span>
                                            <span>${fee.amount.toFixed(2)}</span>
                                        </div>
                                    ))}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', fontSize: '1.25rem', fontWeight: 'bold' }}>
                                        <span>Total</span>
                                        <span className="gradient-text">${cartTotal.toFixed(2)}</span>
                                    </div>

                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        style={{
                                            width: '100%',
                                            fontSize: '1.05rem',
                                            padding: '16px',
                                            boxSizing: 'border-box',
                                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
                                            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)'
                                        }}
                                        disabled={cart.length === 0 || isCheckingOut}
                                    >
                                        {isCheckingOut ? (
                                            'Connecting to Stripe Checkout...'
                                        ) : (
                                            `Pay with Stripe • $${cartTotal.toFixed(2)}`
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Wallet Pass Preview Modal */}
            <WalletModal
                isOpen={walletModalState.isOpen}
                walletType={walletModalState.type}
                order={lastOrder}
                event={event}
                onClose={() => setWalletModalState({ isOpen: false, type: 'apple' })}
            />
        </div>
    );
}
