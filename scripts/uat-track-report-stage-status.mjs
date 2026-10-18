// Synthetic acceptance fixture and authored contextual synthesis; no model/provider calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventStore, Track, TrackReader, runCli, auditNextActions, describeRowNextActions, describeStatusProposals, auditStatusProposals } from '../packages/track/dist/index.js';
const NOW_ISO = '2026-10-18T12:00:00.000Z';
const OLD_ISO = '2026-09-20T10:00:00.000Z';
function makeFixture(dir) {
let sequence = 0;
const newId = () => '01M57' + String(++sequence).padStart(21, '0');
const store = new EventStore(`${dir}/events.jsonl`)
const old = new Track(store, { by: 'uat6', now: () => OLD_ISO, newId })
const now = new Track(store, { by: 'uat6', now: () => NOW_ISO, newId })
const ids = {}

// OLD phase: two WPs + one sub-WP, old open work (in-progress, no acceptance
// at all), old delivery (done + pass run at commit c-old), old withdrawal
// with a live dependency gate, irrelevant old withdrawal (no gate, no reason).
ids.wpa = old.createItem({ kind: 'chore', title: 'UAT Alpha', workspace: 'uat', role: 'workpackage' })
ids.wpb = old.createItem({ kind: 'chore', title: 'UAT Beta', workspace: 'uat', role: 'workpackage' })
ids.wpa1 = old.createItem({ kind: 'chore', title: 'UAT Alpha.1', workspace: 'uat', role: 'workpackage', parentId: ids.wpa })
ids.oldOpen = old.createItem({ kind: 'chore', title: 'old open work', body: 'Retain the last message when resuming an interrupted session; acceptance has not been recorded.', workspace: 'uat', parentId: ids.wpa })
old.setRealization(ids.oldOpen, 'in-progress')
ids.oldDone = old.createItem({ kind: 'chore', title: 'old delivery', workspace: 'uat', parentId: ids.wpb })
old.setRealization(ids.oldDone, 'in-progress')
old.setRealization(ids.oldDone, 'done')
const e0 = old.linkEvidence(old.addCriterion(ids.oldDone, 'old delivery accepted'), 'manual', 'https://example.test/uat/old-delivery')
old.recordRun(e0, { commit: 'c-old', env: 'uat', runner: 'uat6', result: 'pass' })
ids.oldGone = old.createItem({ kind: 'chore', title: 'old withdrawal with live gate', workspace: 'uat', parentId: ids.wpa })
old.setRealization(ids.oldGone, 'cancelled')
ids.oldGate = old.createItem({ kind: 'chore', title: 'old external prerequisite', workspace: 'uat' })
old.openBlocker({ targetId: ids.oldGone, kind: 'dependency', ref: ids.oldGate, reason: 'Waiting on the old lane' })
ids.veryOld = old.createItem({ kind: 'chore', title: 'irrelevant old withdrawal', workspace: 'uat', parentId: ids.wpb })
old.setRealization(ids.veryOld, 'cancelled')

// NOW phase: sub-WP member, deployed member with a recorded delivery link,
// red lane work (dependency gate + recorded facts/proposal), blue choice work
// (structured answerable dossier), never-qualified work, parentless leaf,
// phase-only and stream-only leaves, one demand promoted to two items, and a
// fresh withdrawal whose reason comes from a settled linked decision.
ids.fresh = now.createItem({ kind: 'chore', title: 'fresh sub-WP work', body: 'Reconnect with the same session id, then compare the last message with the checkpoint.', workspace: 'uat', parentId: ids.wpa1 })
now.setRealization(ids.fresh, 'in-progress')
ids.deployed = now.createItem({ kind: 'chore', title: 'deployed member', body: 'Synthetic delivery assertion: the referenced environment can restore a session after reconnecting.', workspace: 'uat', parentId: ids.wpb,
  links: [{ kind: 'deployed', locator: 'https://example.test/env/prod' }] })
now.setRealization(ids.deployed, 'in-progress')
now.setRealization(ids.deployed, 'done')
const ed = now.linkEvidence(now.addCriterion(ids.deployed, 'deployed member accepted'), 'manual', 'https://example.test/uat/deployed')
now.recordRun(ed, { commit: 'c-new', env: 'uat', runner: 'uat6', result: 'pass' })
ids.red = now.createItem({ kind: 'chore', title: 'red lane work', body: 'The session resume check waits for the dependent execution lane to restart; retain the result log on replay.', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.red, 'in-progress')
ids.dep = now.createItem({ kind: 'chore', title: 'other lane prerequisite', workspace: 'uat' })
now.openBlocker({ targetId: ids.red, kind: 'dependency', ref: ids.dep, reason: 'Waiting on the other lane' })
now.setReportStatus(ids.red, { status: 'blocked', facts: 'Blocked by the other lane.',
  proposal: 'Restart the lane, then replay the check.' })
ids.blue = now.createItem({ kind: 'chore', title: 'blue choice work', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.blue, 'in-progress')
ids.d1 = now.createDecision({ decisionKind: 'commitment', title: 'Share the UAT connector ?', workspace: 'uat', targets: [ids.blue],
  dossier: { context: 'The choice changes connection handling.', qa: [],
    readability: { readingBudgetMinutes: 2 },
    options: [{ id: 'a', title: 'Share', summary: 'One connection' },
              { id: 'b', title: 'Isolate', summary: 'Two connections' }],
    recommendation: { optionId: 'a', rationale: 'Fewer connections' },
    artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/share' }] } })
ids.nq = now.createItem({ kind: 'chore', title: 'never-qualified work', body: 'Define and run the interruption/resume case that must preserve the last message; no result is recorded.', workspace: 'uat', parentId: ids.wpb })
now.setRealization(ids.nq, 'in-progress')
ids.orphan = now.createItem({ kind: 'chore', title: 'parentless leaf', workspace: 'uat' })
ids.phase = now.createItem({ kind: 'chore', title: 'phase only', workspace: 'uat', role: 'spec-phase' })
ids.phaseLeaf = now.createItem({ kind: 'chore', title: 'phase-only leaf', workspace: 'uat', parentId: ids.phase })
ids.stream = now.createItem({ kind: 'chore', title: 'stream only', workspace: 'uat', role: 'stream' })
ids.streamLeaf = now.createItem({ kind: 'chore', title: 'stream-only leaf', workspace: 'uat', parentId: ids.stream })
ids.demand = now.raiseDemand({ type: 'feature', workspace: 'uat',
  raw: { text: 'Quiero reanudar mi sesión sin perder el último mensaje' }, source: { kind: 'human' }, handler: 'uat6' })
now.claimDemand(ids.demand, { handler: 'uat6' })
ids.halves = now.agreeDemand(ids.demand, { items: [{ title: 'first half' }, { title: 'second half' }] })
ids.freshGone = now.createItem({ kind: 'chore', title: 'fresh withdrawal', workspace: 'uat', parentId: ids.wpa })
now.setRealization(ids.freshGone, 'in-progress')
ids.gd = now.createDecision({ decisionKind: 'orientation', title: 'Keep the fresh scope ?', workspace: 'uat', targets: [ids.freshGone],
  dossier: { context: 'Scope cut.', qa: [], readability: { readingBudgetMinutes: 2 },
    options: [{ id: 'a', title: 'Keep', summary: 'Keep the scope' },
              { id: 'b', title: 'Cut', summary: 'Cut the scope: duplicate of the old lane' }],
    recommendation: { optionId: 'b', rationale: 'Duplicate' } } })
now.selectDecisionOption(ids.gd, 'b', 'go')
now.setRealization(ids.freshGone, 'cancelled')

// Historical prose-only dossiers are read-compatible, although current
// domain writes require options. Append one explicit legacy fixture event.
ids.legacy = newId();
store.appendCommand([{
  id: newId(), aggregate: 'decision', aggregateId: ids.legacy,
  type: 'decision.created', at: NOW_ISO, by: 'legacy-fixture',
  payload: { decisionKind: 'orientation', title: 'Offline recovery policy', workspace: 'uat', targets: [],
    dossier: { context: 'Choose whether offline recovery retains the session checkpoint.', options: [], qa: [] } },
}]);
return { store, ids, track: now };
}

// These are authored interpretations of the synthetic fixture. They are not
// inferred from titles or gate sentences; the map keys are fixture identities.
const copy = {
  fr: {
    sections: ['FAIT', 'À-FAIRE', 'DÉCISIONS', 'RECOMMANDATION'],
    columns: ['WP', 'av.', 'étape', 'statut', 'à faire', 'bloqué', 'prochaine action'],
    names: ['Reprendre une session interrompue', 'Retrait ancien avec dépendance active — motif non enregistré', 'Rétablir la lane de reprise', 'Choisir le partage de connexion', 'Reprendre après une reconnexion', 'Retrait : périmètre déjà couvert par la lane ancienne', 'Qualifier la reprise sans perte', 'Préparer le prérequis historique', 'Préparer le prérequis de la lane', 'Rattacher la reprise isolée à son WP', 'Définir le résultat de la phase', 'Définir le résultat du flux', 'Préserver le point de reprise', 'Restaurer la session', 'Rendre le choix hors ligne répondable'],
    actions: [
      'Rejouer le contrôle de reprise après redémarrage de la lane dépendante ; conserver le journal du résultat.',
      'Définir le cas « interrompre puis reprendre sans perdre le dernier message » et enregistrer son résultat.',
      'Exécuter le cas de reconnexion avec le même identifiant de session et comparer le dernier message.',
      'Écrire le résultat attendu de cette phase pour une reprise après interruption.',
      'Documenter quel point de reprise ce flux doit conserver avant de le rattacher à un WP.',
      'Enregistrer les options conserver/abandonner le point de reprise hors ligne et leurs conséquences.',
      'Vérifier le livrable des deux prérequis et proposer le WP de rattachement des demandes isolées.',
    ],
    delivered: 'La livraison enregistrée permet la reprise dans l’environnement référencé ; le lien de déploiement et la recette à c-new en sont les appuis.',
    noDelivery: 'Aucune livraison enregistrée dans cette fenêtre ; le travail ouvert reste visible ci-dessous.',
    question: 'Partager la connexion utilisée pour reprendre une session ?',
    alternatives: 'A Partager — une connexion\nB Isoler — deux connexions',
    without: 'Sans réponse : qualifier la conservation du dernier message, vérifier la reconnexion et instruire les demandes isolées. Le retrait ancien garde sa dépendance ; son motif manque.',
    answer: 'D1 A : partage une connexion et libère le choix de reprise ; D1 B : isole les connexions, avec deux connexions à maintenir. Préconisation A : moins de connexions.',
    reply: 'Réponds « vas y » pour les travaux sans décision, ou « D1 A » pour autoriser le partage.',
    outside: 'hors WP ; rattachement à instruire',
  },
  es: {
    sections: ['HECHO', 'POR HACER', 'DECISIONES', 'RECOMENDACIÓN'],
    columns: ['WP', 'av.', 'etapa', 'estado', 'por hacer', 'bloqueo', 'próxima acción'],
    names: ['Reanudar una sesión interrumpida', 'Retiro anterior con dependencia activa — motivo no registrado', 'Restablecer la ejecución de reanudación', 'Elegir si se comparte la conexión', 'Reanudar tras una reconexión', 'Retiro: alcance ya cubierto por el trabajo anterior', 'Verificar la reanudación sin pérdidas', 'Preparar el requisito anterior', 'Preparar el requisito de ejecución', 'Vincular la reanudación aislada a su WP', 'Definir el resultado de la fase', 'Definir el resultado del flujo', 'Conservar el punto de reanudación', 'Restaurar la sesión', 'Preparar la decisión sobre el modo sin conexión'],
    actions: [
      'Repetir la comprobación de reanudación tras reiniciar la ejecución dependiente y guardar su resultado.',
      'Definir el caso « interrumpir y reanudar sin perder el último mensaje » y registrar su resultado.',
      'Ejecutar la reconexión con el mismo identificador de sesión y comparar el último mensaje.',
      'Escribir el resultado esperado de esta fase al reanudar después de una interrupción.',
      'Documentar qué punto de reanudación conserva este flujo antes de vincularlo a un WP.',
      'Registrar las opciones conservar/descartar el punto sin conexión y sus consecuencias.',
      'Comprobar los dos requisitos y proponer el WP de las solicitudes aisladas.',
    ],
    delivered: 'La entrega registrada permite reanudar en el entorno referenciado; la referencia de despliegue y la prueba en c-new respaldan el resultado.',
    noDelivery: 'No hay entregas registradas en esta ventana; el trabajo abierto permanece visible.',
    question: '¿Compartir la conexión utilizada al reanudar una sesión?',
    alternatives: 'A Compartir — una conexión\nB Aislar — dos conexiones',
    without: 'Sin respuesta: verificar el último mensaje y la reconexión, y preparar las solicitudes aisladas. El retiro anterior mantiene su dependencia; falta el motivo.',
    answer: 'D1 A comparte una conexión y libera la elección de reanudación; D1 B aísla las conexiones y exige mantener dos. Se recomienda A para reducir conexiones.',
    reply: 'Responde « vas y » para el trabajo sin decisión o « D1 A » para autorizar la conexión compartida.',
    outside: 'fuera de WP; vinculación pendiente',
  },
  ja: {
    sections: ['完了', '今後の作業', '意思決定', '推奨事項'],
    columns: ['WP', '進捗', '段階', '状態', '作業', '阻害要因', '次の行動'],
    names: ['中断したセッションを再開する', '依存関係が残る以前の取り下げ — 理由の記録なし', '再開処理の実行経路を復旧する', '接続を共有するか決める', '再接続後にセッションを再開する', '取り下げ：以前の作業と範囲が重複', 'メッセージを失わずに再開できるか検証する', '以前の前提作業を準備する', '実行経路の前提作業を準備する', '独立した再開要求をWPに関連付ける', 'フェーズの期待結果を定める', 'ストリームの期待結果を定める', '再開地点を保持する', 'セッションを復元する', 'オフライン復旧の選択肢を準備する'],
    actions: [
      '依存する実行経路を再起動してから再開確認を実行し、結果のログを保存する。',
      '「中断後、最後のメッセージを失わず再開する」ケースを定義し、結果を記録する。',
      '同じセッションIDで再接続を実行し、最後のメッセージを比較する。',
      '中断後の再開について、このフェーズが満たす期待結果を書く。',
      'このストリームが保持する再開地点を記述してから、WPへの関連付けを提案する。',
      'オフラインの再開地点を保持する案と破棄する案、その影響を記録する。',
      '二つの前提作業の成果を確認し、独立した要求の所属WPを提案する。',
    ],
    delivered: '記録された成果により、参照先の環境で再開できる。デプロイ先の参照とc-newの検証結果が根拠となる。',
    noDelivery: 'この期間に記録された成果はない。未完了の作業は引き続き表示する。',
    question: 'セッション再開時の接続を共有するか。',
    alternatives: 'A 共有 — 接続は一つ\nB 分離 — 接続は二つ',
    without: '回答なしでも、最後のメッセージの保持と再接続を検証し、独立した要求を調査できる。以前の取り下げには依存関係が残り、理由は記録されていない。',
    answer: 'D1 Aは一つの接続を共有して再開方式の選択を解除する。D1 Bは接続を分離し、二つの接続の維持が必要となる。接続数を減らせるAを推奨する。',
    reply: '意思決定を要しない作業には「vas y」、接続共有の承認には「D1 A」と回答する。',
    outside: 'WP未所属・関連付けを要調査',
  },
  pt: {
    sections: ['CONCLUÍDO', 'A FAZER', 'DECISÕES', 'RECOMENDAÇÃO'],
    columns: ['WP', 'av.', 'etapa', 'estado', 'a fazer', 'bloqueio', 'próxima ação'],
    names: ['Retomar uma sessão interrompida', 'Retirada anterior com dependência ativa — motivo não registrado', 'Restabelecer a execução da retomada', 'Escolher o compartilhamento da conexão', 'Retomar após uma reconexão', 'Retirada: escopo já coberto pelo trabalho anterior', 'Verificar a retomada sem perdas', 'Preparar o requisito anterior', 'Preparar o requisito da execução', 'Vincular a retomada isolada ao seu WP', 'Definir o resultado da fase', 'Definir o resultado do fluxo', 'Preservar o ponto de retomada', 'Restaurar a sessão', 'Preparar a decisão sobre recuperação sem conexão'],
    actions: [
      'Repetir a verificação da retomada após reiniciar a execução dependente e guardar o resultado.',
      'Definir o caso « interromper e retomar sem perder a última mensagem » e registrar o resultado.',
      'Executar a reconexão com o mesmo identificador de sessão e comparar a última mensagem.',
      'Escrever o resultado esperado desta fase ao retomar após uma interrupção.',
      'Documentar qual ponto de retomada este fluxo preserva antes de vinculá-lo a um WP.',
      'Registrar as opções preservar/descartar o ponto sem conexão e suas consequências.',
      'Verificar os dois requisitos e propor o WP das solicitações isoladas.',
    ],
    delivered: 'A entrega registrada permite retomar no ambiente referenciado; a referência de implantação e a verificação em c-new sustentam o resultado.',
    noDelivery: 'Nenhuma entrega foi registrada nesta janela; o trabalho aberto continua visível.',
    question: 'Compartilhar a conexão usada para retomar uma sessão?',
    alternatives: 'A Compartilhar — uma conexão\nB Isolar — duas conexões',
    without: 'Sem resposta: verificar a última mensagem e a reconexão e preparar as solicitações isoladas. A retirada anterior mantém a dependência; falta o motivo.',
    answer: 'D1 A compartilha uma conexão e libera a escolha de retomada; D1 B isola as conexões e exige manter duas. A recomendação é A, com menos conexões.',
    reply: 'Responda « vas y » para o trabalho sem decisão ou « D1 A » para autorizar a conexão compartilhada.',
    outside: 'fora de WP; vinculação pendente',
  },
};

function contextualize(raw, lang, ids) {
  const report = structuredClone(raw);
  const view = report.view;
  const words = copy[lang];
  const keys = ['oldOpen', 'oldGone', 'red', 'blue', 'fresh', 'freshGone', 'nq', 'oldGate', 'dep', 'orphan', 'phaseLeaf', 'streamLeaf', 'half0', 'half1', 'legacy'];
  const names = new Map(keys.map((key, i) => [ids[key], words.names[i]]));
  const itemsByRow = new Map();
  for (const handle of view.handles) {
    if (!/^\d+\.\d+$/u.test(handle.handle)) continue;
    const rowIndex = Number(handle.handle.split('.')[0]) - 1;
    const handles = itemsByRow.get(rowIndex) ?? [];
    handles.push(handle);
    itemsByRow.set(rowIndex, handles);
  }
  const todo = view.tables.find(table => table.id === 'todo');
  todo.columns.forEach((column, i) => { column.label = words.columns[i]; });
  const rawRows = Object.values(raw.buckets).flat();
  const proposal = words.actions[0];
  for (const [index, handles] of itemsByRow) {
    const row = todo.rows[index];
    row.todo = handles.map(handle => {
      const facts = rawRows.find(candidate => candidate.id === handle.id);
      const outside = facts?.wpStrictRootId === undefined ? ` (outside-wp; ${words.outside})` : '';
      const source = facts?.requestSource?.provenance === 'demand-raw' ? `\n« ${facts.requestSource.text} » (demand-raw)` : '';
      return `[${handle.handle}] ${names.get(handle.id) ?? handle.title}${outside}${source}`;
    }).join('\n');
    const idsInRow = handles.map(handle => handle.id);
    if (idsInRow.includes(ids.legacy) || handles.every(handle => rawRows.find(row => row.id === handle.id)?.wpId === undefined)) row.wp = words.outside;
    const dependencies = { fr: 'dépendance', es: 'dependencia', ja: '依存関係', pt: 'dependência' };
    const missingOptions = { fr: 'options non enregistrées', es: 'opciones no registradas', ja: '選択肢の記録なし', pt: 'opções não registradas' };
    row.blocked = [...new Set(row.directiveIds.split(',').flatMap(id => {
      const gate = view.directives.find(d => d.id === id)?.gate;
      if (gate === undefined) return [];
      if (gate.code === 'decision-pending') {
        const ref = view.handles.find(h => h.id === gate.ref && h.kind === 'decision')?.handle;
        return ref?.startsWith('D') ? [ref] : [missingOptions[lang]];
      }
      return [gate.code === 'linked-dependency' ? dependencies[lang] : gate.code === 'spec-not-ready' ? 'spec' : gate.code];
    }))].join(' · ') || '—';
    const actionIndex = idsInRow.includes(ids.red) ? 0
      : idsInRow.includes(ids.nq) ? 1
      : idsInRow.includes(ids.fresh) ? 2
      : idsInRow.includes(ids.phaseLeaf) ? 3
      : idsInRow.includes(ids.streamLeaf) ? 4
      : idsInRow.includes(ids.legacy) ? 5 : 6;
    row.nextAction = words.actions[actionIndex];
    row.instruction = 'investigated';
    row.actionOrigin = 'investigated';
  }
  const done = view.tables.find(table => table.id === 'done');
  const doneColumns = {
    fr: ['scope', 'avancement', 'dernières actions'], es: ['alcance', 'avance', 'últimos resultados'],
    ja: ['範囲', '進捗', '直近の成果'], pt: ['escopo', 'avanço', 'últimos resultados'],
  };
  done.columns.forEach((column, i) => { column.label = doneColumns[lang][i]; });
  const inWindow = raw.period.eventsInWindow > 0;
  done.rows.forEach(row => { row.lastActions = inWindow ? words.delivered : words.noDelivery; });
  const decisions = view.tables.find(table => table.id === 'decisions');
  assert.equal(decisions.rows.length, 1);
  Object.assign(decisions.rows[0], { alternatives: words.alternatives, preco: 'A\n' });
  const decisionColumns = {
    fr: ['#', 'sujet', 'alternatives', 'préco'], es: ['#', 'pregunta', 'alternativas', 'recomendación'],
    ja: ['#', '問い', '選択肢', '推奨'], pt: ['#', 'pergunta', 'alternativas', 'recomendação'],
  };
  decisions.columns.forEach((column, i) => { column.label = decisionColumns[lang][i]; });
  // Preserve the native subject column identity (the actual id is `subject`).
  const subjectColumn = decisions.columns[1].id;
  decisions.rows[0][subjectColumn] = words.question;
  const recommendation = view.tables.find(table => table.id === 'recommendation');
  recommendation.lines = [words.without, proposal, words.answer, words.reply];
  view.proposals = [{ itemId: ids.red, proposal, proposalState: 'investigated' }];
  view.tables.forEach((table, i) => { table.title = words.sections[i]; });
  return report;
}

function markdown(report, lang) {
  const view = report.view;
  const cell = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  const lines = [
    `<!-- Synthetic contextual report; language=${lang}. Human semantic acceptance pending. -->`,
    `<!-- Historical references track-report-contextual.md and track-report-raw.txt are unchanged. -->`,
    `**${report.period.from} → ${report.period.to}** · c-new · ${view.header.progress}`,
    `coverage: ${view.coverage.projected} → ${view.coverage.rendered} · outside-wp: ${view.coverage.outsideWp}`,
    '',
  ];
  for (const table of view.tables) {
    lines.push(`## ${table.title}`, '');
    if (table.id === 'recommendation') lines.push(...table.lines.map(line => `${line}\n`));
    else {
      lines.push(`| ${table.columns.map(c => c.label).join(' | ')} |`, `| ${table.columns.map(() => '---').join(' | ')} |`);
      for (const row of table.rows) lines.push(`| ${table.columns.map(c => cell(row[c.id])).join(' | ')} |`);
      if (table.id === 'decisions') {
        for (const decision of report.decisions.filter(d => d.structure === 'structured' && d.outcome === 'pending')) {
          const ref = view.handles.find(h => h.id === decision.id && h.kind === 'decision')?.handle;
          for (const artifact of decision.artifacts ?? []) {
            if (artifact.viewRef !== undefined) lines.push('', `[${ref}](${artifact.viewRef})`);
          }
        }
      }
    }
    lines.push('');
  }
  lines.push('```text', view.header.handleCommand, ...view.handles.map(h => `${h.handle}\t${h.id}`), '```', '');
  return lines.join('\n');
}

const outputDir = resolve(process.argv[2] ?? 'docs/specs/examples');
const fixtureDir = mkdtempSync(join(tmpdir(), 'track-contextual-uat-'));
const priorRuntimeDir = process.env.XDG_RUNTIME_DIR;
process.env.XDG_RUNTIME_DIR = fixtureDir;
try {
  const { store, ids, track } = makeFixture(fixtureDir);
  ids.half0 = ids.halves[0]; ids.half1 = ids.halves[1];
  const before = readFileSync(join(fixtureDir, 'events.jsonl'), 'utf8');
  const cli = extra => {
    let out = ''; let err = '';
    const code = runCli(['--track-dir', fixtureDir, 'report', '--status-table', '--commit', 'c-new', '--now', NOW_ISO, '--format', 'json', ...extra], {
      cwd: fixtureDir, out: text => { out += text; }, err: text => { err += text; },
    });
    assert.equal(code, 0, err);
    return JSON.parse(out);
  };
  const variants = [
    ['weekly', []], ['daily', ['--period', 'last-day']],
    ['long', ['--since', '2026-09-01', '--until', '2026-10-18']],
    ['expanded', ['--since', '2026-09-01', '--until', '2026-10-18', '--sub-wp']],
    ['empty', ['--now', '2026-11-10T12:00:00.000Z']], ['all', ['--period', 'all']],
  ];
  const cases = variants.map(([name, args]) => {
    const raw = cli(args);
    assert.deepEqual(raw.view.tables.map(t => t.id), ['done', 'todo', 'decisions', 'recommendation']);
    const target = raw.view.handles.find(h => h.id === ids.red);
    assert.ok(target);
    let out = ''; let err = '';
    const command = raw.view.header.handleCommand.replace('<handle>', target.handle).split(' ').slice(1);
    const code = runCli(['--track-dir', fixtureDir, ...command], { cwd: fixtureDir, out: s => { out += s; }, err: s => { err += s; } });
    assert.equal(code, 0, err);
    assert.ok(out.includes(ids.red));
    if (name === 'weekly') assert.equal(raw.period.requested, 'last-week');
    if (name === 'daily') assert.equal(raw.period.requested, 'last-day');
    if (name === 'empty') assert.equal(raw.period.eventsInWindow, 0);
    assert.equal(raw.view.handles.some(h => h.id === ids.oldGone), true);
    assert.equal(raw.view.handles.some(h => h.id === ids.veryOld), name === 'long' || name === 'expanded' || name === 'all');
    return { name, args, period: raw.period, handleResolved: target.handle, coverage: raw.view.coverage };
  });
  const raw = cli([]);
  const machineFacts = report => ({
    period: report.period,
    handles: report.view.handles,
    progress: report.view.header.progress,
    codes: Object.values(report.buckets).flat().map(row => ({ id: row.id, stage: row.stage, status: row.status, requestSource: row.requestSource })),
  });
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const snapshot = new TrackReader(join(fixtureDir, 'events.jsonl')).reportSnapshot({ baselineCommit: 'c-new', decisions: true, wpTree: true });
  const evidence = {
    about: 'Synthetic fixture plus authored contextual reports. Mechanical presence is tested; semantic and independent cold-agent acceptance remain pending.',
    fixture: { events: snapshot.cursor.count, head: snapshot.cursor.head, now: NOW_ISO, old: OLD_ISO },
    machine: machineFacts(raw),
    cases,
    rawActionAudit: auditNextActions(describeRowNextActions(raw.view.tables.find(t => t.id === 'todo').rows)),
    audits: {}, languages: {}, journalMutations: 0,
    translatedPlaceholder: auditNextActions(describeRowNextActions([{ focus: 'true', instruction: 'to-instruct', nextAction: 'por instruir' }])),
  };
  mkdirSync(outputDir, { recursive: true });
  for (const lang of Object.keys(copy)) {
    const rawLanguage = cli(['--lang', lang]);
    assert.deepEqual(rawLanguage.view.handles, raw.view.handles);
    assert.deepEqual(rawLanguage.period, raw.period);
    const served = contextualize(rawLanguage, lang, ids);
    assert.deepEqual(machineFacts(served), evidence.machine);
    const actions = describeRowNextActions(served.view.tables.find(t => t.id === 'todo').rows);
    const proposals = describeStatusProposals(track.state(), snapshot.report, served.view);
    const actionAudit = auditNextActions(actions);
    const proposalAudit = auditStatusProposals(proposals.rows, proposals.decisionRefs);
    assert.equal(actionAudit.uninstructed, 0);
    assert.equal(actionAudit.ok, true);
    assert.equal(proposalAudit.ok, true);
    const artifact = `track-report-stage-status${lang === 'fr' ? '' : `.${lang}`}.md`;
    writeFileSync(join(outputDir, artifact), markdown(served, lang));
    evidence.languages[lang] = {
      lang, artifact, sections: copy[lang].sections,
      machineDigest: digest(machineFacts(served)),
      actions, proposals: proposals.rows, decisionRefs: proposals.decisionRefs,
      replyLines: [copy[lang].reply],
      audits: { actions: actionAudit, proposals: proposalAudit },
    };
    if (lang === 'fr') evidence.audits.actionFr = actionAudit;
  }
  assert.equal(readFileSync(join(fixtureDir, 'events.jsonl'), 'utf8'), before);
  writeFileSync(join(outputDir, 'track-report-stage-status-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${cases.length} period cases; fr/es/ja/pt: actions=0 owed, proposals=OK; journal mutations=0\n`);
} finally {
  if (priorRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = priorRuntimeDir;
  rmSync(fixtureDir, { recursive: true, force: true });
}
