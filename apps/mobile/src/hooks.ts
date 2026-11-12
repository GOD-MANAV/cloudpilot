import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";

/** Poll while the screen is focused. */
export function usePoll<T>(load: (() => Promise<T>) | null, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async () => {
    if (!loadRef.current) return;
    setLoading(true);
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!load) return;
      void run();
      const t = ms > 0 ? setInterval(run, ms) : null;
      return () => {
        if (t) clearInterval(t);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, ms, !!load, ...deps]),
  );
  return { data, error, loading, reload: run };
}

/** Run an action with a busy flag, haptics, and an alert on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Something went wrong", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
