#!/usr/bin/env node
/**
 * Strip injected casino/affiliate malware from posts in content.json.
 *
 * Hiding is a last resort: a post only lands in src/data/spam-slugs.json when
 * sanitising fails to get the injection out. Titles never hide a post. An
 * earlier version hid on title alone (`online casino`, `gaming`,
 * `entertainmentruimte`, …) and took 9 clean cleaning articles down with it,
 * while those posts stayed "published" in Payload — so publishing them looked
 * broken. The title lists survive below as a report, and behind
 * --apply-offtopic.
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

/**
 * Judge a post AFTER it has been sanitised.
 *
 * A title says what an article is about, not whether it was hacked, so it never
 * hides anything on its own. Only an injection the sanitiser could not remove
 * does — and that is a sanitiser bug worth surfacing, not a page worth serving.
 */
function reasonFor(post) {
  const titleHay = `${post.slug} ${post.title} ${post.seoTitle || ''}`;
  const residue = `${post.content || ''}\n${post.excerpt || ''}\n${post.seoDescription || ''}`;

  if (malwareHitCount(residue) > 0) return 'hard-body:injection-survived-sanitize';
  for (const re of HARD_BODY) {
    if (re.test(residue)) return `hard-body:${re}`;
  }

  // Off-topic gossip stays live by default so old articles keep showing.
  // Pass --apply-offtopic to hide them again.
  if (process.argv.includes('--apply-offtopic')) {
    for (const re of OFF_TOPIC_TITLE) {
      if (re.test(titleHay)) return `off-topic:${re}`;
    }
  }
  return null;
}

/** Casino/gaming titles worth a human glance. Reported only, never acted on. */
function noteworthyTitle(post) {
  const titleHay = `${post.slug} ${post.title} ${post.seoTitle || ''}`;
  for (const re of HARD_TITLE) if (re.test(titleHay)) return String(re);
  if (isCloaked(titleHay) && !isCleaning(titleHay)) return 'cloaked-title';
  return null;
}

/**
 * Excerpt and SEO description are plain text, so the HTML-shaped scrubbing in
 * sanitizeContent cannot reach them — that is how "zonder Cruks" kept showing
 * up in meta descriptions of posts whose body was already clean. Drop the
 * poisoned sentence; if that guts the field, rebuild it from the body.
 */
const META_SENTENCE = new RegExp(
  `[^.!?]*(?:${MALWARE_HOST}|zonder[\\s-]?cruks|cruks\\s+omzeilen|online[\\s-]?casino|buitenlandse\\s+casino|cryptogok|goksites)[^.!?]*[.!?]?`,
  'gi',
);

function sanitizeMeta(post) {
  let changed = false;
  const fallback = String(post.content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  for (const field of ['excerpt', 'seoDescription']) {
    const before = String(post[field] || '');
    if (!before) continue;
    let after = before.replace(META_SENTENCE, '').replace(/\s+/g, ' ').trim();
    if (after.length < 40) after = fallback;
    if (after !== before) {
      post[field] = after;
      changed = true;
    }
  }
  return changed;
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

// Deliberately not sticky. The previous run carried every hard- hit forward as
// sticky:previous-hard, so a slug caught once by a title regex stayed hidden
// even after the regex was softened — the fix looked applied and changed nothing.
const noted = [];

for (const p of posts) {
  if (!p?.slug) continue;

  // Sanitise first, then judge: the verdict has to be about what actually ships.
  const { html, changed } = sanitizeContent(p.content);
  if (changed) p.content = html;
  const metaChanged = sanitizeMeta(p);
  if (changed || metaChanged) sanitized += 1;

  const reason = reasonFor(p);
  if (reason) {
    hits.push({ slug: p.slug, reason, title: p.title });
    continue;
  }
  const note = noteworthyTitle(p);
  if (note) noted.push({ slug: p.slug, title: p.title, note });
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
if (noted.length) {
  console.log(`[remove-spam] ${noted.length} post(s) carry a casino/gaming title but ship clean — kept live:`);
  for (const n of noted.slice(0, 8)) console.log(`  · ${n.slug}  (${n.note})`);
  if (noted.length > 8) console.log(`  … +${noted.length - 8} more`);
}

if (dryRun) {
  console.log('[remove-spam] dry-run — not writing content files');
  process.exit(0);
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
writeFileSync(CONTENT, JSON.stringify(data));
console.log(`[remove-spam] wrote ${OUT} and updated ${CONTENT}`);
