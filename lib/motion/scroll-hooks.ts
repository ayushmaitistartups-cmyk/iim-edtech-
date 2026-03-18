"use client";

import { useScroll, useTransform, type MotionValue } from "framer-motion";
import React, { useRef } from "react";

// ============================================
// 3D FOLD SCROLL HOOK
// ============================================

interface UseFoldScrollOptions {
  foldIntensity?: number;
  scaleReduction?: number;
}

interface UseFoldScrollReturn {
  ref: React.RefObject<HTMLDivElement>;
  scrollYProgress: MotionValue<number>;
  rotateX: MotionValue<number>;
  scale: MotionValue<number>;
  opacity: MotionValue<number>;
}

export function useFoldScroll({
  foldIntensity = 15,
  scaleReduction = 0.05
}: UseFoldScrollOptions = {}): UseFoldScrollReturn {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"]
  });

  const rotateX = useTransform(scrollYProgress, [0, 1], [0, -foldIntensity]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1 - scaleReduction]);
  const opacity = useTransform(scrollYProgress, [0, 0.8, 1], [1, 1, 0.6]);

  return { ref, scrollYProgress, rotateX, scale, opacity };
}

// ============================================
// PARALLAX STACKING HOOK
// ============================================

interface UseParallaxStackOptions {
  offset?: number;
}

interface UseParallaxStackReturn {
  ref: React.RefObject<HTMLDivElement>;
  scrollYProgress: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
}

export function useParallaxStack({
  offset = 100
}: UseParallaxStackOptions = {}): UseParallaxStackReturn {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });

  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 0.95]);

  return { ref, scrollYProgress, y, scale };
}

// ============================================
// SCROLL PROGRESS INDICATOR HOOK
// ============================================

interface UseScrollProgressReturn {
  scrollYProgress: MotionValue<number>;
  scrollY: MotionValue<number>;
}

export function useScrollProgress(): UseScrollProgressReturn {
  const { scrollYProgress, scrollY } = useScroll();
  return { scrollYProgress, scrollY };
}

// ============================================
// STICKY HEADER SCROLL HOOK
// ============================================

interface UseStickyHeaderOptions {
  threshold?: number;
}

interface UseStickyHeaderReturn {
  scrollY: MotionValue<number>;
  headerOpacity: MotionValue<number>;
  headerBlur: MotionValue<string>;
  headerY: MotionValue<number>;
}

export function useStickyHeader({
  threshold = 100
}: UseStickyHeaderOptions = {}): UseStickyHeaderReturn {
  const { scrollY } = useScroll();

  const headerOpacity = useTransform(
    scrollY,
    [0, threshold],
    [0, 0.95]
  );

  const headerBlur = useTransform(
    scrollY,
    [0, threshold],
    ["blur(0px)", "blur(12px)"]
  );

  const headerY = useTransform(
    scrollY,
    [0, threshold],
    [-100, 0]
  );

  return { scrollY, headerOpacity, headerBlur, headerY };
}

// ============================================
// SECTION REVEAL HOOK
// ============================================

type ScrollOffset = "start" | "end" | "center" | `${number}` | `${number} ${number}`;

interface UseSectionRevealOptions {
  triggerOffset?: ScrollOffset;
}

interface UseSectionRevealReturn {
  ref: React.RefObject<HTMLDivElement>;
  scrollYProgress: MotionValue<number>;
  opacity: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
}

export function useSectionReveal(): UseSectionRevealReturn {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "start center"]
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [60, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.95, 1]);

  return { ref, scrollYProgress, opacity, y, scale };
}

// ============================================
// PERSPECTIVE SCROLL HOOK (for 3D depth)
// ============================================

interface UsePerspectiveScrollOptions {
  perspective?: number;
  rotateIntensity?: number;
}

interface UsePerspectiveScrollReturn {
  ref: React.RefObject<HTMLDivElement>;
  scrollYProgress: MotionValue<number>;
  rotateX: MotionValue<number>;
  translateZ: MotionValue<number>;
}

export function usePerspectiveScroll({
  perspective = 1000,
  rotateIntensity = 20
}: UsePerspectiveScrollOptions = {}): UsePerspectiveScrollReturn {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });

  const rotateX = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [rotateIntensity, 0, -rotateIntensity]
  );

  const translateZ = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [-50, 0, -50]
  );

  return { ref, scrollYProgress, rotateX, translateZ };
}
