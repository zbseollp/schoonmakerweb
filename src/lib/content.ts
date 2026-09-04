import raw from "../data/content.json";
import spamRaw from "../data/spam-slugs.json";
import { authors } from "../data/site";

export type Term = { slug: string; name: string };

export type Entry = {
  slug: string;
  path: string;
  kind: "post" | "page" | "magic";
  title: string;
  date: string;
  modified: string;
  content: string;
  excerpt: string;
  categories: Term[];
  tags: Term[];
  featuredImage: string;
  seoTitle: string;
  seoDescription: string;
  canonical: string;
  ogImage: string;
  author?: number;
};

const data = raw as {
  posts: Entry[]; pages: Entry[]; magic: Entry[]; categories: Term[]; tags: Term[];
};

/** CMS dates can be a few hours ahead of build time — keep ~48h slack. */
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;

const spamList = Array.isArray(spamRaw)
  ? spamRaw
  : ((spamRaw as { slugs?: string[] }).slugs ?? []);
const spamSlugs = new Set(spamList.map(String));

function isLivePost(p: Entry): boolean {
  if (!p?.slug || spamSlugs.has(p.slug)) return false;
  if (!p.date) return true;
  const t = Date.parse(p.date);
  if (Number.isNaN(t)) return true;
  return t <= Date.now() + FUTURE_SLACK_MS;
}

export const posts: Entry[] = [...data.posts]
  .filter(isLivePost)
  .sort((a, b) => b.date.localeCompare(a.date));
export const magic: Entry[] = data.magic;
export const categories: Term[] = data.categories;

/** De voorpagina, /blog/ en /sitemap/ hebben een eigen sjabloon. */
const OWN_TEMPLATE = new Set(["/", "/blog/", "/sitemap/"]);
export const pages: Entry[] = data.pages.filter((p) => !OWN_TEMPLATE.has(p.path));
export const pageByPath = (path: string) => data.pages.find((p) => p.path === path);

/** Alles wat op /{slug}/ staat: berichten, magic pages en de losse pagina's. */
export const detailEntries: Entry[] = [...posts, ...magic, ...pages];

export const postsInCategory = (slug: string) =>
  posts.filter((p) => p.categories.some((c) => c.slug === slug));

export const authorList = Object.entries(authors).map(([id, a]) => ({ id: Number(id), ...a }));

export const postsByAuthor = (id: number) => posts.filter((p) => p.author === id);

export const authorFor = (entry: Entry) =>
  entry.author != null ? authors[entry.author] : undefined;

const MONTHS = ["januari","februari","maart","april","mei","juni",
                "juli","augustus","september","oktober","november","december"];

export function formatDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function isoDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function summarise(entry: Entry, max = 160): string {
  if (entry.seoDescription && entry.seoDescription.length <= max) return entry.seoDescription;
  const text = (entry.seoDescription || entry.excerpt || entry.content)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : text.slice(0, text.lastIndexOf(" ", max)) + "…";
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length ? out : [[]];
}
