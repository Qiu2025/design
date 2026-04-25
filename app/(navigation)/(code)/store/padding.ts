import { atomWithCodeImagesHash } from "../util/shareState";

export const PADDING_OPTIONS = [16, 32, 64, 128] as const;

export type Padding = (typeof PADDING_OPTIONS)[number];

export function isPadding(value: unknown): value is Padding {
  return PADDING_OPTIONS.includes(value as Padding);
}

const paddingAtom = atomWithCodeImagesHash<Padding>("padding", PADDING_OPTIONS[2]);

export { paddingAtom };
