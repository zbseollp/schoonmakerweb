import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Posts live in src/data/content.json — not markdown.
 * Jenkins tenant-cli still may create an empty src/content/blog/ folder.
 * Declaring the collection here stops Astro's deprecated auto-generated
 * collections warning without affecting the JSON-driven site.
 */
const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({}).passthrough(),
});

export const collections = { blog };
