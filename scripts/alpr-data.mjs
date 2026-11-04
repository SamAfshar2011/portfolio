/**
 * Regenerates src/projects/alpr/classifier.json from the PlateHunter
 * repository's saved classifier artifacts. The repository is only read.
 *
 *   node scripts/alpr-data.mjs <path to a Persian_ALPR_project checkout>
 *
 * The confusion matrix is rebuilt from per_class_accuracy.csv (the diagonal)
 * and misclassifications.csv (every off-diagonal cell), then checked against
 * the per-class totals and classification_report.csv.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2];
if (!repo) throw new Error('usage: node scripts/alpr-data.mjs <Persian_ALPR_project path>');
const saved = ['Saved_models', 'Saved_models copy'].map((d) => join(repo, d, 'model_3')).find((d) => existsSync(join(d, 'per_class_accuracy.csv')));
if (!saved) throw new Error('no model_3 artifacts found');

const csv = (name) => {
  const [head, ...lines] = readFileSync(join(saved, name), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const keys = head.split(',');
  return lines.map((l) => {
    // Only the path column can contain commas; take the fixed columns from the right.
    const cells = l.split(',');
    const extra = cells.length - keys.length;
    const row = {};
    keys.forEach((k, i) => (row[k] = i === 0 && extra > 0 ? cells.slice(0, extra + 1).join(',') : cells[i + (i > 0 ? extra : 0)]));
    return row;
  });
};

const perClass = csv('per_class_accuracy.csv');
const labels = perClass.map((r) => r.native_label);
const english = perClass.map((r) => r.english_label);
const N = labels.length;
const matrix = labels.map(() => new Array(N).fill(0));
perClass.forEach((r, i) => (matrix[i][i] = +r.correct));
for (const m of csv('misclassifications.csv')) matrix[+m.true_idx][+m.pred_idx] += 1;
perClass.forEach((r, i) => {
  const sum = matrix[i].reduce((a, b) => a + b, 0);
  if (sum !== +r.total) throw new Error(`row ${r.english_label}: ${sum} ≠ ${r.total}`);
});

const report = Object.fromEntries(csv('classification_report.csv').map((r) => [r[''], r]));
const total = perClass.reduce((a, r) => a + +r.total, 0);
const correct = perClass.reduce((a, r) => a + +r.correct, 0);
if (Math.abs(correct / total - +report.accuracy.precision) > 1e-9) throw new Error('accuracy does not match the classification report');

const dist = csv('class_distribution.csv');
const leakage = csv('train_valid_exact_leakage.csv').length;
const config = JSON.parse(readFileSync(join(saved, 'config.json'), 'utf8'));
const log = csv('training_log.csv').map((r) => ({
  epoch: +r.epoch,
  seconds: Math.round(+r.epoch_seconds),
  validAccuracy: +(+r.valid_accuracy).toFixed(5),
  macroF1: +(+r.macro_f1).toFixed(5),
}));

// An exported snapshot (git archive) has no .git: pass ALPR_COMMIT instead.
let commit = process.env.ALPR_COMMIT ?? 'unknown';
try {
  commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}

const out = {
  source: `Persian_ALPR_project ${commit} · ${saved.slice(repo.length + 1)} (per_class_accuracy.csv, misclassifications.csv, classification_report.csv, class_distribution.csv, train_valid_exact_leakage.csv, training_log.csv, config.json)`,
  architecture: config.architecture,
  labels,
  english,
  matrix,
  total,
  correct,
  macroF1: +(+report['macro avg']['f1-score']).toFixed(4),
  trainCounts: Object.fromEntries(dist.map((r) => [r.native_label, +r.train_count])),
  validCounts: Object.fromEntries(dist.map((r) => [r.native_label, +r.valid_count])),
  trainTotal: dist.reduce((a, r) => a + +r.train_count, 0),
  leakage,
  epochs: log,
};
writeFileSync(new URL('../src/projects/alpr/classifier.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`classifier.json: ${correct}/${total} correct, macro-F1 ${out.macroF1}, ${leakage} leaked pairs, ${log.length} epochs (${commit})`);
