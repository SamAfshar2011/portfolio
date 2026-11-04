import { useEffect } from 'react';
import { director } from '../experience/director';
import { toast } from '../components/ui/Toast';
import { audio } from '../components/audio/engine';

/**
 * Hidden detail for the curious: type "python" anywhere and the glass
 * briefly remembers where all of this started.
 */
export function useEasterEggs() {
  useEffect(() => {
    let buffer = '';
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      buffer = (buffer + e.key.toLowerCase()).slice(-12);
      if (buffer.endsWith('python')) {
        buffer = '';
        director.lock({ formation: 'python', presence: 1, title: 0 }, 'egg');
        audio.chime();
        toast.show('print("hello, world")', '# 2024 — where this started');
        window.clearTimeout(timer);
        timer = window.setTimeout(() => director.release(undefined, 'egg'), 4200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, []);
}
