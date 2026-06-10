# Audit complet Mnemosys v0.10.1 → plan v0.11 « Recentrage »

> Audit du 2026-06-09 : 9 agents d'analyse sur zones disjointes + 24 vérifications
> adversariales (0 réfutée) + tour CDP de l'app installée + exécution des suites de
> tests (tsc ✅, Vitest 189/189 ✅, cargo test 295/296 — `apkg::convert_skips_anki_default_deck` ❌).

## 1. Diagnostic global

La qualité d'**exécution** est élevée (migrations blindées, transactions, tests Rust
sérieux, design system OKLCH verrouillé). Le problème est **produit** : 23 « vagues »
de features empilées sans jamais rien retirer.

- **17 entrées de menu** pour 4 jobs réels (créer, réviser, mesurer, configurer) ;
  l'action cœur — réviser — n'a **aucune entrée de menu**, pendant qu'un métronome
  (« Musique ») et un minuteur de poses (« Dessin ») trônent au niveau 1.
- **5 schedulers** dont 4 objectivement inférieurs ou cassés : MEMORIZE plafonne
  mathématiquement à 27 j à vie (2.7/√0.01), Leitner à 30 j, HLR n'est jamais entraîné
  (θ codé en dur = doublement exponentiel qui ignore Hard/Good/Easy), et les 4 cassent
  silencieusement les tiers mastery/badges (indexés sur la stabilité FSRS).
- **11 interruptions possibles** dans une session de révision ; jusqu'à 7 interactions
  et 14 boutons pour noter une carte nouvelle, tout activé.
- **~5 800 LOC mortes ou placebo vérifiées** : pipeline JOL mort-né (bootstrap
  circulaire — le prompt qui crée les prédictions ne s'ouvre que s'il en existe déjà),
  dashboard de calibration qui promet des stats ne pouvant jamais arriver, toggle
  « Garde-attention webcam » dont la feature (webgazer) a été supprimée, slider de
  rétention globale jamais consulté par le scheduling, sync Supabase cassé au niveau
  protocole (remote_id jamais réécrit, l'historique de reviews ne serait JAMAIS pushé).

## 2. Bugs confirmés (sélection, tous vérifiés ligne à ligne)

| Sév. | Bug | Localisation |
|---|---|---|
| CRIT | Pas de ré-apprentissage intra-session : « Encore » sur une carte neuve → due demain (pas de learning steps) | fsrs/scheduler.rs:275 + file de session |
| CRIT | JOL différé mort-né (bootstrap circulaire) + boucle de réouverture du modal | DelayedJolPrompt.tsx:54-75, db/metacognition.rs:196 |
| CRIT | CalibrationDashboard inatteignable (exige 30 JOL résolus, chaîne morte) | CalibrationDashboard.tsx:96 |
| CRIT | Hotkeys actives derrière le modal MovementBreak : Échap quitte la session, 1-4 notent à l'aveugle | ReviewSession.tsx:606 |
| CRIT | Palais 3D : mode review sans soumission FSRS (« preview » depuis la V9) + ~74 Mo de deps three.js | PalaceReview.tsx:7-9 |
| CRIT | Sync Supabase : ACKs jetés, remote_id jamais persisté, reviews jamais pushées | sync/cycle.rs:117-120, delta.rs:148 |
| HIGH | Confiance « prospective » CBM rendue APRÈS le flip (donnée scientifiquement invalide) + colonne `reviews.confidence` write-only | ReviewControls.tsx:99-129 |
| HIGH | Rétention cible globale = placebo (per-deck override systématique, create_deck hardcode 0.9, boot ignore settings.json) | review.rs:109,151 ; decks.rs:42 ; app_state.rs:40 |
| HIGH | Optimiseur FSRS synchrone → gèle l'app 5-30 s | fsrs_optimizer.rs:71 |
| HIGH | Jour UTC partout (stats, heatmap, streak, wellness) : faux après minuit pour un utilisateur français | stats.rs:84, reviews.rs:156/180, gamification.rs:105/127 |
| HIGH | Aucun backup réel : l'export JSON omet état FSRS + historique | io.rs:27-31 |
| HIGH | Échap contourne la confirmation de sortie de session | ReviewSession.tsx:648 |
| HIGH | Toggle « Garde-attention (webcam) » placebo (webgazer supprimé, flag consommé nulle part) | ReviewSettingsSection.tsx:358 |
| HIGH | Animations Radix mortes (tailwindcss-animate jamais installé) + FOUC thème à chaque lancement + lang="en" | ui/dialog.tsx:18, index.html:2 |
| HIGH | Hint Whisper codé en dur "fr", voix TTS "nova" en dur dans Lecture, language_mode décoratif | ReviewCard.tsx:565, ReadingImport.tsx:313 |
| MED | « Continuer » contourne le quota quotidien de nouvelles cartes | ReviewSession.tsx:256 |
| MED | Self-explanation : gate `card.id % 5` = toujours les MÊMES 20 % de cartes, texte jeté | ReviewSession.tsx:716-720 |
| MED | Pre-questioning IA systématiquement en erreur en session entrelacée (deckId=-1) | ReviewSession.tsx:690 |
| MED | Chargement démo : 835 transactions au lieu de 4 | demo.rs:99-103 |
| MED | settings.json corrompu → reset silencieux (clés API incluses) | settings.rs:282 |
| MED | Conversion HLR↔FSRS faussée ×6.6 (demi-vie ≠ stabilité@90%) | scheduler/mod.rs:307-315 |
| MED | 2 dialogs d'aide concurrents + raccourci « E » documenté inexistant | App.tsx:191, ShortcutsHelpDialog.tsx:51 |
| MED | Test cassé sur clone frais : `apkg::convert_skips_anki_default_deck` + lint rouge (221 erreurs CRLF, pas de .gitattributes) | apkg/tests.rs:435 |

## 3. Méthodes d'apprentissage : verdict scientifique

**Conservées (les plus puissantes, faible friction)** :
1. **FSRS-6 + rétention par deck** — gagne tous les benchmarks open-spaced-repetition. Scheduler UNIQUE désormais.
2. **Ré-apprentissage intra-session** (ajouté) — une carte « Encore » revient dans la même session ; le plus gros manque vs Anki.
3. **Saisie de la réponse** (generation effect, d≈0.40) — déjà la meilleure option du code ; absorbe la réponse vocale (bouton micro) et couvre le pretesting sur cartes neuves.
4. **Entrelacement** (Rohrer & Taylor ×2) — devient le comportement par défaut du bouton « Réviser » global, plus une page à part.
5. **Confiance 1-5 + calibration** (CBM) — réparée : capturée AVANT le flip, branchée sur le dashboard de calibration (à la place du pipeline JOL mort). UNE seule échelle.

**Supprimées (redondantes, cassées ou hors-sujet)** : SM-2, Leitner, HLR, MEMORIZE,
JOL différé, double strip rétrospectif, auto-explication, pré-questionnement LLM,
pré-test séparé, garde-attention webcam, bilan humeur/sommeil, pauses mouvement,
soupirs cycliques, chronotype, métronome/ear-training, dessin gestuel, Major System,
palais 3D (review non câblée), graphe en page dédiée, page Succès dédiée.

**Reléguées en Labs (un seul endroit, désactivées par défaut)** : croquis avant flip,
mode mains-libres, podcast de deck, son ambiant (discret, conservé tel quel).

## 4. Architecture cible v0.11

**Navigation : 6 entrées** (au lieu de 17)
```
Accueil        – hero « X cartes à réviser » + decks + streak
Réviser        – session globale immédiate (tous decks dus, entrelacée, quotas)
Créer          – onglets : IA / Capture OCR / Vocabulaire / Imports (apkg, srt, json)
Langues        – onglets : Lecture / Shadowing / Prononciation
Statistiques   – onglets : Vue d'ensemble / Calibration / Succès / Graphe
Paramètres     – onglets : Apparence / Révision / IA & Audio / Rappels / Données / Labs / À propos
```

**Backend** : migration v19 (tous les decks → fsrs6 via conversion P073 corrigée),
optimiseur async, jour local, export/import v2 avec état FSRS + historique
(vrai backup), suppression sync + JOL + wellness + palaces + commandes mortes,
~89 → ~55 commandes IPC.

**Review** : plein écran (sans sidebar), carte plus grande, Échap = confirmation,
un seul dialog d'aide, file de ré-apprentissage intra-session, max UNE interruption
par carte (confiance optionnelle pré-flip).

**Design** : animations Radix ressuscitées (tw-animate-css), FOUC supprimé
(script pré-paint), lang=fr, favicon brandé, retour aux tokens (success/warning/
destructive) dans les composants « Vagues », PageHeader unifié, un seul système de toasts.
