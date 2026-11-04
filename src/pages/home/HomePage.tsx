import { Hero } from './Hero';
import { Momentum } from './Momentum';
import { Rooms } from './Rooms';
import { Honors } from './Honors';
import { Influences } from './Influences';
import { Ambition } from './Ambition';
import { Source } from './Source';
import { Footer } from '../../components/nav/Footer';

/**
 * Home, in seven movements:
 *   Hero       — the name behind glass (tension)
 *   Momentum   — how it started, as acceleration
 *   Rooms      — the three projects, each a different structure of light
 *   Honors     — the medals as struck metal, lit by the pointer
 *   Influences — daylight; typography only (release)
 *   Next       — layers pressed into one object (impact)
 *   Source     — the work, physically, and the way to GitHub
 */
export function HomePage() {
  return (
    <>
      <Hero />
      <Momentum />
      <Rooms />
      <Honors />
      <Influences />
      <Ambition />
      <Source />
      <Footer />
    </>
  );
}
