import { createStore } from '../lib/store';
import { storage } from '../lib/storage';
import { initialQuality, type QualityTier } from '../lib/device';

export type RoomId = 'home' | 'fiscora' | 'anka' | 'persian-alpr';

export interface ExperienceState {
  /** Renderer status. 'fallback' keeps the CSS environment and DOM typography. */
  stage: 'pending' | 'ready' | 'fallback';
  backend: 'WebGPU' | 'WebGL 2' | null;
  quality: QualityTier;
  /** First-visit intro has completed (persisted, so repeat visits start fast). */
  introSeen: boolean;
  /** Intro running right now: navigation and scroll wait for it. */
  introActive: boolean;
  audio: boolean;
  menuOpen: boolean;
  transitioning: boolean;
  room: RoomId;
}

export const experience = createStore<ExperienceState>({
  stage: 'pending',
  backend: null,
  quality: typeof window === 'undefined' ? 'balanced' : initialQuality(),
  introSeen: storage.get('sa.introSeen', false),
  introActive: false,
  audio: false,
  menuOpen: false,
  transitioning: false,
  room: 'home',
});
