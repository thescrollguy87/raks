// Tailwind is set up per the spec ("Tailwind CSS only where needed"), but
// the prototype already ships a complete, self-contained CSS system
// (src/styles/rosterpro.css — variables, components, layout, dark theme)
// that's reused pixel-for-pixel. Tailwind's utility classes are only for
// small layout adjustments inside new React-only pieces (e.g. the report
// download panel) where writing bespoke CSS would be overkill — not for
// re-styling anything that already exists in the prototype.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: "#0D1B2A",
        "navy-mid": "#1A2E42",
        "navy-lite": "#243D54",
        cyan: "#00C6FF",
        amber: "#F5A623",
        rp-red: "#E53935",
        "rp-green": "#00C853",
      },
    },
  },
  // Prevents Tailwind's own reset from fighting the prototype's hand-tuned
  // base styles (button/input/table resets already in rosterpro.css).
  corePlugins: { preflight: false },
  plugins: [],
};
