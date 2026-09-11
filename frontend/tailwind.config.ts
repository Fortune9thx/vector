import type { Config } from "tailwindcss";

// Tailwind v4 is CSS-first -- the real theme tokens (colors, fonts) live in
// styles/globals.css under @theme inline. This file exists only for tools
// that still look for a config file and for explicit content-path scoping.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};

export default config;
