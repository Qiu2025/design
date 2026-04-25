import { atomWithCodeImagesHash } from "../util/shareState";

export const BACKGROUND_RADIUS_MIN = 0;
export const BACKGROUND_RADIUS_MAX = 48;
export const BACKGROUND_RADIUS_DEFAULT = 16;

export const backgroundRadiusAtom = atomWithCodeImagesHash<number>("backgroundRadius", BACKGROUND_RADIUS_DEFAULT);
