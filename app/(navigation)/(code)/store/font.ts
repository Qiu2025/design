import { atomWithCodeImagesHash } from "../util/shareState";

export const FONTS = [
  "jetbrains-mono",
  "geist-mono",
  "ibm-plex-mono",
  "fira-code",
  "soehne-mono",
  "roboto-mono",
  "commit-mono",
  "space-mono",
  "source-code-pro",
  "google-sans-code",
] as const;

export type Font = (typeof FONTS)[number];

const fontAtom = atomWithCodeImagesHash<Font>("font", FONTS[0]);

export { fontAtom };
