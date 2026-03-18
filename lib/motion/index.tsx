"use client";

import { motion, type HTMLMotionProps, type Variants } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

// ============================================
// ANIMATION VARIANTS
// ============================================

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  }
};

export const slideUp: Variants = {
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

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
  }
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: {
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 500,
      damping: 30
    }
  }
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  show: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 25
    }
  }
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 25
    }
  }
};

// ============================================
// PRESSABLE CARD COMPONENT
// ============================================

interface PressableCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  as?: "div" | "article" | "section" | "button";
  disabled?: boolean;
}

export const PressableCard = forwardRef<HTMLDivElement, PressableCardProps>(
  ({ children, className = "", as = "div", disabled = false, ...props }, ref) => {
    const Component = motion[as] as typeof motion.div;

    return (
      <Component
        ref={ref}
        className={`
          bg-surface-raised border border-edge rounded-md p-6
          transition-colors duration-normal ease-gentle
          ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
          ${className}
        `}
        initial="rest"
        whileHover={disabled ? undefined : "hover"}
        whileTap={disabled ? undefined : "pressed"}
        variants={{
          rest: {
            scale: 1,
            boxShadow: `
              0 1px 2px hsla(220, 28%, 12%, 0.04),
              0 2px 4px hsla(220, 28%, 12%, 0.03),
              0 4px 8px hsla(220, 28%, 12%, 0.02)
            `
          },
          hover: {
            scale: 1.02,
            y: -2,
            boxShadow: `
              0 2px 4px hsla(220, 28%, 12%, 0.05),
              0 4px 8px hsla(220, 28%, 12%, 0.04),
              0 8px 16px hsla(220, 28%, 12%, 0.03),
              0 16px 32px hsla(220, 28%, 12%, 0.02)
            `,
            transition: {
              type: "spring",
              stiffness: 400,
              damping: 25
            }
          },
          pressed: {
            scale: 0.98,
            boxShadow: `
              0 0.5px 1px hsla(220, 28%, 12%, 0.06),
              0 1px 2px hsla(220, 28%, 12%, 0.04)
            `,
            transition: {
              type: "spring",
              stiffness: 600,
              damping: 30
            }
          }
        }}
        {...props}
      >
        {children}
      </Component>
    );
  }
);

PressableCard.displayName = "PressableCard";

// ============================================
// STAGGERED LIST COMPONENT
// ============================================

interface StaggeredListProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  staggerDelay?: number;
}

export function StaggeredList({
  children,
  className = "",
  delay = 0.1,
  staggerDelay = 0.08
}: StaggeredListProps): JSX.Element {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: delay
          }
        }
      }}
    >
      {children}
    </motion.div>
  );
}

// ============================================
// STAGGERED ITEM COMPONENT
// ============================================

interface StaggeredItemProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
}

export function StaggeredItem({
  children,
  className = "",
  ...props
}: StaggeredItemProps): JSX.Element {
  return (
    <motion.div className={className} variants={slideUp} {...props}>
      {children}
    </motion.div>
  );
}

// ============================================
// PRESSABLE BUTTON COMPONENT
// ============================================

interface PressableButtonProps extends HTMLMotionProps<"button"> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

export function PressableButton({
  children,
  className = "",
  variant = "primary",
  size = "md",
  disabled,
  ...props
}: PressableButtonProps): JSX.Element {
  const sizeClasses = {
    sm: "px-3 py-2 text-caption",
    md: "px-6 py-3 text-body",
    lg: "px-8 py-4 text-title"
  };

  const variantClasses = {
    primary: "bg-accent text-white border-transparent hover:bg-accent-hover",
    secondary: "bg-surface-raised text-ink border-edge hover:border-edge-strong",
    ghost: "bg-transparent text-ink border-transparent hover:bg-surface-sunken"
  };

  return (
    <motion.button
      className={`
        inline-flex items-center justify-center font-medium rounded-md
        border transition-colors duration-normal ease-gentle
        focus:outline-none focus-visible:ring-3 focus-visible:ring-accent-glow
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
        ${className}
      `}
      disabled={disabled}
      initial="rest"
      whileHover={disabled ? undefined : "hover"}
      whileTap={disabled ? undefined : "pressed"}
      variants={{
        rest: { scale: 1 },
        hover: {
          scale: 1.02,
          transition: { type: "spring", stiffness: 400, damping: 25 }
        },
        pressed: {
          scale: 0.98,
          transition: { type: "spring", stiffness: 600, damping: 30 }
        }
      }}
      {...props}
    >
      {children}
    </motion.button>
  );
}

// ============================================
// FADE IN VIEW COMPONENT (Intersection Observer)
// ============================================

interface FadeInViewProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  once?: boolean;
}

export function FadeInView({
  children,
  className = "",
  delay = 0,
  direction = "up",
  once = true
}: FadeInViewProps): JSX.Element {
  const directionOffset = {
    up: { y: 24 },
    down: { y: -24 },
    left: { x: 24 },
    right: { x: -24 },
    none: {}
  };

  return (
    <motion.div
      className={className}
      initial={{
        opacity: 0,
        ...directionOffset[direction]
      }}
      whileInView={{
        opacity: 1,
        x: 0,
        y: 0
      }}
      viewport={{ once, margin: "-50px" }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
        delay
      }}
    >
      {children}
    </motion.div>
  );
}

// ============================================
// 3D TILT CARD COMPONENT
// ============================================

interface TiltCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  tiltAmount?: number;
  glareEnabled?: boolean;
}

export function TiltCard({
  children,
  className = "",
  tiltAmount = 10,
  glareEnabled = true,
  ...props
}: TiltCardProps): JSX.Element {
  return (
    <motion.div
      className={`
        relative bg-surface-raised border border-edge rounded-lg
        overflow-hidden transform-gpu
        ${className}
      `}
      style={{ transformStyle: "preserve-3d", perspective: 1000 }}
      whileHover="hover"
      initial="rest"
      variants={{
        rest: {
          rotateX: 0,
          rotateY: 0,
          boxShadow: `
            0 1px 2px hsla(220, 28%, 12%, 0.04),
            0 2px 4px hsla(220, 28%, 12%, 0.03),
            0 4px 8px hsla(220, 28%, 12%, 0.02)
          `
        },
        hover: {
          boxShadow: `
            0 4px 8px hsla(220, 28%, 12%, 0.06),
            0 8px 16px hsla(220, 28%, 12%, 0.05),
            0 16px 32px hsla(220, 28%, 12%, 0.04)
          `
        }
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -tiltAmount;
        const rotateY = ((x - centerX) / centerX) * tiltAmount;
        e.currentTarget.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
      }}
      {...props}
    >
      {children}
      {glareEnabled && (
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background:
              "linear-gradient(105deg, transparent 40%, hsla(0, 0%, 100%, 0.1) 45%, hsla(0, 0%, 100%, 0.2) 50%, hsla(0, 0%, 100%, 0.1) 55%, transparent 60%)"
          }}
        />
      )}
    </motion.div>
  );
}

// ============================================
// PARALLAX SCROLL SECTION
// ============================================

interface ParallaxSectionProps {
  children: ReactNode;
  className?: string;
  speed?: number;
}

export function ParallaxSection({
  children,
  className = "",
  speed = 0.5
}: ParallaxSectionProps): JSX.Element {
  return (
    <motion.section
      className={className}
      initial={{ y: 0 }}
      whileInView={{
        y: 0,
        transition: {
          type: "spring",
          stiffness: 100,
          damping: 30
        }
      }}
      viewport={{ once: false }}
      style={{
        willChange: "transform"
      }}
    >
      {children}
    </motion.section>
  );
}
