import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { validateLoginInputs } from '../utils/security';

export default function LoginPage() {
    const navigate = useNavigate();
    const { login, isLoading } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const validation = validateLoginInputs(email, password);
        if (!validation.isValid) {
            setError(validation.error);
            return;
        }

        try {
            await login(email, password);
            navigate('/dashboard');
        } catch (err) {
            setError(err.message || 'Login failed. Please check your credentials.');
        }
    };

    const handleFillDemo = () => {
        setEmail('promoter@vtix.com');
        setPassword('password123');
        setError('');
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: '460px', margin: '40px auto 80px', padding: '0 16px' }}>
            <div className="glass-panel" style={{ padding: '40px 32px', position: 'relative' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎟️</div>
                    <h1 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '8px' }}>Promoter Login</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                        Access your dashboard to manage events and ticket sales.
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#fca5a5',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span>⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Email Address
                        </label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="promoter@organization.com"
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                fontSize: '1rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Password
                        </label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                fontSize: '1rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    {/* Underneath the inputs: Login button and Create your promoter account hyperlink */}
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isLoading}
                            style={{ width: '100%', padding: '14px', fontSize: '1.05rem', fontWeight: 600 }}
                        >
                            {isLoading ? 'Logging in...' : 'Login'}
                        </button>

                        <Link
                            to="/register"
                            style={{
                                color: 'var(--accent-primary)',
                                fontSize: '0.95rem',
                                textDecoration: 'none',
                                fontWeight: 500,
                                transition: 'opacity 0.2s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
                            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                        >
                            Create your promoter account
                        </Link>
                    </div>
                </form>

                {/* Convenient Seed/Demo Credentials helper */}
                <div style={{
                    marginTop: '32px',
                    paddingTop: '20px',
                    borderTop: '1px solid var(--border-color)',
                    textAlign: 'center',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)'
                }}>
                    <span>Testing credentials: </span>
                    <button
                        type="button"
                        onClick={handleFillDemo}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-secondary)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        Use Demo Account (promoter@vtix.com)
                    </button>
                </div>
            </div>
        </div>
    );
}
