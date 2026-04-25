import { atom } from "jotai";

const CODE_IMAGES_HASH_STATE_KEY = "__raysoCodeImagesHashState";

declare global {
  interface Window {
    __raysoCodeImagesHashState?: string;
  }
}

const normalizeHash = (hash: string) => {
  if (!hash || hash === "#") {
    return "";
  }

  return hash.startsWith("#") ? hash : `#${hash}`;
};

const getParamsFromState = () => {
  return new URLSearchParams(getCodeImagesHashState().replace(/^#/, ""));
};

const toHashString = (params: URLSearchParams) => {
  const serialized = params.toString();
  return serialized ? `#${serialized}` : "";
};

export const setCodeImagesHashState = (hash: string) => {
  if (globalThis.window === undefined) {
    return;
  }

  globalThis.window[CODE_IMAGES_HASH_STATE_KEY] = normalizeHash(hash);
};

export const getCodeImagesHashState = () => {
  if (globalThis.window === undefined) {
    return "";
  }

  return globalThis.window[CODE_IMAGES_HASH_STATE_KEY] ?? normalizeHash(globalThis.window.location.hash);
};

export const getCodeImagesShareUrl = () => {
  if (globalThis.window === undefined) {
    return "";
  }

  const hash = getCodeImagesHashState();
  return `${globalThis.window.location.origin}${globalThis.window.location.pathname}${hash}`;
};

type HashOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

const defaultSerialize = String;

const defaultDeserialize = <T>(initialValue: T, value: string): T => {
  if (typeof initialValue === "boolean") {
    return (value === "true") as T;
  }

  if (typeof initialValue === "number") {
    const parsed = Number(value);
    return (Number.isNaN(parsed) ? initialValue : parsed) as T;
  }

  return value as T;
};

export const getCodeImagesHashParam = <T>(key: string, initialValue: T, options?: HashOptions<T>) => {
  const rawValue = getParamsFromState().get(key);

  if (rawValue === null) {
    return initialValue;
  }

  if (options?.deserialize) {
    return options.deserialize(rawValue);
  }

  return defaultDeserialize(initialValue, rawValue);
};

export const setCodeImagesHashParam = <T>(key: string, value: T, initialValue: T, options?: HashOptions<T>) => {
  const params = getParamsFromState();
  const serialized = options?.serialize ? options.serialize(value) : defaultSerialize(value);

  if (value === null || value === undefined || serialized === "" || value === initialValue) {
    params.delete(key);
  } else {
    params.set(key, serialized);
  }

  setCodeImagesHashState(toHashString(params));
};

export const atomWithCodeImagesHash = <T>(key: string, initialValue: T, options?: HashOptions<T>) => {
  const baseAtom = atom<T>(getCodeImagesHashParam(key, initialValue, options));

  return atom(
    (get) => get(baseAtom),
    (get, set, update: T | ((previous: T) => T)) => {
      const previous = get(baseAtom);
      const nextValue = typeof update === "function" ? (update as (previous: T) => T)(previous) : update;

      set(baseAtom, nextValue);
      setCodeImagesHashParam(key, nextValue, initialValue, options);
    },
  );
};
