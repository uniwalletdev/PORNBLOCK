/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f3f0ff",
          100: "#ede8ff",
          300: "#c4b5fd",
          500: "#8b5cf6",
          700: "#6c2bd9",
          900: "#4c1d95",
        },
      },
    },
  },
  plugins: [],
};
