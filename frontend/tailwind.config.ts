import type { Config } from 'tailwindcss';

/**
 * The tokens in globals.css used to be dead code: ~20 CSS variables were
 * declared and `theme.extend` was empty, so nothing could reach them and every
 * component hardcoded a palette class instead. That is how the product ended up
 * with thirteen colour families and two different neutrals.
 *
 * Everything below exists to make `bg-surface`, `text-fg-muted`,
 * `border-border` and friends real, so a component never names a raw colour.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          raised: 'hsl(var(--surface-raised) / <alpha-value>)',
          sunken: 'hsl(var(--surface-sunken) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'hsl(var(--fg) / <alpha-value>)',
          muted: 'hsl(var(--fg-muted) / <alpha-value>)',
          subtle: 'hsl(var(--fg-subtle) / <alpha-value>)',
          onDark: 'hsl(var(--fg-onDark) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          hover: 'hsl(var(--accent-hover) / <alpha-value>)',
          fg: 'hsl(var(--accent-fg) / <alpha-value>)',
          soft: 'hsl(var(--accent-soft) / <alpha-value>)',
          onSoft: 'hsl(var(--accent-onSoft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          soft: 'hsl(var(--success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          soft: 'hsl(var(--warning-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          soft: 'hsl(var(--danger-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          soft: 'hsl(var(--info-soft) / <alpha-value>)',
        },
        ring: 'hsl(var(--ring) / <alpha-value>)',
        /** Sign-in brand panel — fixed dark in both themes, see globals.css. */
        panel: {
          DEFAULT: 'hsl(var(--panel) / <alpha-value>)',
          fg: 'hsl(var(--panel-fg) / <alpha-value>)',
          muted: 'hsl(var(--panel-muted) / <alpha-value>)',
        },
      },

      /**
       * Two radii. The old code used four (`rounded-lg` 317×, `rounded-xl` 229×,
       * `rounded-2xl` 45×, `rounded-md` 6×) with no rule about which meant what.
       * `control` is for anything you click or type into; `surface` is for
       * anything that contains other things.
       */
      borderRadius: {
        control: 'var(--radius-control)',
        surface: 'var(--radius-surface)',
      },

      /**
       * Two shadows. Enterprise UI reads as flat and precise; depth is carried
       * by borders and surface tone, not by drop shadows. `pop` exists only for
       * things that genuinely float above the page — menus, dialogs, toasts.
       */
      boxShadow: {
        rest: '0 1px 2px 0 hsl(215 30% 8% / 0.05)',
        pop: '0 8px 24px -6px hsl(215 30% 8% / 0.16), 0 2px 6px -2px hsl(215 30% 8% / 0.08)',
        none: 'none',
      },

      /**
       * Six steps, and no arbitrary values. The old code contained
       * `text-[10px]` and `text-[11px]` typed by hand in individual components.
       */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        caption: ['0.75rem', { lineHeight: '1.125rem' }],
        body: ['0.875rem', { lineHeight: '1.375rem' }],
        lead: ['1rem', { lineHeight: '1.5rem' }],
        title: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
      },

      fontFamily: {
        /** IBM Plex Sans — drawn for enterprise software, and not Inter. */
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        /** Data, codes, identifiers, money. Real tabular figures. */
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      /** Row heights for dense tables — an ERP is read, not browsed. */
      spacing: {
        row: '2.25rem',
        'row-lg': '2.75rem',
      },

      transitionDuration: {
        instant: '80ms',
        quick: '140ms',
        base: '220ms',
      },

      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 220ms cubic-bezier(0.2, 0.6, 0.3, 1) both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
