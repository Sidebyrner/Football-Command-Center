/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0f1e',
        surface: '#111827',
        'surface-2': '#1e293b',
        accent: '#f59e0b',
        'accent-hover': '#d97706',
        start: '#10b981',
        caution: '#f59e0b',
        sit: '#f43f5e',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Sora', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 16px rgba(10, 15, 30, 0.6)',
      },
    },
  },
  plugins: [],
}
