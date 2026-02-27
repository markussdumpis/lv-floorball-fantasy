import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type TourId = 'MAIN_ONBOARDING' | 'SQUAD_TIPS';

type TourStartPayload = {
  restart?: boolean;
  source?: string;
};

type TourRequest = {
  id: number;
  tourId: TourId;
  restart: boolean;
  source?: string;
};

type TourContextValue = {
  lastRequest: TourRequest | null;
  startTour: (tourId: TourId, payload?: TourStartPayload) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

export function TourProvider({ children }: Props) {
  const [lastRequest, setLastRequest] = useState<TourRequest | null>(null);

  const startTour = useCallback((tourId: TourId, payload?: TourStartPayload) => {
    setLastRequest(prev => {
      const nextId = (prev?.id ?? 0) + 1;
      const restart = payload?.restart ?? true;
      const request: TourRequest = {
        id: nextId,
        tourId,
        restart,
        source: payload?.source,
      };
      if (__DEV__) {
        console.log('[tour] start', request);
      }
      return request;
    });
  }, []);

  const value = useMemo(() => ({ lastRequest, startTour }), [lastRequest, startTour]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useTour must be used within TourProvider');
  }
  return ctx;
}
