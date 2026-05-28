# Test Checklist — Mnemosys (Sessions 1-4 + Vagues 1-13)

Procédure pas-à-pas pour valider que tout marche sur ta machine. Coche les cases au fur et à mesure. Si quelque chose cloche, descends dans la section **Bugs à reporter** en bas.

> Les sections **0-9** couvrent le cœur Session 1. Les sections **10-12** couvrent les Sessions 2-4. Les sections **13-26** couvrent les Vagues 1-13. Beaucoup de features Vague sont **opt-in** : pense à activer le toggle correspondant dans les Paramètres avant de tester.

> Convention : `[ ]` à cocher, `→` = action attendue, `=>` = ce que tu dois observer.

---

## 0. Setup

- [ ] `cd /home/moi/Bureau/memoire/mnemosys`
- [ ] Vérifie que tu as Node 22+ : `node -v`
- [ ] Vérifie que tu as pnpm 9+ : `pnpm -v`
- [ ] `source "$HOME/.cargo/env"` (rend `cargo` dispo dans le shell courant)
- [ ] `cargo --version` => `cargo 1.81+` au moins
- [ ] `pnpm install` complète sans erreur
- [ ] `pnpm tauri:dev` lance — **le premier build Rust prend ~5 min, c'est normal**
- [ ] La fenêtre **Mnemosys** (1280×800, centrée) s'ouvre

> Si la fenêtre ne s'ouvre pas mais le terminal indique « backend ready » : tu n'as pas de display GTK actif. Vérifie `$DISPLAY` ou lance via X/Wayland.

---

## 1. First-run wizard

- [ ] Au tout premier lancement, un wizard plein écran **« Bienvenue dans Mnemosys »** s'affiche avec une barre de progression en haut
- [ ] Slide 1 (Sparkles) : titre + sous-titre + texte explicatif
- [ ] Clique **« Suivant »** → slide 2 (Brain) sur FSRS-6 (animation de glissement vers la gauche)
- [ ] Clique **« Précédent »** → retour slide 1 (glissement vers la droite)
- [ ] Avance jusqu'au slide 3 (Wand) : 2 boutons (Créer mon propre deck / Charger les decks démo)
- [ ] Clique **« Charger les decks démo »** → spinner brièvement puis toast **« 4 decks ajoutés »**
- [ ] Le wizard se ferme automatiquement
- [ ] Tu vois la page d'accueil avec **4 deck cards**

> Si tu rates le wizard, va dans **Paramètres → À propos** → bouton de relecture.

---

## 2. Home (decks)

- [ ] Header : `Mes decks` à gauche + bouton **« + Nouveau deck »** en haut à droite
- [ ] Section **« Aujourd'hui »** avec 3 mini-stats : Reviews dues / Nouvelles / Rétention
- [ ] Grille de 4 deck cards :
  - [ ] Vocabulary EN→FR
  - [ ] Capitales du monde
  - [ ] Fondamentaux JavaScript/TypeScript
  - [ ] Biologie cellulaire
- [ ] Chaque deck card affiche une couleur, un nombre de cartes, des badges colorés par état (new/learning/review)
- [ ] Hover sur un deck → légère élévation (translation `y: -2px`)
- [ ] Menu kebab (`...`) sur chaque deck → Étudier / Modifier / Supprimer
- [ ] Click sur le corps d'un deck (ou Enter au clavier) → navigation vers `/decks/<id>`

---

## 3. Deck detail

(prends *Vocabulary EN→FR* comme cobaye)

- [ ] Header : swatch de couleur + nom + description + « Rétention cible : 90% »
- [ ] 3 boutons : **Étudier** (primary), **Nouvelle carte** (outline), **Modifier le deck** (outline)
- [ ] Stat ribbon 4 cards : `Total cartes` / `Dues aujourd'hui` / `Nouvelles` / `En apprentissage`
- [ ] Tabs : **Cartes** (actif par défaut) + **Paramètres**
- [ ] Liste paginée des cartes — chaque ligne a un Front preview, un template badge, un state badge
- [ ] Pagination en bas (chevrons gauche/droite) si > 25 cartes
- [ ] Barre de recherche : tape **« house »** → après ~300 ms de debounce, la liste filtre les notes contenant le mot
- [ ] Bouton **« Effacer »** apparaît à côté → click → la recherche se vide

---

## 4. Création d'une carte

- [ ] Depuis le détail du deck, click **« + Nouvelle carte »**
- [ ] Tu arrives sur `/decks/<id>/new-card`
- [ ] 3 tabs visibles : **Basic** / **Basic + Reverse** / **Cloze**

### 4a. Basic

- [ ] Tab Basic actif par défaut, 2 textareas (Front, Back) + champ Tags
- [ ] Remplis Front = `Quelle est la capitale du Japon ?`, Back = `Tokyo`
- [ ] Ajoute le tag `geo` → tape `geo` puis Entrée → un Badge bleu apparaît
- [ ] Click **« Ajouter »** (ou Ctrl+Entrée) → toast **« Carte ajoutée — 1 carte créée »**
- [ ] Retourne au détail du deck → la carte apparaît dans la liste, total +1

### 4b. Basic + Reverse

- [ ] Tab **Basic + Reverse** → bandeau d'info « Génère deux cartes »
- [ ] Remplis Front/Back, valide → toast **« 2 cartes ont été créées »**
- [ ] Détail du deck → total +2

### 4c. Cloze

- [ ] Tab **Cloze** → layout 2 colonnes : éditeur à gauche, **Aperçu** live à droite
- [ ] Tape : `Le {{c1::ATP}} est la monnaie énergétique de la {{c2::cellule}}.`
- [ ] L'aperçu affiche les mots masqués (en gris ou caché selon l'implémentation)
- [ ] Sous le bouton : « 2 cloze(s) détecté(s) »
- [ ] Valide → toast indique « 2 carte(s) cloze créée(s) »

### 4d. Validation

- [ ] Vide Front et Back, click Ajouter → toast d'erreur rouge **« Front et Back sont obligatoires »**
- [ ] En tab Cloze, tape un texte sans `{{cN::…}}` → toast **« Ajoute au moins un {{c1::texte}} »**

---

## 5. Session de review (LE CŒUR)

- [ ] Retourne sur un deck, click **« Étudier »**
- [ ] Navigation vers `/review/<id>`, barre de progression en haut (1/N), chrono qui démarre
- [ ] Première carte affichée en grand, **recto seul**
- [ ] Bouton « Voir la réponse » + indication `Espace`
- [ ] Presse **Espace** → flip animé, le verso apparaît sous le recto
- [ ] 4 boutons couleur : Again (rouge) / Hard (orange) / Good (vert) / Easy (bleu)
- [ ] Sous chaque bouton : preview interval `+Xj` ou `+Xmn`
- [ ] Touche `1` → toast (si erreur) ou carte suivante (si succès)
- [ ] Click souris sur **Good** → carte suivante, barre avance
- [ ] Presse `?` → dialog **Raccourcis clavier** s'ouvre (le local de la session, plus dense que le global)
- [ ] Ferme avec Escape (ou click backdrop)
- [ ] Touche `S` → carte courante suspendue, toast « Carte suspendue », passage à la suivante
- [ ] Touche `E` → navigation vers l'éditeur (en Session 1 c'est encore l'éditeur de création, ne te formalise pas)
- [ ] Reviens et termine **5 cartes minimum** avec différents ratings
- [ ] Quand le paquet est vide : **écran de fin** avec **confetti**, stats récap (nb reviewed, accuracy %, durée)
- [ ] Bouton « Retour au deck » fonctionne

---

## 6. Stats dashboard

- [ ] Dans la sidebar, click **Stats** (icône BarChart)
- [ ] Header : `Statistiques` + sous-titre + **PeriodSelector** à droite (7j / 30j / 90j / 1 an)
- [ ] **Today card** : 4 KPIs (Reviews dues / Reviews faites / Nouvelles / Rétention %)
- [ ] **Heatmap GitHub-style** :
  - [ ] 53 colonnes × 7 lignes (1 an)
  - [ ] Cases grises si aucune activité ce jour-là
  - [ ] Cases vertes (intensité variable) sur les jours où tu as fait des reviews
  - [ ] Hover sur une case → tooltip avec date + nb de reviews
- [ ] **Reviews par jour** (bar chart) : barres sur les jours actifs
- [ ] **Rétention par jour** (line chart) : ligne sur le ratio correct/total
- [ ] Click **« 7j »** dans le PeriodSelector → les deux charts re-fetchent et resserrent leur axe X
- [ ] Si tu n'as encore *jamais* révisé : un callout `« Pas encore assez de données »` s'affiche en bas avec un CTA vers les decks

---

## 7. Settings

- [ ] Sidebar → **Settings** (icône engrenage)
- [ ] 4 sections empilées : **Apparence** / **Réglages des révisions** / **Données** / **À propos**

### 7a. Apparence

- [ ] 3 boutons : Light / Dark / System
- [ ] Click **Dark** → l'UI passe en thème sombre **instantanément** (pas besoin de Save)
- [ ] Click **System** → suit le thème de l'OS

### 7b. Réglages des révisions

- [ ] Slider **Rétention cible** : déplace de 90% vers 95% → la valeur affichée se met à jour en temps réel
- [ ] Inputs **Nouvelles cartes par jour** (1-200) et **Reviews par jour** (10-1000)
- [ ] Switch **Afficher les intervalles dans les boutons** — toggle
- [ ] Bouton **Sauvegarder** désactivé tant que rien n'a bougé
- [ ] Modifie une valeur → bouton activé → click → toast **« Paramètres enregistrés »**

### 7c. Données — Export

- [ ] Liste des decks avec checkbox par deck
- [ ] Lien **« Tout sélectionner »** en haut à droite de la liste
- [ ] Sélectionne 1 deck → click **« Exporter la sélection »**
- [ ] File picker natif s'ouvre, suggère `mnemosys-export-YYYY-MM-DD.json`
- [ ] Sauvegarde → toast **« Export réussi — N notes exportées dans <fichier> »**

### 7d. Données — Import

- [ ] Click **« Importer un fichier Mnemosys (.json) »**
- [ ] File picker natif filtré sur `.json`
- [ ] Choisis le fichier que tu viens d'exporter
- [ ] Toast **« Import terminé — 0 deck importés (1 deck ignoré : <nom>) »** (car déjà existant localement)
- [ ] (Optionnel) Renomme le deck dans le JSON et réimporte → cette fois il rentre

### 7e. À propos

- [ ] Version `v0.1.0` affichée
- [ ] Bouton **« Rejouer le wizard de bienvenue »** → click → le wizard réapparaît au prochain refresh

---

## 8. Raccourcis globaux + theme persistant

- [ ] Depuis n'importe quelle page (pas pendant un input focus), presse `?` → ShortcutsHelp s'ouvre (le **global**, avec 4 sections)
- [ ] Ferme avec Escape
- [ ] Presse `g` puis `h` (dans les 800 ms) → navigation vers Home
- [ ] `g` puis `s` → Stats
- [ ] `g` puis `p` → Settings
- [ ] Toggle theme via le bouton **Dark mode / Light mode** en bas de la sidebar
- [ ] **Ctrl+R** ou ferme/relance l'app → le thème est persisté

---

## 9. Edge cases

- [ ] Sur le formulaire de nouvelle carte : laisse tout vide, click Ajouter → toast d'erreur (Front/Back obligatoires)
- [ ] Crée un deck avec un nom déjà existant (ex : `Vocabulary EN→FR`) → toast d'erreur (unique constraint)
- [ ] Sur la Home, menu kebab d'un deck → **Supprimer** → AlertDialog de confirmation → confirme → le deck disparaît, toast **« Deck supprimé »** et les cartes sont supprimées en cascade (vérifie : Stats → reviews_done_today n'a pas changé mais le deck n'est plus là)

---

## Performance subjective

- [ ] L'app boot et affiche la Home en **< 5 s** (hors premier build Rust)
- [ ] La navigation entre pages est **quasi-instantanée**
- [ ] Pendant une session de review, le flip se fait sans lag (< 100 ms entre Espace et l'apparition du verso)
- [ ] Le drag du slider rétention reste fluide à 60 fps
- [ ] La heatmap (365 cases) se rend sans freeze

---

## Bugs à reporter

Pour chaque bug trouvé, copie-colle ce template et remplis :

```
### Bug #1 — <titre court>

**Description** :


**Étapes pour reproduire** :
1.
2.
3.

**Comportement attendu** :


**Comportement observé** :


**Logs / erreurs** :
- Console DevTools (clic droit dans la webview → *Inspect Element* → onglet Console) :
- Terminal `pnpm tauri:dev` :

**Captures d'écran** : (optionnel)

**Environnement** :
- OS :
- Version Mnemosys : 0.1.0
- Display server (Linux) : X11 / Wayland
```

---

## 10. Session 2 — Génération IA, TTS, APKG, image-occlusion, reset_card

### 10.1 Génération IA

- [ ] Sans clé Anthropic : page **Génération IA** s'affiche, mais cliquer « Générer » → toast clair *« Clé API manquante »* + lien vers Settings
- [ ] Avec clé Anthropic configurée dans **Paramètres → Intégrations** : « Générer » avec un texte (≥ 100 caractères) renvoie au moins 1 carte en < 15 s
- [ ] Onglet PDF : choisir un PDF court → texte extrait → génération OK
- [ ] Chaque carte brouillon est éditable (recto/verso/cloze) ; cliquer le `×` la retire
- [ ] « Valider et créer N cartes » → toast récap + redirection vers le deck cible → les cartes sont bien créées (vérifier en passant en review)

### 10.2 TTS (synthèse vocale)

- [ ] Sans clé OpenAI : bouton 🔊 cliqué → toast clair *« Clé API manquante »*
- [ ] Avec clé OpenAI : 🔊 sur la face d'une carte joue l'audio en < 5 s la 1re fois
- [ ] Re-cliquer le même bouton est instantané (cache hit)
- [ ] Changer la voix dans **Paramètres → Intégrations** modifie la voix utilisée pour les prochains clics
- [ ] **Paramètres → Cache TTS** affiche la taille en Kio/Mio ; bouton « Vider le cache » remet à 0 o
- [ ] Sur une carte cloze, le bouton 🔊 strip les marqueurs `{{c1::…}}` côté question, les remplace côté réponse

### 10.3 Import APKG

- [ ] **Paramètres → Données → « Importer un paquet Anki (.apkg) »** ouvre le file picker filtré sur `.apkg`
- [ ] Import d'un `.apkg` Basic + Cloze réel → toast récap avec N decks / M notes / K cartes
- [ ] Re-importer le même fichier → skip wholesale (deck name déjà existant) → mentionné dans le toast
- [ ] Modèles non supportés (custom Anki) sont comptés en `notes_skipped` et signalés
- [ ] Les cartes importées partent en `new` (l'historique Anki est dropped)

### 10.4 Image-occlusion

- [ ] Onglet **« Image-occlusion »** dans NoteEditor → bouton « Choisir une image » ouvre le file picker (PNG/JPG)
- [ ] Image affichée dans le canvas, dessiner 3 rectangles → 3 masques numérotés apparaissent
- [ ] Saisir un label pour chaque masque ; bouton « Supprimer » retire un masque
- [ ] « Créer N cartes » → 3 cartes créées dans le deck, l'image est copiée vers `~/.local/share/com.mnemosys.app/occlusion-media/`
- [ ] En review d'une carte image-occlusion : avant flip, tous les masques sont tracés, celui de la carte courante est saturé ; après flip, l'image entière est révélée + label

### 10.5 Reset card

- [ ] Detail d'un deck → carte non-`new` → menu `⋯` → **« Réinitialiser (FSRS) »** visible
- [ ] Confirmation → toast → l'état repasse en `new`, stability/difficulty/next_review effacés
- [ ] Stats → la review historique de cette carte est conservée (les compteurs `reviews_done_today` ne changent pas)

---

## 11. Session 3 — Sync cloud (scaffolding)

- [ ] Sans `supabase_url` configurée : **Paramètres → Synchronisation cloud** affiche le message *« La sync cloud est désactivée »* + champ URL
- [ ] Renseigner une URL fictive + clé anon → champs email/password + bouton « Se connecter »
- [ ] « Se connecter » avec credentials invalides → toast d'erreur métier (pas de crash)
- [ ] Si tu as un vrai projet Supabase : login OK → email affiché + bouton « Se déconnecter » + « Synchroniser maintenant »
- [ ] `cd src-tauri && cargo test sync` : tous les tests LWW / delta / apply passent

---

## 12. Session 4 — FSRS Optimizer + CI + License

- [ ] Avec < 1000 reviews dans la DB : **Paramètres → Optimizer FSRS** affiche le message « Continue tes révisions, l'optimizer demande au moins 1000 reviews »
- [ ] Avec ≥ 1000 reviews : bouton « Calibrer FSRS » + warning sur l'impact
- [ ] Cliquer le bouton recalcule les 21 paramètres et toast récap (les futures sessions utilisent les nouveaux params)
- [ ] `LICENSE` à la racine contient le texte MIT et la mention `2026 Mnemosys contributors`
- [ ] `README.md` mentionne « MIT (see LICENSE) » dans la section License
- [ ] `.github/workflows/ci.yml` est syntaxiquement valide (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`)
- [ ] CI : pushed le repo sur GitHub, vérifier que les jobs `frontend`, `backend`, `build` (matrix linux/macos/windows) tournent et passent
- [ ] `tauri-plugin-updater` est configuré dans `tauri.conf.json` avec un endpoint placeholder ; pas d'erreur au boot de l'app

---

## 13. Vague 1 — Gamification éthique (streaks, succès, maîtrise)

- [ ] Sidebar → **« Succès »** ouvre la page `/achievements`
- [ ] Termine une review aujourd'hui → le **streak** affiche au moins `1 jour`
- [ ] Au moins un **badge** est débloqué (ex. *première review*) après ta première session
- [ ] La page indique l'inventaire de **freezes** restants ce mois (2 par défaut)
- [ ] Utiliser un freeze (si l'UI l'expose) décrémente le compteur ; il **ne descend jamais sous 0**
- [ ] La **maîtrise d'un deck** progresse (5 stages WaniKani) à mesure que ses cartes mûrissent
- [ ] Aucun classement public, aucun compte à rebours punitif (vérif. White Hat)

---

## 14. Vague 2 — Modes cognitifs (type-the-answer, confidence, pré-questions)

> Toggles dans **Paramètres → Réglages des révisions → Modes cognitifs**. Sauvegarde après chaque changement.

- [ ] Active **Type-the-answer** → en review, un champ de saisie apparaît avant le flip ; taper puis valider compare ta réponse (scoring fuzzy)
- [ ] Active **Évaluation de confiance** → avant les boutons FSRS, on te demande une confiance 1-5 ; la valeur est stockée (colonne `reviews.confidence`)
- [ ] Active **Pré-questionnement IA** (clé Anthropic requise) → au début d'un nouveau bloc, des questions d'amorçage s'affichent
- [ ] Désactive les trois → la review redevient le flux classique (recto → flip → rating)

---

## 15. Vague 3 — Modes neuro (opt-in)

> **Paramètres → Modes neuro (opt-in)** ; master switch `data-testid="neuro-master-switch"`.

- [ ] Master **off** par défaut : les sous-toggles (mood, mouvement, sighing) sont **désactivés** (grisés)
- [ ] Active le master → les sous-options deviennent réglables
- [ ] Active **Mood / Sleep check-in** → au début d'une session, un modal 5 questions (humeur, sommeil, stress, hydratation, caféine) s'affiche **une fois par jour**
- [ ] Skipper le check-in est possible (champs NULL-ables) sans bloquer la session
- [ ] Règle le **Movement break** à 10 min → un rappel de pause apparaît après ce délai en session
- [ ] Active **Cyclic sighing** → la séquence respiratoire est proposée quand le stress est flaggé élevé

---

## 16. Vague 4 — Schedulers pluggables par deck

- [ ] **Nouveau deck** → section *Algorithme de scheduling* propose **FSRS-6** (badge recommandé), **SM-2**, **Leitner 5-box**
- [ ] Crée un deck en **Leitner** → un badge `Leitner` apparaît sur la carte du deck
- [ ] Révise une carte Leitner : une réussite la fait monter d'une boîte, **Again** la renvoie en boîte 1
- [ ] Crée un deck en **SM-2** → badge `SM-2`, comportement ease-factor
- [ ] **Modifier le deck** permet de changer l'algorithme ; l'historique des reviews est **conservé**

---

## 17. Vague 5 — Review entrelacée + Élaboration IA

- [ ] Sidebar → **« Review entrelacée »** (`/review-interleaved`)
- [ ] Sélectionne **≥ 2 decks** → lance → les cartes dues sont **mélangées** dans une seule file (pas deck par deck)
- [ ] Pendant une review, demander **Why?** / **Example** (clé Anthropic) affiche une explication / des exemples générés
- [ ] Si Claude ne renvoie rien d'exploitable, le bloc reste vide **sans erreur bloquante**

---

## 18. Vague 7 — Sketch-before-flip

> Toggle **« Dessin avant flip (drawing effect) »**.

- [ ] Active le toggle → en review, un **canvas de dessin** apparaît sous la question (recto)
- [ ] Dessine quelque chose à la souris/au stylet → trace visible
- [ ] Retourne la carte (Espace) puis note → le croquis est **persisté** (table `review_sketches`, keyé par `review_id`)
- [ ] Rouvre la même carte plus tard → les **croquis passés** sont consultables
- [ ] Toggle off → plus de canvas, review classique

---

## 19. Vague 7 — Prédictions JOL différées + Calibration Dashboard

> Toggle **« Prédictions de rappel différées (JOL) »** ; délai réglable (5-120 min, défaut 30).

- [ ] Active le toggle → après une review, ~30 min plus tard une **relance JOL** demande une probabilité de réussite
- [ ] La prédiction donnée est enregistrée (`jol_predictions`, `actual_correct = NULL` au départ)
- [ ] À la **prochaine review réelle** de la carte, la prédiction est **résolue** (`actual_correct` passe à 1/0)
- [ ] Dans **Stats**, tant que `< 30` prédictions résolues : message *« N / 30 prédictions résolues »*
- [ ] À **≥ 30** résolues : la carte **« Calibration métacognitive »** affiche **γ (Gamma)**, **Biais** (+ = surconfiance), **Résolues**
- [ ] L'**histogramme 10 bandes** montre prédit (bleu) vs réel (vert = calibré / rouge = surconfiance) avec l'effectif `n`
- [ ] L'interprétation de γ s'affiche (≥0,5 excellente / ≥0,2 bonne / ≥0 modérée / <0 inverse)

---

## 20. Vague 8 — Deck Podcast

> Nécessite clés **Anthropic + OpenAI**. Le deck doit avoir **≥ 3 cartes**.

- [ ] Sur la **Home**, menu `⋯` d'un deck (≥3 cartes) → **« Podcast »** ouvre le dialogue
- [ ] Sans clés : « Générer » → toast *« Clés API manquantes »* + renvoi vers Settings
- [ ] Choisis un **format** (Deep Dive / Brief / Critique) et **2 voix différentes** (Host + Expert)
- [ ] Choisir **deux fois la même voix** → message d'erreur + bouton « Générer » bloqué
- [ ] « Générer » (~30-60 s) → l'épisode se joue **inline** + apparaît dans **« Épisodes précédents »**
- [ ] Re-générer le même couple format+voix → toast *« Podcast déjà en cache »* (cache hit)
- [ ] **« Télécharger »** → file picker → le `.mp3` est copié à l'emplacement choisi
- [ ] La corbeille supprime l'épisode du cache (`<app_cache_dir>/podcasts/`)

---

## 21. Vague 8 — Whisper Mode (réponse vocale)

> Toggle **« Réponse vocale (Whisper) »** ; clé **OpenAI** requise ; cartes basic/basic_reverse.

- [ ] Active le toggle → en review d'une carte basic, un bouton **« Enregistrer »** (micro) s'affiche
- [ ] 1er clic → demande d'accès **micro** ; refuser → toast clair, retour à l'état idle
- [ ] Autoriser + parler → chrono qui défile ; **« Arrêter »** lance la transcription
- [ ] L'enregistrement se **coupe automatiquement à 10 s**
- [ ] Sans clé OpenAI → toast *« Clé API manquante »*
- [ ] La transcription Whisper est **comparée** à la réponse attendue (scoring fuzzy, comme Type-the-answer)

---

## 22. Vague 9 — Memory Palace 3D

- [ ] Sidebar → **« Memory Palaces »** → **« Nouveau palace »** → nom + template (Maison / Rue / Château) → créé
- [ ] Ouvrir le palace → éditeur 3 colonnes (decks à gauche, scène 3D au centre, loci à droite)
- [ ] **Cliquer sur le sol sans carte sélectionnée** → toast *« Sélectionne une carte d'abord »*
- [ ] Sélectionne une carte à gauche → **clique sur le sol** → une **sphère numérotée** apparaît + toast *« Locus placé »*
- [ ] Une carte déjà épinglée **disparaît** de la liste de gauche (pas de doublon dans ce palace)
- [ ] Colonne droite : les flèches **↑/↓** réordonnent le parcours, la **corbeille** retire un locus
- [ ] **« Mode review »** (actif dès ≥1 locus) → scène en mode parcours
- [ ] **Z/Q/S/D** (ou W/A/S/D, ou flèches) déplacent ; **clic gauche maintenu + glisser** oriente la caméra
- [ ] Le **locus courant est surligné en doré** ; cliquer dessus révèle la carte
- [ ] (Environnement sans WebGL) → fallback *« Scene 3D indisponible »* au lieu d'un crash

---

## 23. Vague 10 — Mode Langue

- [ ] **Nouveau/Modifier deck** → sélecteur **Langue** (Français/English/Español/Deutsch/Italiano/日本語/中文/Aucune)
- [ ] Avec une langue active → la page du deck affiche la **carte de couverture de fréquence**
- [ ] Éditeur de carte → onglet **« Phrase »** : champs *Phrase (langue cible)*, *Traduction*, *Indice*, *Bande de fréquence*
- [ ] Valider une carte Phrase → **2 cartes** créées (L2→L1 et L1→L2)
- [ ] Taguer des notes avec des bandes (Top 100 / Top 1k / … / Au-delà) → la **barre de couverture** se colore (vert→orange, gris = non taggé)

---

## 24. Vague 11 — Subtitle Import + Knowledge Graph

- [ ] **Paramètres → Données → « Sous-titres (sentence mining) »** : sélecteur de deck + sélecteur de mode
- [ ] Mode **« Phrase basique (recto/verso) »** → import d'un `.srt` → chaque réplique devient une carte recto/verso
- [ ] Mode **« Cloze auto (mot le plus long) »** → import d'un `.vtt` → chaque réplique devient une cloze (mot le plus long masqué)
- [ ] Le file picker est **filtré sur `.srt` / `.vtt`** ; toast récap après import
- [ ] Sidebar → **« Graphe »** (`/graph`) → graphe de co-occurrence de tags s'affiche
- [ ] Sélecteur **« Portée »** : *Tous les decks* vs un deck précis → le graphe se recharge
- [ ] **Survoler un tag** met en évidence ses connexions

---

## 25. Vague 12 — Pretest, Self-explanation, Focus Guard

> Toggles dans **Paramètres → Réglages des révisions → Modes cognitifs**.

- [ ] Active **Mode pré-test** → sur une carte **neuve**, on t'invite à deviner la réponse avant de la révéler (même si tu te trompes)
- [ ] Active **Auto-explication** → sur **~1 carte sur 5**, après le flip, un champ demande *« pourquoi est-ce la réponse ? »* (texte libre, non noté)
- [ ] Active **Focus Guard** → au premier lancement, **consentement webcam** explicite demandé
- [ ] Refuser le consentement → la session continue normalement, sans tracking
- [ ] Accepter → la webcam s'active pendant la session ; vérifier (DevTools réseau) qu'**aucune image n'est envoyée** (100 % local)
- [ ] Le décrochage d'attention déclenche une relance visuelle

---

## 26. Vague 13 — Multi-Agent Critic + Aide mnémotechnique

- [ ] Page **Génération IA** → coche **Generator → Critic** avant de générer (clé Anthropic requise)
- [ ] Après génération, chaque brouillon porte un badge **« Qualité X% »**
- [ ] Une carte sous **70 %** est signalée **« à améliorer »** avec une **correction proposée** (applicable en un clic)
- [ ] Si le critic échoue → toast non bloquant, *« les cartes restent utilisables sans score »*
- [ ] Crée une carte et fais-la **rater ≥ 3 fois** (lapses ≥ 3) → son menu `⋯` expose **« Aide mnémotechnique »**
- [ ] Pour une carte à **moins de 3 lapses**, l'item *Aide mnémotechnique* est **absent**
- [ ] Cliquer **« Aide mnémotechnique »** → Claude génère une astuce (image/association/acronyme)

---

## Verdict final

- [ ] Sessions 1–4 + Vagues 1–13 validées → tag de release, packaging, itération de production
- [ ] Bugs mineurs (cosmétiques, edge cases) → tracker, prioriser
- [ ] Bugs critiques (crash, data loss, FSRS incorrect) → bloquant pour la release

---

> Astuce : si tu veux repartir d'une base vierge entre deux passes de test, supprime le fichier `~/.local/share/com.mnemosys.app/mnemosys.db` (Linux) et relance `pnpm tauri:dev`. Le wizard et tout l'état partiront de zéro.
