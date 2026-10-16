import { defineConfig } from "vite";

const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";
export default defineConfig({
  server: {
    headers: {
      "Content-Security-Policy": csp.replace(
        "connect-src 'self';",
        "connect-src 'self' ws:;",
      ),
    },
  },
  preview: { headers: { "Content-Security-Policy": csp } },
  build: { target: "es2022" },
});
