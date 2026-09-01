/**
 * The ledger palette.
 *
 * Moss and forest greens on a parchment ground, with a rust accent. The
 * intent is a paper accounts ledger rather than a generic admin template:
 * ruled rows, tabular numerals, restrained colour used to mean something
 * (score band, stage) rather than to decorate.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#FBFAF6',
          100: '#F5F2E9',
          200: '#EAE5D6',
          300: '#DCD5C0',
        },
        ink: {
          DEFAULT: '#1B2019',
          soft: '#3D453A',
          faint: '#6B7266',
        },
        moss: {
          100: '#E4EADE',
          200: '#C7D3BC',
          300: '#A3B594',
          400: '#7F956D',
          500: '#63784F',
          600: '#4C5F3C',
          700: '#3A4A2E',
          800: '#2A3722',
          900: '#1D2718',
        },
        rust: {
          100: '#F3E2D8',
          300: '#D3A184',
          500: '#A65D3A',
          700: '#7A4028',
        },
        ochre: {
          100: '#F6EBCF',
          300: '#DFC178',
          500: '#B08C2E',
          700: '#7C6220',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        ledger: '0 1px 0 0 rgba(27,32,25,0.06), 0 1px 3px 0 rgba(27,32,25,0.05)',
        raised: '0 2px 8px -2px rgba(27,32,25,0.14)',
      },
    },
  },
  plugins: [],
};
