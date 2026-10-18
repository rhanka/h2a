// Test-first baseline. The implementation is gated by velocity-test-lane.test.js.
export function selectFiles(args) { return { package: args[1], files: [] }; }
export function createLane() { throw new Error('private lane not implemented'); }
export function commandPlan() { return []; }
export function checkReport() { return { passed: 0, excluded: 0 }; }
export function executeLane() { return { passed: 0, excluded: 0 }; }
