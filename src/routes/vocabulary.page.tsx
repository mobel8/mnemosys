/**
 * « Vocabulaire par fréquence » — génère des decks à partir des listes de mots
 * anglais les plus fréquents. La traduction FR des mots courants vient du
 * mini-dictionnaire embarqué (les autres restent à compléter).
 */

import VocabularyBuilder from "@/components/VocabularyBuilder";
import { lookupLocal } from "@/lib/dictionary";

export default function VocabularyPage() {
  return <VocabularyBuilder translate={(word) => lookupLocal(word)?.fr} />;
}
