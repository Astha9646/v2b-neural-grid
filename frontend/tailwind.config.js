/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Orbitron", "Inter", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "grid-dark": "linear-gradient(160deg, #050810 0%, #0a1628 45%, #061018 100%)",
        "mesh-gradient":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(34, 211, 238, 0.15), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(16, 185, 129, 0.08), transparent)",
        "grid-pattern":
          "linear-gradient(rgba(34, 211, 238, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, 0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "48px 48px",
      },
      boxShadow: {
        "neon-cyan": "0 0 24px rgba(34, 211, 238, 0.35), 0 0 48px rgba(34, 211, 238, 0.1)",
        "neon-input": "0 0 0 1px rgba(34, 211, 238, 0.2), 0 0 20px rgba(34, 211, 238, 0.15)",
        "neon-error": "0 0 0 1px rgba(244, 63, 94, 0.3), 0 0 16px rgba(244, 63, 94, 0.12)",
        "neon-button":
          "0 0 28px rgba(34, 211, 238, 0.45), 0 0 56px rgba(16, 185, 129, 0.2)",
      },
      animation: {
        "fade-in-up": "fadeInUp 0.7s ease-out forwards",
        "grid-drift": "gridDrift 24s linear infinite",
        "orb-pulse": "orbPulse 8s ease-in-out infinite",
        shake: "shake 0.45s ease-in-out",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        gridDrift: {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "48px 48px" },
        },
        orbPulse: {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.08)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-4px)" },
          "40%, 80%": { transform: "translateX(4px)" },
        },
      },
    },
  },
  plugins: [],
};
