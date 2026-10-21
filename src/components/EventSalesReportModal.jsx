import React, { useState } from 'react';

export default function EventSalesReportModal({ isOpen, onClose, event, orders, promoter }) {
    const [copiedOrderId, setCopiedOrderId] = useState(null);

    if (!isOpen || !event) return null;

    // Filter orders specifically belonging to this event
    const eventOrders = (orders || []).filter(o => {
        if (o.eventId && event.id) {
            return String(o.eventId) === String(event.id);
        }
        return o.eventTitle === event.title;
    });

    // 1. Calculate sales breakdown by ticket type and price
    const ticketTiers = (event.tickets || []).map((ticket, idx) => {
        const tierName = ticket.name || `Tier #${idx + 1}`;
        const unitPrice = parseFloat(ticket.price) || 0;
        const capacity = parseInt(ticket.quantity) || 0;

        // Calculate sold quantity across all event orders
        const soldQty = eventOrders.reduce((sum, order) => {
            const matchedItems = (order.items || []).filter(item => {
                const nameMatches = item.name && item.name.trim().toLowerCase() === tierName.trim().toLowerCase();
                return nameMatches;
            });
            return sum + matchedItems.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0);
        }, 0);

        const remainingQty = Math.max(0, capacity - soldQty);
        const grossRevenue = soldQty * unitPrice;
        const projectedRevenueAtCapacity = capacity * unitPrice;
        const selloutPercent = capacity > 0 ? Math.min(100, Math.round((soldQty / capacity) * 100)) : 0;

        return {
            id: ticket.id || `tier_${idx}`,
            name: tierName,
            price: unitPrice,
            note: ticket.note || '',
            capacity,
            soldQty,
            remainingQty,
            grossRevenue,
            projectedRevenueAtCapacity,
            selloutPercent
        };
    });

    // Check if there are any tickets sold that don't match configured tiers
    const untrackedItems = [];
    eventOrders.forEach(order => {
        (order.items || []).forEach(item => {
            const matchesConfigured = ticketTiers.some(t => t.name.toLowerCase() === (item.name || '').toLowerCase());
            if (!matchesConfigured) {
                const existing = untrackedItems.find(u => u.name === item.name && u.price === item.price);
                if (existing) {
                    existing.soldQty += item.quantity || 0;
                    existing.grossRevenue += (item.quantity || 0) * (item.price || 0);
                } else {
                    untrackedItems.push({
                        id: `untracked_${item.name}`,
                        name: item.name,
                        price: item.price || 0,
                        capacity: item.quantity || 0,
                        soldQty: item.quantity || 0,
                        remainingQty: 0,
                        grossRevenue: (item.quantity || 0) * (item.price || 0),
                        projectedRevenueAtCapacity: (item.quantity || 0) * (item.price || 0),
                        selloutPercent: 100
                    });
                }
            }
        });
    });

    const allReportingTiers = [...ticketTiers, ...untrackedItems];

    // 2. High-level rollups and projections
    const totalCapacity = ticketTiers.reduce((s, t) => s + t.capacity, 0);
    const totalSold = allReportingTiers.reduce((s, t) => s + t.soldQty, 0);
    const totalRemaining = Math.max(0, totalCapacity - totalSold);
    const overallSelloutPercent = totalCapacity > 0 ? Math.min(100, Math.round((totalSold / totalCapacity) * 100)) : 0;

    const totalGrossTicketSales = allReportingTiers.reduce((s, t) => s + t.grossRevenue, 0);
    const totalProjectedTicketRevenue = ticketTiers.reduce((s, t) => s + t.projectedRevenueAtCapacity, 0);
    const remainingRevenuePotential = Math.max(0, totalProjectedTicketRevenue - totalGrossTicketSales);

    // 3. Fee breakdown calculations
    // Event configured fees
    const configuredFees = event.fees || [];

    // Calculate total fees collected from customer orders for this event
    const feesCollectedBreakdown = configuredFees.map(fee => {
        const feeAmount = parseFloat(fee.amount) || 0;
        let totalCollectedForThisFee = 0;
        let appliedCount = 0;

        eventOrders.forEach(order => {
            // Check if order contains this fee in its itemized fees
            const matchedFee = (order.fees || []).find(f => f.name && f.name.toLowerCase() === fee.name.toLowerCase());
            if (matchedFee) {
                totalCollectedForThisFee += parseFloat(matchedFee.amount) || 0;
                appliedCount++;
            } else {
                // Fallback calculation based on fee type
                if (fee.type === 'fixed_per_transaction') {
                    totalCollectedForThisFee += feeAmount;
                    appliedCount++;
                } else if (fee.type === 'fixed_per_ticket') {
                    const ticketsInOrder = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
                    totalCollectedForThisFee += ticketsInOrder * feeAmount;
                    appliedCount += ticketsInOrder;
                } else if (fee.type === 'percentage') {
                    totalCollectedForThisFee += (order.baseTotal || 0) * (feeAmount / 100);
                    appliedCount++;
                }
            }
        });

        return {
            id: fee.id,
            name: fee.name,
            amount: feeAmount,
            type: fee.type,
            appliedCount,
            totalCollected: totalCollectedForThisFee
        };
    });

    const totalFeesCollected = feesCollectedBreakdown.reduce((s, f) => s + f.totalCollected, 0);

    // Platform cost estimation (standard Stripe gateway cost: ~2.9% + $0.30/txn)
    const estimatedGatewayFees = eventOrders.reduce((sum, order) => {
        const orderTotal = order.total || 0;
        return sum + (orderTotal * 0.029 + 0.30);
    }, 0);

    // Promoter Payout Calculations:
    // Promoter Net Payout = Total Gross Ticket Sales + Total Fees Collected - Payment Gateway/Platform Fees
    const netPayoutToPromoter = Math.max(0, totalGrossTicketSales + totalFeesCollected - estimatedGatewayFees);

    // CSV Export Handler
    const handleExportCsv = () => {
        const lines = [
            `"Ticket Lite - Event Sales & Projections Report"`,
            `"Event Title:","${(event.title || '').replace(/"/g, '""')}"`,
            `"Date:","${event.date || 'TBA'}"`,
            `"Location:","${(event.location || '').replace(/"/g, '""')}"`,
            `"Promoter:","${(promoter?.name || 'Promoter').replace(/"/g, '""')} (${(promoter?.organization_name || '').replace(/"/g, '""')})"`,
            `"Generated At:","${new Date().toLocaleString()}"`,
            ``,
            `"--- TICKET SALES BY TYPE & PRICE ---"`,
            `"Ticket Type","Unit Price","Allocated Capacity","Tickets Sold","Remaining","Gross Revenue","Projected (100% Sellout)","Sellout %"`,
            ...allReportingTiers.map(t =>
                `"${t.name.replace(/"/g, '""')}","$${t.price.toFixed(2)}","${t.capacity}","${t.soldQty}","${t.remainingQty}","$${t.grossRevenue.toFixed(2)}","$${t.projectedRevenueAtCapacity.toFixed(2)}","${t.selloutPercent}%"`
            ),
            `"TOTALS","-","${totalCapacity}","${totalSold}","${totalRemaining}","$${totalGrossTicketSales.toFixed(2)}","$${totalProjectedTicketRevenue.toFixed(2)}","${overallSelloutPercent}%"`,
            ``,
            `"--- FEE STRUCTURE & RECONCILIATION ---"`,
            `"Fee Name","Rate / Type","Times Applied","Total Collected"`,
            ...feesCollectedBreakdown.map(f =>
                `"${f.name.replace(/"/g, '""')}","${f.type === 'percentage' ? f.amount + '%' : '$' + f.amount.toFixed(2)}","${f.appliedCount}","$${f.totalCollected.toFixed(2)}"`
            ),
            `"Total Fees Collected","-","-","$${totalFeesCollected.toFixed(2)}"`,
            ``,
            `"--- PROMOTER FINANCIAL SUMMARY & NET PAYOUT ---"`,
            `"Gross Ticket Sales:","$${totalGrossTicketSales.toFixed(2)}"`,
            `"Promoter Fees Collected:","$${totalFeesCollected.toFixed(2)}"`,
            `"Total Gross Revenue:","$${(totalGrossTicketSales + totalFeesCollected).toFixed(2)}"`,
            `"Less Estimated Gateway & Platform Costs:","-$${estimatedGatewayFees.toFixed(2)}"`,
            `"TOTAL FEES & NET REVENUE PAID TO PROMOTER:","$${netPayoutToPromoter.toFixed(2)}"`,
            ``,
            `"--- INDIVIDUAL ATTENDEE TRANSACTIONS ---"`,
            `"Order ID","Date","Customer Name","Email","Tickets Purchased","Total Paid"`
        ];

        eventOrders.forEach(o => {
            const itemsStr = (o.items || []).map(i => `${i.name} x${i.quantity}`).join('; ');
            lines.push(
                `"#${o.orderId}","${new Date(o.createdAt).toLocaleString()}","${(o.customer?.name || '').replace(/"/g, '""')}","${o.customer?.email || ''}","${itemsStr.replace(/"/g, '""')}","$${(o.total || 0).toFixed(2)}"`
            );
        });

        const csvContent = lines.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `sales-report-${(event.title || 'event').toLowerCase().replace(/[^a-z0-9]/g, '-')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(2, 6, 23, 0.85)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            overflowY: 'auto'
        }}>
            <div
                className="animate-fade-in glass-panel"
                style={{
                    width: '100%',
                    maxWidth: '960px',
                    maxHeight: '92vh',
                    overflowY: 'auto',
                    background: '#0d1322',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '20px',
                    padding: '32px',
                    boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                }}
            >
                {/* Modal Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '20px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                📊 Sales & Projections Report
                            </span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {event.date ? (isNaN(new Date(event.date)) ? event.date : new Date(event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : 'Date TBA'}
                            </span>
                        </div>
                        <h2 className="gradient-text" style={{ margin: '4px 0 6px', fontSize: '2rem', fontWeight: 800 }}>
                            {event.title}
                        </h2>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                            {event.location && <span>📍 {event.location}</span>}
                            {promoter && (
                                <>
                                    <span>•</span>
                                    <span>👤 Organizer: <strong>{promoter.organization_name || promoter.name}</strong></span>
                                </>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="btn"
                            style={{
                                padding: '8px 16px',
                                fontSize: '0.85rem',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                color: '#fff',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer'
                            }}
                        >
                            <span>🖨️</span> Print Report
                        </button>
                        <button
                            type="button"
                            onClick={handleExportCsv}
                            className="btn"
                            style={{
                                padding: '8px 16px',
                                fontSize: '0.85rem',
                                background: 'rgba(16, 185, 129, 0.15)',
                                border: '1px solid rgba(16, 185, 129, 0.4)',
                                color: '#10b981',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                fontWeight: 600
                            }}
                        >
                            <span>📥</span> Export CSV
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
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
                                justifyContent: 'center'
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Key Metrics Cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '16px'
                }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '18px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                            Gross Ticket Sales
                        </div>
                        <div className="gradient-text" style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                            ${totalGrossTicketSales.toFixed(2)}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '4px' }}>
                            Across {totalSold} sold tickets
                        </div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '18px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                            Capacity & Sellout
                        </div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
                            {totalSold} <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>/ {totalCapacity}</span>
                        </div>
                        <div style={{ color: overallSelloutPercent > 75 ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: '0.78rem', marginTop: '4px', fontWeight: 600 }}>
                            {overallSelloutPercent}% capacity sold ({totalRemaining} remaining)
                        </div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '18px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                            Projected Gross (100% Sellout)
                        </div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-secondary)' }}>
                            ${totalProjectedTicketRevenue.toFixed(2)}
                        </div>
                        <div style={{ color: '#10b981', fontSize: '0.78rem', marginTop: '4px' }}>
                            +${remainingRevenuePotential.toFixed(2)} potential remaining
                        </div>
                    </div>

                    <div style={{
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.05) 100%)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: '12px',
                        padding: '18px'
                    }}>
                        <div style={{ color: '#10b981', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 700 }}>
                            Net Promoter Payout
                        </div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>
                            ${netPayoutToPromoter.toFixed(2)}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', marginTop: '4px' }}>
                            Gross sales + promoter fees - processing
                        </div>
                    </div>
                </div>

                {/* Sellout Progress Bar */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 600 }}>Event Ticket Capacity Progress</span>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{overallSelloutPercent}% Sold ({totalSold} / {totalCapacity} Tickets)</span>
                    </div>
                    <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '10px', overflow: 'hidden' }}>
                        <div style={{
                            width: `${overallSelloutPercent}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary), #10b981)',
                            borderRadius: '10px',
                            transition: 'width 0.5s ease-in-out'
                        }} />
                    </div>
                </div>

                {/* Section 1: Ticket Sales Separated by Ticket Type and Price */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>🎟️</span> Ticket Sales Breakdown (By Type & Price)
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {allReportingTiers.length} Ticket Class{allReportingTiers.length === 1 ? '' : 'es'}
                        </span>
                    </div>

                    <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <th style={{ padding: '14px 16px' }}>Ticket Type / Tier</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Price</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Allocated</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Sold</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Remaining</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'center', minWidth: '130px' }}>Sellout %</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Gross Sales</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Projected (100%)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allReportingTiers.map((tier) => (
                                    <tr key={tier.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.01)' }}>
                                        <td style={{ padding: '14px 16px', fontWeight: 600, color: '#fff' }}>
                                            <div>{tier.name}</div>
                                            {tier.note && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '2px', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {tier.note}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--accent-primary)' }}>
                                            ${tier.price.toFixed(2)}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                            {tier.capacity}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 700, color: tier.soldQty > 0 ? '#10b981' : 'var(--text-muted)' }}>
                                            {tier.soldQty}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center', color: tier.remainingQty === 0 ? '#ef4444' : 'var(--text-muted)' }}>
                                            {tier.remainingQty === 0 ? 'SOLD OUT' : tier.remainingQty}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{
                                                        width: `${tier.selloutPercent}%`,
                                                        height: '100%',
                                                        background: tier.selloutPercent >= 100 ? '#10b981' : 'var(--accent-primary)',
                                                        borderRadius: '3px'
                                                    }} />
                                                </div>
                                                <span style={{ fontSize: '0.78rem', minWidth: '32px', textAlign: 'right', fontWeight: 600 }}>
                                                    {tier.selloutPercent}%
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>
                                            ${tier.grossRevenue.toFixed(2)}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                                            ${tier.projectedRevenueAtCapacity.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: 'rgba(255,255,255,0.06)', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.15)' }}>
                                    <td style={{ padding: '14px 16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Total Tiers Summary
                                    </td>
                                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>-</td>
                                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>{totalCapacity}</td>
                                    <td style={{ padding: '14px 16px', textAlign: 'center', color: '#10b981' }}>{totalSold}</td>
                                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>{totalRemaining}</td>
                                    <td style={{ padding: '14px 16px', textAlign: 'center', color: 'var(--accent-primary)' }}>{overallSelloutPercent}%</td>
                                    <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '1rem', color: '#fff' }}>
                                        ${totalGrossTicketSales.toFixed(2)}
                                    </td>
                                    <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '1rem', color: 'var(--accent-secondary)' }}>
                                        ${totalProjectedTicketRevenue.toFixed(2)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                {/* Section 2: Fee Structure Breakdown */}
                {feesCollectedBreakdown.length > 0 && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>🧾</span> Event Fee Breakdown & Application
                            </h3>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {feesCollectedBreakdown.length} Configured Fee{feesCollectedBreakdown.length === 1 ? '' : 's'}
                            </span>
                        </div>

                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        <th style={{ padding: '12px 16px' }}>Fee Name</th>
                                        <th style={{ padding: '12px 16px' }}>Calculation Basis</th>
                                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Configured Rate</th>
                                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Times Applied</th>
                                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Total Fee Collected</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feesCollectedBreakdown.map((fee) => (
                                        <tr key={fee.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                            <td style={{ padding: '12px 16px', fontWeight: 600, color: '#fff' }}>{fee.name}</td>
                                            <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                                                {fee.type === 'fixed_per_transaction' && 'Fixed $ per Checkout Transaction'}
                                                {fee.type === 'fixed_per_ticket' && 'Fixed $ per Ticket Unit Sold'}
                                                {fee.type === 'percentage' && 'Percentage % of Ticket Subtotal'}
                                            </td>
                                            <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600 }}>
                                                {fee.type === 'percentage' ? `${fee.amount}%` : `$${fee.amount.toFixed(2)}`}
                                            </td>
                                            <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                                {fee.appliedCount}
                                            </td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                                                ${fee.totalCollected.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: 'rgba(255,255,255,0.06)', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.15)' }}>
                                        <td colSpan={4} style={{ padding: '12px 16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            Total Fees Collected on Event
                                        </td>
                                        <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: '1rem', color: '#38bdf8' }}>
                                            ${totalFeesCollected.toFixed(2)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {/* Section 3: Prominently Tallied Promoter Financial Summary & Total Fees Paid to Promoter */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(13, 27, 42, 0.95) 100%)',
                    border: '2px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '16px',
                    padding: '24px',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <span style={{ fontSize: '1.4rem' }}>💰</span>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', fontWeight: 800 }}>
                            Promoter Settlement & Payout Reconciliation
                        </h3>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.95rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>1. Gross Ticket Sales (All Tiers)</span>
                            <span style={{ fontWeight: 600, color: '#fff' }}>+${totalGrossTicketSales.toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>2. Total Promoter Fees Collected</span>
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>+${totalFeesCollected.toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>3. Total Gross Revenue Processed</span>
                            <span style={{ fontWeight: 700, color: '#fff' }}>${(totalGrossTicketSales + totalFeesCollected).toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>4. Less Payment Processing & Gateway Fees (Stripe ~2.9% + $0.30)</span>
                            <span style={{ fontWeight: 600, color: '#f87171' }}>-${estimatedGatewayFees.toFixed(2)}</span>
                        </div>

                        {/* FINAL TALLY BOX */}
                        <div style={{
                            marginTop: '12px',
                            padding: '16px 20px',
                            borderRadius: '12px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '1px solid rgba(16, 185, 129, 0.5)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px'
                        }}>
                            <div>
                                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#10b981', fontWeight: 800 }}>
                                    TOTAL FEES & NET REVENUE PAID TO PROMOTER
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    Tallied for {promoter?.organization_name || promoter?.name || 'Promoter Account'} • Direct Settlement Available
                                </div>
                            </div>
                            <div style={{
                                fontSize: '2.2rem',
                                fontWeight: 900,
                                color: '#10b981',
                                fontFamily: 'monospace',
                                letterSpacing: '1px',
                                textShadow: '0 0 20px rgba(16, 185, 129, 0.4)'
                            }}>
                                ${netPayoutToPromoter.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Section 4: Individual Attendee Order Log for this Event */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>📋</span> Event Attendee Transactions ({eventOrders.length})
                        </h3>
                    </div>

                    {eventOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
                            <p style={{ margin: 0, fontSize: '0.95rem' }}>No ticket purchases recorded yet for this event.</p>
                            <p style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>When attendees buy tickets through Stripe or the event page, transactions will be logged here.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {eventOrders.map((order) => (
                                <div
                                    key={order.orderId}
                                    style={{
                                        padding: '14px 16px',
                                        background: 'rgba(255,255,255,0.02)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: '10px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '12px',
                                        fontSize: '0.88rem'
                                    }}
                                >
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.95rem' }}>
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
                                                    borderRadius: '4px',
                                                    padding: '2px 6px',
                                                    fontSize: '0.72rem',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                {copiedOrderId === order.orderId ? '✓ Copied' : 'Copy'}
                                            </button>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {new Date(order.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                            </span>
                                            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-secondary)', fontWeight: 600 }}>
                                                💳 Stripe / Card
                                            </span>
                                        </div>
                                        <div style={{ color: '#fff', fontWeight: 500 }}>
                                            {order.customer?.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({order.customer?.email})</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                            {(order.items || []).map((item, idx) => (
                                                <span key={idx} style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                                                    {item.name} × {item.quantity} (${(item.price * item.quantity).toFixed(2)})
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                        <div className="gradient-text" style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                                            ${(order.total || 0).toFixed(2)}
                                        </div>
                                        <a
                                            href={`/tickets/${order.orderId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                fontSize: '0.78rem',
                                                color: '#38bdf8',
                                                textDecoration: 'none',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}
                                        >
                                            🎟️ View Pass ↗
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-primary"
                        style={{ padding: '10px 24px', fontSize: '0.95rem' }}
                    >
                        Close Report
                    </button>
                </div>
            </div>
        </div>
    );
}
