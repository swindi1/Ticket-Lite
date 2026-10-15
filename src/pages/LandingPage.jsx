import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LandingPage() {
    const { currentPromoter } = useAuth();

    return (
        <div className="animate-fade-in">
            <header className="hero">
                <h1 className="gradient-text">The Ultimate Hybrid Ticketing Platform</h1>
                <p>V-Tix Lite empowers promoters to sell tickets and merchandise in one sleek, customizable platform.</p>
                <div className="hero-buttons">
                    <Link to="/portal" className="btn btn-primary">Buy Tickets</Link>
                    <Link to={currentPromoter ? "/dashboard" : "/login"} className="btn btn-primary-reverse">
                        {currentPromoter ? "Go to Dashboard" : "Start Selling"}
                    </Link>
                </div>
            </header>

            <section className="glass-panel" style={{ marginTop: '60px', maxWidth: '1000px', margin: '60px auto 0' }}>
                <h2 style={{ marginBottom: '24px' }}>Why choose V-Tix Lite?</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '32px' }}>
                    <div>
                        <h3>🎨 Full Customization</h3>
                        <p style={{ color: 'var(--text-muted)' }}>Tailor every event page with your own color schemes and branding. Stand out from the crowd.</p>
                    </div>
                    <div>
                        <h3>🛒 Hybrid Sales</h3>
                        <p style={{ color: 'var(--text-muted)' }}>Sell e-tickets alongside your official event merchandise in one unified checkout flow.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
