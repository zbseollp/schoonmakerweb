export const site = {
  name: "Schoonmakerweb",
  domain: "https://schoonmakerweb.nl",
  titleSuffix: " - Uw gids voor schoonmaakmiddelen",
  description:
    "Uw gids voor schoonmaakmiddelen: vergelijkingen, tips en reviews voor huishouden, tuingereedschap en wasmachines.",
};

// Het menu van de oude site.
export const nav = [
  { label: "Home", href: "/" },
  { label: "Onze blogs", href: "/blog/" },
];

/** Auteursarchieven. De id's komen uit de REST-berichten; de slugs en
 *  weergavenamen uit de archiefpagina's zelf (de users-endpoint geeft 403). */
export const authors: Record<number, { slug: string; name: string }> = {
  1: { slug: "info_809y5sr2", name: "admin" },
  5: { slug: "lisanne", name: "Lisanne" },
};

export const ARCHIVE_PER_PAGE = 10;
