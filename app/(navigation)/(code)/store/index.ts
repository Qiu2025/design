import { atom } from "jotai";
import { atomWithCodeImagesHash } from "../util/shareState";
import type { Highlighter } from "shiki";

export const windowWidthAtom = atomWithCodeImagesHash<number | null>("width", null);

export const showBackgroundAtom = atomWithCodeImagesHash<boolean>("background", true);

export const showLineNumbersAtom = atomWithCodeImagesHash<boolean | undefined>("lineNumbers", undefined);

export const fileNameAtom = atomWithCodeImagesHash<string>("title", "", {
  serialize(val) {
    return val;
  },
  deserialize(str) {
    return str || "";
  },
});

export const highlighterAtom = atom<Highlighter | null>(null);

export const loadingLanguageAtom = atom<boolean>(false);

export const highlightedLinesAtom = atomWithCodeImagesHash<number[]>("highlightedLines", [], {
  serialize(val) {
    return val.join(",");
  },
  deserialize(str) {
    return str ? str.split(",").map(Number) : [];
  },
});
