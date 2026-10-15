import React, { useState } from 'react';
import { ThemeContext } from './ThemeContext';

export function ThemeProvider({ children }) {
    const [themeColors, setThemeColors] = useState({
        dominant: '',
        palette: []
    });

    return (
        <ThemeContext.Provider value={{ themeColors, setThemeColors }}>
            {children}
        </ThemeContext.Provider>
    );
}
