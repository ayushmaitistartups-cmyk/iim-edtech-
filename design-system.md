# ClarityAI Design System

A premium EdTech interface designed for academic rigor and tactile engagement.

---

## 1. Design Philosophy

**Intent over decoration.** Every element exists to serve learning. No generic glows, no default Tailwind palettes, no "AI aesthetic" clichés.

### Core Principles
- **Academic Clarity**: Visual hierarchy that mirrors intellectual hierarchy
- **Tactile Feedback**: Every interaction feels physical and intentional
- **Edge Precision**: 1px borders, layered shadows, and subtle glassmorphism
- **Motion with Purpose**: Animations that convey weight and spatial relationships

---

## 2. Color System

All colors are custom HSL values. **No default Tailwind colors permitted.**

### Semantic Palette

```ts
// tailwind.config.ts tokens
colors: {
  // Backgrounds — warm paper tones
  surface: {
    DEFAULT: "hsl(42, 24%, 96%)",      // #F8F6F1 — primary canvas
    raised: "hsl(40, 20%, 98%)",       // #FBFAF8 — elevated cards
    sunken: "hsl(38, 18%, 93%)",       // #F2EFE9 — recessed areas
    overlay: "hsla(42, 24%, 96%, 0.8)" // glassmorphism base
  },

  // Ink — deep, academic
  ink: {
    DEFAULT: "hsl(220, 28%, 12%)",     // #161B26 — primary text
    muted: "hsl(220, 16%, 40%)",       // #545E71 — secondary text
    subtle: "hsl(220, 12%, 58%)",      // #8590A0 — tertiary/placeholder
    ghost: "hsl(220, 8%, 78%)"         // #C4C8CE — disabled
  },

  // Accent — scholarly blue with depth
  accent: {
    DEFAULT: "hsl(222, 68%, 48%)",     // #2952B8 — primary actions
    hover: "hsl(222, 72%, 42%)",       // #1F429E — hover state
    pressed: "hsl(222, 76%, 36%)",     // #163585 — active/pressed
    soft: "hsl(222, 60%, 94%)",        // #E8EDF8 — subtle backgrounds
    glow: "hsla(222, 68%, 48%, 0.15)"  // glow rings
  },

  // Success — muted sage green
  success: {
    DEFAULT: "hsl(158, 48%, 38%)",     // #329E6B
    soft: "hsl(158, 40%, 93%)"         // #E6F5EE
  },

  // Warning — warm amber
  caution: {
    DEFAULT: "hsl(38, 85%, 52%)",      // #E8A622
    soft: "hsl(38, 70%, 94%)"          // #FBF3E0
  },

  // Error — refined crimson
  error: {
    DEFAULT: "hsl(0, 58%, 48%)",       // #C23838
    soft: "hsl(0, 50%, 95%)"           // #F9EDED
  },

  // Borders — warm neutrals
  edge: {
    DEFAULT: "hsl(32, 12%, 84%)",      // #DAD5CD — standard borders
    strong: "hsl(32, 14%, 72%)",       // #BEB5AA — emphasized
    subtle: "hsl(32, 8%, 90%)"         // #E8E6E2 — light dividers
  }
}
```

### Edge Lighting Technique
Cards use a 1px border with 5% luminosity difference from background:
```css
border: 1px solid hsl(32, 12%, 89%); /* 5% lighter than surface */
```

---

## 3. Typography Scale

### Font Stack
```css
--font-sans: "Inter Variable", "Geist", system-ui, -apple-system, sans-serif;
--font-serif: "Source Serif 4 Variable", "Georgia", serif;
--font-mono: "JetBrains Mono", "Geist Mono", monospace;
```

### Fluid Type Scale (using clamp())
```css
/* Display — hero text */
--text-display: clamp(2.5rem, 5vw + 1rem, 4rem);      /* 40px → 64px */
--leading-display: 1.1;

/* Headline — section headers */
--text-headline: clamp(1.75rem, 3vw + 0.5rem, 2.5rem); /* 28px → 40px */
--leading-headline: 1.2;

/* Title — card titles, H2 */
--text-title: clamp(1.25rem, 2vw + 0.25rem, 1.5rem);  /* 20px → 24px */
--leading-title: 1.3;

/* Body — primary reading */
--text-body: clamp(0.9375rem, 1vw + 0.125rem, 1rem);  /* 15px → 16px */
--leading-body: 1.6;

/* Caption — small text, labels */
--text-caption: clamp(0.75rem, 0.5vw + 0.5rem, 0.8125rem); /* 12px → 13px */
--leading-caption: 1.4;

/* Math content weight */
--text-math: 1.0625rem; /* 17px — slightly larger for equations */
```

### Typographic Treatments
- **Academic content**: Use serif font at --text-body with --leading-body: 1.7
- **UI elements**: Use sans at standard weight (400-500)
- **Math expressions**: KaTeX containers get --text-math with generous padding

---

## 4. Spacing Scale (4px Base)

```ts
spacing: {
  px: "1px",
  0: "0",
  0.5: "2px",    // 0.5 × 4
  1: "4px",      // micro spacing
  2: "8px",      // tight
  3: "12px",     // compact
  4: "16px",     // standard
  5: "20px",     // comfortable
  6: "24px",     // relaxed
  8: "32px",     // section gap
  10: "40px",    // large section
  12: "48px",    // content block
  16: "64px",    // page section
  20: "80px",    // major section
  24: "96px",    // hero spacing
  32: "128px"    // dramatic spacing
}
```

### Grid System
- **Base unit**: 4px
- **Column gutters**: 24px (6 units)
- **Container max-width**: 1280px
- **Content max-width**: 720px (for readability)

---

## 5. Shadow System (Layered Depth)

Shadows use 3-4 layers for realistic soft elevation:

```ts
boxShadow: {
  // Resting state — subtle lift
  "soft": `
    0 1px 2px hsla(220, 28%, 12%, 0.04),
    0 2px 4px hsla(220, 28%, 12%, 0.03),
    0 4px 8px hsla(220, 28%, 12%, 0.02)
  `,

  // Hover — increased prominence
  "lifted": `
    0 2px 4px hsla(220, 28%, 12%, 0.05),
    0 4px 8px hsla(220, 28%, 12%, 0.04),
    0 8px 16px hsla(220, 28%, 12%, 0.03),
    0 16px 32px hsla(220, 28%, 12%, 0.02)
  `,

  // Active/pressed — collapsed
  "pressed": `
    0 0.5px 1px hsla(220, 28%, 12%, 0.06),
    0 1px 2px hsla(220, 28%, 12%, 0.04)
  `,

  // Modal/overlay
  "modal": `
    0 4px 8px hsla(220, 28%, 12%, 0.08),
    0 8px 16px hsla(220, 28%, 12%, 0.06),
    0 16px 32px hsla(220, 28%, 12%, 0.04),
    0 32px 64px hsla(220, 28%, 12%, 0.03)
  `,

  // Glow ring for focus states
  "glow-accent": "0 0 0 3px hsla(222, 68%, 48%, 0.15)"
}
```

---

## 6. Motion Curves & Timing

### Custom Easing Functions
```ts
transitionTimingFunction: {
  // Spring-like for UI elements
  "spring": "cubic-bezier(0.175, 0.885, 0.32, 1.275)",

  // Smooth deceleration
  "smooth-out": "cubic-bezier(0.22, 1, 0.36, 1)",

  // Quick snap
  "snap": "cubic-bezier(0.68, -0.6, 0.32, 1.6)",

  // Gentle ease for content
  "gentle": "cubic-bezier(0.4, 0, 0.2, 1)",

  // Bounce-back for tactile feedback
  "bounce": "cubic-bezier(0.34, 1.56, 0.64, 1)"
}
```

### Duration Scale
```ts
transitionDuration: {
  "fast": "100ms",      // micro-interactions
  "normal": "200ms",    // standard UI
  "smooth": "300ms",    // content reveals
  "gentle": "500ms",    // section transitions
  "slow": "700ms"       // dramatic entrances
}
```

### Framer Motion Variants
```tsx
// Staggered list entrance
export const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  }
};

export const slideUp = {
  hidden: {
    opacity: 0,
    y: 24,
    scale: 0.96
  },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 25
    }
  }
};

// 3D fold effect for scroll
export const foldScroll = (scrollProgress: number) => ({
  rotateX: scrollProgress * -15,
  scale: 1 - scrollProgress * 0.05,
  transformPerspective: 1000,
  transformOrigin: "top center"
});

// Pressable button
export const pressable = {
  rest: { scale: 1 },
  hover: { scale: 1.02 },
  pressed: { scale: 0.98 }
};
```

---

## 7. Border Radius

```ts
borderRadius: {
  none: "0",
  sm: "4px",      // subtle rounding
  DEFAULT: "8px", // standard components
  md: "12px",     // cards, inputs
  lg: "16px",     // modals, large cards
  xl: "24px",     // hero elements
  "2xl": "32px",  // dramatic curves
  full: "9999px"  // pills, avatars
}
```

---

## 8. Glassmorphism Spec

For overlays and elevated surfaces:
```css
.glass {
  background: hsla(42, 24%, 96%, 0.72);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  border: 1px solid hsla(32, 12%, 84%, 0.6);
}

.glass-dark {
  background: hsla(220, 28%, 12%, 0.72);
  backdrop-filter: blur(12px) saturate(1.1);
  border: 1px solid hsla(220, 16%, 24%, 0.4);
}
```

---

## 9. Component Patterns

### Pressable Card
Every interactive card implements:
1. **Rest**: `shadow-soft`, `border-edge`, `scale-100`
2. **Hover**: `shadow-lifted`, `border-edge-strong`, `scale-102`
3. **Pressed**: `shadow-pressed`, `scale-98`
4. **Focus**: `ring-3 ring-accent/15`

### Mobile Patterns
- **Bottom sheets**: Native drawer pattern for filters/options
- **Touch targets**: Minimum 44×44px
- **Swipe gestures**: Pan to dismiss overlays

### KaTeX Container
```css
.katex-container {
  padding: 20px 24px;
  background: hsl(var(--surface-raised));
  border: 1px solid hsl(var(--edge-subtle));
  border-radius: 12px;
  font-size: var(--text-math);
  overflow-x: auto;
}
```

---

## 10. Implementation Checklist

- [ ] Custom fonts loaded via next/font
- [ ] CSS variables defined in globals.css
- [ ] Tailwind config extended with all tokens
- [ ] Motion components created (PressableCard, StaggeredList)
- [ ] 3D scroll logic implemented with Framer Motion
- [ ] Glassmorphism utilities added
- [ ] Mobile bottom sheet pattern
- [ ] KaTeX container styled
- [ ] All default Tailwind colors removed from usage
