import React, { useState, useRef } from 'react';
import { useEventData } from '../hooks/useEventData';
import { useTheme } from '../hooks/useTheme'; // Optional fallback for visual only
import { useAuth } from '../hooks/useAuth';

const DEFAULT_TICKETS = [
    { id: 'default-t1', name: 'General Admission', price: '45', quantity: '500', note: 'Standard entry with full access to festival grounds and stages.', onSaleDate: '', timezone: 'UTC' },
    { id: 'default-t2', name: 'VIP Access', price: '120', quantity: '50', note: 'Skip-the-line express entry, dedicated VIP lounge, and private bar access.', onSaleDate: '', timezone: 'UTC' }
];

const DEFAULT_FEES = [
    { id: 'default-f1', name: 'Platform Fee', amount: '2.50', type: 'fixed_per_transaction' }
];

export default function PromoterDashboard() {
    const { events, addEvent, updateEvent, deleteEvent, orders } = useEventData();
    const { themeColors, setThemeColors } = useTheme();
    const { currentPromoter } = useAuth();

    const [activeTab, setActiveTab] = useState('events'); // 'events' | 'orders'
    const [copiedOrderId, setCopiedOrderId] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [editingEventId, setEditingEventId] = useState(null);
    const [imageSrc, setImageSrc] = useState(null);
    const imgRef = useRef(null);

    const [formData, setFormData] = useState({
        title: '',
        date: '',
        location: ''
    });

    const [ticketClasses, setTicketClasses] = useState(DEFAULT_TICKETS);
    const [fees, setFees] = useState(DEFAULT_FEES);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setImageSrc(event.target.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleImageLoad = () => {
        try {
            const img = imgRef.current;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxSize = 200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height).data;
            let r = 0, g = 0, b = 0, count = 0;

            for (let i = 0; i < imageData.length; i += 16) {
                if (imageData[i + 3] > 128) {
                    r += imageData[i];
                    g += imageData[i + 1];
                    b += imageData[i + 2];
                    count++;
                }
            }

            if (count > 0) {
                r = Math.floor(r / count);
                g = Math.floor(g / count);
                b = Math.floor(b / count);
            }

            const dominant = `rgb(${r}, ${g}, ${b})`;
            const palette = [
                dominant,
                `rgb(${Math.min(255, r + 40)}, ${Math.max(0, g - 20)}, ${b})`,
                `rgb(${Math.max(0, r - 30)}, ${Math.min(255, g + 30)}, ${Math.max(0, b - 10)})`,
                `rgb(${Math.max(0, r - 20)}, ${Math.max(0, b - 10)}, ${Math.min(255, g + 20)})`,
                `rgb(${255 - r}, ${255 - g}, ${255 - b})`
            ];

            setThemeColors({ dominant, palette });
        } catch (e) {
            console.error("Error extracting colors", e);
        }
    };

    const handleAddTicketClass = () => {
        setTicketClasses([...ticketClasses, { id: `tc_${Date.now()}`, name: '', price: '', quantity: '', note: '', onSaleDate: '', timezone: 'UTC' }]);
    };

    const handleRemoveTicketClass = (id) => {
        setTicketClasses(ticketClasses.filter(t => t.id !== id));
    };

    const handleUpdateTicketClass = (id, field, value) => {
        setTicketClasses(ticketClasses.map(t => t.id === id ? { ...t, [field]: value } : t));
    };

    const handleAddFee = () => {
        setFees([...fees, { id: Date.now(), name: '', amount: '', type: 'fixed_per_transaction' }]);
    };

    const handleRemoveFee = (id) => {
        setFees(fees.filter(f => f.id !== id));
    };

    const handleUpdateFee = (id, field, value) => {
        setFees(fees.map(f => f.id === id ? { ...f, [field]: value } : f));
    };

    const handleEditEvent = (eventToEdit) => {
        setEditingEventId(eventToEdit.id);
        setFormData({
            title: eventToEdit.title || '',
            date: eventToEdit.date || '',
            location: eventToEdit.location || ''
        });
        setImageSrc(eventToEdit.image || null);
        setThemeColors(eventToEdit.palette || { dominant: '', palette: [] });

        if (eventToEdit.tickets && eventToEdit.tickets.length > 0) {
            setTicketClasses(eventToEdit.tickets.map((t, idx) => ({ ...t, note: t.note || '', id: t.id || `edit_t_${idx}` })));
        } else {
            setTicketClasses(DEFAULT_TICKETS);
        }

        if (eventToEdit.fees && eventToEdit.fees.length > 0) {
            setFees(eventToEdit.fees.map((f, idx) => ({ ...f, id: f.id || `edit_f_${idx}` })));
        } else {
            setFees([]);
        }

        setIsCreating(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSaveEvent = (e) => {
        e.preventDefault();

        const newEvent = {
            title: formData.title || 'Untitled Event',
            date: formData.date || '',
            location: formData.location || 'Location TBA',
            image: imageSrc,
            palette: themeColors.palette.length > 0 ? themeColors : null,
            tickets: ticketClasses.filter(t => t.name.trim() !== '').map((t, idx) => ({
                id: `t_${Date.now()}_${idx}`,
                name: t.name,
                note: (t.note || '').slice(0, 1000),
                price: parseFloat(t.price) || 0,
                quantity: parseInt(t.quantity) || 0,
                onSaleDate: t.onSaleDate || null,
                timezone: t.timezone || 'UTC'
            })),
            fees: fees.filter(f => f.name.trim() !== '').map(f => ({
                id: f.id,
                name: f.name,
                amount: parseFloat(f.amount) || 0,
                type: f.type
            }))
        };

        if (editingEventId) {
            updateEvent(editingEventId, newEvent);
        } else {
            addEvent(newEvent);
        }

        resetForm();
    };

    const handleDeleteEvent = (id, title) => {
        if (window.confirm(`Are you sure you want to delete "${title}"?`)) {
            deleteEvent(id);
        }
    };

    const resetForm = () => {
        setIsCreating(false);
        setEditingEventId(null);
        setFormData({ title: '', date: '', location: '' });
        setTicketClasses(DEFAULT_TICKETS);
        setFees(DEFAULT_FEES);
        setImageSrc(null);
        setThemeColors({ dominant: '', palette: [] });
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h1 className="gradient-text" style={{ fontSize: '2.5rem' }}>Promoter Dashboard</h1>
                {!isCreating && (
                    <button onClick={() => setIsCreating(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>+</span> Create New Event
                    </button>
                )}
            </div>

            {currentPromoter && (
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 16px',
                    borderRadius: '24px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    marginBottom: '28px',
                    fontSize: '0.88rem'
                }}>
                    <span>👤 <strong>{currentPromoter.name}</strong></span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{currentPromoter.organization_name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>({currentPromoter.email})</span>
                </div>
            )}

            <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>Manage your events, customize aesthetics, and track sales.</p>

            {/* Quick Metrics Bar */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '36px'
            }}>
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '6px' }}>Total Sales Revenue</div>
                    <div className="gradient-text" style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                        ${((orders || []).reduce((s, o) => s + (o.total || 0), 0)).toFixed(2)}
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '6px' }}>Tickets Sold</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
                        {(orders || []).reduce((s, o) => s + (o.items || []).reduce((sum, item) => sum + item.quantity, 0), 0)}
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '6px' }}>Total Transactions</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-secondary)' }}>
                        {(orders || []).length}
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '6px' }}>Active Events</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                        {events.length}
                    </div>
                </div>
            </div>

            {/* View Switcher Tabs */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button
                    type="button"
                    onClick={() => setActiveTab('events')}
                    style={{
                        padding: '10px 20px',
                        borderRadius: '24px',
                        border: '1px solid ' + (activeTab === 'events' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'),
                        background: activeTab === 'events' ? 'rgba(199, 215, 0, 0.15)' : 'rgba(255,255,255,0.03)',
                        color: activeTab === 'events' ? 'var(--accent-primary)' : 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                    }}
                >
                    Events ({events.length})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
                    style={{
                        padding: '10px 20px',
                        borderRadius: '24px',
                        border: '1px solid ' + (activeTab === 'orders' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'),
                        background: activeTab === 'orders' ? 'rgba(199, 215, 0, 0.15)' : 'rgba(255,255,255,0.03)',
                        color: activeTab === 'orders' ? 'var(--accent-primary)' : 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                    }}
                >
                    Orders & Transactions ({(orders || []).length})
                </button>
            </div>

            {isCreating && (
                <div className="glass-panel animate-fade-in" style={{ marginBottom: '40px', padding: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h2 style={{ color: 'var(--accent-primary)' }}>{editingEventId ? 'Edit Event' : 'Create New Event'}</h2>
                        <button onClick={resetForm} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}>
                            Cancel
                        </button>
                    </div>

                    <form onSubmit={handleSaveEvent} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Event Title</label>
                            <input
                                type="text"
                                required
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                placeholder="e.g. Neon Nights Festival 2026"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '24px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Date & Time</label>
                                <input
                                    type="datetime-local"
                                    required
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Location</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.location}
                                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                    placeholder="e.g. The Grand Arena"
                                />
                            </div>
                        </div>

                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3>Ticket Classes</h3>
                                <button type="button" onClick={handleAddTicketClass} style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    + Add Ticket Class
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                {ticketClasses.map((ticket) => (
                                    <div key={ticket.id} style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1.5 }}>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ticket Name</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={ticket.name}
                                                    onChange={(e) => handleUpdateTicketClass(ticket.id, 'name', e.target.value)}
                                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                    placeholder="e.g. Early Bird"
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Price ($)</label>
                                                <input
                                                    type="number"
                                                    required min="0" step="0.01"
                                                    value={ticket.price}
                                                    onChange={(e) => handleUpdateTicketClass(ticket.id, 'price', e.target.value)}
                                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Quantity</label>
                                                <input
                                                    type="number"
                                                    required min="1" step="1"
                                                    value={ticket.quantity}
                                                    onChange={(e) => handleUpdateTicketClass(ticket.id, 'quantity', e.target.value)}
                                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                    placeholder="100"
                                                />
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: '28px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveTicketClass(ticket.id)}
                                                    style={{ background: 'rgba(255, 77, 79, 0.1)', border: '1px solid rgba(255, 77, 79, 0.2)', color: '#ff4d4f', cursor: 'pointer', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    title="Remove Ticket Class"
                                                    disabled={ticketClasses.length === 1}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ticket Note / Details (Optional)</label>
                                                <span style={{ fontSize: '0.75rem', color: (ticket.note?.length || 0) >= 1000 ? '#f87171' : 'var(--text-muted)' }}>
                                                    {(ticket.note?.length || 0)}/1000
                                                </span>
                                            </div>
                                            <textarea
                                                maxLength={1000}
                                                rows={2}
                                                value={ticket.note || ''}
                                                onChange={(e) => handleUpdateTicketClass(ticket.id, 'note', e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    boxSizing: 'border-box',
                                                    padding: '10px 12px',
                                                    borderRadius: '8px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    border: '1px solid var(--border-color)',
                                                    color: '#fff',
                                                    resize: 'vertical',
                                                    fontFamily: 'inherit',
                                                    fontSize: '0.9rem',
                                                    lineHeight: '1.4'
                                                }}
                                                placeholder="e.g. Includes entry, skip-the-line privileges, and complimentary drink ticket."
                                            />
                                        </div>

                                        <div style={{ display: 'flex', gap: '24px' }}>
                                            <div style={{ flex: 2 }}>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>On Sale Date & Time (Optional)</label>
                                                <input
                                                    type="datetime-local"
                                                    value={ticket.onSaleDate || ''}
                                                    onChange={(e) => handleUpdateTicketClass(ticket.id, 'onSaleDate', e.target.value)}
                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Timezone</label>
                                                <select
                                                    value={ticket.timezone}
                                                    onChange={(e) => handleUpdateTicketClass(ticket.id, 'timezone', e.target.value)}
                                                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                >
                                                    <option style={{ color: '#000' }} value="US/Pacific">PST/PDT</option>
                                                    <option style={{ color: '#000' }} value="US/Mountain">MST/MDT</option>
                                                    <option style={{ color: '#000' }} value="US/Central">CST/CDT</option>
                                                    <option style={{ color: '#000' }} value="US/Eastern">EST/EDT</option>
                                                    <option style={{ color: '#000' }} value="UTC">UTC</option>
                                                    <option style={{ color: '#000' }} value="Europe/London">GMT/BST</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3>Ticket Fees</h3>
                                <button type="button" onClick={handleAddFee} style={{ background: 'var(--accent-secondary)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    + Add Custom Fee
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {fees.map((fee) => (
                                    <div key={fee.id} style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ flex: 1.5 }}>
                                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Fee Name</label>
                                            <input
                                                type="text"
                                                required
                                                value={fee.name}
                                                onChange={(e) => handleUpdateFee(fee.id, 'name', e.target.value)}
                                                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                placeholder="e.g. Processing Fee"
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Amount</label>
                                            <input
                                                type="number"
                                                required min="0" step="0.01"
                                                value={fee.amount}
                                                onChange={(e) => handleUpdateFee(fee.id, 'amount', e.target.value)}
                                                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div style={{ flex: 1.5 }}>
                                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Calculation Type</label>
                                            <select
                                                value={fee.type}
                                                onChange={(e) => handleUpdateFee(fee.id, 'type', e.target.value)}
                                                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff' }}
                                            >
                                                <option style={{ color: '#000' }} value="fixed_per_transaction">Fixed $ on Transaction</option>
                                                <option style={{ color: '#000' }} value="fixed_per_ticket">Fixed $ per Ticket Sold</option>
                                                <option style={{ color: '#000' }} value="percentage">% of Transaction</option>
                                            </select>
                                        </div>
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveFee(fee.id)}
                                                style={{ background: 'rgba(255, 77, 79, 0.1)', border: '1px solid rgba(255, 77, 79, 0.2)', color: '#ff4d4f', cursor: 'pointer', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                title="Remove Fee"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h3 style={{ marginBottom: '12px' }}>Event Aesthetics</h3>
                            <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '0.9rem' }}>Upload a promotional image to automatically extract a 5-color palette for your event page.</p>

                            <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-block', marginBottom: '24px' }}>
                                Upload Promo Image
                                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                            </label>

                            {imageSrc && (
                                <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <img
                                        ref={imgRef}
                                        src={imageSrc}
                                        alt="Promo Preview"
                                        style={{ width: '150px', height: '150px', objectFit: 'cover', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                                        onLoad={handleImageLoad}
                                        crossOrigin="anonymous"
                                    />

                                    {themeColors.palette.length > 0 && (
                                        <div style={{ flex: 1 }}>
                                            <p style={{ marginBottom: '12px', fontSize: '0.9rem' }}>Extracted Theme Palette:</p>
                                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                {themeColors.palette.map((color, idx) => (
                                                    <div key={idx} style={{ textAlign: 'center' }}>
                                                        <div
                                                            style={{
                                                                width: '40px', height: '40px', borderRadius: '50%',
                                                                backgroundColor: color,
                                                                boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                                                                border: idx === 0 ? '2px solid white' : 'none'
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '32px', display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={resetForm} className="btn" style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '30px' }}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" style={{ padding: '12px 32px', fontSize: '1.1rem' }}>
                                {editingEventId ? 'Update Event' : 'Publish Event'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {activeTab === 'events' ? (
                <div className="glass-panel">
                    <h2 style={{ marginBottom: '24px' }}>Your Events</h2>

                    {events.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)' }}>No events yet. Create one to get started.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {events.map((event) => (
                                <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{
                                        width: '80px', height: '80px', borderRadius: '8px', flexShrink: 0,
                                        background: event.image ? `url(${event.image}) center/cover` : `linear-gradient(45deg, ${event.palette?.dominant || 'var(--accent-primary)'}, var(--accent-secondary))`
                                    }} />
                                    <div style={{ flex: 1 }}>
                                        <h3 style={{ marginBottom: '4px' }}>{event.title}</h3>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>
                                            {event.date ? (isNaN(new Date(event.date)) ? event.date : new Date(event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : 'TBA'}
                                            {event.location ? ` • ${event.location}` : ''}
                                        </p>
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            {event.tickets && event.tickets.map(t => (
                                                <span key={t.id} style={{ display: 'inline-block', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                                                    {t.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <button
                                            className="btn btn-primary"
                                            style={{ padding: '8px 24px', fontSize: '0.9rem', marginBottom: '8px', display: 'block', width: '100%', whiteSpace: 'nowrap' }}
                                            onClick={() => window.open(`/event/${event.id}`, '_blank')}
                                        >
                                            View Page
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ padding: '8px 24px', fontSize: '0.9rem', marginBottom: '8px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '30px', display: 'block', width: '100%', whiteSpace: 'nowrap' }}
                                            onClick={() => handleEditEvent(event)}
                                        >
                                            Edit Event
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ padding: '8px 24px', fontSize: '0.9rem', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '30px', display: 'block', width: '100%', whiteSpace: 'nowrap' }}
                                            onClick={() => handleDeleteEvent(event.id, event.title)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="glass-panel">
                    <h2 style={{ marginBottom: '24px' }}>Recent Orders & Transactions</h2>

                    {(!orders || orders.length === 0) ? (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                            <p style={{ fontSize: '2rem', marginBottom: '12px' }}>🧾</p>
                            <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>No orders placed yet.</p>
                            <p style={{ fontSize: '0.9rem' }}>When customers purchase tickets on your event pages, their 12-digit order details will appear here.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {orders.map((order) => (
                                <div key={order.orderId} style={{
                                    padding: '20px',
                                    background: 'rgba(255,255,255,0.02)',
                                    borderRadius: '12px',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                                    Order ID:
                                                </span>
                                                <span style={{
                                                    fontFamily: 'monospace',
                                                    fontSize: '1.15rem',
                                                    fontWeight: 700,
                                                    color: 'var(--accent-primary)',
                                                    letterSpacing: '1px'
                                                }}>
                                                    #{order.orderId}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(order.orderId);
                                                        setCopiedOrderId(order.orderId);
                                                        setTimeout(() => setCopiedOrderId(null), 2000);
                                                    }}
                                                    style={{
                                                        background: copiedOrderId === order.orderId ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.08)',
                                                        border: '1px solid ' + (copiedOrderId === order.orderId ? 'var(--success)' : 'rgba(255,255,255,0.15)'),
                                                        color: copiedOrderId === order.orderId ? 'var(--success)' : 'var(--text-muted)',
                                                        borderRadius: '6px',
                                                        padding: '2px 8px',
                                                        fontSize: '0.75rem',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    {copiedOrderId === order.orderId ? '✓ Copied' : 'Copy'}
                                                </button>
                                            </div>
                                            <h3 style={{ margin: '4px 0', fontSize: '1.1rem' }}>{order.eventTitle}</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                                                Purchased by <strong>{order.customer.name}</strong> ({order.customer.email})
                                                {order.customer.phone ? ` • ${order.customer.phone}` : ''}
                                            </p>
                                        </div>

                                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                                            <div className="gradient-text" style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                                                ${order.total.toFixed(2)}
                                            </div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                                {new Date(order.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                                                {order.tickets && (
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        padding: '3px 8px',
                                                        borderRadius: '10px',
                                                        background: order.tickets.every(t => t.checkInStatus === 'checked_in') ? 'rgba(139, 92, 246, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                                                        color: order.tickets.every(t => t.checkInStatus === 'checked_in') ? 'var(--accent-secondary)' : 'var(--success)',
                                                        fontWeight: 600
                                                    }}>
                                                        {order.tickets.filter(t => t.checkInStatus === 'checked_in').length}/{order.tickets.length} Checked In
                                                    </span>
                                                )}
                                                <a
                                                    href={`/tickets/${order.orderId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-primary"
                                                    style={{ padding: '6px 14px', fontSize: '0.8rem', textDecoration: 'none' }}
                                                >
                                                    🎟️ View Passes & QR
                                                </a>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Order Item Pills */}
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                        {order.items.map((item, idx) => (
                                            <span key={idx} style={{
                                                fontSize: '0.8rem',
                                                padding: '4px 10px',
                                                borderRadius: '20px',
                                                background: 'rgba(255,255,255,0.05)',
                                                border: '1px solid rgba(255,255,255,0.1)',
                                                color: '#f8fafc'
                                            }}>
                                                🎫 {item.name} × {item.quantity} (${(item.price * item.quantity).toFixed(2)})
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
