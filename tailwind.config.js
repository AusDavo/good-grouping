/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 1980s English Pub Theme Colors
        pub: {
          // Primary - Deep wood and pub tones
          green: {
            900: '#1a2e1a',
            800: '#1f3d1f',
            700: '#2d5a2d',
            600: '#3d7a3d',
          },
          brown: {
            900: '#1a1410',
            800: '#2d241c',
            700: '#4a3c2e',
            600: '#6b5344',
            500: '#8b6f56',
          },
          red: {
            700: '#7f1d1d',
            600: '#991b1b',
            500: '#b91c1c',
          },
          // Chalkboard
          chalk: {
            board: '#1a2e1a',
            text: '#d4d4c8',
            accent: '#a3a396',
          },
          // Warm wood tones
          wood: {
            dark: '#2d1810',
            medium: '#5c3d2e',
            light: '#8b6f56',
            grain: '#3d2817',
          },
        },
        // Neon accents - 80s flair
        neon: {
          blue: '#00d4ff',
          pink: '#ff2d95',
          yellow: '#ffed4a',
          green: '#39ff14',
          orange: '#ff6b35',
        },
        // Aged paper/cream
        aged: {
          white: '#f5f5dc',
          cream: '#faf3e0',
          paper: '#e8dcc8',
        },
      },
      fontFamily: {
        // Pub-style fonts
        'pub-heading': ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        'pub-display': ['"Press Start 2P"', 'monospace'],
        'pub-body': ['system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // Neon glow effects
        'neon-blue': '0 0 10px #00d4ff, 0 0 20px #00d4ff, 0 0 30px #00d4ff',
        'neon-pink': '0 0 10px #ff2d95, 0 0 20px #ff2d95, 0 0 30px #ff2d95',
        'neon-yellow': '0 0 10px #ffed4a, 0 0 20px #ffed4a',
        'neon-green': '0 0 10px #39ff14, 0 0 20px #39ff14',
        'neon-blue-sm': '0 0 5px #00d4ff, 0 0 10px #00d4ff',
        'neon-pink-sm': '0 0 5px #ff2d95, 0 0 10px #ff2d95',
        // Pub lighting
        'brass': '0 0 15px rgba(218, 165, 32, 0.3)',
        'warm': '0 4px 20px rgba(139, 111, 86, 0.4)',
        // Card shadows
        'wood-inset': 'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
        'chalk': '0 4px 6px rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        // Wood grain texture (CSS gradient simulation)
        'wood-grain': 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
        'chalkboard': 'linear-gradient(180deg, #1a2e1a 0%, #1f3d1f 50%, #1a2e1a 100%)',
        // Pub atmosphere gradients
        'pub-header': 'linear-gradient(135deg, #2d1810 0%, #4a3c2e 50%, #2d1810 100%)',
        'brass-shine': 'linear-gradient(135deg, #d4a574 0%, #c9a227 50%, #d4a574 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'neon-flicker': 'neon-flicker 2s ease-in-out infinite',
        'chalk-write': 'chalk-write 0.3s ease-out',
        'dart-hit': 'dart-hit 0.2s ease-out',
      },
      keyframes: {
        'neon-flicker': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
          '52%': { opacity: '1' },
          '54%': { opacity: '0.9' },
        },
        'chalk-write': {
          '0%': { opacity: '0', transform: 'translateY(-5px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'dart-hit': {
          '0%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      borderRadius: {
        'polaroid': '2px',
      },
    },
  },
  plugins: [],
};
