import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import { experience } from '../../experience/state';
import { audio } from './engine';

/**
 * A visitor who turned sound on before is remembered — but sound never
 * starts by itself. It waits for their first click or key press on the page
 * (a gesture, which browsers require anyway) and then fades in slowly.
 * Installed once, however many toggles are mounted.
 */
let armed = false;
function armRememberedSound() {
  if (armed || !audio.preferred || experience.get().audio) return;
  armed = true;
  const events = ['pointerdown', 'keydown'] as const;
  const resume = (e: Event) => {
    // The toggle itself handles its own click.
    if ((e.target as Element | null)?.closest?.('.audio-toggle')) return;
    events.forEach((t) => window.removeEventListener(t, resume, true));
    if (experience.get().audio) return;
    experience.set({ audio: true });
    audio.setEnabled(true);
  };
  events.forEach((t) => window.addEventListener(t, resume, true));
}

/**
 * Sound control. Five bars that breathe when sound is on and rest as a flat
 * line when it is off. Sound is always off on arrival.
 */
export function AudioToggle({ className = '' }: { className?: string }) {
  const on = useStore(experience, (s) => s.audio);
  useEffect(armRememberedSound, []);
  const toggle = async () => {
    const next = !on;
    experience.set({ audio: next });
    await audio.setEnabled(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Turn sound off' : 'Turn sound on'}
      data-cursor={on ? 'Mute' : 'Sound'}
      className={`audio-toggle ${className}`}
    >
      <span className="audio-bars" data-on={on} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} style={{ animationDelay: `${-i * 0.23}s` }} />
        ))}
      </span>
      <span className="audio-label">{on ? 'Sound on' : 'Sound'}</span>
    </button>
  );
}
