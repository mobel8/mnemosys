# Guide utilisateur — Mnemosys

Tu viens d'ouvrir Mnemosys pour la première fois ? Ce document te guide de zéro à « première session de review réussie » en moins de 10 minutes, puis te donne les clés pour exploiter chaque fonctionnalité.

---

## Démarrage rapide

### Premier lancement

1. Lance l'app avec `pnpm tauri:dev` (ou exécute le binaire après `pnpm tauri:build`).
2. Un **wizard de bienvenue** s'affiche, en trois slides :
   - *Bienvenue dans Mnemosys* — pitch en une phrase.
   - *FSRS-6* — l'algo qui décide quand te re-présenter chaque carte.
   - *Comment veux-tu démarrer ?* — deux choix.
3. Clique **« Charger les decks démo »** pour explorer immédiatement avec 835 cartes prêtes (Vocab EN→FR, Capitales du monde, JS/TS, Biologie cellulaire). Tu pourras les modifier ou les supprimer plus tard. Ou clique **« Créer mon propre deck »** pour partir vierge.
4. Tu arrives sur la **Home** : un bandeau « Aujourd'hui » + la grille des decks.

Le wizard ne réapparaît plus ensuite. Tu peux le rejouer depuis **Paramètres → À propos**.

---

## Concepts clés

### Carte « due »

Une carte est *due* lorsque sa date `next_review` est passée. FSRS-6 calcule cette date à chaque review en fonction de :
- l'**état** courant : `new` (jamais vue), `learning` (en apprentissage), `review` (mémorisée), `relearning` (re-vue après un échec) ;
- la **stabilité** (combien de jours avant que la rétention chute sous 90 %) ;
- la **difficulté** (1 = très facile, 10 = très difficile, fonction des ratings passés) ;
- ta **`desired_retention`** (paramètre global — 90 % par défaut).

### Templates de notes

Une *note* contient le **contenu** ; une *carte* en est l'**instance scheduable**. Une seule note peut générer plusieurs cartes.

| Template | Comportement | Cartes générées |
|----------|--------------|-----------------|
| **basic** | Front → Back | 1 |
| **basic_reverse** | Front → Back **et** Back → Front | 2 |
| **cloze** | Texte avec `{{cN::truc}}` masqués un à un | 1 par numéro `cN` distinct |
| **occlusion** | Image avec rectangles masqués (cf. *Image-occlusion*) | 1 par masque |
| **sentence** | Phrase recto/verso pour le sentence mining (cf. *Import de sous-titres*) | 1 |
| **bidirectional** | Phrase langue cible ↔ traduction (onglet *Phrase*, cf. *Mode Langue*) | 2 |
| **illness_script** | Script de maladie médical (onglet *Médecine*, cf. *Modes disciplinaires*) | 1 |
| **refutation** | Carte de réfutation d'une idée reçue (onglet *Sciences*) | 1 |
| **worked_example** | Exemple résolu à étapes révélées (Mode Maths) | 1 |

> Les 6 derniers templates ont chacun leur onglet/contexte dédié dans l'éditeur de carte ou un mode complet — voir les sections correspondantes plus bas. Les 9 valeurs sont validées côté base (contrainte `CHECK` sur `notes.template`).

Exemple cloze :
```
La capitale de la {{c1::France}} est {{c2::Paris}}.
```
Génère 2 cartes :
1. *La capitale de la **[…]** est Paris.* → France
2. *La capitale de la France est **[…]**.* → Paris

Tu peux empiler plusieurs trous avec le même numéro pour les révéler ensemble :
```
{{c1::ATP}} est synthétisée dans la {{c1::mitochondrie}}.
```
→ 1 seule carte qui masque les deux mots simultanément.

### Desired retention

Pourcentage de cartes que tu veux réussir au moment où elles sont dues. Réglage entre **80 %** et **97 %**.

- Plus haut (95 %+) = intervalles plus courts, plus de reviews, moins d'oublis.
- Plus bas (80 %) = intervalles plus longs, moins de reviews, plus d'oublis (que tu rattrapes via les *relearning*).
- **90 % est le sweet spot recommandé** par les études FSRS et Anki.

---

## Workflow type

### Créer un deck

1. Sur la **Home**, clique **« + Nouveau deck »** en haut à droite.
2. Saisis un **nom** (obligatoire, unique), éventuellement une description, et choisis une couleur.
3. La rétention cible du deck hérite de tes paramètres globaux mais peut être ajustée plus tard via *Modifier le deck*.

### Ajouter une carte

1. Ouvre un deck, clique **« + Nouvelle carte »**.
2. Choisis un onglet :
   - **Basic** : remplis Front + Back.
   - **Basic + Reverse** : pareil, mais 2 cartes seront créées.
   - **Cloze** : tape ton texte avec `{{c1::…}}`. Un aperçu live se met à jour à droite.
3. Ajoute des **tags** (10 max) — Entrée ou virgule pour valider chaque tag, Backspace sur une zone vide pour retirer le dernier.
4. Clique **« Ajouter »** (ou Ctrl + Entrée) — toast de confirmation, formulaire reset.
5. **« Ajouter et continuer »** garde les tags et recharge un formulaire vide pour enchaîner.

![screenshot — éditeur de carte](docs/screenshot-card-editor.png)

### Lancer une session de review

1. Depuis la Home ou le détail d'un deck, clique **« Étudier »**.
2. La première carte s'affiche, **recto uniquement**.
3. Réfléchis, puis presse **Espace** (ou clique *« Voir la réponse »*) pour révéler le verso.
4. Note ta performance avec les **4 boutons** :

| Bouton | Touche | À utiliser quand… |
|--------|--------|-------------------|
| **Again** (rouge) | `1` | Tu as oublié ou tu t'es complètement trompé. La carte repasse en `relearning`. |
| **Hard** (orange) | `2` | Tu as réussi mais avec difficulté ou hésitation forte. Intervalle réduit. |
| **Good** (vert) | `3` | Tu as réussi normalement. C'est le rating par défaut. |
| **Easy** (bleu) | `4` | Tu as réussi instantanément et sans effort. Intervalle prolongé. |

Sous chaque bouton, **l'intervalle qui sera appliqué si tu cliques** est affiché (`+3j`, `+12j`, etc.). Tu peux désactiver cet affichage dans Paramètres.

5. La carte suivante s'affiche, la barre de progression avance.
6. À la fin du paquet : écran de récap **avec confetti** — nb de cartes revues, précision, durée totale.

![screenshot — review session](docs/screenshot-review.png)

### Lire les stats

Onglet **Stats** dans la sidebar.

- **Aujourd'hui** : 4 KPIs (reviews dues maintenant, reviews faites, nouvelles cartes vues, rétention du jour).
- **Heatmap GitHub-style** : 1 an glissant, couleur = intensité d'activité.
- **Reviews par jour** (bar chart) et **Rétention par jour** (line chart).
- **Sélecteur de période** en haut à droite : 7j / 30j / 90j / 1 an.
- Si tu n'as encore jamais révisé : message d'accueil + bouton vers les decks.

---

## Raccourcis clavier

### Navigation (depuis n'importe quelle page)

| Raccourci | Action |
|-----------|--------|
| `g` puis `h` | Aller à la Home |
| `g` puis `s` | Aller aux Statistiques |
| `g` puis `p` | Aller aux Paramètres |
| `?` | Ouvrir l'aide raccourcis |

Les séquences `g x` ont un timeout de **800 ms** entre les deux touches. Les raccourcis sont automatiquement désactivés quand le focus est dans un champ texte.

### Session de review

| Raccourci | Action |
|-----------|--------|
| `Espace` | Voir la réponse |
| `1` | Again — j'ai oublié |
| `2` | Hard — difficile |
| `3` | Good — correct |
| `4` | Easy — facile |
| `E` | Éditer la carte courante |
| `S` | Suspendre la carte (skip + ne réapparaît plus) |
| `Esc` | Quitter la session |
| `?` | Afficher cette aide |

### Création de carte

| Raccourci | Action |
|-----------|--------|
| `Ctrl + Entrée` (ou `⌘ + Entrée`) | Ajouter la carte |
| `Entrée` ou `,` (dans le champ Tags) | Valider le tag courant |
| `Backspace` (dans le champ Tags vide) | Retirer le dernier tag |

---

## Paramètres

Onglet **Settings** (icône engrenage) ou `g p`.

### Apparence

- **Theme** : Light / Dark / System. *System* suit la préférence de l'OS et bascule automatiquement.

### Réglages des révisions

| Réglage | Effet |
|---------|-------|
| **Rétention cible** | Curseur 80 %–97 % par pas de 1 %. Plus haut → intervalles plus courts, plus de reviews. Affiche la valeur en % à côté. |
| **Nouvelles cartes par jour** | Cap quotidien sur les cartes en état `new` introduites dans les sessions. 1–200. Défaut : 20. |
| **Reviews par jour** | Cap quotidien sur les cartes en état `review` ou `learning`. 10–1000. Défaut : 200. |
| **Afficher les intervalles** | Switch on/off pour le « +3j » sous chaque bouton Again/Hard/Good/Easy. Aide énormément en apprentissage, peut distraire les experts. |

Les changements ne s'appliquent qu'après le bouton **« Sauvegarder »** — pas d'auto-save pendant que tu bouges les sliders.

### Données

Voir section **Import / Export** ci-dessous.

### À propos

- Version de l'app.
- Bouton **« Rejouer le wizard de bienvenue »** (efface la clé `localStorage` `mnemosys.first_run_completed`).
- Liens projet.

---

## Import / Export

### Format JSON Mnemosys

```jsonc
{
  "version": 1,
  "exported_at": 1716700000000,
  "app": "Mnemosys",
  "decks": [
    {
      "name": "Spanish",
      "description": "Common verbs",
      "color": "#3b82f6",
      "desired_retention": 0.9,
      "notes": [
        {
          "template": "basic",
          "fields": { "front": "hola", "back": "hello" },
          "tags": ["greeting"]
        },
        {
          "template": "cloze",
          "fields": { "text": "La capitale est {{c1::Madrid}}" },
          "tags": []
        }
      ]
    }
  ]
}
```

> L'historique de scheduling (stabilité, difficulté, reviews passées) **n'est pas inclus**. C'est un choix conscient pour rester portable : les decks importés repartent à zéro côté FSRS. Une carte importée se présente comme `new`, exactement comme si tu l'avais tapée à la main.

### Exporter

1. **Paramètres → Données → Exporter**.
2. Coche les decks à exporter (ou clique *« Tout sélectionner »*).
3. Clique **« Exporter la sélection »** (ou *« Tout exporter »*).
4. Choisis un emplacement et un nom dans le file picker natif (par défaut : `mnemosys-export-YYYY-MM-DD.json`).
5. Toast de confirmation : *« N notes exportées dans <fichier> »*.

### Importer

1. **Paramètres → Données → Importer**.
2. Choisis un fichier `.json` Mnemosys.
3. Toast récap : *« N decks, M notes, K cartes importées »*.
4. **Politique de conflit** : un deck dont le nom est déjà présent localement est **ignoré en bloc** (pas de fusion, pas d'écrasement). Les noms ignorés apparaissent dans le toast. Renomme le deck source côté JSON (champ `name`) si tu veux forcer l'import.

### Importer un paquet Anki (.apkg)

1. **Paramètres → Données → « Importer un paquet Anki (.apkg) »**.
2. Choisis un fichier `.apkg` exporté depuis Anki (Fichier → Exporter → format paquet Anki).
3. Toast récap avec le nombre de decks/notes importés, et la liste des decks ignorés (même politique que JSON : nom déjà existant = skip).

**Limitations connues** :
- L'**historique de révisions Anki** est volontairement dropped — toutes les cartes importées repartent en `new`. Ça reflète la philosophie « FSRS prend la décision ; ton historique Anki est SM-2 et n'est pas comparable ».
- Templates supportés : Anki **Basic** → Mnemosys `basic`, **Basic (and reversed card)** → `basic_reverse`, **Cloze** → `cloze`. Les modèles custom Anki sont **comptés comme skipped** et signalés dans le récap.
- Les **médias** (images, audio) embarqués dans le `.apkg` ne sont pas (encore) copiés vers la base Mnemosys. Pour les decks avec beaucoup de médias, prévoir un travail manuel ou attendre une session future.

---

## Génération IA de cartes (Session 2)

Mnemosys peut générer un brouillon de cartes à partir d'un **texte** ou d'un **PDF** via Claude (API Anthropic).

### Configuration

1. Récupère une clé API sur <https://console.anthropic.com/>.
2. **Paramètres → Intégrations → Clés API → Anthropic** → colle la clé → *Enregistrer*.
3. Alternative : définir la variable d'environnement `ANTHROPIC_API_KEY` avant de lancer l'app. La variable d'env a la priorité sur les settings.

### Workflow

1. Sidebar → **Génération IA** (icône ✨).
2. Choisis le **deck cible** (un deck doit exister — sinon va d'abord en créer un sur la Home).
3. Onglet **Texte** : colle ton cours / article / résumé (max 50 000 caractères).
   Onglet **PDF** : clique « Choisir un PDF » et sélectionne un fichier. Le texte sera extrait côté backend (`pdf-extract`).
4. Ajuste **Nombre de cartes max** (1–50, défaut 10) et **Langue** (Français / English / Español).
5. Clique **« Générer »**. Claude renvoie une liste de cartes proposées en quelques secondes.
6. Chaque carte apparaît en **brouillon éditable** : modifie le recto/verso (ou la phrase cloze) à ta guise, ou clique le `×` pour rejeter.
7. Clique **« Valider et créer N cartes »** : les notes sont créées dans le deck cible, l'une après l'autre, et l'app navigue vers le deck.

### Templates supportés

- **basic** → fields `{ front, back }`
- **cloze** → fields `{ text }` avec markers `{{c1::…}}`

(Pour l'instant, l'IA ne génère ni `basic_reverse` ni `occlusion` — ces formats demandent une UI dédiée.)

### Tarification

Le coût dépend du modèle Claude (~10-30 cents pour 10-20 cartes générées sur un texte court). La page n'affiche pas le coût en direct — surveille ta console Anthropic.

---

## Synthèse vocale (TTS)

Un bouton 🔊 apparaît à côté de chaque champ texte (NoteEditor) et de chaque face de carte (ReviewCard). Cliquer lance la synthèse OpenAI et joue le résultat. Les MP3 sont **mis en cache sur disque** — re-cliquer sur le même texte est gratuit.

### Configuration

1. Clé API sur <https://platform.openai.com/api-keys>.
2. **Paramètres → Intégrations → Clés API → OpenAI** → colle la clé → *Enregistrer*.
3. Alternative : variable d'env `OPENAI_API_KEY`.

### Voix disponibles

8 voix OpenAI : **nova** (défaut, neutre), **alloy** (mixte), **echo** (masculine), **fable** (britannique), **onyx** (masculine grave), **shimmer** (féminine douce), **coral** (féminine énergique), **sage** (mixte posée).

Modifiable dans **Paramètres → Intégrations → Synthèse vocale → Voix par défaut**.

### Vitesse

Slider 0.5×–2.0× (défaut 1.0×) dans la même section.

### Cache

Les fichiers MP3 vivent dans `<app_cache_dir>/tts/` (`~/.cache/com.mnemosys.app/tts/` sous Linux). Vidable depuis **Paramètres → Intégrations → Cache TTS → « Vider le cache »**. La taille est affichée en direct.

### Sur les cartes Cloze

Le bouton TTS pour une carte cloze lit **uniquement le texte révélé** — les marqueurs `{{c1::…}}` sont strippés pour la version « question », et remplacés par le contenu pour la version « réponse ».

---

## Image-occlusion

Template idéal pour mémoriser des schémas anatomiques, des maps, des organigrammes : tu charges une image, tu dessines des rectangles à masquer, et chaque rectangle devient une carte distincte.

### Créer une carte image-occlusion

1. Dans un deck → **« + Nouvelle carte »** → onglet **« Image-occlusion »**.
2. Clique **« Choisir une image »** (PNG/JPG).
3. L'image apparaît dans le canvas. **Dessine des rectangles** en cliquant-glissant : chaque rectangle est numéroté (1, 2, 3…) et son label peut être saisi à côté.
4. Tu peux retirer un masque via le bouton « Supprimer » dans la liste de droite.
5. Clique **« Créer N cartes »**. L'image est copiée dans `<app_data_dir>/occlusion-media/` (hash SHA-256 préfixé → import dupe = no-op gratuit).

### Lors d'une review

- **Avant flip** : l'image apparaît avec **tous les masques tracés**, mais celui de la carte courante est **saturé** (rouge translucide) — c'est lui qu'on doit deviner.
- **Après flip** : l'image apparaît **sans masques** (entièrement révélée) + le label de la zone qu'on devait deviner s'affiche en grand.

### Limitations actuelles

- Pas de **drag-to-move** d'un masque déjà placé (à recréer si tu te trompes).
- Pas d'édition d'une carte image-occlusion existante (limite préexistante du `NoteEditor`).
- L'image source n'est pas re-éditable une fois la note créée.

---

## Réinitialiser une carte (FSRS reset)

Une carte « réussie » peut accumuler des paramètres FSRS qui ne correspondent plus à la réalité (parce que tu as modifié son contenu, ou parce que tu veux la réapprendre).

1. **Detail du deck → ligne de la carte → menu `⋯` → « Réinitialiser (FSRS) »**.
2. Confirmation : la carte repasse en `new`, ses champs `stability` / `difficulty` / `next_review` sont effacés.
3. **L'historique des reviews est conservé** (les retention stats restent honnêtes).

L'option n'apparaît que pour les cartes dont l'état est différent de `new` (sinon ça n'aurait rien à faire).

---

## Sync cloud (Session 3 — désactivée par défaut)

Architecture livrée mais **désactivée tant que tu ne configures pas un projet Supabase**. Voir `docs/SESSION_3_SYNC.md` pour les détails techniques (schéma Postgres, RLS, stratégie CRDT LWW, format des deltas).

### Activer

1. Crée un projet Supabase + applique le schéma documenté.
2. **Paramètres → Synchronisation cloud → URL Supabase** → colle l'URL `https://<project>.supabase.co`.
3. Renseigne ta clé `anon`.
4. Crée un compte (email/mot de passe) côté Supabase Auth, puis **« Se connecter »** dans la même section.
5. Bouton **« Synchroniser maintenant »** quand tu veux pousser/tirer (la sync automatique périodique est planifiée pour S4+).

### Limites MVP S3

- Pas de chiffrement E2E (les données vivent en clair dans ton Postgres ; le projet est privé à ton compte par RLS).
- Pas de sync des médias (images d'occlusion, MP3 TTS) — uniquement les rows DB.
- Pas de tombstones de suppression (supprimer un deck en local ne le supprime pas dans Supabase pour l'instant).

---

## Schedulers pluggables par deck (Vague 4)

Chaque deck choisit son **algorithme de planification**. Le défaut est FSRS-6, mais tu peux opter pour deux alternatives historiques, deck par deck.

Le choix se fait à la **création** d'un deck (« + Nouveau deck ») ou via **« Modifier le deck »**, dans la section *Algorithme de scheduling*.

| Algorithme | Pour qui / quand | Comportement |
|------------|------------------|--------------|
| **FSRS-6** (recommandé) | Cas par défaut, le meilleur compromis rétention/effort. | Stabilité + difficulté, 21 paramètres, cible `desired_retention`. |
| **SM-2** | Tu viens d'Anki classique et veux le comportement « ease factor » familier. | Facteur de facilité unique, intervalles multipliés. |
| **Leitner 5-box** | Apprentissage simple, tangible, sans maths cachées. | 5 boîtes : une réussite fait monter d'une boîte, un échec renvoie à la boîte 1. |

Un **badge** sur la carte du deck rappelle l'algorithme actif (`FSRS` / `SM-2` / `Leitner`). Changer d'algorithme n'efface pas l'historique des reviews ; seules les prochaines planifications suivent le nouvel algo.

---

## Review entrelacée (Vague 5)

L'**interleaving** (mélanger des sujets plutôt que les masser par bloc) améliore le transfert et la discrimination (Rohrer & Taylor 2007, gains de 10 à 43 % selon les tâches). Mnemosys propose un mode dédié.

1. Sidebar → **« Review entrelacée »** (icône mélange).
2. Sélectionne **plusieurs decks** à mélanger.
3. Lance la session : les cartes dues de tous les decks choisis sont **brassées** dans une seule file, au lieu d'être révisées deck par deck.

Tout le reste (flip, ratings, raccourcis) est identique à une session classique.

---

## Élaboration IA automatique (Vague 5)

Pendant une review, deux aides facultatives peuvent être générées à la volée par Claude pour la carte courante :

- **Why? (Pourquoi ?)** — une phrase d'*interrogation élaborative* qui explique *pourquoi* la réponse est correcte (effet d'élaboration, McDaniel & Donnelly 1996).
- **Example (Exemple)** — un ou deux exemples concrets pour ancrer le concept.

Ces enrichissements demandent une **clé Anthropic** configurée (Paramètres → Intégrations). Si Claude ne renvoie rien d'exploitable, le bloc reste simplement vide — aucune erreur bloquante.

---

## Sketch-before-flip — dessin avant de retourner (Vague 7)

Dessiner sa réponse **avant** de voir le verso produit un gain de rappel mesuré de **30 à 50 %** (effet de dessin / *drawing effect*, Wammes et al. 2016/2018). C'est l'une des manipulations les plus puissantes de la liste.

### Activer

**Paramètres → Réglages des révisions → Modes cognitifs → « Dessin avant flip (drawing effect) »**.

### Pendant une review

1. La carte s'affiche, recto seul, avec un **canvas de dessin** sous la question.
2. Esquisse ta réponse à la souris / au trackpad / au stylet (un schéma grossier suffit — l'intérêt est l'effort de génération, pas la qualité du trait).
3. Retourne la carte (Espace) puis note-toi normalement.
4. Le croquis est **capturé en PNG et stocké localement** (table `review_sketches`), rattaché à cette review précise. Tu pourras revoir les croquis passés d'une carte.

> Le dessin n'est jamais noté ni envoyé sur le réseau : il sert uniquement à forcer l'encodage actif.

---

## Prédictions de rappel différées (JOL) + Calibration (Vague 7)

Un **Judgment of Learning (JOL)** est ta prédiction de la probabilité de réussir une carte plus tard. Les JOL **différés** (faits ~30 min après l'étude, pas immédiatement) sont le meilleur signal métacognitif connu : la méta-analyse Rhodes & Tauber 2011 (4 554 sujets) mesure une résolution **γ (gamma de Goodman-Kruskal) ≈ 0,93**.

### Activer

**Paramètres → Réglages des révisions → Modes cognitifs → « Prédictions de rappel différées (JOL) »**. Le délai entre la review et la relance est réglable (5 à 120 min, défaut 30).

### Le cycle

1. Tu révises une carte normalement.
2. ~30 min plus tard, l'app te **redemande** : « quelle chance as-tu de réussir cette carte dans X jours ? » → tu donnes une probabilité.
3. À la **prochaine review réelle** de la carte, la prédiction est *résolue* (réussie ou non) et alimente le dashboard.

### Lire le Calibration Dashboard

Dans **Stats**, la carte **« Calibration métacognitive »** apparaît dès que tu as **≥ 30 prédictions résolues**. Elle affiche :

- **γ (Gamma)** — qualité de ton *classement* (sais-tu distinguer ce que tu sais de ce que tu ne sais pas ?). Interprétation : `≥ 0,5` excellente · `≥ 0,2` bonne · `≥ 0` modérée · `< 0` inversée (à corriger).
- **Biais** — écart `moyenne(prédit) − moyenne(réel)`. **Positif = surconfiance**, négatif = sous-confiance, `|biais| < 5 %` = équilibré.
- **Histogramme 10 bandes** : pour chaque tranche de confiance prédite (0-10 %, … 90-100 %), la barre **prédite** (bleue) face à l'**accuracy réelle** (verte si bien calibrée, rouge si surconfiance), avec l'effectif `n`.

Vise un γ élevé **et** un biais proche de 0 : tu prédis juste *et* sans te surestimer.

---

## Deck Podcast — NotebookLM-style (Vague 8)

Transforme un deck entier en un **dialogue audio à deux voix** (un animateur + une experte), façon Google NotebookLM. Le script est écrit par Claude, l'audio synthétisé par OpenAI TTS.

### Pré-requis

Les **deux clés** sont nécessaires : **Anthropic** (script) et **OpenAI** (voix). Configure-les dans Paramètres → Intégrations.

### Générer

1. Sur la **Home**, ouvre le menu `⋯` d'un deck (le deck doit contenir **au moins 3 cartes**) → **« Podcast »**.
2. Choisis un **format** :

| Format | Durée | Contenu |
|--------|-------|---------|
| **Deep Dive** | ~5 min | Épisode détaillé : l'experte explique chaque carte avec des exemples. |
| **Brief** | ~2 min | *Highlight reel* : uniquement les cartes phares. |
| **Critique** | variable | Débat critique : l'animateur challenge chaque affirmation. |

3. Choisis une **voix Host** et une **voix Expert** parmi les 8 voix OpenAI (elles doivent être **différentes**, sinon le bouton reste bloqué).
4. Clique **« Générer »** (~30-60 s). L'épisode se joue **en ligne** dans le dialogue, et apparaît dans **« Épisodes précédents »**.

### Télécharger / supprimer

- Le MP3 est mis en cache dans `<app_cache_dir>/podcasts/`. Re-générer le même couple (format + voix) est un *cache hit* gratuit.
- Bouton **« Télécharger »** → file picker natif → copie le MP3 où tu veux.
- Bouton corbeille → supprime l'épisode du cache.

---

## Whisper Mode — réponse vocale (Vague 8)

Réponds aux cartes **à voix haute** plutôt qu'au clavier. La transcription est faite par **OpenAI Whisper**, puis comparée à la réponse attendue avec le **même scoring fuzzy** (distance de Levenshtein) que le mode Type-the-answer.

### Activer

**Paramètres → Réglages des révisions → Modes cognitifs → « Réponse vocale (Whisper) »**. Nécessite une **clé OpenAI**. Ne s'applique qu'aux cartes **basic** / **basic_reverse**.

### Pendant une review

1. Un bouton **« Enregistrer »** (micro) s'affiche sous la question. Au premier usage, le navigateur demande l'accès micro.
2. Parle ta réponse, puis clique **« Arrêter »** (l'enregistrement se coupe seul après **10 secondes** max — garde-fou anti-facture).
3. Whisper transcrit (« Transcription… »), la réponse est comparée et tu vois si ça correspond, exactement comme une réponse tapée.

---

## Memory Palace 3D (Vague 9)

La **méthode des loci** (palais de mémoire) ancre chaque carte à un emplacement dans un bâtiment imaginé que tu parcours mentalement. Krokos et al. 2019 (Virtual Reality 23) mesurent **+8,8 % de rappel** vs une liste plate, en s'appuyant sur les *cellules de lieu* de l'hippocampe (Nobel 2014, O'Keefe & Moser).

### Créer un palace

1. Sidebar → **« Memory Palaces »** → **« Nouveau palace »**.
2. Donne un **nom** (ex. « Ma maison d'enfance »), une description facultative, et choisis un **template 3D** :
   - **Maison** — 3 pièces avec cloisons internes.
   - **Rue** — long couloir avec colonnes régulières.
   - **Château** — grande salle aux hauts murs.

### Placer des loci (mode builder)

Le palace s'ouvre dans un éditeur 3D en trois colonnes :

1. **Colonne gauche** : choisis un deck, puis **clique une carte** pour la sélectionner.
2. **Centre (scène 3D)** : **clique sur le sol** à l'endroit voulu → la carte y est épinglée sous forme de **sphère lumineuse numérotée**.
3. **Colonne droite** : la liste **ordonnée** des loci. Les flèches ↑/↓ réordonnent le **parcours**, la corbeille retire un locus. Une carte déjà placée n'apparaît plus dans la colonne de gauche (pas de doublon dans un même palace).

Contrôles de la caméra en builder : **glisser pour pivoter**, molette pour zoomer.

### Mode review (parcours)

Bouton **« Mode review »** (actif dès qu'il y a ≥ 1 locus). Tu **marches** dans le palais en suivant l'ordre des loci :

| Contrôle | Action |
|----------|--------|
| **Z / Q / S / D** (ou **W / A / S / D**, ou les flèches) | Avancer / reculer / pivoter le déplacement |
| **Clic gauche maintenu + glisser** | Regarder autour (orienter la caméra) |

Le locus courant est **surligné en doré**. Clique-le pour révéler la carte associée, révise, puis avance vers le suivant. La hauteur des yeux reste verrouillée pour une sensation de marche (pas de « vol »).

> Note technique : le rendu utilise React Three Fiber (WebGL). Sur un environnement sans WebGL (rare), un message de repli s'affiche au lieu de la scène.

---

## Mode Langue (Vague 10)

Outils dédiés à l'apprentissage des langues : un template orienté phrases et un suivi de couverture du vocabulaire par fréquence.

### Langue du deck

Dans **« Nouveau deck »** ou **« Modifier le deck »**, choisis une **langue** : Français, English, Español, Deutsch, Italiano, 日本語, 中文 (ou *Aucune*). Activer une langue débloque la **carte de couverture de fréquence** sur la page du deck.

### Template « Phrase » (bidirectionnel)

Dans l'éditeur de carte, l'onglet **« Phrase »** crée une carte de type *bidirectional* (pattern Lampariello) :

- **Phrase (langue cible)** — la phrase en L2.
- **Traduction** — sa version en L1.
- **Indice / note** (optionnel).
- **Bande de fréquence** (optionnel — voir ci-dessous).

→ Génère **2 cartes** : L2→L1 *et* L1→L2.

### Bande de fréquence (couverture du vocabulaire)

Tague une note avec sa **fréquence Zipf** dans la langue : **Top 100**, **Top 1k**, **Top 5k**, **Top 10k**, **Au-delà** (ou *Aucune*). La page du deck affiche alors une **barre de couverture** colorée (du vert pour les mots les plus fréquents à l'orange pour les rares, gris = non taggé), pour voir d'un coup d'œil si ton deck couvre bien le cœur fréquent de la langue.

---

## Import de sous-titres (.srt / .vtt) (Vague 11)

Pratique le *sentence mining* : transforme un fichier de **sous-titres** de film/série en cartes-phrases.

1. **Paramètres → Données → « Sous-titres (sentence mining) »**.
2. Choisis le **deck cible**.
3. Choisis un **mode** :
   - **Phrase basique (recto / verso)** — chaque réplique devient une carte recto/verso.
   - **Cloze auto (mot le plus long)** — chaque réplique devient une cloze où le mot le plus long est masqué.
4. Clique **« Importer des sous-titres (.srt/.vtt) »** → file picker filtré sur `.srt` / `.vtt` → toast récap.

---

## Graphe de connaissances (Vague 11)

Visualise les **liens entre tes cartes via leurs tags partagés** (co-occurrence de tags).

1. Sidebar → **« Graphe »**.
2. Sélecteur **« Portée »** en haut à droite : **Tous les decks** ou un deck précis.
3. Chaque **nœud** est un tag ; une **arête** relie deux tags qui apparaissent ensemble sur des cartes. **Survole un tag** pour mettre en évidence ses connexions.

Sert à repérer les zones denses (sujets bien maillés) et les tags isolés (concepts orphelins à relier).

---

## Modes cognitifs avancés (Vague 12)

Trois manipulations opt-in supplémentaires, dans **Paramètres → Réglages des révisions → Modes cognitifs**.

### Mode pré-test

**« Mode pré-test »** : sur une carte **neuve**, tu es invité à **deviner** la réponse avant de la révéler — *même si tu te trompes*. L'acte de tenter une réponse avant l'étude améliore l'apprentissage ultérieur (*pretesting effect*, Pan et al. 2023). Ne note rien : l'essai compte, pas l'exactitude.

### Auto-explication

**« Auto-explication »** : sur **~1 carte sur 5**, après le flip, un champ te demande d'**expliquer en une phrase pourquoi c'est la réponse** (Chi et al. 1989, g ≈ 0,55). Texte libre, **non noté** — l'effet vient de la verbalisation.

### Focus Guard (webcam)

**« Focus Guard »** : détecte le **décrochage d'attention** (*mind-wandering*) via la webcam pendant une session (Hutt et al. 2024), pour te relancer quand ton regard décroche.

> **100 % local.** L'analyse tourne dans l'app (WebGazer). **Aucune image n'est enregistrée ni envoyée** sur le réseau. Un **consentement** explicite est demandé au premier lancement ; tu peux refuser et la session continue normalement.

---

## Pipeline multi-agent + Aide mnémotechnique (Vague 13)

### Critic (Générateur → Critique)

Sur la page **Génération IA**, coche l'option **Generator → Critic** *avant* de générer. Après la première passe (le *Generator*), un **second appel Claude** (le *Critic*) **note chaque carte** de 0 à 100 % et propose une **correction en un clic** pour les cartes faibles.

- Un badge **« Qualité X% »** s'affiche sur chaque brouillon.
- En dessous de **70 %**, la carte est signalée **« à améliorer »** avec une réécriture proposée.
- Le critic est **purement consultatif** : si l'appel échoue, les brouillons restent utilisables sans score.

### Aide mnémotechnique

Pour les cartes que tu **rates souvent**, Claude peut générer une **astuce mnémotechnique** (image mentale, association, acronyme).

L'option n'apparaît que pour les cartes ayant **au moins 3 lapses** (échecs) : **Détail du deck → ligne de la carte → menu `⋯` → « Aide mnémotechnique »**. Nécessite une clé Anthropic.

---

## Modes disciplinaires : Médecine & Sciences (Vague 14)

Deux templates de notes adaptés à des disciplines précises, accessibles via des onglets dédiés de l'éditeur de carte.

### Onglet « Médecine » — Illness Script

Un *illness script* est la structure mentale d'un clinicien expert : il range chaque maladie en quatre cases (Charlin et al. 2007). L'onglet **« Médecine »** crée une carte `illness_script` à partir de :

- **Condition** — le nom de la pathologie (le recto).
- **Conditions prédisposantes** — terrain, facteurs de risque.
- **Insulte physiopathologique** — le mécanisme lésionnel.
- **Conséquences cliniques** — signes, symptômes, complications.

→ 1 carte : tu vois la condition, tu dois restituer les trois sections. Mémoriser par *scripts* plutôt que par listes plates accélère le raisonnement diagnostique.

### Onglet « Sciences » — Refutation Card

Une *refutation text card* confronte explicitement une **idée reçue** à l'explication correcte. La méta-analyse Tippett 2010 montre que nommer la conception erronée *avant* de la corriger déloge mieux les fausses croyances qu'un simple exposé. L'onglet **« Sciences »** crée une carte `refutation` :

- **Concept / question** (le recto).
- **Idée reçue** — la croyance courante mais fausse.
- **Pourquoi c'est faux + explication correcte** (le verso).

→ 1 carte. Idéal en physique, biologie, chimie où les intuitions trompeuses sont tenaces.

---

## Mode Maths : Faded Worked Example (Vague 15)

L'onglet **« Maths »** de l'éditeur crée une carte `worked_example` : un **exemple résolu** dont les étapes se révèlent **progressivement**. L'effet d'exemple résolu (Sweller, Renkl & Atkinson 2003) réduit la charge cognitive en début d'apprentissage ; révéler une étape à la fois (*faded guidance*) force la génération active sans surcharge.

1. Saisis l'**énoncé** puis les **étapes de résolution** (une par ligne) et la **réponse finale**.
2. En review, l'énoncé s'affiche seul ; tu cliques **« Étape suivante »** pour dévoiler chaque étape une à une, puis la réponse.
3. Note-toi normalement (Again/Hard/Good/Easy) selon ta capacité à anticiper les étapes.

---

## Mastery Gating — déblocage par prérequis (Vague 15)

Inspiré du *mastery learning* de Bloom : un deck avancé reste **verrouillé** tant que son deck **prérequis** n'est pas maîtrisé.

### Définir un prérequis

Dans **« Modifier le deck »**, choisis un **deck prérequis** dans la liste *Prérequis (mastery gating)*. Laisse vide pour aucun verrou.

### Comportement

- Tant que le prérequis n'atteint pas le seuil de maîtrise (**≥ 90 % de rétention sur 30 jours avec au moins 20 reviews**, seuil Bloom), le deck verrouillé affiche un **cadenas** et le bouton *Étudier* est désactivé.
- Une fois le prérequis maîtrisé, le cadenas saute automatiquement.

> Ça évite de se disperser sur de l'avancé avant d'avoir solidifié les bases — utile pour des chaînes de cours (Algèbre → Calcul → Analyse).

### Confiance rétrospective en deux temps

Si l'évaluation de confiance est activée, Mnemosys peut te demander une **deuxième** estimation **après** avoir vu la réponse (« à quel point étais-tu sûr ? », Bang & Fleming 2018). Cette confiance *post* (colonne `reviews.confidence_post`) complète la confiance *prospective* (avant flip) et alimente la calibration rétrospective (cf. *Calibration rétrospective*).

---

## Modes créatifs : Musique & Arts (Vague 16)

Deux entraîneurs autonomes, **100 % offline** (Web Audio + Canvas), sans clé API ni réseau.

### Musique (`/music`)

Sidebar → **« Musique »**. Deux outils :

- **Métronome** : règle le tempo (BPM) et la signature ; le clic est synthétisé en Web Audio (timing précis, pas de fichier audio).
- **Ear training** : l'app joue un **intervalle** (ou un accord) que tu dois identifier. Idéal pour la dictée musicale en répétition espacée.

### Arts — Gesture drawing (`/gesture`)

Sidebar → **« Gesture »**. Un **timer de gesture drawing** : des sessions chronométrées (30 s, 1 min, 2 min, 5 min…) pour t'entraîner au croquis rapide. Le minuteur change de pose à intervalle régulier ; à toi de dessiner avant le buzzer. Tout est local (Canvas + minuteur).

---

## Shadowing — répétition vocale guidée (Vague 17)

Sidebar → **« Shadowing »** (`/shadowing`). La technique du *shadowing* (répéter une phrase immédiatement après l'avoir entendue) est un classique de l'apprentissage des langues et de la diction.

1. L'app génère l'audio **modèle** d'une phrase via TTS (OpenAI ou Piper local).
2. Tu **répètes** par-dessus ; l'app capture ta voix.
3. Les **deux formes d'onde** (modèle vs ta voix) s'affichent côte à côte pour comparer rythme et durée visuellement.

Nécessite l'accès micro. Utile pour caler son intonation sur un modèle.

---

## Reading Import — lecture assistée façon LingQ (Vague 17)

Sidebar → **« Reading »** (`/reading`). Importe un texte et marque chaque mot par **statut de connaissance**, façon LingQ.

1. Colle ou importe un **texte** dans la langue cible.
2. Chaque mot est colorié selon son statut : **new** (jamais vu), **learning** (en cours), **known** (acquis). Le statut est mémorisé par couple `(mot, langue)` dans la table `word_status`.
3. **Clique un mot** pour faire évoluer son statut.
4. Sélectionne les mots *new*/*learning* et clique **« Créer des cartes »** : Mnemosys génère des cartes pour ces mots dans le deck choisi.

### Citations PDF (tag source)

Lors de la génération IA depuis un **PDF**, les cartes créées peuvent être taguées avec leur **source** (le document d'origine), pour retrouver d'où vient une information.

---

## Tuteur IA local — Ollama (Vague 18)

En plus de Claude (cloud), Mnemosys peut générer des cartes **entièrement hors-ligne** via **Ollama**, un runtime de LLM local.

### Configuration

1. Installe Ollama (<https://ollama.com/>) et télécharge un modèle (ex. `ollama pull llama3.1`).
2. Lance le serveur Ollama (il écoute sur `http://localhost:11434` par défaut).
3. **Paramètres → Intégrations** : renseigne l'URL Ollama et le nom du modèle.

### Workflow

Sur la page **Génération IA**, choisis le **moteur local (Ollama)** au lieu de Claude. La génération tourne sur ta machine : **aucune donnée ne sort**, aucun coût d'API. Parfait pour du contenu sensible ou un usage 100 % offline (la qualité dépend du modèle local choisi).

---

## Chronotype — calibration rMEQ (Vague 18)

Dans **Paramètres → Modes neuro**, le **questionnaire rMEQ** (*reduced Morningness-Eveningness Questionnaire*) détermine ton **chronotype** (du matin / intermédiaire / du soir). Mnemosys s'en sert pour te suggérer tes **fenêtres horaires de performance cognitive** optimales, afin de planifier tes sessions exigeantes au bon moment de la journée.

---

## Son d'ambiance (Context Ambient) (Vague 18)

Toujours dans les réglages, active un **fond sonore continu** pendant tes sessions : **bruit blanc**, **bruit rose**, **bruit brun**, ou **pluie**. Le son est **généré localement** (Web Audio, pas de fichier ni de réseau). Le bruit de fond masque les distractions et stabilise l'attention pour certains profils. Réglable en volume, coupable à tout moment.

---

## Schedulers HLR & MEMORIZE (Vague 20)

En plus de FSRS-6 / SM-2 / Leitner, deux algorithmes de planification supplémentaires sont disponibles par deck, portant le total à **5 algorithmes au choix** (section *Algorithme de scheduling* de la création/édition d'un deck).

| Algorithme | Pour qui / quand | Comportement |
|------------|------------------|--------------|
| **HLR** (Half-Life Regression) | Tu veux un modèle léger inspiré de Duolingo. | Estime la **demi-vie** de la mémoire par régression (Settles & Meeder 2016, ACL). |
| **MEMORIZE** | Tu veux un espacement « théoriquement optimal ». | Planification par **contrôle optimal stochastique** (Tabibian et al. 2019, PNAS). |

Comme pour les autres, un **badge** rappelle l'algo actif sur la carte du deck, et changer d'algorithme **n'efface pas l'historique** des reviews.

---

## Maîtrise des concepts (BKT) (Vague 20)

Dans **Stats**, la section **« Maîtrise des concepts »** affiche, **par tag**, un **pourcentage de maîtrise** estimé par **Bayesian Knowledge Tracing** (BKT, Corbett & Anderson 1994). À chaque review, le modèle met à jour la probabilité que tu « connaisses » réellement le concept derrière le tag, en tenant compte des chances de réussite par chance (*guess*) et d'erreur d'inattention (*slip*).

→ Tu vois d'un coup d'œil quels sujets sont solides et lesquels demandent encore du travail, indépendamment du nombre de cartes.

---

## Planning — Implementation Intentions (Vague 21)

Sidebar → **« Planning »** (`/planner`). Une *implementation intention* est un plan « **quand je [situation], alors j'étudie [action]** » (Gollwitzer 1999, effet moyen **d ≈ 0,65** sur le passage à l'acte). Formuler le déclencheur à l'avance double les chances de tenir une habitude.

1. Crée un plan en choisissant un **type de déclencheur** :
   - **Heure** (`time`) — ex. *« à 08:00 »* (un rappel système peut être envoyé).
   - **Lieu** (`place`) — ex. *« dans le métro »*.
   - **Après une habitude** (`after_habit`) — ex. *« après le café du matin »*.
2. Renseigne l'**action** (le deck à réviser, optionnel) et les **jours** concernés (ou tous les jours).
3. Active/désactive chaque plan via son interrupteur.

> Les plans de type **Heure** déclenchent une **notification** locale. Supprimer un deck ne détruit pas le plan associé (il retombe sur un libellé d'action simple).

---

## Major System & PAO (Vague 21)

Sidebar → **« Mnémotechnique »** (`/mnemonics`). Deux systèmes classiques pour mémoriser des **nombres** :

- **Major System** : convertit chaque chiffre en consonne (0=s/z, 1=t/d, 2=n…) pour former des mots faciles à imager. L'app t'aide à encoder/décoder une suite de chiffres.
- **PAO (Personne-Action-Objet)** : associe chaque nombre à deux chiffres à un trio Personne + Action + Objet, pour encoder de longues séquences (cartes, dates, codes) en images vivantes.

Outil d'entraînement autonome, 100 % local.

---

## Piper TTS — synthèse vocale locale (Vague 22)

En plus d'OpenAI TTS (cloud), Mnemosys peut synthétiser la voix **entièrement hors-ligne** via **Piper**, un moteur TTS neuronal local.

### Configuration

1. Installe Piper et un modèle de voix (`.onnx`).
2. **Paramètres → Intégrations → Synthèse vocale** : choisis le moteur **Piper (local)** et indique le chemin du binaire / de la voix.

### Usage

Une fois Piper sélectionné, tous les boutons 🔊 (cartes, NoteEditor, Shadowing) passent par Piper : **aucun coût, aucun réseau**, et ça marche en avion. Le cache disque fonctionne comme pour OpenAI. La qualité dépend du modèle de voix Piper installé.

---

## Image mnémotechnique (DALL-E) (Vague 22)

Pour une carte difficile, Claude/OpenAI peut générer une **image mnémotechnique** illustrant l'astuce de mémorisation. Depuis la **liste des cartes** d'un deck, le menu d'une carte propose **« Image mnémotechnique »** : l'app génère une image (via DALL-E) ancrant visuellement le concept. Nécessite une clé OpenAI. Purement optionnel et additif.

---

## Calibration rétrospective (Vague 22)

Si la **confiance rétrospective en deux temps** est active (cf. *Mastery Gating*), le **Calibration Dashboard** (Stats) ajoute une vue **γ_post** : la qualité de ta calibration basée sur la confiance donnée **après** avoir vu la réponse, à comparer avec la calibration *prospective*. Un écart entre les deux révèle si tu juges mieux ton savoir avant ou après l'effort de rappel.

---

## Temporal Mastery Graph (Vague 23)

Dans **Stats**, la section **« Maîtrise dans le temps »** trace l'évolution de ta **rétention par tag au fil des semaines**. Contrairement au pourcentage instantané du BKT, ce graphe temporel montre les **tendances** : un sujet qui progresse, un autre qui décroche, l'effet d'un changement de rythme. Sélectionne les tags à suivre pour comparer plusieurs concepts sur la même courbe.

---

## Mode mains-libres (Hands-free) (Vague 23)

Un **mode de review entièrement vocal**, pour réviser en marchant, en cuisinant, sans toucher l'écran.

1. Active le **mode mains-libres** depuis l'écran de review.
2. L'app **lit la question à voix haute** (TTS), marque une pause, puis lit la réponse.
3. Tu réponds **à la voix** ; **Whisper** transcrit et compare, et tu notes ton rating **vocalement** (« again », « good »…).

Combine TTS (OpenAI ou Piper local) et reconnaissance vocale Whisper. Nécessite les clés correspondantes (ou Piper local pour la sortie). Idéal pour transformer du temps mort en révision.

---

## Optimiseur FSRS (Session 4)

FSRS-6 utilise par défaut 21 paramètres calibrés sur une **population globale** (~700 M de reviews). Avec assez d'historique **personnel**, tu peux les recalibrer sur **tes** données (Ye et al., SIGKDD 2022).

### Quand calibrer

- **Paramètres → Optimiseur FSRS** affiche une barre de progression *« Reviews accumulées : N / 1000 »*.
- Sous **1 000 reviews**, pas de bouton : continue à réviser quelques sessions.
- À **≥ 1 000 reviews**, le bouton **« Calibrer FSRS »** apparaît. Le calcul prend **5 à 30 s**.
- Un avertissement rappelle que tes **prochaines révisions** utiliseront les nouveaux paramètres et que les intervalles affichés peuvent évoluer. C'est non destructif pour l'historique, mais recalcule la planification future.

Recalibre plutôt **rarement** (tous les quelques milliers de reviews) : au-delà du seuil, les gains marginaux sont faibles.

---

## FAQ

### Combien de cartes par jour ?

Au départ, **10 à 20 nouvelles cartes par jour** est un excellent rythme. Tu accumules ensuite des reviews ; sois prêt à 50–150 cartes/jour en régime de croisière. Ajuste les caps depuis **Paramètres → Réglages des révisions**.

### Pourquoi *Again* donne un intervalle si court (genre 10 min) ?

C'est volontaire : FSRS-6 te remontre une carte oubliée rapidement (passage en `relearning`) pour consolider la trace mémoire avant de la replanifier sur des jours. Si tu réussis le *relearning* du premier coup, l'intervalle remonte vite.

### Comment réinitialiser une carte ?

Depuis le détail du deck → ligne de la carte → menu `⋯` → **« Réinitialiser (FSRS) »**. La carte repart en `new` ; ses paramètres FSRS sont effacés mais l'historique des reviews est conservé. Voir la section *Réinitialiser une carte* plus haut.

### Mes données sont-elles privées ?

**Oui, 100 % local.** Tout est stocké dans une base SQLite à :
- Linux : `~/.local/share/<bundle id>/mnemosys.db`
- macOS : `~/Library/Application Support/<bundle id>/mnemosys.db`
- Windows : `%APPDATA%\<bundle id>\mnemosys.db`

**Aucune télémétrie**, et le **cœur de l'app est entièrement offline** : CRUD, review, scheduling, stats, gamification, palais de mémoire, graphe — rien ne quitte ta machine.

Les seules sorties réseau sont **opt-in et explicites**, déclenchées par les fonctionnalités que *tu* actives avec *tes* clés API :
- **Génération IA / élaboration / critic / mnémotechnique / pré-questionnement** → API Anthropic (le texte envoyé est ton contenu de cours / cartes).
- **TTS, Podcast, Whisper, image mnémotechnique** → API OpenAI (texte à synthétiser, audio à transcrire, ou prompt d'image).
- **Sync cloud** → ton projet Supabase (désactivée par défaut).
- **Focus Guard** → **100 % local** malgré la webcam : l'analyse tourne dans l'app (WebGazer), aucune image n'est enregistrée ni transmise.

**Alternatives 100 % locales** : tu peux remplacer les sorties cloud par des moteurs offline — **Ollama** (génération de cartes) et **Piper** (TTS) tournent sur ta machine, sans réseau ni coût. Les modes créatifs (Musique, Gesture), Major System/PAO, le son d'ambiance et le Reading Import sont eux aussi entièrement locaux.

Sans clés configurées et sans sync, Mnemosys reste 100 % local.

### Sync multi-device ?

Session 3 ajoute une sync optionnelle vers Supabase, **désactivée par défaut**. Voir la section *Sync cloud* plus haut et `docs/SESSION_3_SYNC.md` pour l'architecture. L'export JSON reste valable pour les transferts manuels.

### Génération de cartes par IA ?

Oui — voir la section *Génération IA de cartes* plus haut. Configure une clé API Anthropic dans **Paramètres → Intégrations**, puis utilise la page **Génération IA** depuis la sidebar.

### J'ai perdu mon paquet, où est la base ?

Le fichier `.db` est aux chemins ci-dessus. Tu peux le copier comme backup. Si Mnemosys ne démarre plus suite à une corruption, renomme le fichier et relance — l'app recréera une base vierge.

### Pourquoi mon antivirus chouine au premier lancement ?

Le binaire Tauri n'est pas (encore) signé en Session 1. C'est attendu jusqu'à la Session 4 (release packaging avec signature notarisée macOS + EV cert Windows).

### Comment activer une fonctionnalité d'apprentissage (sketch, JOL, Whisper, pré-test…) ?

La plupart des modes cognitifs sont des **switches opt-in** dans **Paramètres → Réglages des révisions → Modes cognitifs** (Type-the-answer, Évaluation de confiance, Pré-questionnement IA, Dessin avant flip, JOL différés, Réponse vocale Whisper, Mode pré-test, Auto-explication, Focus Guard). Les **modes neuro** (mood/sleep, pauses mouvement, cyclic sighing, chronotype rMEQ, son d'ambiance) ont leur propre section avec un *master switch*. Tout est **désactivé par défaut** : tu composes ton propre protocole.

Certaines features sont des **pages dédiées** dans la sidebar plutôt que des toggles : Musique (`/music`), Gesture (`/gesture`), Shadowing (`/shadowing`), Reading (`/reading`), Planning (`/planner`), Mnémotechnique (`/mnemonics`), Graphe (`/graph`), Memory Palaces (`/palaces`), Review entrelacée (`/review-interleaved`), Génération IA (`/ai-generate`), Succès (`/achievements`). Les onglets disciplinaires (Médecine, Sciences, Maths, Phrase, Image-occlusion) vivent dans l'éditeur de carte.

### C'est quoi les streaks, les succès et la maîtrise des decks ?

C'est la **gamification éthique** (White Hat, Vague 1), visible via **« Succès »** dans la sidebar :
- **Streak** : nombre de jours consécutifs avec au moins une review. Tu disposes de **2 « freezes » par mois** pour absorber un jour manqué sans casser ta série.
- **Succès** : 10 badges débloqués par tes accomplissements (première review, paliers de streak, maîtrise…). **Aucune pénalité, aucun classement public** — uniquement du renforcement positif.
- **Maîtrise d'un deck** : progression en 5 stages façon WaniKani.

### Le podcast / la réponse vocale ne marchent pas ?

Ces deux features dépendent d'**OpenAI** (et le podcast aussi d'**Anthropic** pour le script). Vérifie tes clés dans **Paramètres → Intégrations**. Le podcast n'apparaît que pour les decks d'**au moins 3 cartes** (menu `⋯` du deck sur la Home), et l'enregistrement Whisper se coupe automatiquement après **10 secondes**.

### Quand recalibrer FSRS avec l'Optimiseur ?

Attends d'avoir **au moins 1 000 reviews** dans ta base (la barre de progression dans **Paramètres → Optimiseur FSRS** te le dit). En dessous, les paramètres par défaut globaux sont plus fiables. Au-delà, recalibre rarement — voir la section *Optimiseur FSRS*.
