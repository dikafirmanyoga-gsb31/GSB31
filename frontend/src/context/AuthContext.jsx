import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setUser((await api.get("/auth/me")).data);
      } catch {
        try {
          setUser((await api.post("/auth/refresh")).data);
        } catch {
          setUser(false);
        }
      }
    })();
    const out = () => setUser(false);
    const must = () => setUser((u) => (u ? { ...u, must_change_password: true } : u));
    window.addEventListener("gsb:logout", out);
    window.addEventListener("gsb:mustchange", must);
    return () => {
      window.removeEventListener("gsb:logout", out);
      window.removeEventListener("gsb:mustchange", must);
    };
  }, []);

  const login = async (identifier, password) => {
    const { data } = await api.post("/auth/login", { identifier, password });
    setUser(data);
    return data;
  };
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setUser(false);
    }
  };
  const can = useCallback((p) => !!user && user.permissions?.includes(p), [user]);

  return <AuthCtx.Provider value={{ user, setUser, login, logout, can }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
