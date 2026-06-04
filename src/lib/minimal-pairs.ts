/**
 * English minimal-pair dataset for the pronunciation drill (sous-feature 3).
 *
 * A *minimal pair* is two words that differ by exactly one phoneme, e.g.
 * « ship » /ʃɪp/ vs « sheep » /ʃiːp/. Drilling them trains the ear to
 * discriminate the contrasts that are hardest for non-native (esp. French)
 * speakers of English.
 *
 * Transcriptions use broad IPA in the **General American (GA)** tradition, to
 * stay consistent with the embedded dictionary (`dictionary.ts`) and the US TTS
 * voice used across the Langues area (P114) — drilling a British /ɒ/ against a
 * US voice would mislead the ear. They are deliberately *phonemic* (between
 * slashes), not narrow phonetic detail: length marks are dropped (GA contrasts
 * tense/lax by quality, not length), the LOT vowel is /ɑ/, and rhotic vowels
 * keep their /r/. Stress marks are omitted on monosyllables. The dataset is
 * intentionally modest but every entry is checked rather than vast and
 * approximate.
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
    id: "i-ɪ",
    label: "/i/ vs /ɪ/ — voyelle tendue / relâchée",
    pairs: [
      { a: "sheep", b: "ship", ipaA: "ʃip", ipaB: "ʃɪp" },
      { a: "beat", b: "bit", ipaA: "bit", ipaB: "bɪt" },
      { a: "feet", b: "fit", ipaA: "fit", ipaB: "fɪt" },
      { a: "leave", b: "live", ipaA: "liv", ipaB: "lɪv" },
      { a: "seat", b: "sit", ipaA: "sit", ipaB: "sɪt" },
      { a: "heel", b: "hill", ipaA: "hil", ipaB: "hɪl" },
    ],
  },
  {
    id: "æ-ɛ",
    label: "/æ/ vs /ɛ/ — « a » ouvert / « e » fermé",
    pairs: [
      { a: "bad", b: "bed", ipaA: "bæd", ipaB: "bɛd" },
      { a: "man", b: "men", ipaA: "mæn", ipaB: "mɛn" },
      { a: "had", b: "head", ipaA: "hæd", ipaB: "hɛd" },
      { a: "sad", b: "said", ipaA: "sæd", ipaB: "sɛd" },
      { a: "pan", b: "pen", ipaA: "pæn", ipaB: "pɛn" },
      { a: "gas", b: "guess", ipaA: "ɡæs", ipaB: "ɡɛs" },
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
    id: "ʌ-ɑ",
    label: "/ʌ/ vs /ɑ/ — « cup » / « cop »",
    pairs: [
      { a: "cup", b: "cop", ipaA: "kʌp", ipaB: "kɑp" },
      { a: "luck", b: "lock", ipaA: "lʌk", ipaB: "lɑk" },
      { a: "nut", b: "not", ipaA: "nʌt", ipaB: "nɑt" },
      { a: "duck", b: "dock", ipaA: "dʌk", ipaB: "dɑk" },
      { a: "stuck", b: "stock", ipaA: "stʌk", ipaB: "stɑk" },
    ],
  },
  {
    id: "u-ʊ",
    label: "/u/ vs /ʊ/ — « pool » / « pull »",
    pairs: [
      { a: "pool", b: "pull", ipaA: "pul", ipaB: "pʊl" },
      { a: "fool", b: "full", ipaA: "ful", ipaB: "fʊl" },
      { a: "Luke", b: "look", ipaA: "luk", ipaB: "lʊk" },
      { a: "suit", b: "soot", ipaA: "sut", ipaB: "sʊt" },
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
      { a: "path", b: "pass", ipaA: "pæθ", ipaB: "pæs" },
      { a: "worth", b: "worse", ipaA: "wɜrθ", ipaB: "wɜrs" },
    ],
  },
  {
    id: "ð-z",
    label: "/ð/ vs /z/ — « breathe » / « breeze »",
    pairs: [
      { a: "breathe", b: "breeze", ipaA: "brið", ipaB: "briz" },
      { a: "writhe", b: "rise", ipaA: "raɪð", ipaB: "raɪz" },
      { a: "clothe", b: "close", ipaA: "kloʊð", ipaB: "kloʊz" },
      { a: "teethe", b: "tease", ipaA: "tið", ipaB: "tiz" },
    ],
  },
  {
    id: "ð-d",
    label: "/ð/ vs /d/ — « they » / « day »",
    pairs: [
      { a: "they", b: "day", ipaA: "ðeɪ", ipaB: "deɪ" },
      { a: "then", b: "den", ipaA: "ðɛn", ipaB: "dɛn" },
      { a: "those", b: "doze", ipaA: "ðoʊz", ipaB: "doʊz" },
      { a: "there", b: "dare", ipaA: "ðɛr", ipaB: "dɛr" },
    ],
  },
  {
    id: "v-w",
    label: "/v/ vs /w/ — « vest » / « west »",
    pairs: [
      { a: "vest", b: "west", ipaA: "vɛst", ipaB: "wɛst" },
      { a: "vine", b: "wine", ipaA: "vaɪn", ipaB: "waɪn" },
      { a: "veil", b: "wail", ipaA: "veɪl", ipaB: "weɪl" },
      { a: "vary", b: "wary", ipaA: "ˈvɛri", ipaB: "ˈwɛri" },
      { a: "verse", b: "worse", ipaA: "vɜrs", ipaB: "wɜrs" },
    ],
  },
  {
    id: "b-v",
    label: "/b/ vs /v/ — « berry » / « very »",
    pairs: [
      { a: "berry", b: "very", ipaA: "ˈbɛri", ipaB: "ˈvɛri" },
      { a: "bet", b: "vet", ipaA: "bɛt", ipaB: "vɛt" },
      { a: "ban", b: "van", ipaA: "bæn", ipaB: "væn" },
      { a: "boat", b: "vote", ipaA: "boʊt", ipaB: "voʊt" },
      { a: "curb", b: "curve", ipaA: "kɜrb", ipaB: "kɜrv" },
    ],
  },
  {
    id: "l-r",
    label: "/l/ vs /r/ — « light » / « right »",
    pairs: [
      { a: "light", b: "right", ipaA: "laɪt", ipaB: "raɪt" },
      { a: "lead", b: "read", ipaA: "lid", ipaB: "rid" },
      { a: "lock", b: "rock", ipaA: "lɑk", ipaB: "rɑk" },
      { a: "glass", b: "grass", ipaA: "ɡlæs", ipaB: "ɡræs" },
      { a: "collect", b: "correct", ipaA: "kəˈlɛkt", ipaB: "kəˈrɛkt" },
      { a: "play", b: "pray", ipaA: "pleɪ", ipaB: "preɪ" },
    ],
  },
  {
    id: "ɪ-ɛ",
    label: "/ɪ/ vs /ɛ/ — « bit » / « bet »",
    pairs: [
      { a: "bit", b: "bet", ipaA: "bɪt", ipaB: "bɛt" },
      { a: "litter", b: "letter", ipaA: "ˈlɪtər", ipaB: "ˈlɛtər" },
      { a: "pin", b: "pen", ipaA: "pɪn", ipaB: "pɛn" },
      { a: "tin", b: "ten", ipaA: "tɪn", ipaB: "tɛn" },
      { a: "did", b: "dead", ipaA: "dɪd", ipaB: "dɛd" },
    ],
  },
];
