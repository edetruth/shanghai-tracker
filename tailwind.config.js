/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0c1220',
          800: '#0f1929',
          700: '#131d30',
          600: '#1a2640',
          500: '#243351',
        },
        gold: {
          400: '#e2b858',
          300: '#eeca7a',
          200: '#f5dfa0',
        },
        slate: {
          muted: '#5e7190',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        heading: ['"Fredoka"', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
        sans: ['"Nunito"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
