import React, { useState } from 'react';
import QRCode from 'qrcode';
import { generateApplePassData, generateGoogleWalletPassData, downloadPassJson } from '../utils/wallet';

export default function WalletModal({ isOpen, onClose, walletType, order, ticket, event }) {
    const [qrUrl, setQrUrl] = useState('');
    const [downloaded, setDownloaded] = useState(false);

    if (!isOpen || !order) return null;

    const currentTicket = ticket || (order.tickets && order.tickets[0]) || {
        ticketId: `${order.orderId}-01`,
        name: (order.items && order.items[0]?.name) || 'General Admission',
        checkInStatus: 'valid'
    };

    const isApple = walletType === 'apple';
    const passData = isApple
        ? generateApplePassData({ order, ticket: currentTicket, event })
        : generateGoogleWalletPassData({ order, ticket: currentTicket, event });

    // Generate QR code if not already set
    if (!qrUrl) {
        const checkinUrl = `${window.location.origin}/tickets/${order.orderId}?ticketId=${currentTicket.ticketId}&checkin=1`;
        QRCode.toDataURL(checkinUrl, {
            width: 200,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'H'
        }).then(url => setQrUrl(url)).catch(() => {});
    }

    const handleDownloadJson = () => {
        downloadPassJson(passData, `${isApple ? 'apple-pass' : 'google-wallet'}-${currentTicket.ticketId}.json`);
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2500);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
        }}>
            <div className="animate-fade-in" style={{
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '24px',
                maxWidth: '420px',
                width: '100%',
                maxHeight: '90dvh',
                overflowY: 'auto',
                padding: '24px',
                boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6)',
                color: '#fff',
                position: 'relative'
            }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.4rem' }}>{isApple ? '🍏' : '💳'}</span>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>
                            {isApple ? 'Apple Wallet Pass' : 'Google Wallet Pass'}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            color: '#fff',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem'
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Digital Wallet Card Mockup */}
                <div style={{
                    background: isApple
                        ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
                        : 'linear-gradient(135deg, #1e1e24 0%, #111827 100%)',
                    borderRadius: '16px',
                    border: '1px solid ' + (isApple ? 'rgba(255, 255, 255, 0.2)' : 'rgba(59, 130, 246, 0.3)'),
                    padding: '20px',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    marginBottom: '16px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                                EVENT ADMISSION
                            </span>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '2px' }}>
                                {order.eventTitle}
                            </div>
                        </div>
                        <span style={{
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: '12px',
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: 'var(--success)',
                            fontWeight: 700,
                            border: '1px solid var(--success)'
                        }}>
                            VALID
                        </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '16px', color: 'var(--text-muted)' }}>
                        <div>
                            <span style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase' }}>Tier</span>
                            <strong style={{ color: '#fff' }}>{currentTicket.name}</strong>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase' }}>Pass ID</span>
                            <strong style={{ color: 'var(--accent-primary)', fontFamily: 'monospace' }}>{currentTicket.ticketId}</strong>
                        </div>
                    </div>

                    {/* QR Code in Wallet */}
                    <div style={{
                        background: '#ffffff',
                        borderRadius: '12px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto',
                        maxWidth: '180px'
                    }}>
                        {qrUrl ? (
                            <img src={qrUrl} alt="Wallet Barcode" style={{ width: '150px', height: '150px', display: 'block' }} />
                        ) : (
                            <div style={{ width: '150px', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
                                Generating...
                            </div>
                        )}
                        <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, marginTop: '4px', letterSpacing: '0.5px' }}>
                            VENUE SCANNER CODE
                        </span>
                    </div>
                </div>

                {/* Integration Details Badge */}
                <div style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.4,
                    marginBottom: '16px'
                }}>
                    <strong>📦 Format:</strong> {isApple ? 'Apple PKPass Specification (eventTicket)' : 'Google Wallet EventTicket Class & Object'}
                    <br />
                    <span>Connect your Cloudflare edge signer endpoint to generate cryptographically signed live bundles.</span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        type="button"
                        onClick={handleDownloadJson}
                        style={{
                            flex: 1,
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            background: downloaded ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: downloaded ? 'var(--success)' : '#fff',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        {downloaded ? '✓ Pass JSON Exported!' : '📥 Export Pass JSON'}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-primary"
                        style={{
                            flex: 1,
                            padding: '10px 14px',
                            fontSize: '0.85rem',
                            fontWeight: 700
                        }}
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
