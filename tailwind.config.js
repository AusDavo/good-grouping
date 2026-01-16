/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom dark theme colors
        dark: {
          bg: '#0f172a',
          surface: '#1e293b',
          border: '#334155',
        },
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(59, 130, 246, 0.3)',
        'glow-emerald': '0 0 15px rgba(16, 185, 129, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
