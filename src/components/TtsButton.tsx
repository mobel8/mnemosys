/**
 * Reusable Text-to-Speech button.
 *
 * Drives `synthesize_audio` through `useSynthesizeAudio` and plays the
 * resulting MP3 via an internal `<audio>` element. The Rust side returns
 * an absolute disk path which must be wrapped with `convertFileSrc()` for
 * the WebView (Tauri 2 `asset://` protocol).
 *
 * Tristate visual:
 *   - idle      → Volume2 icon
 *   - loading   → animated Loader2 (mutation pending)
 *   - playing   → Volume2 + a subtle pulse + primary tint
 *
 * The default voice/speed come from `useSettingsQuery`. If `voice` is
 * passed explicitly it wins. We keep a tiny in-memory cache keyed by
 * `text|voice|speed` to avoid re-issuing identical requests within a
 * session (server-side caching exists, but skipping the IPC is free).
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useSettingsQuery, useSynthesizeAudio } from "@/lib/queries";
import type { TTSVoice } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const DEFAULT_VOICE: TTSVoice = "nova";
const DEFAULT_SPEED = 1.0;
const VALID_VOICES: readonly TTSVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "sage",
];

/** Session-scoped cache: avoids re-invoking Tauri for the same input twice. */
const pathCache = new Map<string, string>();

function cacheKey(text: string, voice: TTSVoice, speed: number): string {
  return `${voice}|${speed}|${text}`;
}

function resolveVoice(raw: string | null | undefined): TTSVoice {
  if (raw && (VALID_VOICES as readonly string[]).includes(raw)) {
    return raw as TTSVoice;
  }
  return DEFAULT_VOICE;
}

export interface TtsButtonProps {
  text: string;
  /** Override voice (defaults to user setting -> "nova"). */
  voice?: TTSVoice;
  /** Tailwind extras for sizing. */
  className?: string;
  /** Affiche un label texte a cote de l'icone. Default: false. */
  showLabel?: boolean;
  /** `disabled` from outside (e.g. empty text). */
  disabled?: boolean;
}

export function TtsButton({ text, voice, className, showLabel = false, disabled }: TtsButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const settingsQuery = useSettingsQuery();
  const synthesize = useSynthesizeAudio();

  const effectiveVoice: TTSVoice = voice ?? resolveVoice(settingsQuery.data?.tts_voice);
  const effectiveSpeed: number = settingsQuery.data?.tts_speed ?? DEFAULT_SPEED;

  const trimmed = text.trim();
  const isEmpty = trimmed.length === 0;
  const isLoading = synthesize.isPending;
  const isDisabled = Boolean(disabled) || isEmpty || isLoading;

  function playFromPath(path: string) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = convertFileSrc(path);
    audio.currentTime = 0;
    void audio.play().catch((err: unknown) => {
      setIsPlaying(false);
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Lecture impossible",
        description: message,
        variant: "destructive",
      });
    });
  }

  function handleClick() {
    if (isDisabled) return;

    // If currently playing, treat the click as a stop.
    const audio = audioRef.current;
    if (audio && isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    const key = cacheKey(trimmed, effectiveVoice, effectiveSpeed);
    const cachedPath = pathCache.get(key);
    if (cachedPath) {
      playFromPath(cachedPath);
      return;
    }

    synthesize.mutate(
      { text: trimmed, voice: effectiveVoice, speed: effectiveSpeed },
      {
        onSuccess: (result) => {
          pathCache.set(key, result.path);
          playFromPath(result.path);
        },
        onError: (err) => {
          const message = err.message ?? "Erreur inconnue";
          const isMissingKey = /api key/i.test(message);
          toast({
            title: isMissingKey ? "Cle API manquante" : "Synthese vocale impossible",
            description: isMissingKey ? "Configurer dans Settings -> API keys." : message,
            variant: "destructive",
          });
        },
      },
    );
  }

  const label = isLoading ? "Synthese..." : isPlaying ? "Lecture..." : "Lire";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={showLabel ? "sm" : "icon"}
        onClick={handleClick}
        disabled={isDisabled}
        aria-label={label}
        title={label}
        className={cn("shrink-0", isPlaying && "text-primary animate-pulse", className)}
      >
        {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : <Volume2 aria-hidden />}
        {showLabel && <span className="ml-1">{label}</span>}
      </Button>
      {/** biome-ignore lint/a11y/useMediaCaption: TTS playback of user-supplied text — no captions available. */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => setIsPlaying(false)}
        className="hidden"
      />
    </>
  );
}
