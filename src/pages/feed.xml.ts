import type { APIRoute } from "astro";
import { posts, isoDate, summarise } from "../lib/content";
import { site } from "../data/site";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const GET: APIRoute = () => {
  const items = posts.slice(0, 30).map((p) => `
    <item>
      <title>${escape(p.title)}</title>
      <link>${site.domain}${p.path}</link>
      <guid isPermaLink="true">${site.domain}${p.path}</guid>
      <pubDate>${new Date(isoDate(p.date)).toUTCString()}</pubDate>
      <description>${escape(summarise(p, 300))}</description>
    </item>`).join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escape(site.name)}</title>
  <link>${site.domain}/</link>
  <description>${escape(site.description)}</description>
  <language>nl-NL</language>${items}
</channel></rss>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
