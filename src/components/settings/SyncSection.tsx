/**
 * Settings → "Sync cloud" (Session 3 — Supabase scaffolding).
 *
 * Three UI states driven by `useSyncStatus()`:
 *   1. **Not configured** — banner explaining how to populate
 *      `supabase_url` + `supabase_anon_key`. Saving the inputs flips the
 *      status query and the form below appears.
 *   2. **Configured + logged out** — email/password form calling
 *      `sync_login`.
 *   3. **Logged in** — current email + last sync timestamp + actions
 *      ("Synchroniser maintenant" / "Se déconnecter").
 *
 * The component is intentionally pessimistic: every mutation refetches the
 * status query so the rendered branch always reflects the persisted state.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import {
  queryKeys,
  useSaveSettings,
  useSettingsQuery,
  useSyncLogin,
  useSyncLogout,
  useSyncStatus,
} from "@/lib/queries";
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/stores/settings";
import type { AppSettings } from "@/lib/tauri";

function formatLastSync(ts: number | null): string {
  if (ts == null) return "Jamais";
  const date = new Date(ts * 1000);
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * P108 — états de chargement / d'erreur harmonisés pour le formulaire de
 * configuration Supabase. Tant que les réglages ne sont pas chargés, on ne
 * laisse pas l'utilisateur enregistrer : composer le payload à partir des
 * valeurs par défaut écraserait silencieusement la configuration serveur.
 */
function SettingsSkeleton() {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-busy="true"
      aria-label="Chargement des paramètres"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-3 w-2/3 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function SettingsErrorBanner({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1 space-y-2">
        <div>
          <p className="font-medium text-destructive">Impossible de charger les paramètres</p>
          <p className="mt-0.5 text-muted-foreground">{message}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Réessayer
        </Button>
      </div>
    </div>
  );
}

export function SyncSection() {
  const qc = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const statusQuery = useSyncStatus();
  const saveSettings = useSaveSettings({
    onSuccess: () => {
      // Saving the Supabase URL/key flips `status.configured` on the backend,
      // which decides which sub-form renders below. `useSaveSettings` only
      // invalidates the settings query, so refresh the sync-status query here
      // or the UI would stay stuck on the "not configured" branch.
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
      toast({ title: "Configuration Supabase enregistrée" });
    },
    onError: (err) => {
      toast({
        title: "Échec de la sauvegarde",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const login = useSyncLogin({
    onSuccess: () => {
      toast({ title: "Connexion réussie" });
    },
    onError: (err) => {
      toast({
        title: "Échec de la connexion",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const logout = useSyncLogout({
    onSuccess: () => {
      toast({ title: "Déconnexion effectuée" });
    },
  });
  // NOTE: `useSyncNow` is intentionally not wired here. The backend sync
  // client is still scaffolding (it exchanges no data and would advance
  // `last_sync_at` on an empty cycle), so the "Synchroniser maintenant"
  // action below is rendered disabled until the cloud backend is live and
  // audited. See P041 in the audit log.

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Hydrate the Supabase inputs from persisted settings exactly once, on
  // first arrival. Re-running on every `settingsQuery.data` change would wipe
  // the user's in-progress URL/key whenever another section saves and
  // invalidates the shared settings query (lost-update, P040).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !settingsQuery.data) return;
    hydratedRef.current = true;
    const s = settingsQuery.data;
    setSupabaseUrl(s.supabase_url ?? "");
    setAnonKey(s.supabase_anon_key ?? "");
  }, [settingsQuery.data]);

  const status = statusQuery.data;

  async function handleSaveSupabaseConfig() {
    // Re-read the freshest persisted settings before composing the payload so
    // fields owned by other sections survive. Never fall back to DEFAULTS
    // while real data exists.
    const refreshed = await settingsQuery.refetch();
    const current = refreshed.data ?? settingsQuery.data ?? DEFAULTS;
    const next: AppSettings = {
      ...current,
      supabase_url: supabaseUrl.trim() === "" ? null : supabaseUrl.trim(),
      supabase_anon_key: anonKey.trim() === "" ? null : anonKey.trim(),
    };
    saveSettings.mutate(next);
  }

  function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (email.trim() === "" || password === "") return;
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          setPassword("");
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-brand-500" />
          Synchronisation cloud
          <Badge variant="secondary">Bêta — bientôt disponible</Badge>
        </CardTitle>
        <CardDescription>
          La synchronisation multi-appareils via Supabase est en cours de développement. Tu peux
          déjà enregistrer les identifiants de ton projet, mais aucune donnée n'est encore échangée
          avec le serveur. L'application reste pleinement fonctionnelle sans connexion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---- Supabase project config ---- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Projet Supabase</h3>
          {/* P108 — tant que les réglages ne sont pas chargés, on n'affiche pas
              le formulaire : enregistrer composerait le payload à partir des
              DEFAULTS et écraserait la configuration serveur. */}
          {settingsQuery.isError ? (
            <SettingsErrorBanner
              message={settingsQuery.error.message}
              onRetry={() => {
                void settingsQuery.refetch();
              }}
              isRetrying={settingsQuery.isFetching}
            />
          ) : !settingsQuery.isSuccess ? (
            <SettingsSkeleton />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="supabase-url">URL du projet</Label>
                  <Input
                    id="supabase-url"
                    type="url"
                    autoComplete="off"
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supabase-anon">Clé anon (publique)</Label>
                  <Input
                    id="supabase-anon"
                    type="password"
                    autoComplete="off"
                    placeholder="eyJhbGciOi…"
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Crée un projet sur <strong>supabase.com</strong>, applique le schéma décrit dans{" "}
                <code>docs/SESSION_3_SYNC.md</code>, puis colle ici l'URL et la clé anon.
              </p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void handleSaveSupabaseConfig();
                  }}
                  disabled={saveSettings.isPending}
                >
                  {saveSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Enregistrer la configuration
                </Button>
              </div>
            </>
          )}
        </section>

        {/* ---- Status-driven content ---- */}
        {!status ? (
          <div
            className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4"
            role="status"
            aria-busy="true"
            aria-label="Chargement du statut"
          >
            <div className="mt-0.5 h-5 w-5 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded-lg bg-muted" />
              <div className="h-3 w-3/4 animate-pulse rounded-lg bg-muted" />
            </div>
          </div>
        ) : !status.configured ? (
          <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
            <CloudOff className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Synchronisation cloud désactivée</p>
              <p className="text-muted-foreground">
                Configure l'URL Supabase et la clé anon ci-dessus pour activer la synchronisation.
              </p>
            </div>
          </div>
        ) : status.logged_in ? (
          <section className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Connecté en tant que</p>
                <p className="text-sm text-muted-foreground">{status.email ?? "—"}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                {logout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Se déconnecter
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Dernière synchronisation : <strong>{formatLastSync(status.last_sync_at)}</strong>
            </p>
            <div className="space-y-1.5">
              <Button type="button" size="sm" disabled aria-disabled="true">
                <RefreshCw className="h-4 w-4" />
                Synchroniser maintenant
              </Button>
              <p className="text-xs text-muted-foreground">
                L'échange de données avec le serveur n'est pas encore actif — disponible dans une
                prochaine version.
              </p>
            </div>
          </section>
        ) : (
          <form className="space-y-3" onSubmit={handleLogin}>
            <h3 className="text-sm font-semibold">Connexion</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sync-email">Email</Label>
                <Input
                  id="sync-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sync-password">Mot de passe</Label>
                <Input
                  id="sync-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={login.isPending}>
                {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Se connecter
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
