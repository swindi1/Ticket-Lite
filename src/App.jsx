import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/PromoterDashboard';
import EventPage from './pages/EventPage';
import CustomerPortal from './pages/CustomerPortal';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import TicketPassPage from './pages/TicketPassPage';
import './index.css';

import { ThemeProvider } from './context/ThemeProvider';
import { EventProvider } from './context/EventProvider';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './hooks/useAuth';

function NavigationBar() {
  const { currentPromoter, logout } = useAuth();

  return (
    <nav className="glass-navbar">
      <Link to="/" className="logo gradient-text">Ticket Lite</Link>
      <div className="nav-links">
        <Link to="/">Home</Link>
        <Link to="/portal">Browse Events</Link>
        {currentPromoter ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Link to="/dashboard" className="btn btn-primary-reverse" style={{ padding: '8px 18px', fontSize: '0.9rem' }}>
              Dashboard
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🏢 <strong style={{ color: '#fff' }}>{currentPromoter.organization_name}</strong>
              </span>
              <button
                onClick={logout}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '20px',
                  padding: '4px 12px',
                  fontSize: '0.8rem',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                Log Out
              </button>
            </div>
          </div>
        ) : (
          <Link to="/login" className="btn btn-primary-reverse">Start Selling</Link>
        )}
      </div>
    </nav>
  );
}

function ProtectedDashboard() {
  const { currentPromoter } = useAuth();
  if (!currentPromoter) {
    return <Navigate to="/login" replace />;
  }
  return <Dashboard />;
}

function App() {
  return (
    <ThemeProvider>
      <EventProvider>
        <AuthProvider>
          <Router>
            <div className="app-container">
              <NavigationBar />
              <main className="main-content">
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/portal" element={<CustomerPortal />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/dashboard" element={<ProtectedDashboard />} />
                  <Route path="/event/:eventId" element={<EventPage />} />
                  <Route path="/tickets/:orderId" element={<TicketPassPage />} />
                </Routes>
              </main>
            </div>
          </Router>
        </AuthProvider>
      </EventProvider>
    </ThemeProvider>
  );
}

export default App;

