import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx,mdx}", "./index.html"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          // Editorial alpha derivatives (used by .tiers .featured, .decision,
          // .cmp .us, Pill `primary` variant, etc.). 0.08 ≈ primary-soft;
          // 0.35 ≈ primary-border per v2 design tokens.
          soft: "hsl(var(--primary) / 0.08)",
          border: "hsl(var(--primary) / 0.35)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // v2 semantic + editorial tokens (paired with --success/--warning/
        // --danger/--ink-sub/--rule-soft defined in src/index.css). Mapped here
        // so they're usable as Tailwind classes (`text-success-strong`,
        // `bg-warning-soft`, etc.) rather than arbitrary values everywhere.
        success: {
          DEFAULT: "hsl(var(--success))",
          strong: "hsl(var(--success-strong))",
          soft: "hsl(var(--success) / 0.08)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          strong: "hsl(var(--warning-strong))",
          soft: "hsl(var(--warning) / 0.10)",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          soft: "hsl(var(--danger) / 0.06)",
        },
        "ink-sub": "hsl(var(--ink-sub))",
        "rule-soft": "hsl(var(--rule-soft))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      borderRadius: {
        // `lg` scales with --radius (1rem = 16px) for cards/panels.
        // `md` and `sm` are PINNED so future shadcn primitives (Checkbox,
        // Button, Input) render with their expected small-radius baseline.
        // Without this, `rounded-sm` on a 20px checkbox resolved to 12px in
        // v1 and looked like a radio button — see v1 CLAUDE.md "Design
        // gotchas" for the war story we don't want to repeat.
        lg: "var(--radius)",
        md: "6px",
        sm: "4px",
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "scale-in": "scale-in 0.3s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
} satisfies Config;
