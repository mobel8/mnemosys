/**
 * "?" — global keyboard shortcuts cheat sheet.
 *
 * The dialog is mounted once by `App.tsx`; the global hotkey listener there
 * toggles `open`. Sections are static and kept in sync with the actual
 * handlers wired by the routes that own them (review session, deck pages,
 * etc.).
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: Shortcut[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["g", "h"], description: "Aller à l'accueil" },
      { keys: ["g", "s"], description: "Aller aux statistiques" },
      { keys: ["g", "p"], description: "Aller aux paramètres" },
    ],
  },
  {
    title: "Session de révision",
    shortcuts: [
      { keys: ["Espace"], description: "Voir la réponse" },
      { keys: ["1"], description: "Again — j'ai oublié" },
      { keys: ["2"], description: "Hard — difficile" },
      { keys: ["3"], description: "Good — correct" },
      { keys: ["4"], description: "Easy — facile" },
      { keys: ["E"], description: "Éditer la carte" },
      { keys: ["S"], description: "Suspendre la carte" },
      { keys: ["Esc"], description: "Quitter la session" },
    ],
  },
  {
    title: "Création",
    shortcuts: [
      { keys: ["Ctrl", "Enter"], description: "Ajouter et nouveau (formulaire de carte)" },
    ],
  },
  {
    title: "Global",
    shortcuts: [{ keys: ["?"], description: "Afficher cette aide" }],
  },
];

export function ShortcutsHelpDialog({ open, onOpenChange }: ShortcutsHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
          <DialogDescription>
            Mnemosys est pensé pour la vitesse. Mémorise quelques raccourcis et oublie la souris.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <li
                    key={`${section.title}-${shortcut.keys.join("+")}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">{shortcut.description}</span>
                    <span className="flex items-center gap-1">
                      {shortcut.keys.map((key, idx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: <static legend>
                        <span key={idx} className="flex items-center gap-1">
                          {idx > 0 && <span className="text-muted-foreground text-xs">+</span>}
                          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-semibold uppercase text-foreground shadow-sm">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
