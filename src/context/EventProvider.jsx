import React, { useState, useEffect, useCallback } from 'react';
import { EventContext } from './EventContext';

const STORAGE_KEY = 'vtix_events';
const CART_STORAGE_KEY = 'vtix_cart';
const ORDERS_STORAGE_KEY = 'vtix_orders';

const DEFAULT_EVENTS = [
    {
        id: '1',
        title: 'Neon Nights Festival 2026',
        date: 'Friday, October 30th • 10:00 PM',
        currency: 'cad',
        image: null,
        palette: {
            dominant: 'rgb(236, 72, 153)',
            palette: ['rgb(236, 72, 153)', 'rgb(244, 114, 182)', 'rgb(219, 39, 119)', 'rgb(190, 24, 93)', 'rgb(255, 255, 255)']
        },
        tickets: [
            { id: 't1', name: 'General Admission', price: 65.00, priceCents: 6500, quantity: 500, note: 'Full access to general festival grounds, food trucks, and main stage.' },
            { id: 't2', name: 'VIP Access (Skip the line)', price: 150.00, priceCents: 15000, quantity: 100, note: 'Express fast-track entry, VIP lounge access, and private viewing platform.' }
        ]
    }
];

function getPromoterToken() {
    try {
        const saved = localStorage.getItem('vtix_current_promoter');
        return saved ? JSON.parse(saved)?.token || null : null;
    } catch {
        return null;
    }
}

export function EventProvider({ children }) {
    const [events, setEvents] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load events from localStorage:', e);
        }
        return DEFAULT_EVENTS;
    });

    const [cart, setCart] = useState(() => {
        try {
            const saved = localStorage.getItem(CART_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load cart from localStorage:', e);
        }
        return [];
    });

    const [orders, setOrders] = useState(() => {
        try {
            const saved = localStorage.getItem(ORDERS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load orders from localStorage:', e);
        }
        return [];
    });

    // Fetch authoritative events from D1 /api/events on mount
    useEffect(() => {
        let isMounted = true;
        fetch('/api/events')
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (isMounted && data && Array.isArray(data.events) && data.events.length > 0) {
                    setEvents(data.events);
                }
            })
            .catch(() => {});
        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
        } catch (e) {
            console.error('Failed to save events to localStorage:', e);
            if (e.name === 'QuotaExceededError') {
                alert('Storage quota exceeded. Large image attachments may need to be compressed.');
            }
        }
    }, [events]);

    useEffect(() => {
        try {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        } catch (e) {
            console.error('Failed to save cart to localStorage:', e);
        }
    }, [cart]);

    useEffect(() => {
        try {
            localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
        } catch (e) {
            console.error('Failed to save orders to localStorage:', e);
        }
    }, [orders]);

    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) setEvents(parsed);
                } catch (err) {
                    console.error('Failed to parse synchronized events:', err);
                }
            }
            if (e.key === CART_STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) setCart(parsed);
                } catch (err) {
                    console.error('Failed to parse synchronized cart:', err);
                }
            }
            if (e.key === ORDERS_STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) setOrders(parsed);
                } catch (err) {
                    console.error('Failed to parse synchronized orders:', err);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const addEvent = async (newEvent) => {
        const eventWithId = { id: newEvent.id || `evt_${Date.now()}`, ...newEvent };
        const token = getPromoterToken();

        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                credentials: 'same-origin',
                body: JSON.stringify(eventWithId)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.event) {
                    setEvents((prev) => [data.event, ...prev.filter(e => e.id !== data.event.id)]);
                    return data.event;
                }
            }
        } catch (err) {
            console.warn('Could not sync new event to D1:', err);
        }

        setEvents((prev) => [...prev, eventWithId]);
        return eventWithId;
    };

    const updateEvent = async (id, updatedEvent) => {
        const payload = { id, ...updatedEvent };
        const token = getPromoterToken();

        try {
            const res = await fetch('/api/events', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.event) {
                    setEvents((prev) => prev.map((e) => (e.id === id ? data.event : e)));
                    return data.event;
                }
            }
        } catch (err) {
            console.warn('Could not sync updated event to D1:', err);
        }

        setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updatedEvent } : e)));
    };

    const deleteEvent = async (id) => {
        const token = getPromoterToken();
        try {
            await fetch(`/api/events?id=${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                credentials: 'same-origin'
            });
        } catch (err) {
            console.warn('Could not delete event from D1:', err);
        }
        setEvents((prev) => prev.filter((e) => e.id !== id));
    };

    const recordOrder = useCallback((newOrder) => {
        if (!newOrder || !newOrder.orderId) return null;
        const enrichedOrder = {
            ...newOrder,
            tickets: newOrder.tickets || (() => {
                const list = [];
                let counter = 1;
                (newOrder.items || []).forEach((item) => {
                    for (let q = 0; q < item.quantity; q++) {
                        list.push({
                            ticketId: `${newOrder.orderId}-${String(counter).padStart(2, '0')}`,
                            name: item.name,
                            price: item.price,
                            priceCents: item.priceCents ?? Math.round((Number(item.price) || 0) * 100),
                            note: item.note || '',
                            checkInStatus: 'valid',
                            checkedInAt: null
                        });
                        counter++;
                    }
                });
                return list;
            })()
        };

        setOrders((prev) => {
            const exists = prev.some(o => o.orderId === enrichedOrder.orderId);
            if (exists) {
                return prev.map(o => (o.orderId === enrichedOrder.orderId ? { ...o, ...enrichedOrder } : o));
            }
            return [enrichedOrder, ...prev];
        });
        return enrichedOrder;
    }, []);

    /**
     * Checks in a ticket against the D1 database (/api/tickets/checkin).
     * Requires a valid promoter session token and verifies the passToken signature.
     */
    const checkInTicket = useCallback(async (orderId, ticketId, passToken = '') => {
        const token = getPromoterToken();
        const res = await fetch('/api/tickets/checkin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            credentials: 'same-origin',
            body: JSON.stringify({ orderId, ticketId, passToken })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `Ticket check-in failed (HTTP ${res.status}).`);
        }

        const checkedInAt = data.checkedInAt || new Date().toISOString();
        setOrders((prevOrders) =>
            prevOrders.map((order) => {
                if (order.orderId !== orderId) return order;
                const updatedTickets = (order.tickets || []).map((t) => {
                    if (t.ticketId === ticketId) {
                        return {
                            ...t,
                            checkInStatus: 'checked_in',
                            checkedInAt
                        };
                    }
                    return t;
                });
                return {
                    ...order,
                    tickets: updatedTickets
                };
            })
        );

        return data;
    }, []);

    const addToCart = (item) => {
        setCart((prevCart) => {
            const existing = prevCart.find((i) => i.name === item.name);
            if (existing) {
                return prevCart.map((i) =>
                    i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i
                );
            }
            return [...prevCart, { ...item, quantity: 1 }];
        });
    };

    const updateQuantity = (itemName, delta) => {
        setCart((prevCart) => {
            return prevCart
                .map((i) => {
                    if (i.name === itemName) {
                        return { ...i, quantity: i.quantity + delta };
                    }
                    return i;
                })
                .filter((i) => i.quantity > 0);
        });
    };

    const removeFromCart = (itemName) => {
        setCart((prevCart) => prevCart.filter((i) => i.name !== itemName));
    };

    const clearCart = useCallback(() => setCart([]), []);

    return (
        <EventContext.Provider
            value={{
                events,
                addEvent,
                updateEvent,
                deleteEvent,
                cart,
                addToCart,
                updateQuantity,
                removeFromCart,
                clearCart,
                orders,
                recordOrder,
                checkInTicket
            }}
        >
            {children}
        </EventContext.Provider>
    );
}
