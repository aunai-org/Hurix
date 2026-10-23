// How far the replay has moved from one frame to the next inside a slot.
import * as THREE from "three";

/** Without motion: held sharp for 75 % of the slot, then a quick fade, so the replay never sits on two pictures laid
 * over each other. */
export const hold = (f: number) => THREE.MathUtils.smoothstep(f, 0.75, 1);

/** With motion the clouds slide the whole way through the slot; without it, hold then fade. */
export const blendFor = (f: number, hasFlow: boolean) => (hasFlow ? f : hold(f));

/** How much of the next frame shows. Sliding, the two frames dissolve only through the middle of the slot, where the
 * motion has lined them up, so a single sharp frame is on screen most of the time; without motion, hold then fade. */
export const fadeFor = (f: number, hasFlow: boolean) => (hasFlow ? THREE.MathUtils.smoothstep(f, 0.3, 0.7) : hold(f));
