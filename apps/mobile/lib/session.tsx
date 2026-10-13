import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { queryClient } from './query';
import { supabase } from './supabase';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

const Ctx = createContext<SessionState>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => mounted && setState({ session: data.session, loading: false }))
      .catch(() => mounted && setState({ session: null, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      if (event === 'SIGNED_OUT') queryClient.clear(); // başka hesabın verisi önbellekte kalmasın
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
