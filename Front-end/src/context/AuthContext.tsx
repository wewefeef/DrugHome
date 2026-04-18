import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  avatar_color?: string;
  created_at: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'medidb_token';
const USER_KEY = 'medidb_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount, then verify token server-side
  useEffect(() => {
    const restore = async () => {
      try {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        const savedUser = localStorage.getItem(USER_KEY);
        if (!savedToken || !savedUser) return;

        // Quick optimistic restore so UI shows user immediately
        setToken(savedToken);
        setUser(JSON.parse(savedUser));

        // Verify token is still valid with the server
        const res = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (!res.ok) {
          // Token expired or revoked — force logout
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
        } else {
          // Refresh user data from server
          const freshUser: AuthUser = await res.json();
          localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
          setUser(freshUser);
        }
      } catch {
        // Network offline — keep the locally-restored session as-is
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  const login = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Returns the initials for a user's avatar (up to 2 chars). */
export function getUserInitials(user: AuthUser): string {
  const parts = user.full_name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
