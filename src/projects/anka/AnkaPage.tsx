import './anka.css';
import { projectBySlug } from '../registry';
import { ProjectHero } from '../shared/ProjectHero';
import { Chapter } from '../shared/Chapter';
import { DataTable, Flow, Note, StatGrid } from '../shared/Figures';
import { ProjectEnd } from '../shared/ProjectEnd';
import { Footer } from '../../components/nav/Footer';
import { Picture } from '../../components/media/Picture';
import { LoopVideo } from '../../components/media/LoopVideo';
import { SeismicLab } from './SeismicLab';
import { FeatureTable, INPUTS, RiskScale, Seal, Taper } from './AnkaParts';
import type { Directive } from '../../experience/director';

const p = projectBySlug('anka')!;
const quiet: Partial<Directive> = {
  formation: 'building',
  room: 'anka',
  anchor: [0.64, 0.02],
  scale: 0.7,
  presence: 0.28,
  energy: 0,
  focus: -1,
  title: 0,
  daylight: 0,
};
const hidden: Partial<Directive> = { ...quiet, presence: 0 };

export default function AnkaPage() {
  return (
    <article className="project" data-project="anka">
      <ProjectHero
        p={p}
        lead={
          <p>
            Eight facts about a building and an expected earthquake go in. An estimated probability of collapse comes
            out — with reasons, recommendations, a simulation of the shaking, and a sealed report that can be verified
            later.
          </p>
        }
        facts={[
          { label: 'Languages', value: 'English · Persian · Turkish' },
          { label: 'Model', value: 'Deep regression network (Keras)' },
          { label: 'Purpose', value: 'Preparedness, not certification' },
        ]}
      />

      <Chapter id="question" index="01" label="The question" title={<>How safe is this building if the ground moves?</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Most people living in an earthquake zone can’t answer that about their own home, and a structural survey is
          slow and expensive. ANKA gives a fast, preliminary answer to raise awareness and prompt the right next step —
          it is explicit that it does not replace a licensed engineer.
        </p>
        <ol className="inputs" data-reveal aria-label="The eight inputs">
          {INPUTS.map((i, n) => (
            <li key={i.key}>
              <span className="inputs-n t-meta">{String(n + 1).padStart(2, '0')}</span>
              <span className="inputs-name">{i.name}</span>
              <span className="inputs-kind t-meta">{i.kind}</span>
            </li>
          ))}
        </ol>
        <p className="chapter-text" data-reveal>
          An optional “future years” setting ages the building before predicting, so owners can see how risk changes as
          the structure gets older.
        </p>
      </Chapter>

      <Chapter id="model" index="02" label="The model" title={<>Physics-shaped features, then a deep network.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Before any learning happens, the eight inputs are turned into quantities an engineer would recognise — load,
          mass, energy, the interaction of weak soil with strong shaking, and the absence of shear walls under a large
          magnitude.
        </p>
        <FeatureTable />
        <p className="chapter-text" data-reveal>
          Categorical inputs are one-hot encoded and numeric ones standardised, giving 23 inputs. A seven-layer Swish
          network narrows from 512 units to one sigmoid output: the collapse probability.
        </p>
        <Taper />
        <DataTable
          head={['Training detail', 'Setting']}
          rows={[
            ['Loss', 'Huber'],
            ['Optimiser', 'Adam, learning rate 0.001, gradient clipping'],
            ['Schedule', 'Reduce LR ×0.7 on plateau (patience 20)'],
            ['Stopping', 'Early stopping, patience 70, best weights restored'],
            ['Batch size', '1,024'],
          ]}
        />
      </Chapter>

      <Chapter id="read" index="03" label="Reading a result" title={<>A number, a colour, and what to do next.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          The probability is shown with one of four colour bands, then turned into specific advice by an explicit rule
          set — not by the network. Rules combine the prediction with the building itself: soil and liquefaction under
          tall structures, masonry under strong shaking, missing shear walls above four floors, buildings older than
          fifty years.
        </p>
        <RiskScale />
        <DataTable
          caption="A few of the recommendation rules, from the server code"
          head={['Condition', 'Recommendation']}
          rows={[
            ['Probability above 85%', 'Critical: evacuate until a licensed engineer clears the building'],
            ['High liquefaction and more than 5 floors', 'Emergency geotechnical assessment and deep-pile inspection'],
            ['Masonry and magnitude ≥ 6.5', 'Masonry is highly vulnerable — reinforce with tie beams and shear walls'],
            ['No shear walls and more than 4 floors', 'Insufficient lateral resistance — retrofit with bracing or walls'],
            ['Older than 50 years', 'Pre-modern codes likely — full structural audit and possible retrofit'],
          ]}
        />
      </Chapter>

      <Chapter id="simulate" index="04" label="Simulation" title={<>Shake a building.</>} directive={hidden} wide>
        <p className="chapter-text t-lead" data-reveal>
          ANKA also ships a simulator that shows what the number means. This version keeps its controls and its
          estimate of ground acceleration, and rebuilds the physics for the web. The shaking is a seeded stochastic
          record shaped by the soil, the magnitude and the depth; the building is a chain of storeys that yield,
          soften and lean further under their own weight; the foundation rocks and slides, and settles as liquefying
          ground gives way. When a storey can no longer carry what is above it, the floors fall under rigid-body
          physics.
        </p>
        <SeismicLab />
      </Chapter>

      <Chapter id="report" index="05" label="Sealed reports" title={<>Every report carries a seal you can check.</>} directive={quiet} wide>
        <div className="report-grid">
          <div className="report-copy">
            <p className="chapter-text t-lead" data-reveal>
              Each prediction can be exported as a PDF with the building data, probability, risk level and
              recommendations. The report gets a unique ID, a timestamp and an HMAC-SHA256 seal computed over the ID,
              the building data and the time.
            </p>
            <p className="chapter-text" data-reveal>
              Reports are registered when they are created. A verification page takes the report ID and timestamp and
              confirms whether that report exists — so a printed copy can be checked later.
            </p>
            <Flow
              vertical
              steps={[
                { title: 'Predict', body: 'probability, colour band, rules' },
                { title: 'Seal', body: 'HMAC-SHA256 over ID, data and time' },
                { title: 'Register', body: 'stored in the report database' },
                { title: 'Verify', body: 'ID and timestamp → authentic or invalid' },
              ]}
            />
          </div>
          <div className="report-art" data-reveal>
            <div className="report-paper m-media">
              <Picture id="anka/report" alt="A generated ANKA seismic report: 21.3% collapse probability, low risk, building specifications and a verification seal" sizes="(min-width: 1000px) 26rem, 80vw" />
            </div>
            <Seal />
          </div>
        </div>
      </Chapter>

      <Chapter id="assistant" index="06" label="The assistant" title={<>An assistant that stays on topic.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          The chat assistant receives the user’s building data and predicted probability as context, and is instructed
          to answer only about buildings, structural engineering and earthquake preparedness — historical earthquakes
          included, as long as the answer connects back to building safety. It replies in English, Persian or Turkish,
          and accepts voice input.
        </p>
        <StatGrid
          items={[
            { value: '3', label: 'interface languages: English, Persian, Turkish' },
            { value: 'Claude Sonnet', label: 'language model, via an OpenAI-compatible API' },
            { value: 'Whisper', label: 'speech-to-text for voice questions' },
          ]}
        />
        <figure className="anka-media" data-reveal>
          <div className="m-media anka-video">
            <LoopVideo id="anka/predictor-loop" poster="anka/predictor-poster" label="Screen recording: entering building details into the ANKA collapse predictor and receiving a 21.28% probability with recommendations" />
          </div>
          <figcaption className="t-meta">The predictor in use · recording sped up while typing, real time at the result</figcaption>
        </figure>
        <Note title="The honest part">
          The repository records the architecture and training setup but no evaluation metrics, so this page quotes none.
          ANKA’s own documentation is clear that predictions, simulations and reports are for education and preliminary
          assessment, and that critical decisions belong with qualified engineers and authorities.
        </Note>
      </Chapter>

      <ProjectEnd p={p} />
      <Footer />
    </article>
  );
}
