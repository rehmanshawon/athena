import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101418",
        paper: "#f7f5ef",
        mint: "#0f766e",
        amber: "#b45309"
      }
    }
  },
  plugins: []
} satisfies Config;
