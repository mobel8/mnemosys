# Mnemosys — Design System (« Studio Moderne »)

> **Système verrouillé.** Toute page/composant DOIT référencer les tokens nommés ci-dessous
> (jamais d'OKLCH/hex inline, jamais de `font-family` brute). Source de vérité des tokens :
> [`src/styles/globals.css`](src/styles/globals.css). Ce fichier est le contrat partagé par
> tous les agents de redesign — les pages doivent **partager** le système, pas en diverger.

- **Genre** : modern-minimal (adapté à une application, pas une landing page)
- **Stack** : React 19 · Tailwind 4 (`@theme`) · shadcn/ui (Radix + cva) · framer-motion 12 · lucide-react
- **Vibe** : « logiciel cher », net, focalisé, premium. Light + dark sont des pairs égaux.

## Typographie

| Rôle | Famille (token) | Usage |
|---|---|---|
| Display | `var(--font-display)` → **Space Grotesk Variable** | `h1–h4`, titres, gros chiffres héros. Tracking serré (`-0.02em`/`-0.03em`). Utilitaire : `font-display`. |
| Body / UI | `var(--font-sans)` → **Inter Variable** | tout le reste. |
| Mono / chiffres | `var(--font-mono)` → **JetBrains Mono Variable** | KPIs, durées, versions, code. `tabular-nums`. |

Polices auto-hébergées (`@fontsource-variable/*`, importées dans `src/main.tsx`) → **offline-safe**, aucune CDN.

## Couleur (tokens sémantiques — light / dark gérés par `.dark`)

Accent de marque : **indigo-violet** `oklch(0.55 0.19 275)` (light) / `oklch(0.66 0.18 282)` (dark).

| Token Tailwind | Rôle |
|---|---|
| `bg-background` / `text-foreground` | canvas papier chaud (light) / ardoise-indigo (dark) + texte |
| `bg-card` | surfaces qui « lèvent » au-dessus du canvas (+ `shadow-sm`) |
| `bg-primary` / `text-primary-foreground` | **actions principales / CTA** (indigo) |
| `bg-accent` / `text-accent-foreground` | hover + **état actif** (fond indigo discret + texte/icône indigo) |
| `bg-muted` / `text-muted-foreground` | fonds neutres, texte secondaire |
| `bg-secondary` | boutons secondaires, puces |
| `text-destructive` / `bg-destructive` | erreurs/suppressions (rouge) — **ne jamais** l'utiliser pour un « 0 » neutre |
| `text-success` / `text-warning` | succès (vert) / alerte (ambre) |
| `border` / `ring` | filets hairline / anneau de focus (indigo) |
| `bg-brand-50…900` | échelle de marque (halos, dégradés, décor) |
| `*-chart-1…5` | palette de graphes (recharts) : indigo, cyan, vert, ambre, magenta |

## Forme, profondeur, motion

- **Rayon** : `--radius: 0.75rem` (12px). `rounded-lg`=12px (boutons), `rounded-xl`=16px (cartes), `rounded-2xl`=20px.
- **Ombres** (tokens, douces, teintées indigo) : `shadow-xs/sm/md/lg/xl` + `--shadow-glow` (CTA/accents, à doser). Dark = la profondeur passe par les bordures.
- **Motion** : easings `--ease-out/in/in-out` (jamais `ease` natif, jamais de bounce sur l'UI). Durées `--dur-fast 150ms` / `--dur 200ms` / `--dur-slow 320ms`. Animer **transform/opacity** uniquement. `prefers-reduced-motion` géré globalement.
- **Focus** : `:focus-visible` → anneau `ring-ring` 2px offset 2px, **instantané** (jamais animé).

## Voice des composants

- **Boutons** (`ui/button.tsx`) : `rounded-lg`, `transition-all 150ms`, `active:translate-y-px`, ombre douce + `hover:shadow-md`. `default`=indigo, `outline`=`bg-card`, `ghost`, `secondary`, `destructive`, `link`.
- **Cartes** (`ui/card.tsx`) : `rounded-xl border bg-card shadow-sm`. Les cartes interactives ajoutent `hover:shadow-md`.
- **Selects/checkboxes** : utiliser les primitives Radix stylées (`ui/select.tsx`, `ui/switch.tsx`…). **Bannir les `<select>`/`<input type=checkbox>` natifs** (tell de design inachevé).
- **États** : vide = carte douce centrée (icône brand + titre display + sous-texte + CTA) ; loading = **skeletons** `bg-muted animate-pulse` (pas seulement un spinner) ; erreur = carte `border-destructive/40`.
- **Nav** : sidebar groupée (en-têtes de section uppercase `text-muted-foreground/70`), item actif = `bg-accent text-accent-foreground`.

## À NE PAS faire

- Pas d'OKLCH/hex inline ni de `font-family` brute → toujours un token.
- Pas de gris zéro-chroma (`oklch(… 0 0)`) — tout porte une légère teinte.
- Pas de texte en dégradé, pas de glassmorphism, pas d'easing bounce sur l'UI.
- Pas de libellés EN dans l'UI FR (cohérence : tout en français).

## Langue

UI **entièrement en français**. Termes techniques/identifiants de code restent en anglais.
