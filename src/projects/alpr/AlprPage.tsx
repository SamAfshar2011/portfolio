import '@fontsource-variable/vazirmatn/wght.css';
import './alpr.css';
import { projectBySlug } from '../registry';
import { ProjectHero } from '../shared/ProjectHero';
import { Chapter } from '../shared/Chapter';
import { DataTable, Note, StatGrid } from '../shared/Figures';
import { ProjectEnd } from '../shared/ProjectEnd';
import { Footer } from '../../components/nav/Footer';
import { PipelineStory } from './PipelineStory';
import { ConfusionGrid } from './ConfusionGrid';
import { SceneLens } from './SceneLens';
import { Tracking } from './Tracking';
import data from './classifier.json';
import { HERO } from './scenes';
import { etchPlate } from '../../gl/etch';
import { useLayoutEffect } from 'react';
import type { Directive } from '../../experience/director';

const p = projectBySlug('persian-alpr')!;
const quiet: Partial<Directive> = {
  formation: 'plate',
  room: 'persian-alpr',
  anchor: [0.62, 0.1],
  scale: 0.7,
  presence: 0.28,
  energy: 0,
  focus: -1,
  title: 0,
  daylight: 0,
};
const hidden: Partial<Directive> = { ...quiet, presence: 0 };
// The first epoch trains only the head (backbone frozen); the rest are full fine-tuning epochs.
const full = data.epochs.slice(1);
const perEpoch = Math.round(full.reduce((a, e) => a + e.seconds, 0) / full.length / 60);

export default function AlprPage() {
  // This page follows the scene-5 plate through the pipeline; its glass carries those characters.
  useLayoutEffect(() => etchPlate('hero', HERO.glyphs), []);
  return (
    <article className="project" data-project="persian-alpr">
      <ProjectHero
        p={p}
        lead={
          <p>
            A modular recognition system for Iranian license plates, in images and video. It finds the plate, recovers
            exactly eight characters, reads each one — and returns an answer only when every stage agrees.
          </p>
        }
        facts={[
          { label: 'Models', value: 'YOLO26s · YOLO26l · ConvNeXt V2 Base' },
          { label: 'Classes', value: '32 characters and symbols' },
          { label: 'Video', value: 'Kalman + Hungarian tracking' },
        ]}
      />

      <Chapter id="why" index="01" label="The problem" title={<>Reading a plate is three different problems.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Iranian plates mix Persian digits with a Persian letter in a fixed layout — two digits, a letter, three digits,
          then a two-digit region code. Instead of one opaque end-to-end model, PlateHunter splits the job into stages, so
          every failure has an address: finding the plate, locating its characters, reading them, or following them
          through a video.
        </p>
        <div className="plate-anatomy" data-reveal aria-label="Plate layout: two digits, a letter, three digits, and a two-digit region code">
          {[
            ['۵۲', 'Two digits'],
            ['ق', 'Letter'],
            ['۴۶۲', 'Three digits'],
            ['۱۱', 'Region code'],
          ].map(([g, label]) => (
            <div key={label} className="plate-anatomy-part">
              <span className="plate-anatomy-glyph" lang="fa">
                {g}
              </span>
              <span className="t-meta">{label}</span>
            </div>
          ))}
        </div>
      </Chapter>

      <Chapter id="pipeline" index="02" label="The pipeline" title={<>From raw pixels to a plate number.</>} directive={hidden} wide>
        <p className="chapter-text t-lead" data-reveal>
          One night-time photograph, followed through every stage with the pipeline’s real intermediate outputs. Scroll to
          advance.
        </p>
        <PipelineStory />
      </Chapter>

      <Chapter id="numbers" index="03" label="Evidence" title={<>Checked before it was trusted.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Each model has its own dataset, and each dataset was audited before training: malformed boxes, duplicates,
          plates without exactly eight usable characters, and validation images that were byte-for-byte copies of
          training images.
        </p>
        <DataTable
          head={['Stage', 'Train / validation', 'What the audit did']}
          rows={[
            ['1 · Plate detector', '18,864 / 4,175 images', `22,836 training plates; boxes checked for bad coordinates, overflow and minimum size`],
            ['2 · Character detector', '27,078 / 4,985 plates', `Kept from 30,318 / 5,559 after rejecting 3,814 samples; 216,608 character boxes`],
            [
              '3 · Character classifier',
              `${data.trainTotal.toLocaleString('en-US')} / ${data.total.toLocaleString('en-US')} crops`,
              `${data.leakage} validation crops were exact copies of training crops and were left out`,
            ],
          ]}
        />
        <ConfusionGrid />
        <StatGrid
          items={[
            { value: `${((data.correct / data.total) * 100).toFixed(2)}%`, label: 'of validation crops read correctly (two mistakes)' },
            { value: data.macroF1.toFixed(3), label: 'macro-F1, pulled down by the S class, which has no validation crops left' },
            { value: `${perEpoch} min`, label: 'per full fine-tuning epoch on Apple Silicon (MPS)' },
          ]}
        />
        <Note>
          These are validation results on the project’s own splits of private data; the datasets and trained weights are
          not published. Rare classes have very few validation crops (D has 10, <bdi lang="fa">ث</bdi> 3,{' '}
          <bdi lang="fa">ز</bdi> 2), so treat the classifier’s
          numbers as evidence, not a guarantee. The detector training logs in the repository are partial snapshots, so no
          detector scores are quoted here.
        </Note>
      </Chapter>

      <Chapter id="gate" index="04" label="Refusing to guess" title={<>An answer only when every stage agrees.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          A plate is accepted only if all of these hold. Otherwise it is rejected, and the reason is written to the
          report — never silently returned.
        </p>
        <ol className="gates" data-reveal>
          <li>The plate detector is confident enough</li>
          <li>Exactly eight characters are recovered from the crop</li>
          <li>The mean character-detection confidence clears its minimum</li>
          <li>The mean classification confidence clears its minimum</li>
          <li>
            Each slot decodes to a class that is legal there: <code>DD L DDD DD</code>, with Persian and Arabic numerals
            normalised
          </li>
          <li>The combined confidence clears its minimum</li>
        </ol>
        <div className="geo" data-reveal>
          <p className="t-meta">Combined confidence</p>
          <p className="geo-eq">
            <span className="t-serif">c</span> = ∛( <span>c</span>
            <sub>plate</sub> · <span>c̄</span>
            <sub>characters</sub> · <span>c̄</span>
            <sub>classes</sub> )
          </p>
          <p className="geo-note">A geometric mean: one weak stage pulls the whole answer down, so it can’t hide behind two confident ones.</p>
        </div>
      </Chapter>

      <Chapter id="video" index="05" label="Video" title={<>One plate, one identity, many frames.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          In video, the aim is to keep the same physical plate on the same track ID through motion, short misses and noisy
          detections. A Kalman filter predicts where each plate moves; detections are assigned to tracks by Hungarian
          matching, trusting confirmed tracks and strong detections first. A plate that vanishes for a moment waits in a
          short dormant memory and can return under its old ID.
        </p>
        <Tracking />
        <p className="chapter-text" data-reveal>
          Reading is not repeated blindly on every frame. Each track’s crop gets a quality score from detection confidence,
          sharpness, resolution and aspect ratio, and the tracker reads a plate often while it is unknown, less often once
          it is stable — and again early when a clearly better frame arrives. Instead of voting on finished strings, it
          fuses the full per-position probability matrices of the useful reads, and ignores very weak ones, so one bad
          crop can’t poison a stable track.
        </p>
        <DataTable
          head={['Track state', 'How often it is read']}
          rows={[
            ['Not read yet', 'Frequently'],
            ['Building agreement', 'At a moderate interval'],
            ['Stable', 'Less often'],
            ['A much better frame appears', 'Early, out of turn'],
          ]}
        />
      </Chapter>

      <Chapter id="scenes" index="06" label="In the wild" title={<>Night, rain, taxis, and a different plate type.</>} directive={hidden} wide>
        <p className="chapter-text t-lead" data-reveal>
          Example outputs published with the repository. Move over an image to see what the pipeline drew; each read also
          shows the small plate crop it came from.
        </p>
        <SceneLens />
        <p className="chapter-text" data-reveal>
          It was built for Apple Silicon from the start: MPS for both PyTorch and YOLO, CPU fallback where it is allowed,
          and, when it is available, hardware H.264 export through VideoToolbox for annotated video.
        </p>
        <Note>
          Where it can still fail: plates that don’t follow the standard eight-slot layout; severe blur, glare, occlusion
          or extreme angles; tiny plates; and, for the tracker, drastic changes of viewpoint or light, since its appearance
          matching is handcrafted rather than learned.
        </Note>
      </Chapter>

      <ProjectEnd p={p} />
      <Footer />
    </article>
  );
}
