/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1a1a2e',
          card: '#16213e',
          border: '#0f3460',
        },
      },
    },
  },
  plugins: [],
}
