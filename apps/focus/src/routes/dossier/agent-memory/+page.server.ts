import type { PageServerLoad } from './$types';
import { loadAgentMemoryAnswerSet } from '$lib/server/agent-memory-answers';
import { loadAgentMemoryDossier, loadAgentMemoryMatrix } from '$lib/server/agent-memory-dossier';

export const load: PageServerLoad = () => ({
  dossier: loadAgentMemoryDossier(),
  matrix: loadAgentMemoryMatrix(),
  // The committed answer set, so the dossier can be replayed as an acceptance scenario. `null` when
  // the file is unreachable — the page then says replay is unavailable rather than faking answers.
  answerSet: loadAgentMemoryAnswerSet()
});
