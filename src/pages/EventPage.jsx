import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useEventData } from '../hooks/useEventData';

// Generate a random 12-digit number (100,000,000,000 to 999,999,999,999)
function generateOrderId() {
    const firstDigit = Math.floor(1 + Math.random() * 9);
    const remainingDigits = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
    return `${firstDigit}${remainingDigits}`;
}

export default function EventPage() {
    const { eventId } = useParams();
    const { events, cart, addToCart, updateQuantity, removeFromCart, clearCart, recordOrder } = useEventData();
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [success, setSuccess] = useState(false);
    const [lastOrder, setLastOrder] = useState(null);
    const [copiedOrderId, setCopiedOrderId] = useState(false);
    const [copiedTicketLink, setCopiedTicketLink] = useState(false);
    const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '' });
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    const event = events.find(e => e.id === (eventId || '1')) || events[0];

    if (!event) return <div style={{ textAlign: 'center', marginTop: '100px' }}>Event not found</div>;

    const themeColors = event.palette || { palette: [] };
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

    const handleAddToCart = (item) => {
        addToCart(item);
        setSuccess(false);
    };

    const handleCheckout = (e) => {
        if (e) e.preventDefault();
        setIsCheckingOut(true);

        setTimeout(() => {
            const orderId = generateOrderId();
            const orderRecord = {
                orderId,
                eventId: event.id,
                eventTitle: event.title,
                customer: { ...customerInfo },
                items: [...cart],
                baseTotal,
                fees: calculatedFees,
                total: cartTotal,
                createdAt: new Date().toISOString()
            };

            recordOrder(orderRecord);
            setLastOrder(orderRecord);
            setIsCheckingOut(false);
            setSuccess(true);
            clearCart();
        }, 1200);
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
                    style={{ position: 'fixed', bottom: '32px', right: '32px', zIndex: 900, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', padding: '16px 24px', borderRadius: '30px' }}
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
                        className="animate-fade-in"
                        style={{ position: 'fixed', top: 0, right: 0, width: '400px', maxWidth: '90vw', height: '100vh', background: 'var(--bg-darker)', zIndex: 1000, boxShadow: '-5px 0 30px rgba(0,0,0,0.7)', padding: '32px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border-color)', animation: 'fadeIn 0.3s ease-out' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 className="gradient-text">Your Order</h2>
                            <button onClick={() => setIsCartOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer', lineHeight: '1' }}>×</button>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
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

                                        <button
                                            type="button"
                                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', marginTop: '6px', textDecoration: 'underline' }}
                                            onClick={() => {
                                                setIsCartOpen(false);
                                                setSuccess(false);
                                                setLastOrder(null);
                                                setCopiedOrderId(false);
                                                setCopiedTicketLink(false);
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
                        </div>

                        {!success && (
                            <form onSubmit={handleCheckout} style={{ marginTop: '24px', paddingTop: '24px', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
                                {cart.length > 0 && (
                                    <div style={{ marginBottom: '24px' }}>
                                        <h3 style={{ marginBottom: '16px', fontSize: '1.1rem' }}>Customer Details</h3>
                                        <input type="text" required placeholder="Full Name" value={customerInfo.name} onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })} style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }} />
                                        <input type="email" required placeholder="Email Address" value={customerInfo.email} onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })} style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }} />
                                        <input type="tel" required placeholder="Phone Number" value={customerInfo.phone} onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })} style={{ width: '100%', marginBottom: '24px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }} />

                                        <h3 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>Payment Information</h3>
                                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', padding: '24px', textAlign: 'center', marginBottom: '24px' }}>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>🔒 Secure Stripe Embedded Input Placeholder</span>
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
                                    style={{ width: '100%', fontSize: '1.1rem', padding: '16px' }}
                                    disabled={cart.length === 0 || isCheckingOut}
                                >
                                    {isCheckingOut ? (
                                        'Processing Payment...'
                                    ) : (
                                        `Complete Purchase • $${cartTotal.toFixed(2)}`
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
