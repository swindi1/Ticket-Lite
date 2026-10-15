import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function RegisterPage() {
    const navigate = useNavigate();
    const { register, isLoading } = useAuth();

    const [formData, setFormData] = useState({
        name: '',
        organizationName: '',
        phoneNumber: '',
        email: '',
        password: '',
        confirmPassword: ''
    });

    const [error, setError] = useState('');

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters long.');
            return;
        }

        try {
            await register({
                name: formData.name,
                organizationName: formData.organizationName,
                phoneNumber: formData.phoneNumber,
                email: formData.email,
                password: formData.password
            });
            navigate('/dashboard');
        } catch (err) {
            setError(err.message || 'Registration failed. Please try again.');
        }
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: '520px', margin: '40px auto 80px', padding: '0 16px' }}>
            <div className="glass-panel" style={{ padding: '40px 32px' }}>
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🚀</div>
                    <h1 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '8px' }}>
                        Create Promoter Account
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                        Start creating events, customizing ticketing palettes, and selling online.
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

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Your Name
                        </label>
                        <input
                            type="text"
                            required
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g. Tyler Vance"
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                fontSize: '0.95rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Organization Name
                        </label>
                        <input
                            type="text"
                            required
                            name="organizationName"
                            value={formData.organizationName}
                            onChange={handleChange}
                            placeholder="e.g. Apex Music Group / Redline Productions"
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                fontSize: '0.95rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Phone Number
                            </label>
                            <input
                                type="tel"
                                required
                                name="phoneNumber"
                                value={formData.phoneNumber}
                                onChange={handleChange}
                                placeholder="(555) 000-0000"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid var(--border-color)',
                                    color: '#fff',
                                    fontSize: '0.95rem',
                                    outline: 'none'
                                }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Email Address
                            </label>
                            <input
                                type="email"
                                required
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="name@org.com"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid var(--border-color)',
                                    color: '#fff',
                                    fontSize: '0.95rem',
                                    outline: 'none'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Password
                            </label>
                            <input
                                type="password"
                                required
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                placeholder="••••••••"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid var(--border-color)',
                                    color: '#fff',
                                    fontSize: '0.95rem',
                                    outline: 'none'
                                }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Confirm Password
                            </label>
                            <input
                                type="password"
                                required
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                placeholder="••••••••"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid var(--border-color)',
                                    color: '#fff',
                                    fontSize: '0.95rem',
                                    outline: 'none'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isLoading}
                            style={{ width: '100%', padding: '14px', fontSize: '1.05rem', fontWeight: 600 }}
                        >
                            {isLoading ? 'Creating Account...' : 'Create Account'}
                        </button>

                        <Link
                            to="/login"
                            style={{
                                color: 'var(--accent-primary)',
                                fontSize: '0.9rem',
                                textDecoration: 'none',
                                fontWeight: 500
                            }}
                        >
                            Already have an account? Log in
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
