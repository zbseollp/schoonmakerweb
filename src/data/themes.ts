/**
 * De site heeft drie themapagina's — Huishouden, Tuingereedschap en
 * Wasmachines — maar de 96 vergelijkingspagina's hingen er nergens aan vast.
 * Hier worden ze aan een thema gekoppeld, op trefwoord in de slug.
 *
 * De volgorde is die van `themes`: de eerste regel die past wint. Zet een
 * specifieker trefwoord dus bovenaan (bijvoorbeeld "wasmachine-kast" hoort bij
 * wasmachines, niet bij huishouden vanwege "kast").
 *
 * Dit raakt geen enkele URL; het bepaalt alleen wat er op de voorpagina en op
 * de themapagina's bij elkaar staat.
 */
export type Theme = {
  slug: string;
  name: string;
  path: string;
  blurb: string;
  match: RegExp;
};

export const themes: Theme[] = [
  {
    slug: "wasmachines",
    name: "Wasmachines",
    path: "/wasmachines/",
    blurb: "Wassen, drogen en opbergen — van wasmachine tot droogrek.",
    match: /^(wasmachine|wasmand|droger|droogmolen|droogrek|droogtoren|condensdroger|warmtepompdroger|was-droog|kledingstomer|camping-wasmachine|bovenlader)/,
  },
  {
    slug: "tuingereedschap",
    name: "Tuingereedschap",
    path: "/tuingereedschap/",
    blurb: "Alles voor tuin en buitenruimte, van grasmaaier tot hogedrukreiniger.",
    match: /(grasmaaier|maaier|heggenschaar|bladblazer|bladzuiger|boomzaag|bosmaaier|buxusschaar|drukspuit|onkruid|tuinslang|grasschaar|grastrimmer|hakselaar|kruiwagen|slakkenkorrels|sneeuwruimer|snoei|takkenschaar|verticuteer|vijver|zwembadrobot|steekwagen|veegmachine)/,
  },
  {
    slug: "huishouden",
    name: "Huishouden",
    path: "/huishouden/",
    blurb: "Schoonmaken binnenshuis: stofzuigers, stoomreinigers en vaatwassers.",
    // Vangnet: alles wat niet in de tuin of de wasruimte thuishoort.
    match: /.*/,
  },
];

export function themeFor(slug: string): Theme {
  const bare = slug.replace(/^beste-/, "");
  return themes.find((t) => t.match.test(bare)) ?? themes[themes.length - 1];
}
