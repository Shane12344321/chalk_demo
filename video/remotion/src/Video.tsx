import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import {CamKey, cueStart, edit, FPS, manifest, normSrc, voiceActive, wordAt} from './edit';

const C = {
  bg0: '#050807',
  bg1: '#0d1814',
  ink: '#f4f2ec',
  dim: 'rgba(244,242,236,0.62)',
  faint: 'rgba(244,242,236,0.32)',
  ember: '#e4783e',
  blue: '#6f8cff',
  amber: '#f3b54a',
  glass: 'rgba(12,18,16,0.72)',
};
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", Menlo, monospace';

const sec = (f: number) => f / FPS;
const fr = (s: number) => Math.round(s * FPS);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/* ------------------------------------------------------------------ stage */

const Grain: React.FC<{opacity?: number}> = ({opacity = 0.06}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'overlay', opacity}}>
      <svg width="100%" height="100%">
        <filter id={`g${frame % 6}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 6} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${frame % 6})`} />
      </svg>
    </AbsoluteFill>
  );
};

const Stage: React.FC<{children?: React.ReactNode; glow?: string}> = ({children, glow = 'rgba(228,120,62,0.10)'}) => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.25) % 64;
  return (
    <AbsoluteFill style={{background: `radial-gradient(120% 90% at 50% 38%, ${C.bg1} 0%, ${C.bg0} 70%)`}}>
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          backgroundPosition: `${drift}px ${drift * 0.5}px`,
          maskImage: 'radial-gradient(80% 70% at 50% 45%, black 20%, transparent 80%)',
        }}
      />
      <AbsoluteFill style={{background: `radial-gradient(40% 35% at 50% 42%, ${glow}, transparent 70%)`}} />
      {children}
    </AbsoluteFill>
  );
};

const Orb: React.FC<{size: number; speaking?: boolean; listening?: boolean}> = ({size, speaking, listening}) => {
  const frame = useCurrentFrame();
  const breathe = speaking ? 1 + 0.035 * Math.sin(frame / 3.2) : 1;
  return (
    <div style={{position: 'relative', width: size, height: size, transform: `scale(${breathe})`}}>
      {speaking
        ? [0, 1, 2].map((i) => {
            const p = ((frame / 45 + i / 3) % 1);
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: `2px solid rgba(246,226,164,${0.5 * (1 - p)})`,
                  transform: `scale(${1 + p * 0.9})`,
                }}
              />
            );
          })
        : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 38% 32%, #fffdf2 0 9%, #f6e2a4 22%, #d9c079 34%, #7d9a80 58%, #3f6152 78%, #24443a 100%)',
          boxShadow: listening
            ? `0 0 0 ${size * 0.05}px rgba(111,140,255,0.45), 0 0 ${size * 0.6}px rgba(111,140,255,0.35)`
            : `inset -${size * 0.1}px -${size * 0.12}px ${size * 0.3}px rgba(16,42,33,0.4), 0 ${size * 0.15}px ${size * 0.5}px rgba(0,0,0,0.5), 0 0 ${size * 0.8}px rgba(246,226,164,0.18)`,
          overflow: 'hidden',
        }}
      >
        {[8, 17, 28].map((inset, i) => (
          <span
            key={inset}
            style={{
              position: 'absolute',
              inset: `${inset}%`,
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: '46% 54% 58% 42%',
              transform: `rotate(${i * 63 + (speaking ? frame * (2 + i) : 0)}deg)`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------- opener */

const Opener: React.FC = () => {
  const frame = useCurrentFrame();
  const end = edit.shots.opener[1];
  const fade = interpolate(frame, [fr(end - 0.55), fr(end)], [1, 0], clamp);
  return (
    <AbsoluteFill style={{opacity: fade, background: '#000'}}>
      <OffthreadVideo src={staticFile('opener.mp4')} />
      <AbsoluteFill
        style={{background: 'radial-gradient(90% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)'}}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------- meet */

const Meet: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t0 = edit.shots.meet[0];
  const t = t0 + sec(frame);
  const meetWords = manifest.n_meet.words ?? [];
  const meetStart = cueStart('n_meet');
  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});
  const len = edit.shots.meet[1] - t0;
  const exit = interpolate(frame, [fr(len - 0.45), fr(len)], [0, 1], clamp);
  const headline = ['Meet', 'CHALK.'];
  const sub = meetWords.slice(2);
  return (
    <Stage>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 34,
          opacity: 1 - exit,
          transform: `scale(${1 + exit * 0.08})`,
          filter: `blur(${exit * 10}px)`,
        }}
      >
        <div style={{transform: `scale(${0.6 + 0.4 * enter})`, opacity: enter}}>
          <Orb size={150} speaking={voiceActive(t, 0)} />
        </div>
        <div style={{display: 'flex', gap: 28, fontFamily: SANS, fontSize: 132, fontWeight: 700, letterSpacing: -4, color: C.ink}}>
          {headline.map((w, i) => {
            const at = meetStart + (meetWords[i]?.s ?? 0) - t0;
            const p = interpolate(frame, [fr(at - 0.1), fr(at + 0.25)], [0, 1], {...clamp, easing: easeOut});
            return (
              <span
                key={w}
                style={{
                  opacity: p,
                  transform: `translateY(${(1 - p) * 40}px)`,
                  color: i === 1 ? C.ink : C.dim,
                  filter: `blur(${(1 - p) * 8}px)`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        <div style={{display: 'flex', gap: 14, fontFamily: SANS, fontSize: 44, fontWeight: 500, color: C.dim, letterSpacing: -0.5}}>
          {sub.map((w, i) => {
            const at = meetStart + w.s - t0;
            const p = interpolate(frame, [fr(at - 0.08), fr(at + 0.2)], [0, 1], {...clamp, easing: easeOut});
            const accent = /live|whiteboard/i.test(w.w);
            return (
              <span key={i} style={{opacity: p, transform: `translateY(${(1 - p) * 18}px)`, color: accent ? C.ember : undefined}}>
                {w.w}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

/* -------------------------------------------------------------- app shot */

const VP = edit.app.viewport; // page CSS px
const WIN_W = 1440;
const SCALE = WIN_W / VP[0];
const WIN_H = VP[1] * SCALE;
const BAR = 40;
const WIN_X = (1920 - WIN_W) / 2;
const WIN_Y = (1080 - (WIN_H + BAR)) / 2;

function camAt(keys: CamKey[], t: number): CamKey {
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (t <= b.t) {
      const k = easeIO((t - a.t) / Math.max(1e-6, b.t - a.t));
      return {t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k};
    }
  }
  return keys[keys.length - 1];
}

const Chip: React.FC<{
  from: number;
  to: number;
  t: number;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  color?: string;
}> = ({from, to, t, icon, label, sub, color = C.ember}) => {
  if (t < from - 0.1 || t > to + 0.5) return null;
  const pin = interpolate(t, [from, from + 0.35], [0, 1], {...clamp, easing: easeOut});
  const pout = interpolate(t, [to, to + 0.35], [0, 1], clamp);
  const p = pin * (1 - pout);
  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        top: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 26px 16px 18px',
        borderRadius: 18,
        background: C.glass,
        backdropFilter: 'blur(18px)',
        border: `1px solid rgba(255,255,255,0.10)`,
        boxShadow: `0 20px 50px rgba(0,0,0,0.35), inset 0 0 0 1px ${color}22`,
        opacity: p,
        transform: `translateX(${(1 - pin) * -30}px) translateY(${pout * -10}px)`,
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 13,
          display: 'grid',
          placeItems: 'center',
          background: `${color}26`,
          color,
          fontSize: 24,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{color: C.ink, fontSize: 28, fontWeight: 650, letterSpacing: -0.3}}>{label}</div>
        {sub ? <div style={{color: C.dim, fontSize: 19, marginTop: 3, fontWeight: 500}}>{sub}</div> : null}
      </div>
    </div>
  );
};

const Captions: React.FC<{t: number}> = ({t}) => {
  const cap = edit.captions.find((c) => t >= c.start - 0.05 && t <= c.end + 0.35);
  if (!cap) return null;
  const pin = interpolate(t, [cap.start - 0.05, cap.start + 0.2], [0, 1], clamp);
  const pout = interpolate(t, [cap.end + 0.1, cap.end + 0.35], [0, 1], clamp);
  const student = cap.speaker === 'student';
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 46,
        display: 'flex',
        justifyContent: 'center',
        opacity: pin * (1 - pout),
        transform: `translateY(${(1 - pin) * 14}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          maxWidth: 1460,
          padding: '16px 28px 16px 16px',
          borderRadius: 22,
          background: C.glass,
          backdropFilter: 'blur(18px)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          fontFamily: SANS,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px 8px 10px',
            borderRadius: 12,
            background: student ? 'rgba(111,140,255,0.18)' : 'rgba(246,226,164,0.12)',
            color: student ? C.blue : '#f6e2a4',
            fontSize: 17,
            fontWeight: 750,
            letterSpacing: 1.6,
            whiteSpace: 'nowrap',
          }}
        >
          {student ? <MicIcon /> : <Orb size={22} speaking />}
          {student ? 'STUDENT' : 'CHALK'}
        </div>
        <div style={{fontSize: 33, fontWeight: 560, lineHeight: 1.28, color: C.ink, letterSpacing: -0.2}}>
          {cap.words.map((w, i) => (
            <span key={i} style={{opacity: t >= w.s - 0.02 ? 1 : 0.28}}>
              {w.w}{' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const MicIcon: React.FC<{size?: number; color?: string}> = ({size = 20, color = 'currentColor'}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const AppShot: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const a0 = edit.shots.app[0];
  const len = edit.shots.app[1] - a0;
  const t = sec(frame); // app-local
  const T = a0 + t; // global
  const {freezeAt, resumeAt, createAt, arriveAt, circleAt} = edit.app;

  const cam = camAt(edit.app.cam, t);
  const sx = WIN_X + cam.x * SCALE;
  const sy = WIN_Y + BAR + cam.y * SCALE;

  const enter = spring({frame, fps, config: {damping: 18, stiffness: 70, mass: 0.9}, durationInFrames: 40});
  const exit = interpolate(t, [len - 0.5, len], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const frozen = t >= freezeAt && t < resumeAt;
  const freezeGlow = frozen
    ? interpolate(t, [freezeAt, freezeAt + 0.25], [0, 1], clamp) * interpolate(t, [resumeAt - 0.3, resumeAt], [1, 0], clamp)
    : 0;
  const flash = interpolate(t, [freezeAt, freezeAt + 0.06, freezeAt + 0.45], [0, 0.35, 0], clamp);
  const resumePulse = interpolate(t, [resumeAt, resumeAt + 0.6], [0, 1], clamp);

  return (
    <Stage glow={frozen ? 'rgba(243,181,74,0.16)' : 'rgba(228,120,62,0.10)'}>
      <AbsoluteFill
        style={{
          transformOrigin: '0 0',
          transform: `translate(960px, 540px) scale(${cam.z * (1 + exit * 0.35)}) translate(${-sx}px, ${-sy}px)`,
          opacity: 1 - exit,
          filter: exit > 0 ? `blur(${exit * 12}px)` : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: WIN_X,
            top: WIN_Y,
            width: WIN_W,
            height: WIN_H + BAR,
            borderRadius: 16,
            overflow: 'hidden',
            background: '#fdfdfc',
            transformOrigin: '50% 100%',
            transform: `perspective(2200px) translateY(${(1 - enter) * 160}px) rotateX(${(1 - enter) * 22}deg) scale(${0.88 + 0.12 * enter})`,
            opacity: Math.min(1, enter * 1.6),
            boxShadow: `0 60px 140px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)${
              freezeGlow > 0 ? `, 0 0 0 ${4 * freezeGlow}px rgba(243,181,74,${0.9 * freezeGlow}), 0 0 ${90 * freezeGlow}px rgba(243,181,74,${0.45 * freezeGlow})` : ''
            }`,
          }}
        >
          <div
            style={{
              height: BAR,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 16px',
              background: '#ecebe7',
              borderBottom: '1px solid #dcdbd6',
            }}
          >
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{width: 12, height: 12, borderRadius: 6, background: c}} />
            ))}
            <div
              style={{
                margin: '0 auto',
                width: 420,
                height: 24,
                borderRadius: 7,
                background: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontFamily: SANS,
                fontSize: 13,
                color: '#6b6f78',
              }}
            >
              localhost:5173 · CHALK
            </div>
          </div>
          <OffthreadVideo
            src={staticFile('app.mp4')}
            style={{width: WIN_W, height: WIN_H, display: 'block'}}
            muted
          />
          <AbsoluteFill style={{background: '#fff', opacity: flash, pointerEvents: 'none'}} />
        </div>
      </AbsoluteFill>

      {/* freeze ripple */}
      {t >= freezeAt && t < freezeAt + 1.2 ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
          {(() => {
            const p = (t - freezeAt) / 1.2;
            return (
              <div
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: '50%',
                  border: `3px solid rgba(243,181,74,${0.9 * (1 - p)})`,
                  transform: `scale(${0.4 + p * 2.6})`,
                }}
              />
            );
          })()}
        </AbsoluteFill>
      ) : null}
      {t >= resumeAt && t < resumeAt + 0.8 ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: '50%',
              border: `3px solid rgba(228,120,62,${0.8 * (1 - resumePulse)})`,
              transform: `scale(${0.4 + resumePulse * 2.6})`,
            }}
          />
        </AbsoluteFill>
      ) : null}

      <Chip t={t} from={0.7} to={createAt - 0.2} icon="⌨" label="Ask for any topic" sub="Typed here, or just say it out loud" />
      <Chip
        t={t}
        from={createAt + 0.1}
        to={arriveAt + 0.2}
        icon="⏩"
        label="Lesson generated live"
        sub="Real generation took 18 s · sped up for the video"
        color={C.blue}
      />
      <Chip t={t} from={arriveAt + 0.6} to={arriveAt + 7.5} icon="〰" label="Talks while it draws" sub="Ink is paced to the narration, stroke by stroke" />
      <Chip t={t} from={freezeAt + 0.05} to={circleAt - 0.3} icon="❚❚" label="Interrupted mid-stroke" sub="Speech stops and the ink freezes exactly where it was" color={C.amber} />
      <Chip t={t} from={circleAt - 0.2} to={resumeAt - 0.2} icon="◎" label="Answers from the board" sub="Grounded in what is actually drawn, and annotated live" color={C.blue} />
      <Chip t={t} from={resumeAt} to={resumeAt + 4.2} icon="▶" label="Picks up where it froze" sub="Same lesson, same stroke, no restart" />
      <Captions t={T} />
    </Stage>
  );
};

/* ---------------------------------------------------------------- montage */

const Montage: React.FC = () => {
  const frame = useCurrentFrame();
  const t = sec(frame);
  const m0 = edit.shots.montage[0];
  const len = edit.shots.montage[1] - m0;
  const names = edit.montage.names;
  const gridAt = len - 2.1;
  const slot = gridAt / names.length;
  const T = m0 + t;
  const lines: [string, number][] = [
    ['Any topic.', wordAt('n_any', 'Any') - m0],
    ['Drawn on the spot.', wordAt('n_any', 'Every') - m0],
    ['Grounded in the board.', wordAt('n_any', 'grounded') - m0],
  ];
  const current = [...lines].reverse().find(([, at]) => t >= at - 0.1);
  const enterAll = interpolate(t, [0, 0.4], [0, 1], clamp);
  const exit = interpolate(t, [len - 0.4, len], [0, 1], clamp);
  return (
    <Stage>
      <AbsoluteFill style={{opacity: enterAll * (1 - exit)}}>
        {t < gridAt + 0.4
          ? names.map((n, i) => {
              const s0 = i * slot;
              if (t < s0 - 0.3 || t > s0 + slot + 0.4) return null;
              const pin = interpolate(t, [s0 - 0.3, s0 + 0.15], [0, 1], {...clamp, easing: easeOut});
              const pout = interpolate(t, [s0 + slot, s0 + slot + 0.35], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
              return (
                <AbsoluteFill key={n} style={{alignItems: 'center', justifyContent: 'center'}}>
                  <div
                    style={{
                      width: 1360,
                      height: 765,
                      marginTop: 70,
                      borderRadius: 20,
                      overflow: 'hidden',
                      background: '#f6f5f1',
                      boxShadow: '0 50px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
                      opacity: pin * (1 - pout),
                      transform: `perspective(2400px) translateX(${(1 - pin) * 260 - pout * 260}px) rotateY(${(1 - pin) * -14 + pout * 14}deg) scale(${0.94 + 0.06 * pin})`,
                    }}
                  >
                    <Sequence from={fr(s0 - 0.3)} layout="none">
                      <OffthreadVideo
                        src={staticFile(`montage-${n}.mp4`)}
                        playbackRate={3.4 / (slot + 0.3)}
                        muted
                        style={{width: 1360, height: 765}}
                      />
                    </Sequence>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 280 + 24,
                      bottom: 112 - 24,
                      padding: '10px 18px',
                      borderRadius: 12,
                      background: C.glass,
                      color: C.ink,
                      fontFamily: SANS,
                      fontSize: 24,
                      fontWeight: 600,
                      opacity: pin * (1 - pout),
                    }}
                  >
                    <span style={{color: C.ember, fontSize: 15, letterSpacing: 2, fontWeight: 750, marginRight: 12}}>LIVE</span>
                    {edit.montage.titles[i]}
                  </div>
                </AbsoluteFill>
              );
            })
          : null}
        {t >= gridAt
          ? names.map((n, i) => {
              const p = interpolate(t, [gridAt + i * 0.07, gridAt + 0.45 + i * 0.07], [0, 1], {...clamp, easing: easeOut});
              const col = i % 2;
              const row = Math.floor(i / 2);
              const w = 704;
              const h = 396;
              return (
                <div
                  key={n}
                  style={{
                    position: 'absolute',
                    left: 960 - w - 16 + col * (w + 32),
                    top: 214 + row * (h + 26),
                    width: w,
                    height: h,
                    borderRadius: 16,
                    overflow: 'hidden',
                    boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
                    opacity: p,
                    transform: `scale(${0.9 + 0.1 * p}) translateY(${(1 - p) * 30}px)`,
                  }}
                >
                  <Img src={staticFile(`montage-${n}-last.jpg`)} style={{width: w, height: h}} />
                </div>
              );
            })
          : null}
        {current ? (
          <div
            key={current[0]}
            style={{
              position: 'absolute',
              top: 64,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: -2,
              color: C.ink,
              opacity: interpolate(t, [current[1] - 0.1, current[1] + 0.2], [0, 1], clamp),
              transform: `translateY(${interpolate(t, [current[1] - 0.1, current[1] + 0.3], [16, 0], {...clamp, easing: easeOut})}px)`,
            }}
          >
            {current[0]}
          </div>
        ) : null}
      </AbsoluteFill>
      <Captions t={T} />
    </Stage>
  );
};

/* ------------------------------------------------------------ how it works */

const Node: React.FC<{
  x: number;
  y: number;
  w?: number;
  at: number;
  t: number;
  title: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
  hero?: boolean;
}> = ({x, y, w = 360, at, t, title, sub, icon, accent, hero}) => {
  const p = interpolate(t, [at - 0.05, at + 0.45], [0, 1], {...clamp, easing: easeOut});
  const lit = interpolate(t, [at, at + 0.2, at + 1.2], [0, 1, 0.35], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - 80,
        width: w,
        height: 160,
        borderRadius: 24,
        background: hero ? 'linear-gradient(160deg, rgba(228,120,62,0.22), rgba(20,28,25,0.92))' : 'rgba(20,28,25,0.86)',
        border: `1px solid ${hero ? 'rgba(228,120,62,0.55)' : 'rgba(255,255,255,0.10)'}`,
        boxShadow: `0 30px 70px rgba(0,0,0,0.45), 0 0 ${60 * lit}px ${accent}66`,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 26px',
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px) scale(${0.92 + 0.08 * p})`,
        fontFamily: SANS,
      }}
    >
      <div style={{width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center', background: `${accent}22`, color: accent, flex: '0 0 auto'}}>
        {icon}
      </div>
      <div>
        <div style={{color: C.ink, fontSize: 29, fontWeight: 680, letterSpacing: -0.4, lineHeight: 1.1}}>{title}</div>
        <div style={{color: C.dim, fontSize: 20, marginTop: 6, lineHeight: 1.3}}>{sub}</div>
      </div>
    </div>
  );
};

const Link: React.FC<{x1: number; y1: number; x2: number; y2: number; at: number; t: number; color: string; both?: boolean}> = ({
  x1, y1, x2, y2, at, t, color, both,
}) => {
  const p = interpolate(t, [at, at + 0.5], [0, 1], {...clamp, easing: easeOut});
  if (p <= 0) return null;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dots = [0, 0.33, 0.66].map((o) => ((t - at) * 0.55 + o) % 1);
  return (
    <g opacity={p}>
      <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * p} y2={y1 + (y2 - y1) * p} stroke={color} strokeOpacity={0.45} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
      {p >= 1
        ? dots.map((d, i) => {
            const k = both && i === 1 ? 1 - d : d;
            return <circle key={i} cx={x1 + (x2 - x1) * k} cy={y1 + (y2 - y1) * k} r={6} fill={color} opacity={Math.sin(Math.PI * d)} />;
          })
        : null}
      <title>{len}</title>
    </g>
  );
};

const How: React.FC = () => {
  const frame = useCurrentFrame();
  const t = sec(frame);
  const h0 = edit.shots.how[0];
  const len = edit.shots.how[1] - h0;
  const w = (needle: string) => wordAt('n_how', needle) - h0;
  const tVoice = w('realtime');
  const tPlan = w('planner');
  const tDraw = w('drawer');
  const tSync = w('sync') - 0.6;
  const enter = interpolate(t, [0, 0.5], [0, 1], clamp);
  const exit = interpolate(t, [len - 0.45, len], [0, 1], clamp);
  const Y = 420;
  const xs = {student: 230, voice: 670, drawer: 1150, planner: 1640};
  const syncP = interpolate(t, [tSync, tSync + 0.6], [0, 1], {...clamp, easing: easeOut});
  return (
    <Stage>
      <AbsoluteFill style={{opacity: enter * (1 - exit)}}>
        <div style={{position: 'absolute', top: 92, left: 0, right: 0, textAlign: 'center', fontFamily: SANS}}>
          <div style={{color: C.ember, fontSize: 20, fontWeight: 750, letterSpacing: 4}}>UNDER THE HOOD</div>
          <div style={{color: C.ink, fontSize: 60, fontWeight: 700, letterSpacing: -2, marginTop: 10}}>Voice is the interface.</div>
        </div>
        <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
          <Link x1={xs.student + 130} y1={Y} x2={xs.voice - 180} y2={Y} at={tVoice + 0.2} t={t} color={C.blue} both />
          <Link x1={xs.voice + 180} y1={Y} x2={xs.drawer - 195} y2={Y} at={tDraw} t={t} color={'#f6e2a4'} both />
          <Link x1={xs.planner - 180} y1={Y} x2={xs.drawer + 195} y2={Y} at={tDraw + 0.15} t={t} color={C.ember} />
          <Link x1={xs.drawer} y1={Y + 80} x2={xs.drawer} y2={Y + 250} at={tDraw + 0.3} t={t} color={C.ember} />
        </svg>
        <Node x={xs.student} y={Y} w={260} at={0.2} t={t} title="Student" sub="Talks, interrupts" icon={<MicIcon size={30} />} accent={C.blue} />
        <Node x={xs.voice} y={Y} at={tVoice} t={t} title="Realtime voice" sub="Talks and listens, turn by turn" icon={<Orb size={40} speaking={t > tVoice && t < tPlan} />} accent={'#f6e2a4'} />
        <Node x={xs.drawer} y={Y} w={390} at={tDraw} t={t} hero title="The Drawer" sub="Orchestrates every stroke between voice and board" icon={<span style={{fontSize: 34}}>✎</span>} accent={C.ember} />
        <Node x={xs.planner} y={Y} at={tPlan} t={t} title="Lesson planner" sub="Writes validated board steps" icon={<span style={{fontSize: 30}}>☰</span>} accent={C.ember} />
        {/* whiteboard with sync meter */}
        <div
          style={{
            position: 'absolute',
            left: xs.drawer - 330,
            top: Y + 250,
            width: 660,
            height: 220,
            borderRadius: 22,
            background: '#f6f5f1',
            overflow: 'hidden',
            boxShadow: '0 40px 90px rgba(0,0,0,0.5)',
            opacity: interpolate(t, [tDraw + 0.4, tDraw + 0.9], [0, 1], clamp),
            transform: `translateY(${interpolate(t, [tDraw + 0.4, tDraw + 0.9], [24, 0], {...clamp, easing: easeOut})}px)`,
          }}
        >
          <Img src={staticFile('montage-tangent-last.jpg')} style={{width: 660, height: 371, objectFit: 'cover', objectPosition: 'top', opacity: 0.9}} />
          <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: '16px 24px 20px', background: 'rgba(246,245,241,0.97)', borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 10}}>
            {[['VOICE', '#3f6152'], ['INK', C.ember]].map(([label, col], i) => (
              <div key={label} style={{display: 'flex', alignItems: 'center', gap: 12, fontFamily: MONO, fontSize: 14, color: '#3a3d45', fontWeight: 700}}>
                <span style={{width: 48}}>{label}</span>
                <div style={{flex: 1, height: 10, borderRadius: 5, background: 'rgba(0,0,0,0.08)', overflow: 'hidden'}}>
                  <div style={{width: `${100 * syncP}%`, height: '100%', background: col, borderRadius: 5, opacity: i ? 1 : 0.85}} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: xs.drawer + 360,
            top: Y + 330,
            fontFamily: SANS,
            color: C.ink,
            fontSize: 34,
            fontWeight: 650,
            opacity: syncP,
            transform: `translateX(${(1 - syncP) * -20}px)`,
          }}
        >
          Voice and ink,<br />
          <span style={{color: C.ember}}>in sync.</span>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

/* -------------------------------------------------------------------- end */

const End: React.FC = () => {
  const frame = useCurrentFrame();
  const t = sec(frame);
  const e0 = edit.shots.end[0];
  const len = edit.shots.end[1] - e0;
  const enter = interpolate(t, [0, 0.8], [0, 1], {...clamp, easing: easeOut});
  const out = interpolate(t, [len - 1.0, len], [0, 1], clamp);
  const tag = interpolate(t, [cueStart('n_end') - e0 + 0.6, cueStart('n_end') - e0 + 1.2], [0, 1], {...clamp, easing: easeOut});
  const small = interpolate(t, [cueStart('n_end') - e0 + 2.4, cueStart('n_end') - e0 + 3.0], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{opacity: enter * (1 - out), transform: `scale(${1.02 + t * 0.008})`}}>
        <Img src={staticFile('opener-last.png')} style={{width: 1920, height: 1080}} />
        <AbsoluteFill style={{background: 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.75) 100%)'}} />
      </AbsoluteFill>
      <AbsoluteFill style={{opacity: 1 - out}}>
        <div style={{position: 'absolute', bottom: 150, left: 0, right: 0, textAlign: 'center', fontFamily: SANS}}>
          <div style={{color: C.ink, fontSize: 54, fontWeight: 650, letterSpacing: -1.4, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)`}}>
            The tutor that draws while it talks<span style={{color: C.ember}}>.</span>
          </div>
          <div style={{color: C.dim, fontSize: 24, marginTop: 22, letterSpacing: 2.5, fontWeight: 600, opacity: small}}>
            BUILT FOR THE BOLNA BUILDATHON · SYMPHONY 2026
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ audio */

const SFX: {id: string; at: number; vol: number; len?: number}[] = (() => {
  const a0 = edit.shots.app[0];
  const {createAt, freezeAt, resumeAt, arriveAt} = edit.app;
  const list = [
    {id: 'sfx_hit', at: 2.5, vol: 0.55},
    {id: 'sfx_chalk', at: 0.5, vol: 0.32, len: 2.2},
    {id: 'sfx_whoosh', at: edit.shots.meet[0] - 0.55, vol: 0.5},
    {id: 'sfx_whoosh', at: a0 - 0.4, vol: 0.45},
    {id: 'sfx_type', at: a0 + 0.9, vol: 0.4, len: 2.1},
    {id: 'sfx_click', at: a0 + createAt, vol: 0.7},
    {id: 'sfx_whoosh', at: a0 + arriveAt - 0.35, vol: 0.25},
    {id: 'sfx_freeze', at: a0 + freezeAt, vol: 0.55},
    {id: 'sfx_click', at: a0 + resumeAt - 0.25, vol: 0.7},
    {id: 'sfx_whoosh', at: edit.shots.montage[0] - 0.45, vol: 0.5},
    {id: 'sfx_whoosh', at: edit.shots.how[0] - 0.45, vol: 0.45},
    {id: 'sfx_hit', at: edit.shots.end[0] + 0.1, vol: 0.5},
  ];
  // soft chalk under each drawing step
  for (const c of edit.captions.filter((c) => c.speaker === 'tutor' && !/answer/.test(c.words[0]?.w ?? ''))) {
    if (c.start > a0 + freezeAt - 0.5 && c.start < a0 + resumeAt - 0.5) continue;
    list.push({id: 'sfx_chalk', at: c.start + 0.1, vol: 0.09, len: Math.min(4, c.end - c.start)});
  }
  return list;
})();

const Soundtrack: React.FC = () => {
  const {durationInFrames} = useVideoConfig();
  return (
    <>
      <Audio
        src={staticFile('audio/norm/music_bed.wav')}
        volume={(f) => {
          const t = sec(f);
          const ducked = voiceActive(t, 0.3) ? 0.2 : 0.5;
          const fadeOut = interpolate(f, [durationInFrames - fr(1.5), durationInFrames], [1, 0], clamp);
          return ducked * fadeOut;
        }}
      />
      {edit.audio.map((a, i) => (
        <Sequence key={i} from={fr(a.start)} durationInFrames={a.cut ? fr(a.cut) : undefined} layout="none">
          <Audio
            src={staticFile(normSrc(a.src))}
            volume={(f) => (a.cut ? a.volume * interpolate(f, [fr(a.cut) - 4, fr(a.cut)], [1, 0], clamp) : a.volume)}
          />
        </Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={`sfx${i}`} from={Math.max(0, fr(s.at))} durationInFrames={s.len ? fr(s.len) : undefined} layout="none">
          <Audio
            src={staticFile(`audio/norm/${s.id}.wav`)}
            volume={(f) => (s.len ? s.vol * interpolate(f, [fr(s.len) - 8, fr(s.len)], [1, 0], clamp) : s.vol)}
          />
        </Sequence>
      ))}
    </>
  );
};

/* ----------------------------------------------------------------- master */

const span = (k: keyof typeof edit.shots, preroll = 0, tail = 0) => ({
  from: fr(edit.shots[k][0] - preroll),
  durationInFrames: fr(edit.shots[k][1] - edit.shots[k][0] + preroll + tail),
});

export const ChalkDemo: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    <Sequence {...span('meet', 0, 0)}>
      <Meet />
    </Sequence>
    <Sequence {...span('opener', 0, 0)}>
      <Opener />
    </Sequence>
    <Sequence {...span('app', 0, 0)}>
      <AppShot />
    </Sequence>
    <Sequence {...span('montage')}>
      <Montage />
    </Sequence>
    <Sequence {...span('how')}>
      <How />
    </Sequence>
    <Sequence {...span('end')}>
      <End />
    </Sequence>
    <Grain />
    <Soundtrack />
  </AbsoluteFill>
);

export const Thumbnail: React.FC = () => (
  <AbsoluteFill>
    <Img src={staticFile('opener-last.png')} style={{width: 1920, height: 1080}} />
    <AbsoluteFill style={{background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.8) 100%)'}} />
    <div style={{position: 'absolute', bottom: 120, left: 0, right: 0, textAlign: 'center', fontFamily: SANS, color: C.ink, fontSize: 64, fontWeight: 700, letterSpacing: -2}}>
      The tutor that draws while it talks<span style={{color: C.ember}}>.</span>
    </div>
  </AbsoluteFill>
);
