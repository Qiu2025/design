import type { Config } from "tailwindcss";

const config: Config = {
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        panel: "hsl(var(--panel) / <alpha-value>)",
        brand: "hsl(var(--brand) / <alpha-value>)",
        purple: "hsl(var(--purple) / <alpha-value>)",
        blue: "hsl(var(--blue) / <alpha-value>)",
        gray: {
          1: "hsl(var(--gray-1) / <alpha-value>)",
          2: "hsl(var(--gray-2) / <alpha-value>)",
          3: "hsl(var(--gray-3) / <alpha-value>)",
          4: "hsl(var(--gray-4) / <alpha-value>)",
          5: "hsl(var(--gray-5) / <alpha-value>)",
          6: "hsl(var(--gray-6) / <alpha-value>)",
          7: "hsl(var(--gray-7) / <alpha-value>)",
          8: "hsl(var(--gray-8) / <alpha-value>)",
          9: "hsl(var(--gray-9) / <alpha-value>)",
          10: "hsl(var(--gray-10) / <alpha-value>)",
          11: "hsl(var(--gray-11) / <alpha-value>)",
          12: "hsl(var(--gray-12) / <alpha-value>)",
          a1: "var(--gray-a1)",
          a2: "var(--gray-a2)",
          a3: "var(--gray-a3)",
          a4: "var(--gray-a4)",
          a5: "var(--gray-a5)",
          a6: "var(--gray-a6)",
          a7: "var(--gray-a7)",
          a8: "var(--gray-a8)",
          a9: "var(--gray-a9)",
          a10: "var(--gray-a10)",
          a11: "var(--gray-a11)",
          a12: "var(--gray-a12)",
        },
      },
      spacing: {
        "scrollbar-offset": "calc(16px + var(--removed-body-scroll-bar-size, 0px))",
      },
      borderRadius: {
        inherit: "inherit",
      },
      keyframes: {
        slideDownAndFade: {
          from: { opacity: "0", transform: "translateY(-2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideLeftAndFade: {
          from: { opacity: "0", transform: "translateX(2px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        slideUpAndFade: {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideRightAndFade: {
          from: { opacity: "0", transform: "translateX(-2px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        slideDownAndFade: "slideDownAndFade 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        slideLeftAndFade: "slideLeftAndFade 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        slideUpAndFade: "slideUpAndFade 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        slideRightAndFade: "slideRightAndFade 250ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji",
          "Segoe UI Symbol",
          "Noto Color Emoji",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
