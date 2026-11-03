import { test as nodeTest } from 'node:test';
import { packageScenario } from './helpers/mh-l6-package-scenario.js';
const test = (name, body) => { if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body); };
test("U10 U12 should publish @sentropic/h2a-runtime with exact lockstep and install twice offline without a compiler", t => packageScenario(t, "@sentropic/h2a-runtime"));
test("U10 should install @sentropic/h2a-runtime for off-profile diagnostics while refusing H4 preparation", t => packageScenario(t, "@sentropic/h2a-runtime", { diagnosticsOnly: true }));
