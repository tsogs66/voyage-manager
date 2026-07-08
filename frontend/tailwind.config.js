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
          50: '#f0f4ff',
          100: '#dce6ff',
          200: '#b4c8ff',
          300: '#7ca2ff',
          400: '#3d72ff',
          500: '#0d4aff',
          600: '#0029ff',
          700: '#0021db',
          800: '#001db0',
          900: '#001a8a',
          950: '#00104d',
        },
      },
    },
  },
  plugins: [],
}
