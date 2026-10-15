import React, { useState, useEffect } from 'react';
import { EventContext } from './EventContext';

const STORAGE_KEY = 'vtix_events';
const CART_STORAGE_KEY = 'vtix_cart';
const ORDERS_STORAGE_KEY = 'vtix_orders';

const DEFAULT_EVENTS = [
    {
        id: '1',
        title: 'Neon Nights Festival 2026',
        date: 'Friday, October 30th • 10:00 PM',
        image: null,
        palette: {
            dominant: 'rgb(236, 72, 153)', // pink-500
            palette: ['rgb(236, 72, 153)', 'rgb(244, 114, 182)', 'rgb(219, 39, 119)', 'rgb(190, 24, 93)', 'rgb(255, 255, 255)']
        },
        tickets: [
            { id: 't1', name: 'General Admission', price: 65.00, note: 'Full access to general festival grounds, food trucks, and main stage.' },
            { id: 't2', name: 'VIP Access (Skip the line)', price: 150.00, note: 'Express fast-track entry, VIP lounge access, and private viewing platform.' }
        ]
    }
];

export function EventProvider({ children }) {
    // Initialize events from localStorage if available, otherwise fallback to DEFAULT_EVENTS
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

    // Initialize cart from localStorage
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

    // Initialize orders from localStorage
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

    // Save events to localStorage whenever they change
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

    // Save cart to localStorage whenever it changes
    useEffect(() => {
        try {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        } catch (e) {
            console.error('Failed to save cart to localStorage:', e);
        }
    }, [cart]);

    // Save orders to localStorage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
        } catch (e) {
            console.error('Failed to save orders to localStorage:', e);
        }
    }, [orders]);

    // Listen for storage events from other tabs/windows to keep state synchronized in real-time
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) {
                        setEvents(parsed);
                    }
                } catch (err) {
                    console.error('Failed to parse synchronized events:', err);
                }
            }
            if (e.key === CART_STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) {
                        setCart(parsed);
                    }
                } catch (err) {
                    console.error('Failed to parse synchronized cart:', err);
                }
            }
            if (e.key === ORDERS_STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) {
                        setOrders(parsed);
                    }
                } catch (err) {
                    console.error('Failed to parse synchronized orders:', err);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const addEvent = (newEvent) => {
        setEvents((prev) => [...prev, { id: newEvent.id || Date.now().toString(), ...newEvent }]);
    };

    const updateEvent = (id, updatedEvent) => {
        setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updatedEvent } : e)));
    };

    const deleteEvent = (id) => {
        setEvents((prev) => prev.filter((e) => e.id !== id));
    };

    const recordOrder = (newOrder) => {
        // Automatically build individual ticket pass objects if not already provided
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

        setOrders((prev) => [enrichedOrder, ...prev]);
        return enrichedOrder;
    };

    const checkInTicket = (orderId, ticketId) => {
        setOrders((prevOrders) =>
            prevOrders.map((order) => {
                if (order.orderId !== orderId) return order;
                const updatedTickets = (order.tickets || []).map((t) => {
                    if (t.ticketId === ticketId) {
                        return {
                            ...t,
                            checkInStatus: 'checked_in',
                            checkedInAt: new Date().toISOString()
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
    };

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

    const clearCart = () => setCart([]);

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
