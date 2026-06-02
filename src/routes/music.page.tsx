/**
 * Mode Musique page (Vague 16). Two creative-practice tools under one route,
 * split via Tabs: a metronome and an ear-training drill. Both are pure
 * frontend (Web Audio), so this page is loaded lazily through
 * `lazyRouteComponent` and pulls in no extra IPC or DB work.
 *
 * Grounded in Ericsson's deliberate-practice framing: the metronome supplies
 * a steady, progressively harder beat; ear training supplies immediate,
 * gradable feedback on pitch/interval recognition.
 */

import { Music2 } from "lucide-react";
import { EarTraining } from "@/components/music/EarTraining";
import { Metronome } from "@/components/music/Metronome";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MusicPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Music2 className="h-6 w-6 text-brand-500" /> Musique
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pratique délibérée : garde le tempo au métronome et affûte ton oreille.
        </p>
      </header>

      <Tabs defaultValue="metronome" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="metronome" data-testid="tab-metronome">
            Métronome
          </TabsTrigger>
          <TabsTrigger value="ear" data-testid="tab-ear">
            Oreille
          </TabsTrigger>
        </TabsList>

        <TabsContent value="metronome">
          <Card>
            <CardHeader>
              <CardTitle>Métronome</CardTitle>
              <CardDescription>
                Tempo régulier avec accent sur le premier temps. Active le ramp pour monter le BPM
                progressivement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Metronome />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ear">
          <Card>
            <CardHeader>
              <CardTitle>Entraînement de l'oreille</CardTitle>
              <CardDescription>
                Devine la note ou l'intervalle joué. Le score de la session s'accumule.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EarTraining />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
