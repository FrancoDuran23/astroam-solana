/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark space theme (names kept from the light Stellar-era theme).
        bglight: '#070814',
        cardbg: 'rgba(18, 19, 44, 0.72)',
        warmneutral: '#0C0D22',
        cardborder: '#272A55',
        textprimary: '#F3F1FF',
        textsecondary: '#A6A3C9',
        primaryviolet: {
          DEFAULT: '#6A45FF',
          hover: '#5B36F0',
          light: 'rgba(123, 92, 255, 0.16)',
          dim: 'rgba(123, 92, 255, 0.10)',
        },
        starlight: '#FDDA24',
        tealbrand: '#2FD0DD',
        cyanlight: 'rgba(47, 208, 221, 0.14)',
        online: '#3DDC97',
        alerta: '#FF6B7A',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      keyframes: {
        floatShip: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-12px) rotate(1.5deg)' },
        },
        slowDriftA: {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)' },
          '50%': { transform: 'translate(-10px, 12px) rotate(16deg)' },
        },
        slowDriftB: {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)' },
          '50%': { transform: 'translate(10px, -10px) rotate(-14deg)' },
        },
        pulseBeam: {
          '0%': { strokeDashoffset: '400' },
          '100%': { strokeDashoffset: '0' },
        },
        portalSpin: {
          '0%': { transform: 'rotate(0deg) scale(1)' },
          '50%': { transform: 'rotate(180deg) scale(1.04)' },
          '100%': { transform: 'rotate(360deg) scale(1)' },
        },
      },
      animation: {
        'float-ship': 'floatShip 5s ease-in-out infinite',
        'drift-a': 'slowDriftA 16s ease-in-out infinite',
        'drift-b': 'slowDriftB 20s ease-in-out infinite',
        portal: 'portalSpin 24s linear infinite',
        'portal-teal': 'spin 35s linear infinite',
      },
    },
  },
  plugins: [],
}
