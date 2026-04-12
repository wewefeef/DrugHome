/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#e8eef7',
          100: '#c5d5ec',
          200: '#9fb9df',
          300: '#789cd2',
          400: '#5a88c9',
          500: '#3b74bf',
          600: '#2c5fa8',
          700: '#1e4a8c',
          800: '#133670',
          900: '#0a2454',
          950: '#061540',
        },
        navy: '#0a2454',
        'navy-dark': '#061540',
        'navy-light': '#133670',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 2px 12px rgba(10, 36, 84, 0.10)',
        'card-hover': '0 8px 24px rgba(10, 36, 84, 0.18)',
      },
    },
  },
  plugins: [],
}


