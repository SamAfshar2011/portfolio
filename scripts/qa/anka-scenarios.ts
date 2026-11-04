// Representative ANKA simulator scenarios and parameter sweeps: stability (no
// NaN), damage states, continuity across magnitude, depth and duration.
//
//   npm run qa:anka
import { generateGround, estimatePga, type QuakeInput } from '../../src/projects/anka/sim/ground';
import { Building, STOREY_H, type BuildingInput } from '../../src/projects/anka/sim/structure';

function run(label: string, b: BuildingInput, q: QuakeInput) {
  const g = generateGround(q);
  const bld = new Building(b);
  const t0 = performance.now();
  let maxRu = 0;
  while (bld.time < g.length && !bld.unstable) {
    bld.advance(g, 1 / 60);
    maxRu = Math.max(maxRu, bld.ru);
  }
  const ms = performance.now() - t0;
  const s = bld.summary();
  const roof = bld.active > 0 ? bld.floorOffset(bld.active) - bld.sway : 0;
  const nan = bld.unstable;
  console.log(
    `${label.padEnd(44)} T=${bld.period.toFixed(2)}s PGA=${g.pga.toFixed(2)}g peakPGA=${bld.peakAcc.toFixed(2)}g | peak drift ${(s.peakRatio * 100).toFixed(2)}% @${s.peakAt} | D=${s.damage.toFixed(2)} ${s.state.padEnd(8)} | failed from ${bld.releases[0]?.from ?? '-'} | residual roof ${(roof * 100).toFixed(1)}cm | slide ${(bld.slide * 100).toFixed(1)}cm settle ${(bld.settlement * 100).toFixed(1)}cm tilt ${((bld.tiltPerm * 180) / Math.PI).toFixed(2)}° ru ${maxRu.toFixed(2)} | ${nan ? 'NaN!' : 'ok'} ${ms.toFixed(0)}ms`,
  );
  return { s, bld };
}

const base = { age: 20, liquefaction: 'low' as const };
console.log('--- required scenarios');
run('A modern low-rise concrete, rock, walls, M6', { structure: 'concrete', floors: 4, age: 5, shearWall: true, soil: 'rock', liquefaction: 'low' }, { magnitude: 6.0, duration: 20, depth: 15, soil: 'rock' });
run('B old masonry, soft, no wall, M7.2', { structure: 'masonry', floors: 5, age: 60, shearWall: false, soil: 'soft', liquefaction: 'low' }, { magnitude: 7.2, duration: 30, depth: 10, soil: 'soft' });
run('C steel, age 25, sand, M7.0 short', { structure: 'steel', floors: 8, age: 25, shearWall: false, soil: 'sand', liquefaction: 'low' }, { magnitude: 7.0, duration: 10, depth: 15, soil: 'sand' });
run('D1 concrete sand liq LOW M6.8', { structure: 'concrete', floors: 6, age: 20, shearWall: true, soil: 'sand', liquefaction: 'low' }, { magnitude: 6.8, duration: 30, depth: 12, soil: 'sand' });
run('D2 concrete sand liq HIGH M6.8', { structure: 'concrete', floors: 6, age: 20, shearWall: true, soil: 'sand', liquefaction: 'high' }, { magnitude: 6.8, duration: 30, depth: 12, soil: 'sand' });
console.log('--- screenshot defaults (concrete 10 fl, 20 yr, no wall, sand, M6.5 30s 10km, low)');
run('defaults', { structure: 'concrete', floors: 10, age: 20, shearWall: false, soil: 'sand', liquefaction: 'low' }, { magnitude: 6.5, duration: 30, depth: 10, soil: 'sand' });
console.log('--- materials at the same quake (6 fl, 20 yr, no wall, clay, M7.0 20s 15km)');
for (const m of ['concrete', 'steel', 'wood', 'masonry'] as const) run(`material ${m}`, { structure: m, floors: 6, ...base, shearWall: false, soil: 'clay' }, { magnitude: 7.0, duration: 20, depth: 15, soil: 'clay' });
console.log('--- walls');
for (const w of [false, true]) run(`concrete 8 fl walls=${w}`, { structure: 'concrete', floors: 8, ...base, shearWall: w, soil: 'clay' }, { magnitude: 7.0, duration: 20, depth: 15, soil: 'clay' });
console.log('--- age');
for (const a of [0, 20, 40, 60, 80, 100]) run(`concrete age ${a}`, { structure: 'concrete', floors: 8, age: a, shearWall: false, soil: 'clay', liquefaction: 'low' }, { magnitude: 7.0, duration: 20, depth: 15, soil: 'clay' });
console.log('--- soils (same building, M6.8)');
for (const so of ['rock', 'gravel', 'sand', 'clay', 'soft'] as const) run(`soil ${so}`, { structure: 'concrete', floors: 8, ...base, shearWall: false, soil: so }, { magnitude: 6.8, duration: 20, depth: 15, soil: so });
console.log('--- continuity in magnitude (steel 6 fl clay)');
for (let M = 6.0; M <= 8.01; M += 0.25) run(`M${M.toFixed(2)}`, { structure: 'steel', floors: 6, ...base, shearWall: false, soil: 'clay' }, { magnitude: M, duration: 20, depth: 15, soil: 'clay' });
console.log('--- duration');
for (const d of [5, 10, 20, 40, 60]) run(`duration ${d}`, { structure: 'concrete', floors: 6, ...base, shearWall: false, soil: 'sand' }, { magnitude: 7.0, duration: d, depth: 15, soil: 'sand' });
console.log('--- depth');
for (const dep of [1, 10, 30, 60, 100]) run(`depth ${dep}`, { structure: 'concrete', floors: 6, ...base, shearWall: false, soil: 'sand' }, { magnitude: 7.0, duration: 20, depth: dep, soil: 'sand' });
console.log('--- extremes');
run('25 floors masonry M9 soft high liq', { structure: 'masonry', floors: 25, age: 100, shearWall: false, soil: 'soft', liquefaction: 'high' }, { magnitude: 9.0, duration: 60, depth: 1, soil: 'soft' });
run('2 floors wood rock M4', { structure: 'wood', floors: 2, age: 0, shearWall: true, soil: 'rock', liquefaction: 'low' }, { magnitude: 4.0, duration: 5, depth: 100, soil: 'rock' });
