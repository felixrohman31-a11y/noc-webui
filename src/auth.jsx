/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

export const AuthCtx = React.createContext(null);

export function useAuth() {
  return React.useContext(AuthCtx);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.get('/api/auth/me')
      .then(d => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    try {
      const t = getToken();
      if (t) {
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          keepalive: true
        }).catch(() => {});
      }
    } catch {}
    setToken(null);
    localStorage.removeItem('noc_weakpw');
    setUser(null);
    window.location.hash = '#/login';
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
