import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      // Custom Colors — No default Tailwind colors
      colors: {
        // Backgrounds — warm paper tones
        surface: {
          DEFAULT: "hsl(42, 24%, 96%)",
          raised: "hsl(40, 20%, 98%)",
          sunken: "hsl(38, 18%, 93%)",
          overlay: "hsla(42, 24%, 96%, 0.8)"
        },

        // Ink — deep, academic
        ink: {
          DEFAULT: "hsl(220, 28%, 12%)",
          muted: "hsl(220, 16%, 40%)",
          subtle: "hsl(220, 12%, 58%)",
          ghost: "hsl(220, 8%, 78%)"
        },

        // Accent — scholarly blue with depth
        accent: {
          DEFAULT: "hsl(222, 68%, 48%)",
          hover: "hsl(222, 72%, 42%)",
          pressed: "hsl(222, 76%, 36%)",
          soft: "hsl(222, 60%, 94%)",
          glow: "hsla(222, 68%, 48%, 0.15)"
        },

        // Success — muted sage green
        success: {
          DEFAULT: "hsl(158, 48%, 38%)",
          soft: "hsl(158, 40%, 93%)"
        },

        // Warning — warm amber
        caution: {
          DEFAULT: "hsl(38, 85%, 52%)",
          soft: "hsl(38, 70%, 94%)"
        },

        // Error — refined crimson
        error: {
          DEFAULT: "hsl(0, 58%, 48%)",
          soft: "hsl(0, 50%, 95%)"
        },

        // Borders — warm neutrals
        edge: {
          DEFAULT: "hsl(32, 12%, 84%)",
          strong: "hsl(32, 14%, 72%)",
          subtle: "hsl(32, 8%, 90%)"
        }
      },

      // Font families
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "monospace"]
      },

      // Fluid typography
      fontSize: {
        display: ["clamp(2.5rem, 5vw + 1rem, 4rem)", { lineHeight: "1.1", fontWeight: "700" }],
        headline: ["clamp(1.75rem, 3vw + 0.5rem, 2.5rem)", { lineHeight: "1.2", fontWeight: "600" }],
        title: ["clamp(1.25rem, 2vw + 0.25rem, 1.5rem)", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["clamp(0.9375rem, 1vw + 0.125rem, 1rem)", { lineHeight: "1.6" }],
        caption: ["clamp(0.75rem, 0.5vw + 0.5rem, 0.8125rem)", { lineHeight: "1.4" }],
        math: ["1.0625rem", { lineHeight: "1.5" }]
      },

      // 4px base spacing scale
      spacing: {
        "0.5": "2px",
        "1": "4px",
        "1.5": "6px",
        "2": "8px",
        "2.5": "10px",
        "3": "12px",
        "4": "16px",
        "5": "20px",
        "6": "24px",
        "7": "28px",
        "8": "32px",
        "9": "36px",
        "10": "40px",
        "11": "44px",
        "12": "48px",
        "14": "56px",
        "16": "64px",
        "20": "80px",
        "24": "96px",
        "28": "112px",
        "32": "128px"
      },

      // Layered shadow system
      boxShadow: {
        soft: `
          0 1px 2px hsla(220, 28%, 12%, 0.04),
          0 2px 4px hsla(220, 28%, 12%, 0.03),
          0 4px 8px hsla(220, 28%, 12%, 0.02)
        `,
        lifted: `
          0 2px 4px hsla(220, 28%, 12%, 0.05),
          0 4px 8px hsla(220, 28%, 12%, 0.04),
          0 8px 16px hsla(220, 28%, 12%, 0.03),
          0 16px 32px hsla(220, 28%, 12%, 0.02)
        `,
        pressed: `
          0 0.5px 1px hsla(220, 28%, 12%, 0.06),
          0 1px 2px hsla(220, 28%, 12%, 0.04)
        `,
        modal: `
          0 4px 8px hsla(220, 28%, 12%, 0.08),
          0 8px 16px hsla(220, 28%, 12%, 0.06),
          0 16px 32px hsla(220, 28%, 12%, 0.04),
          0 32px 64px hsla(220, 28%, 12%, 0.03)
        `,
        "glow-accent": "0 0 0 3px hsla(222, 68%, 48%, 0.15)",
        card: `
          0 1px 3px hsla(220, 28%, 12%, 0.03),
          0 4px 12px hsla(220, 28%, 12%, 0.04)
        `,
        "card-hover": `
          0 4px 12px hsla(220, 28%, 12%, 0.06),
          0 12px 32px hsla(220, 28%, 12%, 0.08)
        `
      },

      // Border radius scale
      borderRadius: {
        none: "0",
        sm: "4px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
        full: "9999px"
      },

      // Custom easing curves
      transitionTimingFunction: {
        spring: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        "smooth-out": "cubic-bezier(0.22, 1, 0.36, 1)",
        snap: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
        gentle: "cubic-bezier(0.4, 0, 0.2, 1)",
        bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)"
      },

      // Duration scale
      transitionDuration: {
        fast: "100ms",
        normal: "200ms",
        smooth: "300ms",
        gentle: "500ms",
        slow: "700ms"
      },

      // Backdrop blur
      backdropBlur: {
        xs: "2px",
        sm: "4px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px"
      },

      // Container
      maxWidth: {
        content: "720px",
        container: "1280px"
      },

      // Animations
      keyframes: {
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(24px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" }
        }
      },
      animation: {
        "slide-up": "slide-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "scale-in": "scale-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        pulse: "pulse 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        float: "float 3s ease-in-out infinite"
      }
    }
  },
  plugins: [require("@tailwindcss/typography")]
};

export default config;
