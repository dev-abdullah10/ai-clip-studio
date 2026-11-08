/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#111116",
          925: "#181820",
          900: "#15151C",
          850: "#1B1B24",
          800: "#22222C",
          750: "#262631",
          700: "#2E2E3A",
          600: "#3A3A48",
        },
        accent: {
          50: "#F4F0FF",
          100: "#E9E2FF",
          200: "#D6CCFF",
          300: "#B9A7FF",
          400: "#9B7AFF",
          500: "#8965F5",
          600: "#7350DD",
          700: "#5C3EB8",
        },
        gold: {
          300: "#FCD34D",
          400: "#F59E0B",
          500: "#D97706",
        },
        mint: {
          400: "#4ADE80",
          500: "#22C55E",
        },
        rose: {
          400: "#F87171",
          500: "#EF4444",
        },
        slate: {
          100: "#F2F0F7",
          200: "#E4E1EC",
          300: "#CFCBDB",
          400: "#A6A3B1",
          500: "#8A8796",
          600: "#777584",
          700: "#5A5866",
          800: "#3E3D49",
          900: "#2A2933",
          950: "#1B1B24",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI Variable Display",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["Cascadia Code", "Consolas", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 10px 30px -18px rgba(137, 101, 245, 0.55)",
        card: "0 1px 2px rgba(0, 0, 0, 0.18)",
        raised: "0 18px 45px -26px rgba(0, 0, 0, 0.85)",
      },
      borderRadius: {
        "2.5xl": "1.25rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.24s ease-out both",
        "slide-in": "slide-in 0.24s ease-out both",
        shimmer: "shimmer 1.8s infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
