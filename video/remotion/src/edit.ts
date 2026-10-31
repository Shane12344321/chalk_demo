import editJson from '../public/edit.json';
import manifestJson from '../public/audio/manifest.json';

export const FPS = 30;

export interface Word {
  w: string;
  s: number;
}
export interface Caption {
  speaker: 'tutor' | 'student' | 'narrator';
  start: number;
  end: number;
  words: Word[];
}
export interface AudioCue {
  src: string;
  start: number;
  volume: number;
  cut?: number;
}
export interface CamKey {
  t: number;
  x: number;
  y: number;
  z: number;
}

export const edit = editJson as unknown as {
  duration: number;
  shots: Record<'opener' | 'meet' | 'app' | 'montage' | 'how' | 'end', [number, number]>;
  app: {
    freezeAt: number;
    resumeAt: number;
    createAt: number;
    arriveAt: number;
    circleAt: number;
    cam: CamKey[];
    viewport: [number, number];
  };
  montage: {names: string[]; slot: number; titles: string[]};
  audio: AudioCue[];
  captions: Caption[];
};

type ManifestEntry = {file: string; duration: number; words?: {w: string; s: number; e: number}[]};
export const manifest = manifestJson as unknown as Record<string, ManifestEntry>;

/** Global start time (s) of a voice clip by id, from the edit's audio cues. */
export const cueStart = (id: string): number => {
  const cue = edit.audio.find((a) => a.src.includes(`/${id}.`));
  if (!cue) throw new Error(`no cue ${id}`);
  return cue.start;
};

/** Global time (s) a word is spoken in a clip. */
export const wordAt = (id: string, needle: string, nth = 0): number => {
  const words = manifest[id].words ?? [];
  const hits = words.filter((w) => w.w.toLowerCase().includes(needle.toLowerCase()));
  const hit = hits[Math.min(nth, hits.length - 1)];
  return cueStart(id) + (hit ? hit.s : 0);
};

/** Is any voice speaking at global time t? Used for music ducking. */
export const voiceActive = (t: number, pad = 0.15): boolean =>
  edit.audio.some((a) => {
    if (!/\/(n|t|s)_/.test(a.src)) return false;
    const id = a.src.split('/').pop()!.replace(/\.\w+$/, '');
    const len = a.cut ?? manifest[id]?.duration ?? 0;
    return t >= a.start - pad && t <= a.start + len + pad;
  });

export const normSrc = (src: string) => src.replace('audio/', 'audio/norm/').replace(/\.mp3$/, '.wav');
