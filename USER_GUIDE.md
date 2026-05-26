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

Aucune télémétrie, aucune connexion réseau (hors les liens externes que tu cliques toi-même). Session 1 est entièrement offline.

### Sync multi-device ?

Session 3 ajoute une sync optionnelle vers Supabase, **désactivée par défaut**. Voir la section *Sync cloud* plus haut et `docs/SESSION_3_SYNC.md` pour l'architecture. L'export JSON reste valable pour les transferts manuels.

### Génération de cartes par IA ?

Oui — voir la section *Génération IA de cartes* plus haut. Configure une clé API Anthropic dans **Paramètres → Intégrations**, puis utilise la page **Génération IA** depuis la sidebar.

### J'ai perdu mon paquet, où est la base ?

Le fichier `.db` est aux chemins ci-dessus. Tu peux le copier comme backup. Si Mnemosys ne démarre plus suite à une corruption, renomme le fichier et relance — l'app recréera une base vierge.

### Pourquoi mon antivirus chouine au premier lancement ?

Le binaire Tauri n'est pas (encore) signé en Session 1. C'est attendu jusqu'à la Session 4 (release packaging avec signature notarisée macOS + EV cert Windows).
