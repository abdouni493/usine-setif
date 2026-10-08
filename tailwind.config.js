/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // All colors now reference CSS variables so they adapt to light/dark mode
        cream: 'rgb(var(--c-cream) / <alpha-value>)',
        vanilla: 'rgb(var(--c-vanilla) / <alpha-value>)',
        gold: {
          DEFAULT: 'rgb(var(--c-gold) / <alpha-value>)',
          light: 'rgb(var(--c-gold-light) / <alpha-value>)',
          dark: 'rgb(var(--c-gold-dark) / <alpha-value>)',
        },
        rose: {
          DEFAULT: 'rgb(var(--c-rose) / <alpha-value>)',
          deep: 'rgb(var(--c-rose-deep) / <alpha-value>)',
        },
        lavender: {
          DEFAULT: 'rgb(var(--c-lavender) / <alpha-value>)',
          deep: 'rgb(var(--c-lavender-deep) / <alpha-value>)',
        },
        chocolate: 'rgb(var(--c-chocolate) / <alpha-value>)',
        caramel: 'rgb(var(--c-caramel) / <alpha-value>)',
        pistachio: 'rgb(var(--c-pistachio) / <alpha-value>)',
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          light: 'var(--text-light)',
        },
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-sidebar': 'var(--gradient-sidebar)',
        'gradient-card': 'var(--gradient-card)',
        'gradient-button': 'var(--gradient-button)',
        'gradient-rose': 'var(--gradient-rose)',
        'gradient-lavender': 'var(--gradient-lavender)',
        'gradient-mint': 'var(--gradient-mint)',
        'gradient-glass': 'var(--gradient-glass)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        hover: 'var(--shadow-hover)',
        gold: 'var(--shadow-gold)',
      },
      // Professional, squarer geometry — every rounded-* class in the app follows.
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.875rem',
      },
    },
  },
  plugins: [],
};
