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

import { Cloud, CloudOff, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import {
  useSaveSettings,
  useSettingsQuery,
  useSyncLogin,
  useSyncLogout,
  useSyncNow,
  useSyncStatus,
} from "@/lib/queries";
import type { AppSettings } from "@/lib/tauri";

const DEFAULTS: AppSettings = {
  theme: "system",
  desired_retention: 0.9,
  daily_new_limit: 20,
  daily_review_limit: 200,
  show_next_interval: true,
  openai_api_key: null,
  tts_voice: null,
  tts_speed: null,
  piper_enabled: false,
  piper_binary_path: "",
  piper_model_path: "",
  anthropic_api_key: null,
  supabase_url: null,
  supabase_anon_key: null,
  type_the_answer_enabled: false,
  confidence_rating_enabled: false,
  pre_questioning_enabled: false,
  neuro_modes_enabled: false,
  mood_checkin_enabled: false,
  movement_break_minutes: 25,
  cyclic_sighing_enabled: false,
  sketch_before_flip_enabled: false,
  delayed_jol_enabled: false,
  jol_delay_minutes: 30,
  voice_answer_enabled: false,
  pretest_mode_enabled: false,
  self_explanation_enabled: false,
  focus_guard_enabled: false,
  ollama_enabled: false,
  ollama_url: null,
  ollama_model: null,
  chronotype: null,
  ambient_sound: "none",
  hands_free_enabled: false,
};

function formatLastSync(ts: number | null): string {
  if (ts == null) return "Jamais";
  const date = new Date(ts * 1000);
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SyncSection() {
  const settingsQuery = useSettingsQuery();
  const statusQuery = useSyncStatus();
  const saveSettings = useSaveSettings({
    onSuccess: () => {
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
  const syncNow = useSyncNow({
    onSuccess: (report) => {
      const pushed =
        report.decks_pushed + report.notes_pushed + report.cards_pushed + report.reviews_pushed;
      const pulled =
        report.decks_pulled + report.notes_pulled + report.cards_pulled + report.reviews_pulled;
      toast({
        title: "Synchronisation terminée",
        description: `${pushed} ligne(s) envoyée(s), ${pulled} reçue(s).`,
      });
    },
    onError: (err) => {
      toast({
        title: "Échec de la synchronisation",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Hydrate from persisted settings once they arrive.
  useEffect(() => {
    const s = settingsQuery.data ?? DEFAULTS;
    setSupabaseUrl(s.supabase_url ?? "");
    setAnonKey(s.supabase_anon_key ?? "");
  }, [settingsQuery.data]);

  const status = statusQuery.data;

  async function handleSaveSupabaseConfig() {
    const current = settingsQuery.data ?? DEFAULTS;
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
        </CardTitle>
        <CardDescription>
          Sauvegarde ta collection sur ton propre projet Supabase et synchronise-la entre plusieurs
          appareils. Optionnel — l'application reste pleinement fonctionnelle sans connexion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---- Supabase project config ---- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Projet Supabase</h3>
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
              <p className="font-medium">Sync cloud désactivée</p>
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
            <Button
              type="button"
              size="sm"
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
            >
              {syncNow.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Synchroniser maintenant
            </Button>
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
