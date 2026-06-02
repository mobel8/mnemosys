/**
 * English minimal-pair dataset for the pronunciation drill (sous-feature 3).
 *
 * A *minimal pair* is two words that differ by exactly one phoneme, e.g.
 * « ship » /ʃɪp/ vs « sheep » /ʃiːp/. Drilling them trains the ear to
 * discriminate the contrasts that are hardest for non-native (esp. French)
 * speakers of English.
 *
 * Transcriptions use broad IPA in the British (RP) tradition, which is the
 * convention most learner dictionaries (Oxford, Cambridge) follow. They are
 * deliberately *phonemic* (between slashes), not narrow phonetic detail.
 * Stress marks are omitted on monosyllables. The dataset is intentionally
 * modest but every entry is checked rather than vast and approximate.
 *
 * Nothing here is randomised at module load — the drill component performs all
 * random selection at runtime inside event handlers.
 */

/** A single minimal pair: two words differing by one phoneme, with IPA. */
export interface MinimalPair {
  /** First word of the pair (e.g. « sheep »). */
  a: string;
  /** Second word of the pair (e.g. « ship »). */
  b: string;
  /** Broad IPA for {@link MinimalPair.a}, without slashes. */
  ipaA: string;
  /** Broad IPA for {@link MinimalPair.b}, without slashes. */
  ipaB: string;
}

/** A phonemic contrast (e.g. /iː/ vs /ɪ/) and the pairs that illustrate it. */
export interface Contrast {
  /** Stable identifier, safe for use as a React key / Select value. */
  id: string;
  /** Human-facing French label, e.g. « /iː/ vs /ɪ/ — voyelle longue / brève ». */
  label: string;
  /** Minimal pairs illustrating this contrast (4–8 each). */
  pairs: MinimalPair[];
}

/**
 * The contrasts, ordered roughly from the most common French-speaker
 * difficulties (tense/lax vowels, the « th » fricatives) onward.
 */
export const CONTRASTS: Contrast[] = [
  {
    id: "iː-ɪ",
    label: "/iː/ vs /ɪ/ — voyelle tendue / relâchée",
    pairs: [
      { a: "sheep", b: "ship", ipaA: "ʃiːp", ipaB: "ʃɪp" },
      { a: "beat", b: "bit", ipaA: "biːt", ipaB: "bɪt" },
      { a: "feet", b: "fit", ipaA: "fiːt", ipaB: "fɪt" },
      { a: "leave", b: "live", ipaA: "liːv", ipaB: "lɪv" },
      { a: "seat", b: "sit", ipaA: "siːt", ipaB: "sɪt" },
      { a: "heel", b: "hill", ipaA: "hiːl", ipaB: "hɪl" },
    ],
  },
  {
    id: "æ-e",
    label: "/æ/ vs /e/ — « a » ouvert / « e » fermé",
    pairs: [
      { a: "bad", b: "bed", ipaA: "bæd", ipaB: "bed" },
      { a: "man", b: "men", ipaA: "mæn", ipaB: "men" },
      { a: "had", b: "head", ipaA: "hæd", ipaB: "hed" },
      { a: "sad", b: "said", ipaA: "sæd", ipaB: "sed" },
      { a: "pan", b: "pen", ipaA: "pæn", ipaB: "pen" },
      { a: "gas", b: "guess", ipaA: "ɡæs", ipaB: "ɡes" },
    ],
  },
  {
    id: "æ-ʌ",
    label: "/æ/ vs /ʌ/ — « cat » / « cut »",
    pairs: [
      { a: "cat", b: "cut", ipaA: "kæt", ipaB: "kʌt" },
      { a: "bat", b: "but", ipaA: "bæt", ipaB: "bʌt" },
      { a: "ran", b: "run", ipaA: "ræn", ipaB: "rʌn" },
      { a: "match", b: "much", ipaA: "mætʃ", ipaB: "mʌtʃ" },
      { a: "ankle", b: "uncle", ipaA: "ˈæŋkl̩", ipaB: "ˈʌŋkl̩" },
      { a: "cap", b: "cup", ipaA: "kæp", ipaB: "kʌp" },
    ],
  },
  {
    id: "ʌ-ɒ",
    label: "/ʌ/ vs /ɒ/ — « cup » / « cop »",
    pairs: [
      { a: "cup", b: "cop", ipaA: "kʌp", ipaB: "kɒp" },
      { a: "luck", b: "lock", ipaA: "lʌk", ipaB: "lɒk" },
      { a: "nut", b: "not", ipaA: "nʌt", ipaB: "nɒt" },
      { a: "duck", b: "dock", ipaA: "dʌk", ipaB: "dɒk" },
      { a: "stuck", b: "stock", ipaA: "stʌk", ipaB: "stɒk" },
    ],
  },
  {
    id: "uː-ʊ",
    label: "/uː/ vs /ʊ/ — « pool » / « pull »",
    pairs: [
      { a: "pool", b: "pull", ipaA: "puːl", ipaB: "pʊl" },
      { a: "fool", b: "full", ipaA: "fuːl", ipaB: "fʊl" },
      { a: "Luke", b: "look", ipaA: "luːk", ipaB: "lʊk" },
      { a: "suit", b: "soot", ipaA: "suːt", ipaB: "sʊt" },
    ],
  },
  {
    id: "θ-s",
    label: "/θ/ vs /s/ — « think » / « sink »",
    pairs: [
      { a: "think", b: "sink", ipaA: "θɪŋk", ipaB: "sɪŋk" },
      { a: "thick", b: "sick", ipaA: "θɪk", ipaB: "sɪk" },
      { a: "thing", b: "sing", ipaA: "θɪŋ", ipaB: "sɪŋ" },
      { a: "mouth", b: "mouse", ipaA: "maʊθ", ipaB: "maʊs" },
      { a: "path", b: "pass", ipaA: "pɑːθ", ipaB: "pɑːs" },
      { a: "worth", b: "worse", ipaA: "wɜːθ", ipaB: "wɜːs" },
    ],
  },
  {
    id: "ð-z",
    label: "/ð/ vs /z/ — « breathe » / « breeze »",
    pairs: [
      { a: "breathe", b: "breeze", ipaA: "briːð", ipaB: "briːz" },
      { a: "writhe", b: "rise", ipaA: "raɪð", ipaB: "raɪz" },
      { a: "clothe", b: "close", ipaA: "kləʊð", ipaB: "kləʊz" },
      { a: "teethe", b: "tease", ipaA: "tiːð", ipaB: "tiːz" },
    ],
  },
  {
    id: "ð-d",
    label: "/ð/ vs /d/ — « they » / « day »",
    pairs: [
      { a: "they", b: "day", ipaA: "ðeɪ", ipaB: "deɪ" },
      { a: "then", b: "den", ipaA: "ðen", ipaB: "den" },
      { a: "those", b: "doze", ipaA: "ðəʊz", ipaB: "dəʊz" },
      { a: "there", b: "dare", ipaA: "ðeə", ipaB: "deə" },
    ],
  },
  {
    id: "v-w",
    label: "/v/ vs /w/ — « vest » / « west »",
    pairs: [
      { a: "vest", b: "west", ipaA: "vest", ipaB: "west" },
      { a: "vine", b: "wine", ipaA: "vaɪn", ipaB: "waɪn" },
      { a: "veil", b: "wail", ipaA: "veɪl", ipaB: "weɪl" },
      { a: "vary", b: "wary", ipaA: "ˈveəri", ipaB: "ˈweəri" },
      { a: "verse", b: "worse", ipaA: "vɜːs", ipaB: "wɜːs" },
    ],
  },
  {
    id: "b-v",
    label: "/b/ vs /v/ — « berry » / « very »",
    pairs: [
      { a: "berry", b: "very", ipaA: "ˈberi", ipaB: "ˈveri" },
      { a: "bet", b: "vet", ipaA: "bet", ipaB: "vet" },
      { a: "ban", b: "van", ipaA: "bæn", ipaB: "væn" },
      { a: "boat", b: "vote", ipaA: "bəʊt", ipaB: "vəʊt" },
      { a: "curb", b: "curve", ipaA: "kɜːb", ipaB: "kɜːv" },
    ],
  },
  {
    id: "l-r",
    label: "/l/ vs /r/ — « light » / « right »",
    pairs: [
      { a: "light", b: "right", ipaA: "laɪt", ipaB: "raɪt" },
      { a: "lead", b: "read", ipaA: "liːd", ipaB: "riːd" },
      { a: "lock", b: "rock", ipaA: "lɒk", ipaB: "rɒk" },
      { a: "glass", b: "grass", ipaA: "ɡlɑːs", ipaB: "ɡrɑːs" },
      { a: "collect", b: "correct", ipaA: "kəˈlekt", ipaB: "kəˈrekt" },
      { a: "play", b: "pray", ipaA: "pleɪ", ipaB: "preɪ" },
    ],
  },
  {
    id: "ɪ-e",
    label: "/ɪ/ vs /e/ — « bit » / « bet »",
    pairs: [
      { a: "bit", b: "bet", ipaA: "bɪt", ipaB: "bet" },
      { a: "litter", b: "letter", ipaA: "ˈlɪtə", ipaB: "ˈletə" },
      { a: "pin", b: "pen", ipaA: "pɪn", ipaB: "pen" },
      { a: "tin", b: "ten", ipaA: "tɪn", ipaB: "ten" },
      { a: "did", b: "dead", ipaA: "dɪd", ipaB: "ded" },
    ],
  },
];
