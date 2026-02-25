import { createEffect } from "solid-js";
import { createStore, type SetStoreFunction } from "solid-js/store";

export function createLocalStore<T extends object>(
  key: string,
  initState: T,
): [T, SetStoreFunction<T>] {
  const [state, setState] = createStore<T>(initState);

  if (typeof window !== "undefined") {
    const storedValue = localStorage.getItem(key);
    if (storedValue) {
      try {
        setState(JSON.parse(storedValue));
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  createEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(state));
    }
  });

  return [state, setState];
}
