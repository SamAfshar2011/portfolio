import '@fontsource-variable/vazirmatn/wght.css';
import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '../../motion/gsap';
import { focusPull } from '../../motion/hooks';
import { projectBySlug } from '../registry';
import { ProjectHero } from '../shared/ProjectHero';
import { Chapter } from '../shared/Chapter';
import { CompareBars, DataTable, Flow, Note, StatGrid } from '../shared/Figures';
import { ProjectEnd } from '../shared/ProjectEnd';
import { Footer } from '../../components/nav/Footer';
import { Picture } from '../../components/media/Picture';
import { Cockpit } from './Cockpit';
import { BootstrapLab } from './BootstrapLab';
import { device } from '../../lib/device';
import type { Directive } from '../../experience/director';

const p = projectBySlug('fiscora')!;
const quiet: Partial<Directive> = {
  formation: 'horizon',
  room: 'fiscora',
  anchor: [0.62, 0.05],
  scale: 0.72,
  presence: 0.3,
  energy: 0,
  focus: -1,
  title: 0,
  daylight: 0,
};
const hidden: Partial<Directive> = { ...quiet, presence: 0 };

function QuestionShift() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      if (!device.reducedMotion) {
        gsap.fromTo(
          '.q-old-strike',
          { scaleX: 0 },
          { scaleX: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 70%', end: 'top 30%', scrub: true } },
        );
        gsap.fromTo('.q-old', { opacity: 1 }, { opacity: 0.35, scrollTrigger: { trigger: el, start: 'top 60%', end: 'top 30%', scrub: true } });
      }
      focusPull(el.querySelector<HTMLElement>('.q-new')!, { scroll: true, duration: 1.4 });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <div ref={ref} className="q-shift">
      <p className="q-old t-headline">
        Where did my money go?
        <span className="q-old-strike" aria-hidden="true" />
      </p>
      <p className="q-new t-headline">
        What happens next — <span className="t-serif">and what can I do about it?</span>
      </p>
    </div>
  );
}

const FEATURES = [
  'Spend ÷ income',
  'Budget utilisation',
  'Savings rate',
  'Month-over-month growth',
  'Weekend ratio',
  'Largest-purchase share',
  'log(transaction count)',
  'Crypto intensity',
  'Crypto transactions',
  'Month (sin)',
  'Month (cos)',
  'Food & dining share',
  'Groceries share',
  'Transport share',
  'Housing & utilities share',
  'Health share',
  'Entertainment share',
  'Shopping share',
  'Education share',
  'Subscriptions share',
  'Transfers share',
  'Other share',
];

function SequenceModel() {
  const [hover, setHover] = useState(-1);
  return (
    <div className="seq" data-reveal>
      <div className="seq-input">
        <div className="seq-grid" role="img" aria-label="Input: a sequence of 6 months, each described by 22 features">
          {Array.from({ length: 22 }, (_, f) => (
            <div key={f} className="seq-row" data-on={hover === f}>
              {Array.from({ length: 6 }, (_, m) => (
                <span key={m} className="seq-cell" style={{ ['--m' as string]: m }} />
              ))}
            </div>
          ))}
          <div className="seq-axis t-meta" aria-hidden="true">
            <span>M−5</span>
            <span>M0</span>
          </div>
        </div>
        <ul className="seq-features" aria-label="The 22 features">
          {FEATURES.map((f, i) => (
            <li key={f} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(-1)}>
              {f}
            </li>
          ))}
        </ul>
      </div>
      <ol className="seq-layers" aria-label="Network layers">
        <li>
          <span>LSTM</span>
          <span className="t-meta">64 units</span>
        </li>
        <li className="seq-drop">Dropout</li>
        <li>
          <span>LSTM</span>
          <span className="t-meta">32 units</span>
        </li>
        <li className="seq-drop">Dropout</li>
        <li>
          <span>Dense · Swish</span>
          <span className="t-meta">32 units</span>
        </li>
        <li className="seq-heads">
          <span className="seq-head">
            <strong>Spend growth</strong>
            <span className="t-meta">log(next ÷ current) · Huber</span>
          </span>
          <span className="seq-head">
            <strong>Overspend probability</strong>
            <span className="t-meta">P(next &gt; budget) · cross-entropy</span>
          </span>
        </li>
      </ol>
    </div>
  );
}

function Bilingual() {
  const [fa, setFa] = useState(false);
  return (
    <div className="bilingual" data-reveal>
      <div className="bilingual-toggle" role="group" aria-label="Interface language">
        <button type="button" aria-pressed={!fa} onClick={() => setFa(false)}>
          English · USD
        </button>
        <button type="button" aria-pressed={fa} onClick={() => setFa(true)} lang="fa">
          فارسی · تومان
        </button>
      </div>
      <div className="bilingual-card m-slab" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'} key={fa ? 'fa' : 'en'}>
        <p className="bilingual-kind t-meta">{fa ? 'اعلان' : 'Notification'}</p>
        <p className="bilingual-title">{fa ? 'موجودی رو به اتمام' : 'Balance running low'}</p>
        <p className="bilingual-body">
          {fa
            ? 'موجودی شما با روند فعلی حدود 6.4 روز دیگر کفاف می‌دهد.'
            : 'Your balance covers about 6.4 days at the current spending pace.'}
        </p>
        <p className="bilingual-rule t-meta" dir="ltr">
          Trigger: runway &lt; 7 days · at most once per ISO week
        </p>
      </div>
      <p className="bilingual-caption t-meta">Notification templates taken verbatim from the Fiscora backend.</p>
    </div>
  );
}

const TOOLS = [
  ['get_spending_summary', 'Aggregate spending and category totals'],
  ['search_transactions', 'Search by text, category and date'],
  ['get_daily_files', 'Raw daily records, up to 30 days'],
  ['get_budget_status', 'Balance, projection, risk, runway'],
  ['get_insights', 'Trends, anomalies, computed insights'],
  ['get_btc_context', 'Market context and the model signal'],
];

export default function FiscoraPage() {
  return (
    <article className="project" data-project="fiscora">
      <ProjectHero
        p={p}
        lead={
          <p>
            A bilingual finance cockpit that turns transaction history into forecasts, risk signals and grounded answers —
            and shows its uncertainty instead of hiding it.
          </p>
        }
        facts={[
          { label: 'Built as', value: 'Innoverse competition project' },
          { label: 'Stack', value: 'Python · FastAPI · TensorFlow' },
          { label: 'Languages', value: 'English · Persian (RTL)' },
        ]}
      />

      <Chapter id="question" index="01" label="The question" title={<>A different question for a finance app.</>} directive={quiet}>
        <QuestionShift />
        <p className="chapter-text t-lead" data-reveal>
          A transaction list can tell you what happened. It can’t tell you whether your pace is sustainable, whether a
          category is quietly drifting upward, or which repeated payments have become fixed costs. Fiscora puts analysis,
          forecasting, retrieval and interaction behind one financial data model.
        </p>
        <Flow
          steps={[
            { title: 'Transactions', body: 'entered by hand or from reviewed receipts' },
            { title: 'Context', body: 'budgets, categories, history' },
            { title: 'Forecasts', body: 'three separate systems' },
            { title: 'Insight', body: 'trends, anomalies, runway' },
            { title: 'Action', body: 'alerts, simulations, answers' },
          ]}
        />
      </Chapter>

      <Chapter id="cockpit" index="02" label="The interface" title={<>An instrument panel, not a spreadsheet.</>} directive={hidden} wide>
        <p className="chapter-text t-lead" data-reveal>
          The dashboard borrows from automotive instrument clusters: carbon surfaces, thin metal edges, compact telemetry.
          It’s built without a UI framework — the charts are drawn directly with the Canvas 2D API.
        </p>
        <Cockpit />
        <div className="gallery-3">
          <figure data-reveal>
            <div className="m-media">
              <Picture id="fiscora/panel-whatif" alt="What-if simulator: sliders reduce spending per category and the month-end projection updates" sizes="(min-width: 900px) 30rem, 90vw" />
            </div>
            <figcaption>
              <strong>What-if.</strong> Cut a category by a percentage and the projection, monthly saving and budget
              position are recomputed from the real category state.
            </figcaption>
          </figure>
          <figure data-reveal>
            <div className="m-media">
              <Picture id="fiscora/panel-recurring" alt="Recurring payments detected with cadence and next expected charge" sizes="(min-width: 900px) 30rem, 90vw" />
            </div>
            <figcaption>
              <strong>Recurring payments.</strong> Found deterministically: up to 120 days of history, three or more
              observations, weekly (6–8 days) or monthly (25–35 days) cadence.
            </figcaption>
          </figure>
          <figure data-reveal>
            <div className="m-media">
              <Picture id="fiscora/panel-insights" alt="Personalised insights describing category changes against the previous month" sizes="(min-width: 900px) 30rem, 90vw" />
            </div>
            <figcaption>
              <strong>Insights.</strong> Category changes against the previous month, relative to the user’s own
              spending — never one universal threshold.
            </figcaption>
          </figure>
        </div>
      </Chapter>

      <Chapter id="forecasts" index="03" label="Three forecasts" title={<>Three forecasting systems, deliberately kept apart.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          They solve different problems and do not pretend to be one vague “AI engine”. The first isn’t machine learning
          at all — it’s statistics you can audit.
        </p>
        <ol className="triad" data-reveal>
          <li>
            <span className="triad-num t-meta">A</span>
            <strong>Month-end projection</strong>
            <span>Deterministic. Weekday-specific spending over the last 28 days, plus 300 bootstrap simulations for a P20–P80 band and a budget-overrun probability.</span>
          </li>
          <li>
            <span className="triad-num t-meta">B</span>
            <strong>Next-month behaviour</strong>
            <span>An LSTM multi-task model: how much spending will grow, and the probability of exceeding the budget.</span>
          </li>
          <li>
            <span className="triad-num t-meta">C</span>
            <strong>Bitcoin, 10 days</strong>
            <span>A Conv1D/LSTM model that predicts ten daily log-returns directly, with an uncertainty estimate and an UP / DOWN / HOLD view.</span>
          </li>
        </ol>
      </Chapter>

      <Chapter id="projection" index="04" label="System A, live" title={<>The projection, running in front of you.</>} directive={hidden} wide>
        <p className="chapter-text t-lead" data-reveal>
          This is Fiscora’s month-end method, ported line for line: an expected path from weekday averages, and three
          hundred resampled futures drawn from the last 28 days. Where they land is the uncertainty.
        </p>
        <BootstrapLab />
      </Chapter>

      <Chapter id="behaviour" index="05" label="System B" title={<>Six months in, one month out.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Each month becomes 22 scale-free features, so the same network works for accounts in dollars and in toman. The
          model reads six months and predicts the seventh, with two heads sharing one encoder.
        </p>
        <SequenceModel />
        <CompareBars
          modelLabel="LSTM"
          rows={[
            { metric: 'Log-growth MAE', model: 0.1887, baseline: 0.2571, baselineLabel: 'no change', better: 'lower', format: (v) => v.toFixed(4) },
            { metric: 'Spend-ratio MAE', model: 0.2014, baseline: 0.2728, baselineLabel: 'no change', better: 'lower', format: (v) => v.toFixed(4) },
            { metric: 'Overspend accuracy', model: 0.7141, baseline: 0.6579, baselineLabel: 'majority', better: 'higher', format: (v) => `${(v * 100).toFixed(2)}%` },
            { metric: 'Overspend ROC AUC', model: 0.7595, baseline: null, better: 'higher', format: (v) => v.toFixed(4) },
          ]}
        />
        <Note>
          Validation results recorded in the training notebook, on a synthetic-but-coherent panel of 900 users × 30 months
          (27,000 user-months), split by user so nobody appears in both sets. They show the pipeline beats simple
          baselines on that data — not accuracy on real bank data.
        </Note>
      </Chapter>

      <Chapter id="bitcoin" index="06" label="System C" title={<>The model that didn’t win — and an interface that says so.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          The Bitcoin model sees 60 days of 20 engineered features — returns, volatility, RSI, MACD, Bollinger %B — and
          never the raw price. It predicts all ten days at once instead of feeding its own guesses back in. Then it was
          measured honestly against naive baselines:
        </p>
        <DataTable
          caption="Final test on the synthetic future-dated series"
          head={['Strategy', 'MAPE +1 day ↓', 'MAPE +10 days ↓', 'Direction +1 ↑', 'Direction +10 ↑']}
          rows={[
            ['LSTM', '2.03%', '6.95%', '48.79%', '50.31%'],
            ['Persistence', <b key="a">2.01%</b>, <b key="b">6.67%</b>, '—', '—'],
            ['60-day drift', '2.03%', '7.28%', <b key="c">51.41%</b>, <b key="d">53.41%</b>],
            ['Always up', '2.01%', '6.67%', '49.62%', '50.79%'],
          ]}
        />
        <p className="chapter-text" data-reveal>
          On that test the network shows no material edge. Fiscora keeps the result visible, describes its “confidence”
          as normalised move strength rather than a probability of being right, and designs the Bitcoin view around
          uncertainty and model inspection — not trading advice.
        </p>
      </Chapter>

      <Chapter id="coach" index="07" label="The AI coach" title={<>Arithmetic in Python. Language in the model.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          The assistant is told never to invent a monetary value. It chooses among six retrieval tools; the backend does
          the maths and returns facts; the model explains them. If tool calling isn’t available it pre-fetches a smaller
          grounded context, and if the language model is down entirely, Fiscora still answers with a deterministic
          bilingual summary.
        </p>
        <ul className="tools" data-reveal>
          {TOOLS.map(([name, desc]) => (
            <li key={name}>
              <code>{name}</code>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
        <h3 className="chapter-sub t-subtitle" data-reveal>
          Receipts are drafts, not truth
        </h3>
        <Flow
          vertical
          steps={[
            { title: 'Receipt image', body: 'Persian or English' },
            { title: 'EasyOCR + normalisation', body: 'optional OpenCV pre-processing; Rial amounts converted to toman' },
            { title: 'Structured extraction', body: 'language model when configured, regex fallback otherwise' },
            { title: 'Editable review', body: 'merchant, items, quantities, totals' },
            { title: 'Confirmed transaction', body: 'only after the user says so' },
          ]}
        />
      </Chapter>

      <Chapter id="signals" index="08" label="Alerts & language" title={<>Rules decide. Language only phrases.</>} directive={quiet}>
        <p className="chapter-text t-lead" data-reveal>
          Python rules decide whether something happened; a language model may phrase the facts in English and Persian,
          with deterministic templates when it isn’t available. Every alert has a cooldown so it can’t nag.
        </p>
        <DataTable
          head={['Alert', 'Trigger', 'Cooldown']}
          rows={[
            ['Budget risk', 'Overrun probability ≥ 60% after day 5', 'Once per month'],
            ['Low balance', 'Runway below 7 days', 'Once per ISO week'],
            ['Category spike', 'Weekly category z-score ≥ 2', 'Once per category per month'],
            ['Large transaction', '> 1.5 × the user’s 90-day P95', 'Once per transaction'],
            ['Bitcoin signal', 'Model moves to UP or DOWN', 'Once per signal per week'],
            ['Weekly digest', 'Friday in Iran, Sunday in the US', 'Once per week'],
          ]}
        />
        <Bilingual />
        <StatGrid
          items={[
            { value: 'fa · en', label: 'Persian and English, with full right-to-left layout' },
            { value: 'IRT · USD', label: 'Toman (shown as rial on request) and US dollars' },
            { value: 'Jalali', label: 'and Gregorian calendars, per region' },
          ]}
        />
      </Chapter>

      <Chapter id="engineering" index="09" label="Engineering & limits" title={<>A competition prototype that knows it is one.</>} directive={quiet}>
        <StatGrid
          items={[
            { value: '310,000', label: 'PBKDF2-SHA256 iterations per password hash' },
            { value: '25 / 25', label: 'integration smoke checks passed', note: 'Notebook-level suite, not CI or browser E2E' },
            { value: '300', label: 'bootstrap simulations per projection' },
          ]}
        />
        <ul className="limits" data-reveal>
          <li>The behaviour model is trained and evaluated on synthetic data; real-world accuracy is not established.</li>
          <li>Serving can build a six-month sequence from sparse history, so some features are approximations; crypto features are currently zero at serving time.</li>
          <li>Storage is local JSON with atomic writes — fine for a localhost prototype, not an internet-facing financial service.</li>
          <li>Outputs are decision support, not financial advice. Fiscora never executes trades.</li>
        </ul>
      </Chapter>

      <ProjectEnd p={p} />
      <Footer />
    </article>
  );
}
