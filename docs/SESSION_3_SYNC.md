# Session 3 — Synchronisation cloud (Mnemosys)

Document de design pour la sync optionnelle vers un backend Supabase (Postgres
+ Auth + RLS). Le code de la S3 est un **scaffolding** : tout compile, tout est
testé hors HTTP, mais aucun appel réel ne tournera tant que l'utilisateur
n'aura pas renseigné une `supabase_url` valide et configuré son projet.

## 1. Objectifs

- Sync **opt-in** (désactivée par défaut, aucune télémétrie sans consentement).
- **Offline-first** : l'app continue de fonctionner sans réseau, la sync rattrape
  au retour de connectivité.
- **Multi-device** : un compte Supabase = un trousseau de decks/notes/cards
  partagé entre tous les terminaux.
- **Idempotente** : rejouer un push n'altère pas les données déjà reçues.

Hors scope MVP S3 (follow-ups) : chiffrement E2E, partage social de decks,
résolution interactive des conflits, sync des médias (images d'occlusion, MP3
de TTS) — pour l'instant on ne synchronise que les rows DB.

## 2. Schéma Supabase

Quatre tables miroir + une seule rangée par user :

```sql
-- Activé pour chaque table ci-dessous.
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON <t> USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL,
    desired_retention DOUBLE PRECISION NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT  -- tombstone, NULL = vivant
);

CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    deck_id UUID NOT NULL REFERENCES decks(id),
    template TEXT NOT NULL,
    fields JSONB NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    note_id UUID NOT NULL REFERENCES notes(id),
    deck_id UUID NOT NULL REFERENCES decks(id),
    card_ord INTEGER NOT NULL,
    state TEXT NOT NULL,
    stability DOUBLE PRECISION, difficulty DOUBLE PRECISION,
    last_review BIGINT, next_review BIGINT,
    elapsed_days INTEGER, scheduled_days INTEGER,
    reps INTEGER, lapses INTEGER, suspended BOOLEAN,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    card_id UUID NOT NULL REFERENCES cards(id),
    rating SMALLINT NOT NULL,
    state_before TEXT NOT NULL, state_after TEXT NOT NULL,
    stability_before DOUBLE PRECISION, stability_after DOUBLE PRECISION NOT NULL,
    difficulty_before DOUBLE PRECISION, difficulty_after DOUBLE PRECISION NOT NULL,
    elapsed_days INTEGER, scheduled_days INTEGER, review_time INTEGER,
    reviewed_at BIGINT NOT NULL
);
CREATE INDEX ON reviews(user_id, reviewed_at);
```

**Mapping local ↔ distant.** SQLite garde ses `INTEGER PK AUTOINCREMENT` ; la
colonne ajoutée par la migration v3 `remote_id TEXT` stocke l'UUID Supabase.
À l'inverse, le serveur conserve l'UUID — la première synchro d'une row locale
push avec `remote_id = NULL`, le serveur renvoie l'UUID assigné qu'on persiste.

## 3. Stratégie CRDT

- **Decks / Notes / Cards** : LWW (Last-Write-Wins) sur `updated_at`. À l'apply,
  si `remote.updated_at > local.updated_at` on remplace, sinon on ignore. Égalité
  → on garde le local (tie-breaker arbitraire mais déterministe). Les
  suppressions sont des **tombstones** : `deleted_at` non-null. À l'apply local,
  un tombstone supprime la row (cascade FK conservé).
- **Reviews** : append-only, fusion = union par `(card_id, reviewed_at)`.
  Aucun conflit possible — on ne corrige jamais un review passé.
- **Cards (champs FSRS)** : LWW global sur `updated_at`. Conséquence : si deux
  terminaux notent la même carte sans s'être resynchronisés, le dernier wins.
  C'est imparfait mais conforme à la pratique d'Anki/RemNote. Un follow-up
  CRDT (G-Counter sur `reps`/`lapses`, fusion par max) reste possible si besoin.

## 4. Endpoints REST (PostgREST via Supabase)

Tout passe par l'API REST auto-générée. Le client Rust (reqwest) signe chaque
requête avec le JWT obtenu à l'auth.

| Méthode | Chemin | Usage |
|---|---|---|
| `GET` | `/rest/v1/decks?updated_at=gt.<ts>` | Pull delta |
| `POST` | `/rest/v1/decks` (header `Prefer: resolution=merge-duplicates`) | Push (upsert sur PK) |
| `PATCH` | `/rest/v1/decks?id=eq.<uuid>` | Update champ par champ |
| idem pour notes / cards / reviews | | |
| `POST` | `/auth/v1/token?grant_type=password` | Login |
| `POST` | `/auth/v1/logout` | Logout |
| `POST` | `/auth/v1/token?grant_type=refresh_token` | Refresh |

Format de payload : JSON, snake_case (PostgREST le respecte). Les batch push
envoient un tableau `[{...}, {...}]` avec `Prefer: return=representation` pour
récupérer les UUID neufs.

## 5. Flow d'authentification

1. L'utilisateur saisit `supabase_url` dans Settings.
2. `sync_login(email, password)` → `POST /auth/v1/token?grant_type=password`.
3. Le JWT (access + refresh + expiry) est persisté dans `sync_session.json`
   via `tauri-plugin-store`.
4. Au démarrage de l'app, on charge la session, on contrôle `expires_at` et on
   refresh silencieusement si <60 s.
5. `sync_logout()` purge le store et stoppe les sync planifiées.

## 6. Cycle de sync

Délenché manuellement (bouton « Synchroniser maintenant ») ou périodiquement
(`SyncCron::every(15min)`, à implémenter en S4).

```
last_sync = sync_state.last_sync_at
push  := extract local changes WHERE updated_at > last_sync OR remote_id IS NULL
pull  := GET /rest/v1/*?updated_at=gt.<last_sync>
resolve := LWW merge (push response can override locals if server re-stamped)
commit  := UPDATE sync_state SET last_sync_at = now()
```

Idempotence : on s'appuie sur `updated_at` côté serveur (déclencheur Postgres
qui force `NEW.updated_at = max(NEW.updated_at, now())`) ; un push dupliqué ne
modifie rien si l'`updated_at` est identique. Le client garde aussi un buffer
des UUID en cours d'upload pour éviter les double-INSERT.

## 7. Conflits & cas limites

- **Suppression vs édition** : tombstone gagne si `deleted_at > updated_at` côté
  remote. Sinon l'édition wins (et le tombstone est ignoré ; la prochaine
  suppression locale enverra un nouveau tombstone).
- **Network failure mid-push** : transaction côté serveur est atomique par row
  (PostgREST). On retient les rows ack-ées dans une mémoire locale ; au prochain
  cycle, les rows non-ack repartent.
- **Clock skew** : `updated_at` est un `i64` unix-epoch en secondes. Le serveur
  override avec `max(client_ts, now())` pour borner les divergences.
- **Quota** : si Supabase répond `429`, on backoff exponentiel (S4).

## 8. Sécurité

- RLS sur toutes les tables : `user_id = auth.uid()`. Toute requête sans JWT
  ou avec un JWT d'un autre utilisateur reçoit 0 ligne.
- JWT en clair dans `sync_session.json` (limite acceptée MVP). S4 migrera vers
  le keychain OS (`tauri-plugin-stronghold` ou `keyring`).
- Pas de chiffrement E2E pour le MVP : Supabase voit les contenus en clair.
  Follow-up : libsodium côté client + colonnes `*_ciphertext` côté serveur,
  RLS protégeant uniquement les clés `user_id`.

## 9. Tests

- `delta.rs` : extract des rows modifiées depuis un timestamp (table par
  table) — testé en SQLite in-memory.
- `apply.rs` : LWW merge — golden tests sur les 4 cas (newer remote, newer
  local, equal, tombstone).
- `auth.rs` / `client.rs` : pas de tests d'intégration sans serveur ; tests
  unitaires d'erreur (URL absente → `AppError::Validation`).

## 10. Roadmap S3 → S4

- **S3 (livré)** : design doc, migration v3, scaffolding Rust, commandes
  stub, UI Settings.
- **S4** : implem complète de `client.rs` (POST/PATCH réels), cron sync,
  E2E test contre un projet Supabase de staging, gestion des médias,
  E2E encryption, partage de decks.
