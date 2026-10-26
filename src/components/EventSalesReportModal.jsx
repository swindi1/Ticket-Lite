import React, { useState } from 'react';

/**
 * EventSalesReportModal
 * 
 * Performance Matrix & Financial Reconciliation Modal
 * - Displays "Ticket Sales Tracker & Performance Matrix" matching executive reporting specs:
 *   - Top KPI cards: TOTAL TICKETS SOLD and TOTAL GROSS REVENUE (omits Average Ticket Price per spec)
 *   - Matrix Breakdown Table: Ticket Type along Y-axis, Price along X-axis, bottom summary totals
 *   - Dual-Axis Combo Chart: Ticket Sales Volume & Revenue by Tier (SVG with volume bars & revenue line)
 * - Retains full promoter fee reconciliation and net payout settlement tally
 * - Attendee order log with direct pass links and copyable order IDs
 * - CSV Export reflecting the matrix breakdown format
 */
export default function EventSalesReportModal({ isOpen, onClose, event, orders, promoter }) {
    const [copiedOrderId, setCopiedOrderId] = useState(null);
    const [hoveredTierIdx, setHoveredTierIdx] = useState(null);

    if (!isOpen || !event) return null;

    // Filter orders specifically belonging to this event
    const eventOrders = (orders || []).filter(o => {
        if (o.eventId && event.id) {
            return String(o.eventId) === String(event.id);
        }
        return o.eventTitle === event.title;
    });

    // 1. Gather all unique price points (X-Axis) sorted ascending
    const priceSet = new Set();
    (event.tickets || []).forEach(t => {
        const p = parseFloat(t.price);
        if (!isNaN(p)) priceSet.add(p);
    });
    eventOrders.forEach(order => {
        (order.items || []).forEach(item => {
            const p = parseFloat(item.price);
            if (!isNaN(p)) priceSet.add(p);
        });
    });

    let pricePoints = Array.from(priceSet).sort((a, b) => a - b);
    if (pricePoints.length === 0) {
        pricePoints = [0];
    }

    // 2. Gather all ticket tiers (Y-Axis)
    // First, configured tiers in event.tickets
    const configuredTiers = (event.tickets || []).map((ticket, idx) => ({
        id: ticket.id || `tier_${idx}`,
        name: ticket.name || `Tier #${idx + 1}`,
        configuredPrice: parseFloat(ticket.price) || 0,
        capacity: parseInt(ticket.quantity) || 0,
        note: ticket.note || ''
    }));

    // Find any untracked tier names sold in orders that weren't in configured tiers
    const extraTierNames = [];
    eventOrders.forEach(order => {
        (order.items || []).forEach(item => {
            const itemName = (item.name || '').trim();
            if (
                itemName &&
                !configuredTiers.some(t => t.name.trim().toLowerCase() === itemName.toLowerCase()) &&
                !extraTierNames.some(n => n.toLowerCase() === itemName.toLowerCase())
            ) {
                extraTierNames.push(itemName);
            }
        });
    });

    const allTierRows = [
        ...configuredTiers.map(t => ({
            id: t.id,
            name: t.name,
            capacity: t.capacity,
            note: t.note
        })),
        ...extraTierNames.map((name, idx) => ({
            id: `extra_tier_${idx}`,
            name,
            capacity: 0,
            note: ''
        }))
    ];

    if (allTierRows.length === 0) {
        allTierRows.push({ id: 'default_tier', name: 'General Admission', capacity: 0, note: '' });
    }

    // 3. Compute Matrix cells: count of tickets sold for each tier at each price point
    const matrixRows = allTierRows.map(tier => {
        const salesByPrice = {};
        let rowSold = 0;
        let rowRevenue = 0;

        pricePoints.forEach(price => {
            const count = eventOrders.reduce((sum, order) => {
                const matchedItems = (order.items || []).filter(item => {
                    const nameMatches = (item.name || '').trim().toLowerCase() === tier.name.trim().toLowerCase();
                    const priceMatches = Math.abs((parseFloat(item.price) || 0) - price) < 0.001;
                    return nameMatches && priceMatches;
                });
                return sum + matchedItems.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0);
            }, 0);

            salesByPrice[price] = count;
            rowSold += count;
            rowRevenue += count * price;
        });

        return {
            ...tier,
            salesByPrice,
            totalSold: rowSold,
            totalRevenue: rowRevenue
        };
    });

    // 4. Compute column totals for each price point along bottom of the table
    const colTotals = {};
    let grandTotalSold = 0;
    let grandTotalRevenue = 0;

    pricePoints.forEach(price => {
        const colSum = matrixRows.reduce((sum, row) => sum + (row.salesByPrice[price] || 0), 0);
        colTotals[price] = colSum;
        grandTotalSold += colSum;
    });

    grandTotalRevenue = matrixRows.reduce((sum, row) => sum + row.totalRevenue, 0);

    // Rollups
    const totalCapacity = configuredTiers.reduce((s, t) => s + t.capacity, 0);
    const overallSelloutPercent = totalCapacity > 0 ? Math.min(100, Math.round((grandTotalSold / totalCapacity) * 100)) : 0;

    // 5. Fee breakdown calculations
    const configuredFees = event.fees || [];
    const feesCollectedBreakdown = configuredFees.map(fee => {
        const feeAmount = parseFloat(fee.amount) || 0;
        let totalCollectedForThisFee = 0;
        let appliedCount = 0;

        eventOrders.forEach(order => {
            const matchedFee = (order.fees || []).find(f => f.name && f.name.toLowerCase() === fee.name.toLowerCase());
            if (matchedFee) {
                totalCollectedForThisFee += parseFloat(matchedFee.amount) || 0;
                appliedCount++;
            } else {
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

    // Promoter Net Payout = Total Gross Ticket Sales + Total Fees Collected - Payment Gateway/Platform Fees
    const netPayoutToPromoter = Math.max(0, grandTotalRevenue + totalFeesCollected - estimatedGatewayFees);

    // Helper for chart scale computation
    const getChartScale = (maxVal, isCurrency = false) => {
        const safeMax = Math.max(maxVal || 0, isCurrency ? 100 : 4);
        const rawStep = safeMax / 4;
        const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const fraction = rawStep / power;
        let step;
        if (fraction <= 1) step = power;
        else if (fraction <= 2) step = 2 * power;
        else if (fraction <= 2.5) step = 2.5 * power;
        else if (fraction <= 5) step = 5 * power;
        else step = 10 * power;

        const maxTick = step * 4;
        const ticks = [0, step, step * 2, step * 3, maxTick];
        return { maxTick, ticks };
    };

    const maxUnitsSold = Math.max(...matrixRows.map(r => r.totalSold), 0);
    const maxRevenueAchieved = Math.max(...matrixRows.map(r => r.totalRevenue), 0);

    const unitScale = getChartScale(maxUnitsSold, false);
    const revScale = getChartScale(maxRevenueAchieved, true);

    // CSV Export Handler conforming to the Matrix Layout
    const handleExportCsv = () => {
        const lines = [
            `"Ticket Lite - Event Sales Tracker & Performance Matrix"`,
            `"Event Title:","${(event.title || '').replace(/"/g, '""')}"`,
            `"Date:","${event.date || 'TBA'}"`,
            `"Location:","${(event.location || '').replace(/"/g, '""')}"`,
            `"Promoter:","${(promoter?.name || 'Promoter').replace(/"/g, '""')} (${(promoter?.organization_name || '').replace(/"/g, '""')})"`,
            `"Generated At:","${new Date().toLocaleString()}"`,
            ``,
            `"--- TICKET SALES TRACKER & PERFORMANCE MATRIX ---"`,
            `"Ticket Type",${pricePoints.map(p => `"$${p.toFixed(2)}"`).join(',')},"Total Tickets Sold","Total Revenue"`,
            ...matrixRows.map(row =>
                `"${row.name.replace(/"/g, '""')}",${pricePoints.map(p => row.salesByPrice[p] || 0).join(',')},"${row.totalSold}","$${row.totalRevenue.toFixed(2)}"`
            ),
            `"Total Ticket Sales",${pricePoints.map(p => colTotals[p] || 0).join(',')},"${grandTotalSold}","$${grandTotalRevenue.toFixed(2)}"`,
            ``,
            `"--- FEE STRUCTURE & RECONCILIATION ---"`,
            `"Fee Name","Rate / Type","Times Applied","Total Collected"`,
            ...feesCollectedBreakdown.map(f =>
                `"${f.name.replace(/"/g, '""')}","${f.type === 'percentage' ? f.amount + '%' : '$' + f.amount.toFixed(2)}","${f.appliedCount}","$${f.totalCollected.toFixed(2)}"`
            ),
            `"Total Fees Collected","-","-","$${totalFeesCollected.toFixed(2)}"`,
            ``,
            `"--- PROMOTER FINANCIAL SUMMARY & NET PAYOUT ---"`,
            `"Gross Ticket Sales:","$${grandTotalRevenue.toFixed(2)}"`,
            `"Promoter Fees Collected:","$${totalFeesCollected.toFixed(2)}"`,
            `"Total Gross Revenue:","$${(grandTotalRevenue + totalFeesCollected).toFixed(2)}"`,
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
        link.setAttribute('download', `sales-matrix-${(event.title || 'event').toLowerCase().replace(/[^a-z0-9]/g, '-')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // SVG Chart dimensions
    const svgWidth = 800;
    const svgHeight = 360;
    const leftMargin = 65;
    const rightMargin = 80;
    const topMargin = 25;
    const bottomMargin = 85;
    const plotW = svgWidth - leftMargin - rightMargin;
    const plotH = svgHeight - topMargin - bottomMargin;

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
                    maxWidth: '1020px',
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
                {/* Modal Header Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '20px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                📊 Sales Reports & Financial Matrix
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
                                justifySelf: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* =========================================================================
                    PERFORMANCE MATRIX REPORT CONTAINER (MATCHING ATTACHED SPECIFICATION)
                    ========================================================================= */}
                <div style={{
                    background: '#ffffff',
                    color: '#0f172a',
                    borderRadius: '16px',
                    padding: '28px',
                    boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                }}>
                    {/* Header: Ticket Sales Tracker & Performance Matrix */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <h2 style={{
                            margin: 0,
                            fontSize: '1.5rem',
                            fontWeight: 800,
                            color: '#1e3a8a',
                            letterSpacing: '-0.02em',
                            fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}>
                            Ticket Sales Tracker & Performance Matrix
                        </h2>
                        {totalCapacity > 0 && (
                            <span style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: '#475569',
                                background: '#f1f5f9',
                                padding: '4px 10px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1'
                            }}>
                                Capacity: {grandTotalSold.toLocaleString()} / {totalCapacity.toLocaleString()} ({overallSelloutPercent}% sold)
                            </span>
                        )}
                    </div>

                    {/* Top Summary Cards (Image Reference: Clean Box, omits Average Ticket Price) */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        overflow: 'hidden'
                    }}>
                        {/* TOTAL TICKETS SOLD */}
                        <div style={{
                            padding: '18px 24px',
                            textAlign: 'center',
                            borderRight: '1px solid #cbd5e1'
                        }}>
                            <div style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: '#475569',
                                letterSpacing: '0.8px',
                                textTransform: 'uppercase',
                                marginBottom: '6px'
                            }}>
                                TOTAL TICKETS SOLD
                            </div>
                            <div style={{
                                fontSize: '2.2rem',
                                fontWeight: 800,
                                color: '#1e3a8a',
                                lineHeight: 1.1,
                                letterSpacing: '-0.02em'
                            }}>
                                {grandTotalSold.toLocaleString()}
                            </div>
                            <div style={{
                                fontSize: '0.78rem',
                                color: '#64748b',
                                fontStyle: 'italic',
                                marginTop: '6px'
                            }}>
                                All active tiers
                            </div>
                        </div>

                        {/* TOTAL GROSS REVENUE */}
                        <div style={{
                            padding: '18px 24px',
                            textAlign: 'center'
                        }}>
                            <div style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: '#475569',
                                letterSpacing: '0.8px',
                                textTransform: 'uppercase',
                                marginBottom: '6px'
                            }}>
                                TOTAL GROSS REVENUE
                            </div>
                            <div style={{
                                fontSize: '2.2rem',
                                fontWeight: 800,
                                color: '#1e3a8a',
                                lineHeight: 1.1,
                                letterSpacing: '-0.02em'
                            }}>
                                ${grandTotalRevenue.toLocaleString(undefined, { minimumFractionDigits: grandTotalRevenue % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
                            </div>
                            <div style={{
                                fontSize: '0.78rem',
                                color: '#64748b',
                                fontStyle: 'italic',
                                marginTop: '6px'
                            }}>
                                Combined gross earnings
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Matrix Table: Ticket Type along Y axis, Price along X axis */}
                    <div style={{
                        overflowX: 'auto',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px'
                    }}>
                        <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.88rem',
                            textAlign: 'left'
                        }}>
                            <thead>
                                <tr style={{
                                    background: '#204975',
                                    color: '#ffffff',
                                    fontWeight: 700,
                                    fontSize: '0.85rem'
                                }}>
                                    <th style={{ padding: '12px 16px', textAlign: 'left', minWidth: '140px' }}>
                                        Ticket Type
                                    </th>
                                    {pricePoints.map(p => (
                                        <th key={p} style={{ padding: '12px 16px', textAlign: 'center', minWidth: '90px' }}>
                                            ${p.toFixed(2)}
                                        </th>
                                    ))}
                                    <th style={{ padding: '12px 16px', textAlign: 'center', minWidth: '130px' }}>
                                        Total Tickets Sold
                                    </th>
                                    <th style={{ padding: '12px 16px', textAlign: 'right', minWidth: '120px' }}>
                                        Total Revenue
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {matrixRows.map((row, idx) => (
                                    <tr
                                        key={row.id}
                                        style={{
                                            background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                                            borderBottom: '1px solid #e2e8f0'
                                        }}
                                    >
                                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                                            <div>{row.name}</div>
                                            {row.note && (
                                                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                                                    {row.note}
                                                </div>
                                            )}
                                        </td>
                                        {pricePoints.map(p => {
                                            const count = row.salesByPrice[p] || 0;
                                            return (
                                                <td key={p} style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'center',
                                                    color: count > 0 ? '#0f172a' : '#94a3b8',
                                                    fontWeight: count > 0 ? 600 : 400
                                                }}>
                                                    {count}
                                                </td>
                                            );
                                        })}
                                        <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                                            {row.totalSold.toLocaleString()}
                                        </td>
                                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#1e3a8a' }}>
                                            ${row.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: row.totalRevenue % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{
                                    background: '#f1f5f9',
                                    borderTop: '2px solid #204975',
                                    fontWeight: 800,
                                    color: '#0f172a'
                                }}>
                                    <td style={{ padding: '12px 16px', fontWeight: 800 }}>
                                        Total Ticket Sales
                                    </td>
                                    {pricePoints.map(p => (
                                        <td key={p} style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 800 }}>
                                            {(colTotals[p] || 0).toLocaleString()}
                                        </td>
                                    ))}
                                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 800 }}>
                                        {grandTotalSold.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, color: '#1e3a8a' }}>
                                        ${grandTotalRevenue.toLocaleString(undefined, { minimumFractionDigits: grandTotalRevenue % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Visual Dual-Axis Chart: Ticket Sales Volume & Revenue by Tier */}
                    <div style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '20px 24px',
                        position: 'relative'
                    }}>
                        <h3 style={{
                            margin: '0 0 16px 0',
                            fontSize: '1.15rem',
                            color: '#475569',
                            fontWeight: 600
                        }}>
                            Ticket Sales Volume & Revenue by Tier
                        </h3>

                        <div style={{ width: '100%', overflowX: 'auto' }}>
                            <svg
                                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                                style={{ width: '100%', minWidth: '600px', height: 'auto', display: 'block' }}
                            >
                                {/* Left Y-Axis Title */}
                                <text
                                    transform={`rotate(-90)`}
                                    x={-(topMargin + plotH / 2)}
                                    y={18}
                                    textAnchor="middle"
                                    fill="#475569"
                                    fontSize="12"
                                    fontWeight="600"
                                >
                                    Tickets Sold (Units)
                                </text>

                                {/* Horizontal Grid Lines & Y-Axis Tick Labels (5 lines: 0%, 25%, 50%, 75%, 100%) */}
                                {[0, 1, 2, 3, 4].map(idx => {
                                    const y = topMargin + (plotH * (4 - idx)) / 4;
                                    const unitVal = unitScale.ticks[idx];
                                    const revVal = revScale.ticks[idx];

                                    return (
                                        <g key={idx}>
                                            {/* Horizontal Grid Line */}
                                            <line
                                                x1={leftMargin}
                                                y1={y}
                                                x2={leftMargin + plotW}
                                                y2={y}
                                                stroke="#e2e8f0"
                                                strokeWidth="1"
                                            />
                                            {/* Left Tick (Units Sold) */}
                                            <text
                                                x={leftMargin - 10}
                                                y={y + 4}
                                                textAnchor="end"
                                                fill="#475569"
                                                fontSize="11"
                                                fontWeight="500"
                                            >
                                                {unitVal.toLocaleString()}
                                            </text>
                                            {/* Right Tick (Revenue) */}
                                            <text
                                                x={leftMargin + plotW + 10}
                                                y={y + 4}
                                                textAnchor="start"
                                                fill="#475569"
                                                fontSize="11"
                                                fontWeight="500"
                                            >
                                                ${revVal.toLocaleString()}
                                            </text>
                                        </g>
                                    );
                                })}

                                {/* Bottom Baseline Line */}
                                <line
                                    x1={leftMargin}
                                    y1={topMargin + plotH}
                                    x2={leftMargin + plotW}
                                    y2={topMargin + plotH}
                                    stroke="#64748b"
                                    strokeWidth="1.5"
                                />

                                {/* Render Vertical Bars (Volume Sold) */}
                                {matrixRows.map((row, i) => {
                                    const slotW = plotW / matrixRows.length;
                                    const barW = Math.min(65, Math.max(22, slotW * 0.55));
                                    const barH = unitScale.maxTick > 0 ? (row.totalSold / unitScale.maxTick) * plotH : 0;
                                    const barX = leftMargin + i * slotW + (slotW - barW) / 2;
                                    const barY = topMargin + plotH - barH;
                                    const isHovered = hoveredTierIdx === i;

                                    return (
                                        <g
                                            key={row.id}
                                            onMouseEnter={() => setHoveredTierIdx(i)}
                                            onMouseLeave={() => setHoveredTierIdx(null)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <title>{`${row.name}: ${row.totalSold.toLocaleString()} tickets sold • $${row.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gross revenue`}</title>
                                            <rect
                                                x={barX}
                                                y={barY}
                                                width={barW}
                                                height={barH}
                                                fill={isHovered ? '#1e40af' : '#2f5787'}
                                                rx="1"
                                                style={{ transition: 'fill 0.2s, y 0.3s, height 0.3s' }}
                                            />
                                        </g>
                                    );
                                })}

                                {/* Render Revenue Overlay Trendline */}
                                {matrixRows.length > 0 && (
                                    <>
                                        {/* Polyline connecting all tiers */}
                                        <polyline
                                            points={matrixRows.map((row, i) => {
                                                const slotW = plotW / matrixRows.length;
                                                const cx = leftMargin + i * slotW + slotW / 2;
                                                const cy = revScale.maxTick > 0 ? topMargin + plotH - (row.totalRevenue / revScale.maxTick) * plotH : topMargin + plotH;
                                                return `${cx},${cy}`;
                                            }).join(' ')}
                                            fill="none"
                                            stroke="#683958"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />

                                        {/* Point nodes at each tier */}
                                        {matrixRows.map((row, i) => {
                                            const slotW = plotW / matrixRows.length;
                                            const cx = leftMargin + i * slotW + slotW / 2;
                                            const cy = revScale.maxTick > 0 ? topMargin + plotH - (row.totalRevenue / revScale.maxTick) * plotH : topMargin + plotH;
                                            const isHovered = hoveredTierIdx === i;

                                            return (
                                                <g
                                                    key={`point_${row.id}`}
                                                    onMouseEnter={() => setHoveredTierIdx(i)}
                                                    onMouseLeave={() => setHoveredTierIdx(null)}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <circle
                                                        cx={cx}
                                                        cy={cy}
                                                        r={isHovered ? 6 : 4}
                                                        fill="#683958"
                                                        stroke="#ffffff"
                                                        strokeWidth={isHovered ? 3 : 2}
                                                        style={{ transition: 'all 0.2s' }}
                                                    />
                                                </g>
                                            );
                                        })}
                                    </>
                                )}

                                {/* X-Axis Tier Names */}
                                {matrixRows.map((row, i) => {
                                    const slotW = plotW / matrixRows.length;
                                    const cx = leftMargin + i * slotW + slotW / 2;

                                    return (
                                        <text
                                            key={`label_${row.id}`}
                                            x={cx}
                                            y={topMargin + plotH + 20}
                                            textAnchor="middle"
                                            fill="#0f172a"
                                            fontSize="12"
                                            fontWeight="600"
                                        >
                                            {row.name.length > 15 ? `${row.name.slice(0, 13)}…` : row.name}
                                        </text>
                                    );
                                })}

                                {/* X-Axis Label */}
                                <text
                                    x={leftMargin + plotW / 2}
                                    y={topMargin + plotH + 42}
                                    textAnchor="middle"
                                    fill="#475569"
                                    fontSize="12"
                                    fontWeight="600"
                                >
                                    Ticket Tier
                                </text>

                                {/* Legend at Bottom of Chart */}
                                <g transform={`translate(${leftMargin + plotW / 2 - 140}, ${topMargin + plotH + 64})`}>
                                    {/* Volume Legend Marker */}
                                    <rect x="0" y="0" width="16" height="12" fill="#2f5787" rx="1" />
                                    <text x="24" y="10" fill="#0f172a" fontSize="12" fontWeight="600">
                                        Total Tickets Sold
                                    </text>

                                    {/* Revenue Legend Marker */}
                                    <line x1="165" y1="6" x2="185" y2="6" stroke="#683958" strokeWidth="3" strokeLinecap="round" />
                                    <circle cx="175" cy="6" r="3.5" fill="#683958" />
                                    <text x="195" y="10" fill="#0f172a" fontSize="12" fontWeight="600">
                                        Total Revenue
                                    </text>
                                </g>
                            </svg>
                        </div>
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
                            <span style={{ fontWeight: 600, color: '#fff' }}>+${grandTotalRevenue.toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>2. Total Promoter Fees Collected</span>
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>+${totalFeesCollected.toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>3. Total Gross Revenue Processed</span>
                            <span style={{ fontWeight: 700, color: '#fff' }}>${(grandTotalRevenue + totalFeesCollected).toFixed(2)}</span>
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
