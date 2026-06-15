import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api, AuthResponse, AuthUser } from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateToken: (newToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_STORAGE_KEY = "orca_auth_token";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(AUTH_STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  const persistAuth = useCallback((auth: AuthResponse) => {
    localStorage.setItem(AUTH_STORAGE_KEY, auth.token);
    api.setToken(auth.token);
    setToken(auth.token);
    setUser(auth.user);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      if (!token) {
        api.setToken("");
        setLoading(false);
        return;
      }

      try {
        api.setToken(token);
        const currentUser = await api.getCurrentUser();
        setUser(currentUser);
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [token]);

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await api.login(email, password);
      persistAuth(auth);
    },
    [persistAuth],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const auth = await api.loginWithGoogle(idToken);
      persistAuth(auth);
    },
    [persistAuth],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      const auth = await api.register(email, password, name);
      persistAuth(auth);
    },
    [persistAuth],
  );

  const logout = useCallback(() => {
    void api.logout().catch(() => {
      // Ignore network/backend errors and still clear local auth state.
    });
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setUser(null);
    setToken(null);
    api.setToken("");
  }, []);

  const refreshUser = useCallback(async () => {
    const currentUser = await api.getCurrentUser();
    setUser(currentUser);
  }, []);

  const updateToken = useCallback((newToken: string) => {
    localStorage.setItem(AUTH_STORAGE_KEY, newToken);
    api.setToken(newToken);
    setToken(newToken);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginWithGoogle, signup, logout, refreshUser, updateToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
