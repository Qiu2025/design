import { atomWithCodeImagesHash } from "../util/shareState";

export const FRAME_BORDER_RADIUS_MIN = 0;
export const FRAME_BORDER_RADIUS_MAX = 32;
export const FRAME_BORDER_RADIUS_DEFAULT = 16;

export const frameBorderRadiusAtom = atomWithCodeImagesHash<number>("borderRadius", FRAME_BORDER_RADIUS_DEFAULT);
