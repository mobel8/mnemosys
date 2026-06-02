/**
 * Embedded English → French micro-dictionary (Vague 17 — Reading Import).
 *
 * Purpose: provide an **offline**, zero-cost inline lookup for the most common
 * English words a learner meets while reading, so `WordLookupPopover` can show
 * an IPA transcription, the part of speech and a French gloss without a network
 * round-trip. When a word is absent, the popover falls back to an « AI lookup »
 * affordance (handled by the orchestrator).
 *
 * Data discipline (see project rules):
 *   - IPA uses standard **General American** broad transcription in /…/ slashes.
 *   - Glosses are the single most frequent French equivalent for the listed
 *     part of speech — deliberately concise, never invented.
 *   - The set is intentionally modest (~150 high-frequency entries) but every
 *     row is hand-checked rather than auto-generated; correctness over breadth.
 *
 * Lookup is case-insensitive (keys are stored lower-cased; `lookupLocal`
 * lower-cases + trims its argument). Only one sense is stored per word — this
 * is a reading aid, not a full lexicographic resource.
 */

/** Part of speech, kept as a small closed French-facing union. */
export type PartOfSpeech =
  | "nom"
  | "verbe"
  | "adjectif"
  | "adverbe"
  | "pronom"
  | "préposition"
  | "conjonction"
  | "déterminant"
  | "interjection";

/** One dictionary entry. `word` is the canonical lower-cased headword. */
export interface DictEntry {
  /** Canonical lower-cased headword. */
  word: string;
  /** Broad General-American IPA transcription, slashes included (e.g. `/ˈwɔtər/`). */
  ipa: string;
  /** Part of speech (French label). */
  pos: PartOfSpeech;
  /** Concise French gloss for the listed sense. */
  fr: string;
}

/**
 * The embedded data set. Stored as a plain array and indexed lazily into a Map
 * on first lookup so the module stays trivially serialisable and tree-shake
 * friendly. Keys MUST be unique + lower-cased.
 */
const ENTRIES: readonly DictEntry[] = [
  // --- Determiners / pronouns ---------------------------------------------
  { word: "the", ipa: "/ðə/", pos: "déterminant", fr: "le, la, les" },
  { word: "a", ipa: "/ə/", pos: "déterminant", fr: "un, une" },
  { word: "an", ipa: "/ən/", pos: "déterminant", fr: "un, une" },
  { word: "this", ipa: "/ðɪs/", pos: "déterminant", fr: "ce, cette" },
  { word: "that", ipa: "/ðæt/", pos: "déterminant", fr: "ce, cela" },
  { word: "these", ipa: "/ðiz/", pos: "déterminant", fr: "ces" },
  { word: "those", ipa: "/ðoʊz/", pos: "déterminant", fr: "ces, ceux-là" },
  { word: "some", ipa: "/sʌm/", pos: "déterminant", fr: "quelques, du" },
  { word: "any", ipa: "/ˈɛni/", pos: "déterminant", fr: "aucun, n'importe quel" },
  { word: "all", ipa: "/ɔl/", pos: "déterminant", fr: "tout, tous" },
  { word: "each", ipa: "/itʃ/", pos: "déterminant", fr: "chaque" },
  { word: "every", ipa: "/ˈɛvri/", pos: "déterminant", fr: "chaque, tous les" },
  { word: "i", ipa: "/aɪ/", pos: "pronom", fr: "je" },
  { word: "you", ipa: "/ju/", pos: "pronom", fr: "tu, vous" },
  { word: "he", ipa: "/hi/", pos: "pronom", fr: "il" },
  { word: "she", ipa: "/ʃi/", pos: "pronom", fr: "elle" },
  { word: "it", ipa: "/ɪt/", pos: "pronom", fr: "il, elle, cela" },
  { word: "we", ipa: "/wi/", pos: "pronom", fr: "nous" },
  { word: "they", ipa: "/ðeɪ/", pos: "pronom", fr: "ils, elles" },
  { word: "who", ipa: "/hu/", pos: "pronom", fr: "qui" },
  { word: "what", ipa: "/wʌt/", pos: "pronom", fr: "quoi, que" },
  { word: "which", ipa: "/wɪtʃ/", pos: "pronom", fr: "lequel, quel" },

  // --- Prepositions / conjunctions ----------------------------------------
  { word: "of", ipa: "/ʌv/", pos: "préposition", fr: "de" },
  { word: "to", ipa: "/tu/", pos: "préposition", fr: "à, vers" },
  { word: "in", ipa: "/ɪn/", pos: "préposition", fr: "dans, en" },
  { word: "on", ipa: "/ɑn/", pos: "préposition", fr: "sur" },
  { word: "at", ipa: "/æt/", pos: "préposition", fr: "à" },
  { word: "for", ipa: "/fɔr/", pos: "préposition", fr: "pour" },
  { word: "with", ipa: "/wɪð/", pos: "préposition", fr: "avec" },
  { word: "from", ipa: "/frʌm/", pos: "préposition", fr: "de, depuis" },
  { word: "by", ipa: "/baɪ/", pos: "préposition", fr: "par, près de" },
  { word: "about", ipa: "/əˈbaʊt/", pos: "préposition", fr: "à propos de, environ" },
  { word: "into", ipa: "/ˈɪntu/", pos: "préposition", fr: "dans, en" },
  { word: "over", ipa: "/ˈoʊvər/", pos: "préposition", fr: "au-dessus de, par-dessus" },
  { word: "under", ipa: "/ˈʌndər/", pos: "préposition", fr: "sous" },
  { word: "between", ipa: "/bɪˈtwin/", pos: "préposition", fr: "entre" },
  { word: "through", ipa: "/θru/", pos: "préposition", fr: "à travers" },
  { word: "during", ipa: "/ˈdʊrɪŋ/", pos: "préposition", fr: "pendant" },
  { word: "without", ipa: "/wɪˈðaʊt/", pos: "préposition", fr: "sans" },
  { word: "and", ipa: "/ænd/", pos: "conjonction", fr: "et" },
  { word: "but", ipa: "/bʌt/", pos: "conjonction", fr: "mais" },
  { word: "or", ipa: "/ɔr/", pos: "conjonction", fr: "ou" },
  { word: "because", ipa: "/bɪˈkɔz/", pos: "conjonction", fr: "parce que" },
  { word: "if", ipa: "/ɪf/", pos: "conjonction", fr: "si" },
  { word: "while", ipa: "/waɪl/", pos: "conjonction", fr: "pendant que, tandis que" },
  { word: "although", ipa: "/ɔlˈðoʊ/", pos: "conjonction", fr: "bien que" },

  // --- Common verbs --------------------------------------------------------
  { word: "be", ipa: "/bi/", pos: "verbe", fr: "être" },
  { word: "is", ipa: "/ɪz/", pos: "verbe", fr: "est" },
  { word: "are", ipa: "/ɑr/", pos: "verbe", fr: "sont, es" },
  { word: "was", ipa: "/wʌz/", pos: "verbe", fr: "était" },
  { word: "were", ipa: "/wɜr/", pos: "verbe", fr: "étaient, étais" },
  { word: "have", ipa: "/hæv/", pos: "verbe", fr: "avoir" },
  { word: "has", ipa: "/hæz/", pos: "verbe", fr: "a" },
  { word: "had", ipa: "/hæd/", pos: "verbe", fr: "avait, eu" },
  { word: "do", ipa: "/du/", pos: "verbe", fr: "faire" },
  { word: "does", ipa: "/dʌz/", pos: "verbe", fr: "fait" },
  { word: "did", ipa: "/dɪd/", pos: "verbe", fr: "a fait, faisait" },
  { word: "make", ipa: "/meɪk/", pos: "verbe", fr: "faire, fabriquer" },
  { word: "go", ipa: "/ɡoʊ/", pos: "verbe", fr: "aller" },
  { word: "come", ipa: "/kʌm/", pos: "verbe", fr: "venir" },
  { word: "see", ipa: "/si/", pos: "verbe", fr: "voir" },
  { word: "know", ipa: "/noʊ/", pos: "verbe", fr: "savoir, connaître" },
  { word: "think", ipa: "/θɪŋk/", pos: "verbe", fr: "penser" },
  { word: "take", ipa: "/teɪk/", pos: "verbe", fr: "prendre" },
  { word: "get", ipa: "/ɡɛt/", pos: "verbe", fr: "obtenir, recevoir" },
  { word: "give", ipa: "/ɡɪv/", pos: "verbe", fr: "donner" },
  { word: "find", ipa: "/faɪnd/", pos: "verbe", fr: "trouver" },
  { word: "want", ipa: "/wɑnt/", pos: "verbe", fr: "vouloir" },
  { word: "use", ipa: "/juz/", pos: "verbe", fr: "utiliser" },
  { word: "say", ipa: "/seɪ/", pos: "verbe", fr: "dire" },
  { word: "tell", ipa: "/tɛl/", pos: "verbe", fr: "dire, raconter" },
  { word: "ask", ipa: "/æsk/", pos: "verbe", fr: "demander" },
  { word: "work", ipa: "/wɜrk/", pos: "verbe", fr: "travailler" },
  { word: "call", ipa: "/kɔl/", pos: "verbe", fr: "appeler" },
  { word: "feel", ipa: "/fil/", pos: "verbe", fr: "ressentir, sentir" },
  { word: "become", ipa: "/bɪˈkʌm/", pos: "verbe", fr: "devenir" },
  { word: "leave", ipa: "/liv/", pos: "verbe", fr: "partir, laisser" },
  { word: "need", ipa: "/nid/", pos: "verbe", fr: "avoir besoin de" },
  { word: "keep", ipa: "/kip/", pos: "verbe", fr: "garder" },
  { word: "begin", ipa: "/bɪˈɡɪn/", pos: "verbe", fr: "commencer" },
  { word: "show", ipa: "/ʃoʊ/", pos: "verbe", fr: "montrer" },
  { word: "hear", ipa: "/hɪr/", pos: "verbe", fr: "entendre" },
  { word: "read", ipa: "/rid/", pos: "verbe", fr: "lire" },
  { word: "write", ipa: "/raɪt/", pos: "verbe", fr: "écrire" },
  { word: "speak", ipa: "/spik/", pos: "verbe", fr: "parler" },
  { word: "learn", ipa: "/lɜrn/", pos: "verbe", fr: "apprendre" },
  { word: "understand", ipa: "/ˌʌndərˈstænd/", pos: "verbe", fr: "comprendre" },
  { word: "remember", ipa: "/rɪˈmɛmbər/", pos: "verbe", fr: "se souvenir" },
  { word: "love", ipa: "/lʌv/", pos: "verbe", fr: "aimer" },
  { word: "live", ipa: "/lɪv/", pos: "verbe", fr: "vivre" },
  { word: "eat", ipa: "/it/", pos: "verbe", fr: "manger" },
  { word: "drink", ipa: "/drɪŋk/", pos: "verbe", fr: "boire" },
  { word: "sleep", ipa: "/slip/", pos: "verbe", fr: "dormir" },
  { word: "buy", ipa: "/baɪ/", pos: "verbe", fr: "acheter" },
  { word: "run", ipa: "/rʌn/", pos: "verbe", fr: "courir" },
  { word: "walk", ipa: "/wɔk/", pos: "verbe", fr: "marcher" },
  { word: "play", ipa: "/pleɪ/", pos: "verbe", fr: "jouer" },

  // --- Common nouns --------------------------------------------------------
  { word: "time", ipa: "/taɪm/", pos: "nom", fr: "temps, heure" },
  { word: "year", ipa: "/jɪr/", pos: "nom", fr: "année, an" },
  { word: "day", ipa: "/deɪ/", pos: "nom", fr: "jour, journée" },
  { word: "people", ipa: "/ˈpipəl/", pos: "nom", fr: "gens, personnes" },
  { word: "person", ipa: "/ˈpɜrsən/", pos: "nom", fr: "personne" },
  { word: "way", ipa: "/weɪ/", pos: "nom", fr: "chemin, manière" },
  { word: "thing", ipa: "/θɪŋ/", pos: "nom", fr: "chose" },
  { word: "man", ipa: "/mæn/", pos: "nom", fr: "homme" },
  { word: "woman", ipa: "/ˈwʊmən/", pos: "nom", fr: "femme" },
  { word: "child", ipa: "/tʃaɪld/", pos: "nom", fr: "enfant" },
  { word: "world", ipa: "/wɜrld/", pos: "nom", fr: "monde" },
  { word: "life", ipa: "/laɪf/", pos: "nom", fr: "vie" },
  { word: "hand", ipa: "/hænd/", pos: "nom", fr: "main" },
  { word: "eye", ipa: "/aɪ/", pos: "nom", fr: "œil" },
  { word: "place", ipa: "/pleɪs/", pos: "nom", fr: "endroit, lieu" },
  { word: "work", ipa: "/wɜrk/", pos: "nom", fr: "travail" },
  { word: "word", ipa: "/wɜrd/", pos: "nom", fr: "mot" },
  { word: "book", ipa: "/bʊk/", pos: "nom", fr: "livre" },
  { word: "water", ipa: "/ˈwɔtər/", pos: "nom", fr: "eau" },
  { word: "house", ipa: "/haʊs/", pos: "nom", fr: "maison" },
  { word: "home", ipa: "/hoʊm/", pos: "nom", fr: "maison, foyer" },
  { word: "school", ipa: "/skul/", pos: "nom", fr: "école" },
  { word: "country", ipa: "/ˈkʌntri/", pos: "nom", fr: "pays" },
  { word: "city", ipa: "/ˈsɪti/", pos: "nom", fr: "ville" },
  { word: "friend", ipa: "/frɛnd/", pos: "nom", fr: "ami" },
  { word: "family", ipa: "/ˈfæməli/", pos: "nom", fr: "famille" },
  { word: "money", ipa: "/ˈmʌni/", pos: "nom", fr: "argent" },
  { word: "food", ipa: "/fud/", pos: "nom", fr: "nourriture" },
  { word: "name", ipa: "/neɪm/", pos: "nom", fr: "nom" },
  { word: "night", ipa: "/naɪt/", pos: "nom", fr: "nuit" },
  { word: "morning", ipa: "/ˈmɔrnɪŋ/", pos: "nom", fr: "matin" },
  { word: "week", ipa: "/wik/", pos: "nom", fr: "semaine" },
  { word: "month", ipa: "/mʌnθ/", pos: "nom", fr: "mois" },
  { word: "hour", ipa: "/ˈaʊər/", pos: "nom", fr: "heure" },
  { word: "language", ipa: "/ˈlæŋɡwɪdʒ/", pos: "nom", fr: "langue, langage" },
  { word: "number", ipa: "/ˈnʌmbər/", pos: "nom", fr: "nombre, numéro" },
  { word: "question", ipa: "/ˈkwɛstʃən/", pos: "nom", fr: "question" },
  { word: "story", ipa: "/ˈstɔri/", pos: "nom", fr: "histoire" },
  { word: "music", ipa: "/ˈmjuzɪk/", pos: "nom", fr: "musique" },

  // --- Adjectives ----------------------------------------------------------
  { word: "good", ipa: "/ɡʊd/", pos: "adjectif", fr: "bon" },
  { word: "bad", ipa: "/bæd/", pos: "adjectif", fr: "mauvais" },
  { word: "new", ipa: "/nu/", pos: "adjectif", fr: "nouveau, neuf" },
  { word: "old", ipa: "/oʊld/", pos: "adjectif", fr: "vieux, ancien" },
  { word: "great", ipa: "/ɡreɪt/", pos: "adjectif", fr: "grand, formidable" },
  { word: "big", ipa: "/bɪɡ/", pos: "adjectif", fr: "grand, gros" },
  { word: "small", ipa: "/smɔl/", pos: "adjectif", fr: "petit" },
  { word: "long", ipa: "/lɔŋ/", pos: "adjectif", fr: "long" },
  { word: "little", ipa: "/ˈlɪtəl/", pos: "adjectif", fr: "petit, peu" },
  { word: "high", ipa: "/haɪ/", pos: "adjectif", fr: "haut, élevé" },
  { word: "different", ipa: "/ˈdɪfərənt/", pos: "adjectif", fr: "différent" },
  { word: "important", ipa: "/ɪmˈpɔrtənt/", pos: "adjectif", fr: "important" },
  { word: "easy", ipa: "/ˈizi/", pos: "adjectif", fr: "facile" },
  { word: "hard", ipa: "/hɑrd/", pos: "adjectif", fr: "difficile, dur" },
  { word: "happy", ipa: "/ˈhæpi/", pos: "adjectif", fr: "heureux" },
  { word: "right", ipa: "/raɪt/", pos: "adjectif", fr: "correct, droit" },
  { word: "wrong", ipa: "/rɔŋ/", pos: "adjectif", fr: "faux, incorrect" },
  { word: "true", ipa: "/tru/", pos: "adjectif", fr: "vrai" },
  { word: "young", ipa: "/jʌŋ/", pos: "adjectif", fr: "jeune" },
  { word: "beautiful", ipa: "/ˈbjutɪfəl/", pos: "adjectif", fr: "beau, magnifique" },
  { word: "free", ipa: "/fri/", pos: "adjectif", fr: "libre, gratuit" },
  { word: "sure", ipa: "/ʃʊr/", pos: "adjectif", fr: "sûr, certain" },

  // --- Adverbs -------------------------------------------------------------
  { word: "not", ipa: "/nɑt/", pos: "adverbe", fr: "ne… pas" },
  { word: "very", ipa: "/ˈvɛri/", pos: "adverbe", fr: "très" },
  { word: "also", ipa: "/ˈɔlsoʊ/", pos: "adverbe", fr: "aussi" },
  { word: "only", ipa: "/ˈoʊnli/", pos: "adverbe", fr: "seulement" },
  { word: "now", ipa: "/naʊ/", pos: "adverbe", fr: "maintenant" },
  { word: "here", ipa: "/hɪr/", pos: "adverbe", fr: "ici" },
  { word: "there", ipa: "/ðɛr/", pos: "adverbe", fr: "là, là-bas" },
  { word: "always", ipa: "/ˈɔlweɪz/", pos: "adverbe", fr: "toujours" },
  { word: "never", ipa: "/ˈnɛvər/", pos: "adverbe", fr: "jamais" },
  { word: "often", ipa: "/ˈɔfən/", pos: "adverbe", fr: "souvent" },
  { word: "again", ipa: "/əˈɡɛn/", pos: "adverbe", fr: "encore, de nouveau" },
  { word: "together", ipa: "/təˈɡɛðər/", pos: "adverbe", fr: "ensemble" },
  { word: "today", ipa: "/təˈdeɪ/", pos: "adverbe", fr: "aujourd'hui" },
  { word: "tomorrow", ipa: "/təˈmɑroʊ/", pos: "adverbe", fr: "demain" },
  { word: "yesterday", ipa: "/ˈjɛstərdeɪ/", pos: "adverbe", fr: "hier" },
  { word: "well", ipa: "/wɛl/", pos: "adverbe", fr: "bien" },
  { word: "soon", ipa: "/sun/", pos: "adverbe", fr: "bientôt" },

  // --- Interjections -------------------------------------------------------
  { word: "yes", ipa: "/jɛs/", pos: "interjection", fr: "oui" },
  { word: "no", ipa: "/noʊ/", pos: "interjection", fr: "non" },
  { word: "hello", ipa: "/həˈloʊ/", pos: "interjection", fr: "bonjour" },
  { word: "please", ipa: "/pliz/", pos: "interjection", fr: "s'il vous plaît" },
  { word: "thanks", ipa: "/θæŋks/", pos: "interjection", fr: "merci" },
];

/**
 * Lazy index from lower-cased headword → entry. Built once on first lookup.
 * Where a headword appears more than once in `ENTRIES` (e.g. « work » as both
 * verb and noun), the FIRST occurrence wins — the array order above places the
 * most frequent sense first on purpose.
 */
let index: Map<string, DictEntry> | null = null;

function getIndex(): Map<string, DictEntry> {
  if (index === null) {
    const map = new Map<string, DictEntry>();
    for (const entry of ENTRIES) {
      if (!map.has(entry.word)) {
        map.set(entry.word, entry);
      }
    }
    index = map;
  }
  return index;
}

/**
 * Look up a word in the embedded dictionary. Case-insensitive and
 * whitespace-tolerant. Returns `null` when the word is not present so callers
 * can branch to an « offline definition unavailable » / AI-lookup state.
 */
export function lookupLocal(word: string): DictEntry | null {
  const key = word.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }
  return getIndex().get(key) ?? null;
}

/** Total number of embedded entries (handy for tests / about-screens). */
export function entryCount(): number {
  return getIndex().size;
}
