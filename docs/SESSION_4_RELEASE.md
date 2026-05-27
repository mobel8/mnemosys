# Session 4 — Release tooling (Mnemosys)

Document de référence pour tout ce qui touche au *packaging*, à la
distribution et à la maintenance long terme de Mnemosys hors « pure
fonctionnalité ». La Session 4 livre cinq briques :

1. **Optimiseur FSRS-6** : recalibration personnelle des 21 paramètres FSRS.
2. **Workflow CI multi-OS** : Linux + macOS + Windows à chaque commit.
3. **Plugin auto-updater** : pré-câblé mais inerte tant qu'aucune clé n'est
   provisionnée (pas de surprises au boot).
4. **Procédure de signature** : Apple / Windows / Linux, documentée pour le
   jour où le projet aura un budget « binaires signés ».
5. **License MIT** : voir `LICENSE` à la racine.

---

## 1. Vue d'ensemble

À la fin de la S4, le repo est livrable :

- Le binaire compile sur les trois OS desktop majeurs via GitHub Actions.
- Le code est gated par `cargo fmt`, `clippy -D warnings`, `pnpm typecheck`,
  Biome et la suite Vitest sur chaque push / PR.
- Les paramètres FSRS peuvent être réajustés en local sans dépendance cloud,
  via un bouton « Calibrer FSRS » dans Paramètres.
- L'app est prête à recevoir un manifest d'updater (toute l'infra côté Rust
  est en place ; il ne manque qu'une paire de clés et un serveur statique).
- Le projet est sous licence MIT, claire et permissive.

---

## 2. Optimiseur FSRS

### Quand l'utiliser

L'optimiseur **n'est pas une routine quotidienne**. À déclencher :

- **Une fois** quand l'utilisateur atteint ≥ 1 000 reviews dans la DB.
- **À nouveau** tous les 6–12 mois si l'utilisateur a accumulé une masse
  significative de reviews supplémentaires (ex. +5 000 depuis la dernière
  calibration).
- **Jamais** sur un compte fraîchement initialisé — sous le seuil, le bouton
  est masqué et un message « continue à réviser » prend sa place.

Les paramètres globaux FSRS-6 fournis par défaut sont déjà calibrés sur des
millions de reviews issues de la communauté Anki. Les recalibrer trop tôt sur
un échantillon trop petit dégrade la qualité de la prédiction.

### Algorithme (résumé)

L'optimiseur exécute une **descente de gradient** sur la log-loss des reviews
historiques :

1. On extrait chaque ligne `reviews` rangée par carte et par ordre temporel.
2. Pour chaque review, on calcule la rétention prédite avec les paramètres
   courants et on compare au résultat observé (Again/Hard/Good/Easy → 0 ou 1).
3. On rétropropage la perte sur les 21 paramètres FSRS.
4. On itère jusqu'à convergence (ou un budget d'epoch maximal).

C'est exactement l'approche décrite dans **Ye et al., SIGKDD 2022** (« A
Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition
Scheduling ») et implémentée dans la crate `fsrs-rs` sur laquelle Mnemosys
s'appuie. Pas de réinvention de roue.

### Limites

- **Besoin de ≥ 1 000 reviews** : sous ce seuil, le fit overfit le bruit.
- **Coût** : 5 à 30 s sur un dataset typique (10–50k reviews). L'UI affiche
  un spinner et désactive le bouton tant que la mutation tourne.
- **Pas de rollback automatisé** : les anciens paramètres sont conservés dans
  `previous_params` du résultat retourné, mais aucun bouton « annuler » ne
  les remet en place. Une issue follow-up est ouverte pour cette affordance.

### Où ça vit dans le code

| Couche | Chemin | Rôle |
| --- | --- | --- |
| Algorithme | `src-tauri/src/fsrs/optimize.rs` | Wrapper sur `fsrs::FSRS::compute_parameters`. Expose `MIN_REVIEWS_FOR_OPTIM = 1000`. |
| Persistance | `src-tauri/src/db/params.rs` | Table `fsrs_params` + colonnes `optimized_at` / `reviews_at_optim`. |
| Commande IPC | `src-tauri/src/commands/fsrs_optimizer.rs` | `get_total_reviews_count` + `optimize_fsrs_params`. |
| Type frontend | `src/lib/tauri.ts` (`OptimizeResult`) | Mirror serde. |
| Hook React | `src/lib/queries.ts` (`useOptimizeFsrsParams` / `useTotalReviewsCount`) | TanStack Query. |
| UI | `src/components/settings/FsrsOptimizerSection.tsx` | Section « Optimiseur FSRS » de la page Paramètres. |

---

## 3. CI multi-OS

### Trois jobs, trois rôles

Le workflow `.github/workflows/ci.yml` orchestre :

1. **`frontend`** *(Ubuntu, < 2 min)* — `pnpm typecheck && pnpm lint && pnpm test`.
2. **`backend`** *(Ubuntu, ~10 min cache froid)* — `cargo fmt --check`,
   `cargo clippy -D warnings`, `cargo test`. Installe les dépendances Linux
   GTK (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
   `librsvg2-dev`) avant clippy parce que `tauri-build` les exige dès le
   `build.rs`.
3. **`build`** *(matrice Linux / macOS / Windows, 10–20 min)* — `pnpm tauri
   build`. Upload les bundles sous `mnemosys-<OS>` en artifact GitHub
   (rétention 14 j) :
   - **Linux** : `.deb` + AppImage.
   - **macOS** : `.dmg` + `.app` zip.
   - **Windows** : `.msi` (WiX) + `.exe` (NSIS).

Le cache `actions/cache@v4` est indexé sur `Cargo.lock`. Premier run sur un
runner froid : ~15 min de Rust. Runs suivants : ~3 min.

### Activation

Le workflow se déclenche **sur tout push** vers `main` ou `master`, et sur
chaque **pull request**. Aucune action manuelle n'est requise — pousser sur
GitHub suffit.

Pour lancer manuellement un build sans push : `gh workflow run ci.yml` (CLI
GitHub) ou via l'onglet *Actions* du repo.

### Tests verts requis avant merge

Configurer dans **Settings → Branches → Branch protection** :
- `frontend` requis.
- `backend` requis.
- `build` (`ubuntu-latest`, `macos-latest`, `windows-latest`) requis.

---

## 4. Packaging local (`tauri build`)

### Une commande, trois sorties

```bash
pnpm tauri build
```

Sans `--bundles`, Tauri utilise les *defaults* par OS :

| OS hôte | Bundles produits | Chemin de sortie |
| --- | --- | --- |
| Linux | `.deb`, AppImage | `src-tauri/target/release/bundle/{deb,appimage}/` |
| macOS | `.dmg`, `.app` zippé | `src-tauri/target/release/bundle/{dmg,macos}/` |
| Windows | `.msi`, `.exe` (NSIS) | `src-tauri/target/release/bundle/{msi,nsis}/` |

Pour ne produire qu'un format : `pnpm tauri build --bundles deb`. La liste
complète des cibles supportées est dans la doc Tauri sous `tauri::utils::config::BundleTarget`.

### Pré-requis Linux

Sur une machine fraîche (Ubuntu 22.04+ / Debian 12+) :

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev build-essential
```

Sur macOS : Xcode Command Line Tools (`xcode-select --install`).
Sur Windows : Visual Studio Build Tools 2022 avec la workload « Desktop
development with C++ ».

### Piège connu : `beforeBuildCommand`

`tauri.conf.json::build.beforeBuildCommand` invoque
`./node_modules/.bin/tsc && ./node_modules/.bin/vite build` **et non**
`pnpm build`. Sur pnpm 10+, un `pnpm` lancé depuis le shell de `tauri-cli`
ne retrouve pas toujours le binaire dans son `PATH` ; appeler les binaires
directement contourne le souci.

---

## 5. Plugin auto-updater

### Architecture

```
+-------------------+      HTTPS GET       +------------------------------+
|   Mnemosys app    |  /target/version --> |  releases.mnemosys.app       |
|  (running)        |                       |  (static manifest + bundles) |
+-------------------+ <---- 200 OK -------- +------------------------------+
        | manifest.json contient: { version, url, signature, notes }
        |
        | l'app vérifie la signature avec sa pubkey embarquée
        |     -> si OK et version > current : télécharge + relance
```

Le plugin `tauri-plugin-updater` (déjà enregistré dans `src-tauri/src/lib.rs`)
reste **dormant** tant que :

- soit le champ `pubkey` de `tauri.conf.json::plugins.updater` est vide,
- soit le serveur de manifest renvoie 4xx/5xx.

Côté frontend, aucun code ne tire `check()` aujourd'hui — la première fois
qu'on activera l'updater, on appellera explicitement
`@tauri-apps/plugin-updater::check` depuis un effect au démarrage.

### Pourquoi `pubkey` vide pour l'instant

Sans paire de clés signée :
- Pas moyen de garantir l'authenticité d'un bundle servi par un attaquant
  qui prendrait le contrôle de `releases.mnemosys.app`.
- Tauri refuse d'appliquer une mise à jour sans signature vérifiée.

Mieux vaut donc **désactiver le mécanisme** plutôt que livrer un updater
naïf. Le champ `endpoints` est conservé (placeholder
`https://releases.mnemosys.app/{{target}}/{{current_version}}`) pour que la
config soit explicite : le jour où l'on génère une keypair, on remplit
`pubkey` et tout s'enclenche sans diff structurel.

### Comment activer (procédure complète)

#### Étape 1 — Générer une paire de clés Tauri

```bash
pnpm tauri signer generate -w ~/.tauri/mnemosys.key
# Sortie : private key (à conserver hors repo) + public key (à coller dans
# tauri.conf.json::plugins.updater.pubkey)
```

La clé privée est protégée par mot de passe ; le mot de passe doit être
configuré dans la variable d'env `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` au
moment du build (et dans les secrets GitHub Actions du workflow release).

#### Étape 2 — Renseigner la pubkey

Dans `src-tauri/tauri.conf.json` :

```json
"plugins": {
  "updater": {
    "endpoints": ["https://releases.mnemosys.app/{{target}}/{{current_version}}"],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlz...",
    "dangerousInsecureTransportProtocol": false
  }
}
```

Activer aussi `bundle.createUpdaterArtifacts = true` dans le même fichier
pour que `tauri build` produise les `.sig` à côté des binaires.

#### Étape 3 — Publier le manifest

Le manifest est un JSON statique servi sur HTTPS, par exemple via GitHub
Pages sur le repo `mnemosys-releases` :

```json
{
  "version": "0.2.0",
  "notes": "Voir CHANGELOG.md pour les détails.",
  "pub_date": "2026-06-01T12:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/.../mnemosys_0.2.0_amd64.AppImage.tar.gz"
    },
    "darwin-aarch64": { "signature": "...", "url": "..." },
    "windows-x86_64": { "signature": "...", "url": "..." }
  }
}
```

L'URL servie doit matcher le pattern `endpoints` ci-dessus :
`/<target>/<current_version>` où `<target>` ∈ `{linux-x86_64, darwin-x86_64, darwin-aarch64, windows-x86_64}`.

#### Étape 4 — Appeler l'updater au démarrage

Côté React, dans un effet d'init root :

```ts
import { check } from "@tauri-apps/plugin-updater";

useEffect(() => {
  void check().then((upd) => {
    if (upd) toast({ title: `Mise à jour ${upd.version} disponible` });
  });
}, []);
```

---

## 6. Signature des binaires

Pour produire des bundles que macOS et Windows acceptent d'installer sans
avertissement « éditeur inconnu » :

| OS | Outil | Coût annuel | Notes |
| --- | --- | --- | --- |
| macOS | Apple Developer ID + `codesign` + notarytool | ~99 $/an | Notarization obligatoire depuis Catalina pour binaires hors App Store. |
| Windows | Authenticode (cert EV ou OV) | ~300 $/an | SignTool intégré au SDK. EV nécessaire pour éviter SmartScreen sur < ~3000 téléchargements. |
| Linux AppImage | GPG | Gratuit | Signature détachée `.AppImage.gpg`. Pas obligatoire mais facilite la confiance. |
| Linux `.deb` | `dpkg-sig` | Gratuit | Idem AppImage, optionnel mais propre. |

**Hors scope du MVP** : tant que Mnemosys n'a pas de revenu ni d'usage public
massif, l'investissement n'est pas justifié. La procédure est documentée ici
pour que la transition soit triviale le jour venu.

Côté Tauri, la signature s'active via :

- macOS : config `bundle.macOS.signingIdentity` + variables
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`.
- Windows : `bundle.windows.certificateThumbprint` ou `tauri.conf.json::bundle.windows.signCommand`.
- Linux : aucune intervention Tauri ; signer le bundle après build avec
  `gpg --detach-sign --armor`.

---

## 7. License MIT

`LICENSE` à la racine du repo. La licence MIT a été choisie pour :

- Permettre la **réutilisation commerciale** (un fork qui vendrait Mnemosys
  comme service ne pose pas de problème de redistribution).
- Garder une **compatibilité totale** avec les dépendances Rust et JS
  amont, dont la quasi-totalité est sous MIT ou Apache-2.0.
- **Pas de copyleft** : pas d'obligation pour les forks de republier
  leurs modifications, ce qui simplifie l'adoption en milieu institutionnel.

Si Mnemosys passe un jour en mode « commercial avec source visible »
(business source license, FSL), `LICENSE` sera remplacé et un nouveau commit
documentera la migration.

---

## 8. Récapitulatif des artefacts livrés

| Fichier | Rôle |
| --- | --- |
| `src/components/settings/FsrsOptimizerSection.tsx` | UI Settings — bouton « Calibrer FSRS » + progress bar. |
| `src/lib/queries.ts` (nouveau bloc S4) | `useTotalReviewsCount` + `useOptimizeFsrsParams`. |
| `src/lib/tauri.ts` (nouveau bloc S4) | Type `OptimizeResult` + `api.fsrsOptimizer`. |
| `src-tauri/tauri.conf.json` | Bloc `plugins.updater` (inerte, pubkey vide). |
| `.github/workflows/ci.yml` | Workflow CI 3 jobs. |
| `docs/SESSION_4_RELEASE.md` | Ce document. |

Tout le reste (commandes Rust de l'optimiseur, plugin updater enregistré,
LICENSE MIT) avait déjà landed dans les commits précédents.
