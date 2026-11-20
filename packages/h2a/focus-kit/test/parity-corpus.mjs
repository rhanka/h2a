import { readFileSync } from 'node:fs';

// Synthetic public examples only. Never capture a user's dossier in this corpus.
export function parityCorpus() {
  const decision = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url)));
  decision.ref = 'example:portable-decision';
  decision.provenance.source = 'example:parity';
  const diagram = decision.sections.find(s => s.kind === 'diagram');
  diagram.source = 'flowchart LR\nwriter["Rédaction"]\nreader["Lecture"]\nwriter -->|transmet| reader';
  diagram.alt = 'La rédaction transmet le dossier à la lecture.';
  const report = structuredClone(decision);
  report.title = 'Rapport de présentation';
  const question = report.sections.find(s => s.kind === 'question');
  question.state = 'validated';
  question.answer = 'Le fichier portable est retenu pour la lecture hors connexion.';
  report.sections.push({ kind: 'outcome', id: 'conclusion', targetRef: 'conclusion',
    modality: 'decision', questionId: question.id, statement: 'Le fichier portable permet de transmettre le dossier complet.' });
  report.amendmentTrace = [{ at: '2026-11-13T00:00:00Z', author: 'Présentation', summary: 'Le choix retenu est ajouté au rapport.' }];
  const evidence = JSON.parse(readFileSync(new URL('../dossier.evidence.template.json', import.meta.url)));
  evidence.sections.find(s => s.kind === 'diagram').source = diagram.source;
  evidence.sections.find(s => s.kind === 'diagram').alt = diagram.alt;
  return { decision, report, evidence };
}
