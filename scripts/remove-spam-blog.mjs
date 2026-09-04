#!/usr/bin/env node
/**
 * Detect SEO spam / malware-injected posts in content.json.
 * Never deletes posts — writes src/data/spam-slugs.json so the loader hides them.
 * Strips casino/affiliate malware from bodies of posts that stay live.
 *
 *   node scripts/remove-spam-blog.mjs
 *   node scripts/remove-spam-blog.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = 'src/data/content.json';
const OUT = 'src/data/spam-slugs.json';
const dryRun = process.argv.includes('--dry-run');

/** Known malware / casino-affiliate hosts injected into WordPress. */
const MALWARE_HOST = String.raw`(?:playsense\.nl|apparata\.net|gameshub\.com|1337games\.org|casino-vice\.com|getlucky\.nl|pintravel\.pl|ospkurow|thegameroom\.org|snellevoigers\.nl|casinovergelijker\.net|bestebuitenlandsecasinos?(?:\.org|\.com)|casinozonder(?:vergunning\.net|licentie\.io|limiet\.co)|casinojager\.com|nieuwcasinonederland\.com|bestecryptogokkensites\.com|cryptogokkensites\.com|bestegoksites\.(?:net|org)|hashlucky)`;

const HARD_BODY = [
  new RegExp(MALWARE_HOST, 'i'),
  /\bzonder[\s-]?cruks\b/i,
  /\bonline[\s-]?casino\b/i,
  /\bcruks\s+omzeilen\b/i,
  /\bhashlucky\b/i,
  /\bcasino\s+zonder\s+(?:licentie|vergunning|limiet|cruks)\b/i,
  /\bbuitenlandse\s+casino/i,
  /\bcryptogok/i,
  /\bbestegoksites\b/i,
];

const HARD_TITLE = [
  /\bonline[\s-]?casino/i,
  /\bjackpot\b/i,
  /\bzonder[\s-]?cruks\b/i,
  /\bpoker\b/i,
  /\bgokken\b/i,
  /\bkansspelen\b/i,
  /\bdigitaal[\s-]?vermaak/i,
  /\bgaming[\s-]?setup/i,
  /\bgaming[\s-]?vibes/i,
];

/** Cloaked “schoon + casino/gaming” SEO. */
const CLOAKED = [
  /\bgaming\b/i,
  /\bentertainment(?:ruimte|zone)?\b/i,
  /\bspelavond/i,
  /\bonline[\s-]?plezier/i,
  /\bdigitaal[\s-]?vermaak/i,
  /\bcasino/i,
  /\bjackpot/i,
  /\bgok/i,
  /\bcruks/i,
  /\bnear[\s-]?miss/i,
  /\bwinnen[\s-]?met[\s-]?schoon/i,
  /\bspanning[\s-]?thuis/i,
  /\bvoor[\s-]?spel\b/i,
];

const OFF_TOPIC_TITLE = [
  /\bvriendin\b/i,
  /\bvriend van\b/i,
  /\bgetrouwd\b/i,
  /\bzwanger\b/i,
  /\b(?:vermogen|lengte|leeftijd|afkomst)\b/i,
  /\bpartner\b/i,
  /\bdochter\b/i,
  /\bzoon\b/i,
  /\bkinderen\b/i,
  /\bvader\b/i,
  /\binfluencer\b/i,
  /\bentertainmentzone\b/i,
  /\bnacht ontvlammen\b/i,
  /\blokale tovenaars\b/i,
  /\bfamilie[\s-]/i,
  /\byoutube[\s-]?familie/i,
];

const KEEP_IF_CLEANING = [
  /\bschoonmaak/i,
  /\bschoonmaker/i,
  /\bstofzuig/i,
  /\bdweil/i,
  /\bvloer/i,
  /\bbadkamer/i,
  /\bkeuken/i,
  /\btoilet/i,
  /\bhygi[eë]n/i,
  /\breinig/i,
  /\bpoets/i,
  /\bwerkschoen/i,
  /\bdesinfect/i,
  /\bkalk/i,
  /\bwasmiddel/i,
  /\bmicrovezel/i,
  /\bhuisdieren.?en.?kinderen/i,
  /\bvoor.?huisdieren/i,
  /\bhoreca/i,
  /\bhuishoud/i,
  /\bschoon.?huis/i,
  /\bschoon.?houden/i,
  /\bschoonmaaktips/i,
  /\bschoonmaakroutine/i,
  /\bschoonmaakrituel/i,
  /\bextra.?schoon/i,
  /\bwoning/i,
  /\bwoonruimte/i,
  /\bkastruimte/i,
  /\bbetrouwbare.?partner.?voor.?huis/i,
];

function isCleaning(hay) {
  return KEEP_IF_CLEANING.some((re) => re.test(hay));
}

function isCloaked(hay) {
  return CLOAKED.some((re) => re.test(hay));
}

function malwareHitCount(html) {
  if (!html) return 0;
  const re = new RegExp(MALWARE_HOST, 'gi');
  return (html.match(re) || []).length;
}

function reasonFor(post) {
  const titleHay = `${post.slug} ${post.title} ${post.seoTitle || ''}`;
  const body = String(post.content || '');

  for (const re of HARD_TITLE) {
    if (re.test(titleHay)) return `hard-title:${re}`;
  }

  // Cloaked “schoon + gaming/casino” titles — hide on title alone
  if (isCloaked(titleHay) && !/\bbetrouwbare.?partner.?voor.?huis/i.test(titleHay)) {
    // Allow real cleaning titles that only mention "casino" as a venue type
    const venueOnly =
      isCleaning(titleHay) &&
      !/\bgaming|entertainment|spelavond|digitaal.?vermaak|jackpot|cruks|voor-spel|winnen-met-schoon|spanning-thuis/i.test(
        titleHay,
      );
    if (!venueOnly) return 'hard-cloaked:title';
  }

  // Heavy affiliate injection → hide even if title looks cleaning-ish
  if (malwareHitCount(body) >= 2 || /\bhashlucky\b/i.test(body)) {
    return 'hard-body:affiliate-injection';
  }

  for (const re of HARD_BODY) {
    if (re.test(body) || re.test(titleHay)) {
      // Real cleaning article with light injection → sanitize, keep
      if (isCleaning(titleHay) && !isCloaked(titleHay)) return null;
      return `hard-body:${re}`;
    }
  }

  if (isCleaning(titleHay)) return null;
  for (const re of OFF_TOPIC_TITLE) {
    if (re.test(titleHay)) return `off-topic:${re}`;
  }
  return null;
}

/**
 * Strip malware scripts, casino affiliate anchors, and poisoned paragraphs.
 */
function sanitizeContent(html) {
  if (!html) return { html, changed: false };
  let out = html;
  const before = out;

  // Drop third-party scripts (instagram embeds etc. — not needed for static posts)
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  // Drop anchors to malware / casino-affiliate hosts
  out = out.replace(
    new RegExp(`<a\\b[^>]*href=["'][^"']*(?:${MALWARE_HOST}|casino|goksites|cryptogok)[^"']*["'][^>]*>[\\s\\S]*?<\\/a>`, 'gi'),
    '',
  );

  // Drop paragraphs that push casino / CRUKS / HashLucky spam
  out = out.replace(
    /<p\b[^>]*>[\s\S]*?(?:playsense|apparata|gameshub|1337games|casino-vice|zonder[\s-]?cruks|online[\s-]?casino|cruks\s+omzeilen|hashlucky|casino\s+zonder|buitenlandse\s+casino|cryptogok|goksites|crypto\s+goksites|bestegoksites|casinojager|nieuwcasino|casinovergelijk|als\s+gokker)[\s\S]*?<\/p>/gi,
    '',
  );

  // Drop headings that are pure casino SEO glue
  out = out.replace(
    /<h[1-6]\b[^>]*>[\s\S]*?(?:goksites|online\s+casino|zonder\s+cruks|hashlucky)[\s\S]*?<\/h[1-6]>/gi,
    '',
  );

  // Drop spans/links leftover marketing phrases
  out = out.replace(/<span\b[^>]*>[\s\S]*?(?:Nederlandse\s+)?goksites[\s\S]*?<\/span>/gi, '');
  out = out.replace(/crypto\s+goksites/gi, '');
  out = out.replace(/Nederlandse\s+goksites/gi, '');

  // Bare leftover URLs
  out = out.replace(new RegExp(`https?:\\/\\/(?:www\\.)?${MALWARE_HOST}[^\\s<"']*`, 'gi'), '');

  out = out.replace(/\n{3,}/g, '\n\n');
  return { html: out, changed: out !== before };
}

/** Malware image assets that should not ship with the Worker. */
const MALWARE_ASSETS = [
  'public/wp-content/uploads/2025/09/Gameshub1.jpg',
  'public/wp-content/uploads/2025/09/Gameshub1-300x200.jpg',
  'public/wp-content/uploads/2025/11/poker-4518181_1280.jpg',
  'public/wp-content/uploads/2025/11/poker-4518181_1280-1024x769.jpg',
  'public/wp-content/uploads/2025/11/poker-4518181_1280-768x577.jpg',
  'public/wp-content/uploads/2025/11/poker-4518181_1280-300x225.jpg',
];

if (!existsSync(CONTENT)) {
  console.error(`[remove-spam] missing ${CONTENT}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const posts = Array.isArray(data.posts) ? data.posts : [];
const hits = [];
let sanitized = 0;

/** Sticky: never auto-unhide a slug that was previously flagged. */
const previous = new Set();
if (existsSync(OUT)) {
  try {
    const raw = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const s of Array.isArray(raw) ? raw : raw.slugs || []) previous.add(String(s));
  } catch {
    /* ignore */
  }
}

for (const p of posts) {
  if (!p?.slug) continue;
  let reason = reasonFor(p);
  if (!reason && previous.has(p.slug)) reason = 'sticky:previous-spam';
  if (reason) {
    hits.push({ slug: p.slug, reason, title: p.title });
    // Still scrub malware from stored HTML so a future un-hide is safe
    const { html, changed } = sanitizeContent(p.content);
    if (changed) {
      p.content = html;
      sanitized += 1;
    }
    continue;
  }
  const { html, changed } = sanitizeContent(p.content);
  if (changed) {
    p.content = html;
    sanitized += 1;
  }
}

hits.sort((a, b) => a.slug.localeCompare(b.slug));
const payload = {
  version: 1,
  note: 'Hidden at build time — posts stay in content.json. Do not delete.',
  generatedAt: new Date().toISOString(),
  slugs: hits.map((h) => h.slug),
  details: hits,
};

let removedAssets = 0;
for (const rel of MALWARE_ASSETS) {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) continue;
  if (!dryRun) unlinkSync(path);
  removedAssets += 1;
  console.log(`[remove-spam] removed asset ${rel}`);
}

console.log(
  `[remove-spam] ${hits.length} spam/off-topic of ${posts.length} posts; sanitized ${sanitized}; assets removed ${removedAssets}`,
);
for (const h of hits.slice(0, 12)) console.log(`  · ${h.slug}  (${h.reason})`);
if (hits.length > 12) console.log(`  … +${hits.length - 12} more`);

if (dryRun) {
  console.log('[remove-spam] dry-run — not writing content files');
  process.exit(0);
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
writeFileSync(CONTENT, JSON.stringify(data));
console.log(`[remove-spam] wrote ${OUT} and updated ${CONTENT}`);
