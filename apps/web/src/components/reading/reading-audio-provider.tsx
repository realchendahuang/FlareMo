import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const POSITION_KEY_PREFIX = "flaremo-audio-position:";

export type ReadingAudioTrack = {
  id: string;
  filename: string;
  src: string;
  contentType?: string | null;
};

type ReadingAudioContextValue = {
  track: ReadingAudioTrack | null;
  /** All tracks available in this memo, so the bar can switch between them. */
  tracks: ReadingAudioTrack[];
  selectTrack: (id: string) => void;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  follow: boolean;
  toggle: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
  setFollow: (follow: boolean) => void;
  /**
   * Fires on every playback tick. The transcript subscribes here instead of
   * reading `currentTime` from context so a long body is never re-rendered
   * once per second.
   */
  subscribeTime: (listener: (seconds: number) => void) => () => void;
};

const ReadingAudioContext = createContext<ReadingAudioContextValue | null>(
  null,
);

export function useReadingAudio() {
  return useContext(ReadingAudioContext);
}

/** Playback position survives navigation, keyed per attachment. */
export function readSavedPosition(id: string): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = localStorage.getItem(`${POSITION_KEY_PREFIX}${id}`);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function savePosition(id: string, seconds: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      `${POSITION_KEY_PREFIX}${id}`,
      String(Math.floor(seconds)),
    );
  } catch {
    // Storage can be unavailable (private mode, quota); playback still works.
  }
}

export function ReadingAudioProvider({
  children,
  tracks,
}: {
  children: ReactNode;
  tracks: ReadingAudioTrack[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const listeners = useRef(new Set<(seconds: number) => void>());
  const [activeId, setActiveId] = useState<string | null>(
    tracks[0]?.id ?? null,
  );
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [follow, setFollow] = useState(true);

  const track = useMemo(
    () => tracks.find((item) => item.id === activeId) ?? tracks[0] ?? null,
    [tracks, activeId],
  );

  const emitTime = useCallback((seconds: number) => {
    for (const listener of listeners.current) listener(seconds);
  }, []);

  const subscribeTime = useCallback((listener: (seconds: number) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  // Restore the saved position whenever the active track changes. The element
  // itself is a single node in the DOM, so its source swaps in place.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    const saved = readSavedPosition(track.id);
    const apply = () => {
      if (saved > 0 && audio.duration > saved + 1) {
        audio.currentTime = saved;
      }
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [track]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const target = Math.max(0, Math.min(seconds, audio.duration || seconds));
      audio.currentTime = target;
      setCurrentTime(target);
      emitTime(target);
    },
    [emitTime],
  );

  const setRate = useCallback((next: number) => {
    setRateState(next);
  }, []);

  const selectTrack = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const value: ReadingAudioContextValue = {
    track,
    tracks,
    selectTrack,
    playing,
    currentTime,
    duration,
    rate,
    follow,
    toggle,
    seek,
    setRate,
    setFollow,
    subscribeTime,
  };

  return (
    <ReadingAudioContext.Provider value={value}>
      {children}
      {track && (
        // biome-ignore lint/a11y/useMediaCaption: user-supplied audio has no caption track.
        <audio
          onDurationChange={(event) =>
            setDuration(event.currentTarget.duration)
          }
          onEnded={() => setPlaying(false)}
          onPause={() => {
            setPlaying(false);
            if (track)
              savePosition(track.id, audioRef.current?.currentTime ?? 0);
          }}
          onPlay={() => setPlaying(true)}
          onTimeUpdate={(event) => {
            const seconds = event.currentTarget.currentTime;
            setCurrentTime(seconds);
            emitTime(seconds);
          }}
          preload="metadata"
          ref={audioRef}
          src={track.src}
        />
      )}
    </ReadingAudioContext.Provider>
  );
}
