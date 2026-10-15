import React, { useState, useEffect } from 'react';
import { AuthContext } from './AuthContext';
import { promoterDb } from '../services/promoterDb';

const SESSION_KEY = 'vtix_current_promoter';

export function AuthProvider({ children }) {
    const [currentPromoter, setCurrentPromoter] = useState(() => {
        try {
            const saved = localStorage.getItem(SESSION_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            console.error('Failed to load promoter session:', e);
            return null;
        }
    });

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        try {
            if (currentPromoter) {
                localStorage.setItem(SESSION_KEY, JSON.stringify(currentPromoter));
            } else {
                localStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {
            console.error('Failed to sync promoter session:', e);
        }
    }, [currentPromoter]);

    const login = async (email, password) => {
        setIsLoading(true);
        try {
            const account = await promoterDb.authenticate(email, password);
            setCurrentPromoter(account);
            return account;
        } finally {
            setIsLoading(false);
        }
    };

    const register = async (promoterData) => {
        setIsLoading(true);
        try {
            const newAccount = await promoterDb.createPromoter(promoterData);
            setCurrentPromoter(newAccount);
            return newAccount;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        setCurrentPromoter(null);
    };

    return (
        <AuthContext.Provider
            value={{
                currentPromoter,
                isAuthenticated: !!currentPromoter,
                isLoading,
                login,
                register,
                logout
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
