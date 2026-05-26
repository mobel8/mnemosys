# Contributing — Mnemosys

Merci de vouloir contribuer ! Ce doc condense le strict nécessaire pour proposer une PR propre.

## Setup de l'environnement de dev

Prérequis détaillés dans le [README — Installation](./README.md#installation). En résumé :

```bash
git clone <repo-url> mnemosys
cd mnemosys

# Outils de base
node --version   # >= 22
pnpm --version   # >= 9
rustup default stable   # >= 1.81

# Deps OS (Linux Debian/Ubuntu)
sudo apt install -y libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
                    libsoup-3.0-dev build-essential

# Installation
pnpm install

# Lancement
pnpm tauri:dev
```

## Style de code

### Rust

- **rustfmt** + **clippy**. Avant chaque PR :
  ```bash
  cd src-tauri
  cargo fmt --all
  cargo clippy --all-targets --all-features -- -D warnings
  cargo test
  ```
- Pas de `unwrap()` ni de `expect()` dans le code de prod (hors mutex poisoning explicite). Utilise `?` avec `AppResult<T>`.
- Documente les modules et les fonctions publiques avec `///` (un paragraphe minimum, le « pourquoi » plus que le « quoi »).
- Les `#[tauri::command]` doivent rester de fines couches : déléguer la logique à une fonction pure adjacente pour qu'elle soit testable sans Tauri.

### TypeScript / React

- **Biome** est seul juge :
  ```bash
  pnpm lint        # check
  pnpm lint:fix    # fix automatique
  pnpm format
  pnpm typecheck
  ```
- Pas de `any` implicite (`noImplicitAny`, `noUncheckedIndexedAccess` activés).
- Composants fonctionnels + hooks. Pas de classe React.
- Style : Tailwind utility-first. Pas de CSS custom sauf cas extrême.
- Naming :
  - composants : `PascalCase.tsx`
  - hooks : `useFooBar`
  - fichiers utilitaires : `kebab-case.ts`
- Les types et interfaces côté frontend miroitent **snake_case** sur les champs venant du backend serde (cf. `src/lib/tauri.ts`).
- Les wrappers `api.<feature>.<command>(...)` exposent du **camelCase** côté TS (Tauri convertit automatiquement).

## Tests requis pour une PR

| Type de changement | Tests minimaux |
|--------------------|----------------|
| Nouvelle `#[tauri::command]` | Test unitaire Rust sur la fonction pure sous-jacente (in-memory DB via `Database::for_test()`). |
| Nouveau hook React / nouvelle query | Mock `@tauri-apps/api/core` dans le test ; vérifier les invalidations de cache. |
| Nouveau composant UI critique | Test Testing Library + jsdom (focus interaction, accessibility role). |
| Changement schéma DB | Nouvelle migration `vN__*.sql`, bump `CURRENT_VERSION`, test de la migration. |
| Changement FSRS | Au moins un golden test fixant le résultat attendu sur un set de paramètres connus. |

Commandes :
```bash
pnpm test                          # Vitest
pnpm test:e2e                      # Playwright (nécessite tauri:dev actif)
cd src-tauri && cargo test         # Rust unit + integration
```

CI exécute les trois suites + lint + typecheck. PR doivent passer le tout.

## Convention de commits (Conventional Commits)

Format :
```
<type>(<scope>): <résumé court à l'impératif>

<corps facultatif, expliquant le pourquoi>

<footer facultatif : Breaking, Closes, Co-Authored-By...>
```

Types autorisés :
- `feat` — nouvelle fonctionnalité utilisateur
- `fix` — correction de bug
- `refactor` — réécriture sans changement de comportement
- `perf` — optimisation
- `test` — ajout/modif de tests
- `docs` — documentation seule
- `chore` — outillage, deps, config CI
- `style` — formatage (rare ; les hooks devraient gérer)

Exemples :
```
feat(fsrs): expose preview_next_states command
fix(review): prevent rating bypass during submission
refactor(db): split notes repo into separate module
docs(user-guide): document cloze multi-cN syntax
```

Scope optionnel mais recommandé (`fsrs`, `db`, `commands`, `frontend`, `stats`, `io`, etc.).

## Process de review

1. **Branche** depuis `main`. Nomme-la `feature/<short>`, `fix/<short>`, `refactor/<short>` ou `docs/<short>`.
2. **Commits atomiques** suivant la convention ci-dessus. Squash si tu accumules des WIPs.
3. **PR title** = même format qu'un commit (`feat(scope): …`).
4. **PR body** :
   - Contexte / motivation (1-3 lignes).
   - Liste des changements principaux.
   - Captures d'écran si UI.
   - Lien éventuel vers issue / spec.
   - Test plan : ce que le reviewer doit vérifier manuellement.
5. **Self-review** avant publish : `git diff main`, relis pour les `TODO`, `console.log`, `eprintln!`, fichiers oubliés.
6. **CI verte** obligatoire avant merge.
7. **Au moins 1 approbation** d'un autre contributeur.
8. **Merge** : squash-and-merge par défaut, sauf si la branche est déjà une chaîne propre de commits indépendants (alors rebase-and-merge).

## Bonnes pratiques générales

- **Surface IPC unique** : si tu ajoutes une commande Rust, ajoute son wrapper dans `src/lib/tauri.ts` dans la même PR. Ne laisse jamais le frontend appeler `invoke()` en direct.
- **Pas de SQL côté frontend.** Même pour un quick fix. C'est le backend qui possède la DB.
- **Migrations append-only.** On n'édite pas une migration existante après merge — on en crée une nouvelle.
- **Pas de breaking changes du format JSON export** sans bump explicite du champ `version` + path de migration documenté.
- **Tout nouveau composant UI doit fonctionner en light ET dark mode.** Utilise les variables CSS de shadcn (`--background`, `--foreground`, etc.).

## Bug reports

Ouvre une issue avec :
- Titre clair (`[bug] review session freezes when …`).
- Étapes pour reproduire.
- Comportement attendu vs observé.
- Logs (terminal `pnpm tauri:dev` + console DevTools de la webview).
- Environnement (OS, version de Mnemosys, display server sur Linux).

## Questions

Ouvre une issue avec le label `question` ou ping l'équipe sur le channel projet.

Merci, et bon code.
