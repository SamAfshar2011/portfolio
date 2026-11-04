import { useEffect, useRef, useState } from 'react';
import { mediaEntry, mediaUrl } from './media';
import { device } from '../../lib/device';

/**
 * A short muted loop. Plays only while on screen, never autoplays for
 * reduced-motion visitors (they get the poster and a play control), and falls
 * back to the poster if the video can't load.
 */
export function LoopVideo({ id, poster, label }: { id: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const e = mediaEntry(id);
  const posterEntry = mediaEntry(poster);
  const posterUrl = mediaUrl(poster, posterEntry.widths[posterEntry.widths.length - 1], 'webp');

  useEffect(() => {
    const v = ref.current;
    if (!v || device.reducedMotion) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().then(() => setPlaying(true)).catch(() => undefined);
        else {
          v.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  if (failed) return <img src={posterUrl} alt={label} width={e.width} height={e.height} loading="lazy" />;

  return (
    <div className="loop-video">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={posterUrl}
        width={e.width}
        height={e.height}
        aria-label={label}
        onError={() => setFailed(true)}
      >
        <source src={mediaUrl(id, undefined, 'webm')} type="video/webm" />
        <source src={mediaUrl(id, undefined, 'mp4')} type="video/mp4" />
      </video>
      {device.reducedMotion && !playing && (
        <button
          type="button"
          className="loop-play"
          onClick={() => {
            ref.current?.play().then(() => setPlaying(true)).catch(() => setFailed(true));
          }}
        >
          Play recording
        </button>
      )}
    </div>
  );
}
