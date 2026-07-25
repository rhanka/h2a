import type { PageServerLoad } from './$types';
import { loadAgentMemoryDossier, loadAgentMemoryMatrix } from '$lib/server/agent-memory-dossier';

export const load: PageServerLoad = () => ({
  dossier: loadAgentMemoryDossier(),
  matrix: loadAgentMemoryMatrix()
});
