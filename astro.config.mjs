import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://schoonmakerweb.nl",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    sitemap({ filter: (page) => !/\/page\/\d+\//.test(page) }),
  ],
});
