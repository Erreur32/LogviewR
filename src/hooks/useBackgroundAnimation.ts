/**
 * Hook for background animation preference (CSS background for any theme)
 * full-animation theme selection, and animation speed.
 * Ported from MynetworK with logviewr_* localStorage keys.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentTheme } from '../utils/themeManager';

export type BgAnimationVariant = 'off' | 'animation.80.particle-waves' | 'animation.93.particules-line' | 'animation.1.home-assistant-particles';

/** Full animation IDs (lovelace-style). Includes 'animation.all' for cycling through all. Default: animation.80.particle-waves */
export type FullAnimationId =
  | 'animation.all'
  | 'animation.1.home-assistant-particles'
  | 'animation.10.css-dark-particles'
  | 'animation.72.playstation-3-bg-style'
  | 'animation.79.canvas-ribbons'
  | 'animation.80.particle-waves'
  | 'animation.90.aurora'
  | 'animation.92.aurora-v2'
  | 'animation.93.particules-line'
  | 'animation.94.alien-blackout'
  | 'animation.95.bit-ocean'
  | 'animation.96.stars'
  | 'animation.97.space'
  | 'animation.98.sidelined';

/** IDs used when cycling (all except 'animation.all') */
export const CYCLEABLE_ANIMATION_IDS: FullAnimationId[] = [
  'animation.1.home-assistant-particles',
  'animation.10.css-dark-particles',
  'animation.72.playstation-3-bg-style',
  'animation.79.canvas-ribbons',
  'animation.80.particle-waves',
  'animation.90.aurora',
  'animation.92.aurora-v2',
  'animation.93.particules-line',
  'animation.94.alien-blackout',
  'animation.95.bit-ocean',
  'animation.96.stars',
  'animation.97.space',
  'animation.98.sidelined',
];

/** Animation speed slider value: 0-1.5 (0 = very fast, 1.5 = very slow) */
export type AnimationSpeed = number;

/** Convert slider value (0-1.5) to animation multiplier (0.3-3.0) */
export function speedToMultiplier(speed: number): number {
  return 0.3 + ((1.5 - speed) / 1.5) * 2.7;
}

const BG_ANIMATION_KEY = 'logviewr_bg_animation';
const FULL_ANIMATION_ID_KEY = 'logviewr_full_animation_id';
const ANIMATION_SPEED_KEY = 'logviewr_animation_speed';

/** Custom events for same-tab sync (StorageEvent does not fire in the tab that changed storage) */
const ANIMATION_SPEED_SYNC_EVENT = 'logviewr_animation_speed_sync';
const FULL_ANIMATION_ID_SYNC_EVENT = 'logviewr_full_animation_id_sync';

const DEFAULT_BG: BgAnimationVariant = 'animation.80.particle-waves';
const DEFAULT_FULL: FullAnimationId = 'animation.80.particle-waves';
const DEFAULT_SPEED: AnimationSpeed = 0.75;
export const MIN_SPEED = 0;
export const MAX_SPEED = 1.5;

export const VALID_FULL_ANIMATION_IDS: FullAnimationId[] = [
  'animation.all',
  ...CYCLEABLE_ANIMATION_IDS,
];

/** All options for the animation grid in settings: 'off' (no animation) + every animation id */
export const ANIMATION_GRID_OPTIONS: FullAnimationIdOrOff[] = ['off', ...VALID_FULL_ANIMATION_IDS];

export function getStoredBgAnimation(): BgAnimationVariant {
  try {
    const v = localStorage.getItem(BG_ANIMATION_KEY);
    if (v === 'gradient' || v === 'particles' || v === 'grid') {
      setStoredBgAnimation('animation.80.particle-waves');
      return 'animation.80.particle-waves';
    }
    if (v === 'off' || v === 'animation.80.particle-waves' || v === 'animation.93.particules-line' || v === 'animation.1.home-assistant-particles') {
      return v as BgAnimationVariant;
    }
  } catch {
    // ignore
  }
  return DEFAULT_BG;
}

export function setStoredBgAnimation(variant: BgAnimationVariant): void {
  try {
    localStorage.setItem(BG_ANIMATION_KEY, variant);
  } catch {
    // ignore
  }
}

/** Value stored for full animation: either a concrete animation or 'off' for no animation */
export type FullAnimationIdOrOff = FullAnimationId | 'off';

export function getStoredFullAnimationId(): FullAnimationIdOrOff {
  try {
    const v = localStorage.getItem(FULL_ANIMATION_ID_KEY);
    if (v === 'off') return 'off';
    const removedAnimations = ['animation.95.just-in-case', 'animation.99.media-background'];
    if (v && removedAnimations.includes(v)) {
      localStorage.removeItem(FULL_ANIMATION_ID_KEY);
      const paramKey = `logviewr_animation_params_${v}`;
      localStorage.removeItem(paramKey);
      return DEFAULT_FULL;
    }
    if (VALID_FULL_ANIMATION_IDS.includes(v as FullAnimationId)) return v as FullAnimationId;
  } catch {
    // ignore
  }
  return DEFAULT_FULL;
}

export function setStoredFullAnimationId(id: FullAnimationIdOrOff): void {
  try {
    localStorage.setItem(FULL_ANIMATION_ID_KEY, id);
  } catch {
    // ignore
  }
}

export function getStoredAnimationSpeed(): AnimationSpeed {
  try {
    const v = localStorage.getItem(ANIMATION_SPEED_KEY);
    if (v) {
      const num = parseFloat(v);
      if (!isNaN(num) && num >= MIN_SPEED && num <= MAX_SPEED) return num;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SPEED;
}

export function setStoredAnimationSpeed(speed: AnimationSpeed): void {
  try {
    localStorage.setItem(ANIMATION_SPEED_KEY, speed.toString());
  } catch {
    // ignore
  }
}

export type EffectiveVariant = BgAnimationVariant | FullAnimationId;

export function useBackgroundAnimation(): {
  variant: EffectiveVariant;
  theme: string;
  bgAnimation: BgAnimationVariant;
  setBgAnimation: (v: BgAnimationVariant) => void;
  fullAnimationId: FullAnimationIdOrOff;
  setFullAnimationId: (id: FullAnimationIdOrOff) => void;
  animationSpeed: AnimationSpeed;
  setAnimationSpeed: (s: AnimationSpeed) => void;
  minSpeed: number;
  maxSpeed: number;
  prefersReducedMotion: boolean;
} {
  const [bgAnimation, setBgState] = useState<BgAnimationVariant>(getStoredBgAnimation);
  const [fullAnimationId, setFullState] = useState<FullAnimationIdOrOff>(getStoredFullAnimationId);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [animationSpeed, setSpeedState] = useState<AnimationSpeed>(getStoredAnimationSpeed);
  const [theme, setThemeState] = useState<string>(getCurrentTheme());
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const CYCLE_PARAMS_KEY = 'logviewr_animation_params_animation.all';
  const getCycleParams = useCallback(() => {
    try {
      const raw = localStorage.getItem(CYCLE_PARAMS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      const cycleAnimations = Array.isArray(p.cycleAnimations)
        ? p.cycleAnimations.filter((id: string) => CYCLEABLE_ANIMATION_IDS.includes(id as FullAnimationId))
        : [];
      return {
        cycleDuration: typeof p.cycleDuration === 'number' ? Math.max(5, Math.min(43200, p.cycleDuration)) : 60,
        cycleRandom: p.cycleRandom === true,
        cycleLoop: p.cycleLoop !== false,
        cycleAnimations: cycleAnimations.length > 0 ? cycleAnimations : CYCLEABLE_ANIMATION_IDS,
      };
    } catch {
      return {
        cycleDuration: 60,
        cycleRandom: false,
        cycleLoop: true,
        cycleAnimations: CYCLEABLE_ANIMATION_IDS,
      };
    }
  }, []);

  const lastSwitchTimeRef = useRef<number>(Date.now());
  const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(media.matches);
    const handler = () => setPrefersReducedMotion(media.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const syncTheme = () => setThemeState(getCurrentTheme());
    syncTheme();
    window.addEventListener('themechange', syncTheme);
    return () => window.removeEventListener('themechange', syncTheme);
  }, []);

  const setBgAnimation = useCallback((v: BgAnimationVariant) => {
    setStoredBgAnimation(v);
    setBgState(v);
    window.dispatchEvent(new StorageEvent('storage', { key: BG_ANIMATION_KEY, newValue: v }));
  }, []);

  const setFullAnimationId = useCallback((id: FullAnimationIdOrOff) => {
    setStoredFullAnimationId(id);
    setFullState(id);
    window.dispatchEvent(new StorageEvent('storage', { key: FULL_ANIMATION_ID_KEY, newValue: id }));
    window.dispatchEvent(new CustomEvent(FULL_ANIMATION_ID_SYNC_EVENT, { detail: { fullAnimationId: id } }));
  }, []);

  const setAnimationSpeed = useCallback((s: AnimationSpeed) => {
    setStoredAnimationSpeed(s);
    setSpeedState(s);
    window.dispatchEvent(new StorageEvent('storage', { key: ANIMATION_SPEED_KEY, newValue: String(s) }));
    window.dispatchEvent(new CustomEvent(ANIMATION_SPEED_SYNC_EVENT, { detail: { speed: s } }));
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === BG_ANIMATION_KEY && e.newValue) {
        if (e.newValue === 'off' || e.newValue === 'animation.80.particle-waves' || e.newValue === 'animation.93.particules-line' || e.newValue === 'animation.1.home-assistant-particles') {
          setBgState(e.newValue as BgAnimationVariant);
        }
      }
      if (e.key === FULL_ANIMATION_ID_KEY && e.newValue) {
        if (e.newValue === 'off') setFullState('off');
        else if (VALID_FULL_ANIMATION_IDS.includes(e.newValue as FullAnimationId)) setFullState(e.newValue as FullAnimationId);
      }
      if (e.key === ANIMATION_SPEED_KEY && e.newValue) {
        const num = parseFloat(e.newValue);
        if (!isNaN(num) && num >= MIN_SPEED && num <= MAX_SPEED) {
          setSpeedState(num);
        }
      }
    };
    const onSpeedSync = (e: Event) => {
      const detail = (e as CustomEvent<{ speed: number }>).detail;
      if (detail && typeof detail.speed === 'number' && detail.speed >= MIN_SPEED && detail.speed <= MAX_SPEED) {
        setSpeedState(detail.speed);
      }
    };
    const onFullIdSync = (e: Event) => {
      const detail = (e as CustomEvent<{ fullAnimationId: FullAnimationIdOrOff }>).detail;
      if (detail && (detail.fullAnimationId === 'off' || VALID_FULL_ANIMATION_IDS.includes(detail.fullAnimationId as FullAnimationId))) {
        setFullState(detail.fullAnimationId);
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ANIMATION_SPEED_SYNC_EVENT, onSpeedSync);
    window.addEventListener(FULL_ANIMATION_ID_SYNC_EVENT, onFullIdSync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ANIMATION_SPEED_SYNC_EVENT, onSpeedSync);
      window.removeEventListener(FULL_ANIMATION_ID_SYNC_EVENT, onFullIdSync);
    };
  }, []);

  useEffect(() => {
    if (fullAnimationId === 'off' || fullAnimationId !== 'animation.all' || prefersReducedMotion) return;
    lastSwitchTimeRef.current = Date.now();
    const tickMs = 1000;
    const timer = window.setInterval(() => {
      const params = getCycleParams();
      const list = params.cycleAnimations;
      const durationMs = params.cycleDuration * 1000;
      if (Date.now() - lastSwitchTimeRef.current >= durationMs) {
        lastSwitchTimeRef.current = Date.now();
        setCycleIndex((i) => {
          const next = params.cycleRandom
            ? Math.floor(Math.random() * list.length)
            : (i + 1) % list.length;
          if (!params.cycleLoop && next === 0 && list.length > 0) {
            if (cycleTimerRef.current) {
              clearInterval(cycleTimerRef.current);
              cycleTimerRef.current = null;
            }
            return i;
          }
          return next;
        });
      }
    }, tickMs);
    cycleTimerRef.current = timer;
    return () => {
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
      cycleTimerRef.current = null;
    };
  }, [fullAnimationId, prefersReducedMotion, getCycleParams]);

  const isFullAnimationTheme = theme === 'full-animation';
  const isBlackThemeWithAnimation = (theme === 'dark' || theme === 'glass' || theme === 'nightly');
  const showAnimationForTheme = isFullAnimationTheme || isBlackThemeWithAnimation;
  const cycleList = fullAnimationId === 'animation.all' ? getCycleParams().cycleAnimations : CYCLEABLE_ANIMATION_IDS;
  const effectiveVariant: EffectiveVariant = prefersReducedMotion
    ? 'off'
    : fullAnimationId === 'off'
      ? 'off'
      : showAnimationForTheme
        ? fullAnimationId === 'animation.all'
          ? cycleList[cycleIndex % cycleList.length]
          : fullAnimationId
        : bgAnimation === 'off'
          ? 'off'
          : fullAnimationId === 'animation.all'
            ? cycleList[cycleIndex % cycleList.length]
            : fullAnimationId;
  const variant = effectiveVariant;

  return {
    variant,
    theme,
    bgAnimation,
    setBgAnimation,
    fullAnimationId,
    setFullAnimationId,
    animationSpeed,
    setAnimationSpeed,
    minSpeed: MIN_SPEED,
    maxSpeed: MAX_SPEED,
    prefersReducedMotion,
  };
}
