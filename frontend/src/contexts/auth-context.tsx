import { useCallback, useEffect, useMemo, useState } from "react";

import { getSession, signInWithEmail, signOutSession } from "@/lib/auth";
import type { AuthContextValue, AuthUser } from "@/types/auth";
import { AuthContext } from "@/contexts/use-auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const session = await getSession();
      setUser(session?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmail(email, password);
    await refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    await signOutSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    refreshSession,
    signIn,
    signOut,
  }), [user, isLoading, refreshSession, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
