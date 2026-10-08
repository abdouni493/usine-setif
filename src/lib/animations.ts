import type { Transition, Variants } from 'framer-motion';

/* ============================================================================
 *  MOTION DE L'APPLICATION — RAPIDE, FLUIDE, SANS SACCADE
 * ----------------------------------------------------------------------------
 *  Règles appliquées partout (cf. skill « framer-emotion ») :
 *   · on n'anime QUE `transform` (x / y / scale) et `opacity` — composés par le
 *     GPU, jamais de recalcul de mise en page ;
 *   · durées courtes (0,12 s → 0,22 s) : une interface de caisse doit répondre,
 *     pas se donner en spectacle ;
 *   · le décalage en cascade (`stagger`) est plafonné : au-delà de quelques
 *     lignes, TOUT s'affiche en même temps — c'est ce qui rendait les écrans de
 *     50 cartes si lents à apparaître ;
 *   · `prefers-reduced-motion` est respecté via `motionSafe()`.
 * ========================================================================== */

/** L'utilisateur a demandé « moins d'animations » dans son système. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Courbe standard : départ franc, arrivée douce. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const FAST: Transition = { duration: 0.18, ease: EASE };
export const SNAP: Transition = { duration: 0.12, ease: [0.4, 0, 1, 1] };
export const SMOOTH: Transition = { duration: 0.24, ease: EASE };

/* Papeterie motion language — firm, mechanical springs (no bounce). */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 };
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 260, damping: 30 };

/**
 * Décalage d'apparition d'une liste, PLAFONNÉ.
 * 12 cartes maximum sont décalées ; au-delà le délai reste constant, sinon la
 * 60ᵉ carte d'un écran n'apparaîtrait qu'au bout de 3 secondes.
 */
export const stepDelay = (index = 0, step = 0.022, max = 12): number =>
  Math.min(index, max) * step;

export const pageTransition = {
  initial: { opacity: 0, y: 12, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: SPRING_SOFT },
  exit: { opacity: 0, y: -6, transition: SNAP },
};

/** Cards rise from below like sheets coming off the press. */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...SPRING, delay: stepDelay(i, 0.035, 10) },
  }),
  hover: { y: -3, transition: SPRING },
};

/** Table rows slide in from the reading edge. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { delay: stepDelay(i, 0.016, 16), duration: 0.18, ease: EASE },
  }),
};

export const viewSwitchVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, y: -6, transition: SNAP },
};

/** Dialogs unfold from slightly below with a firm spring; exit is faster. */
export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 18 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING },
  exit: { opacity: 0, scale: 0.98, y: 8, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
};

export const menuVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: -6 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 600, damping: 36 } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.08 } },
};

export const sidebarItemVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { ...SPRING, delay: stepDelay(i, 0.025, 14) },
  }),
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 32 },
  visible: { opacity: 1, x: 0, transition: SPRING },
  exit: { opacity: 0, x: 32, transition: SNAP },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -32 },
  visible: { opacity: 1, x: 0, transition: SPRING },
  exit: { opacity: 0, x: -32, transition: SNAP },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: SPRING },
  exit: { opacity: 0, scale: 0.98, transition: SNAP },
};

export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, y: -6, transition: SNAP },
};

export const shakeVariants: Variants = {
  shake: { x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.38 } },
};
