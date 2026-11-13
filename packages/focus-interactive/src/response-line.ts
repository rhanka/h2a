/** Stable, visible decision/option codes. Unanswered questions never imply consent. */
export function optionCode(index: number): string {
  let code = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) code = String.fromCharCode(65 + (n - 1) % 26) + code;
  return code;
}

/** Keep authored decision numbers, including gaps, and avoid collisions with generated codes. */
export function decisionCodes(questions: readonly { id: string }[]): string[] {
  const explicit = (id: string) => /^D[1-9]\d*$/i.test(id) ? id.toUpperCase() : null;
  const reserved = new Set(questions.map(q => explicit(q.id)));
  let next = 1;
  return questions.map(q => {
    const code = explicit(q.id);
    if (code) return code;
    while (reserved.has(`D${next}`)) next++;
    return `D${next++}`;
  });
}

export function responseLine(
  questions: readonly { id: string }[],
  optionSets: readonly { questionId: string; options: readonly { id: string }[] }[],
  selections: ReadonlyMap<string, string>,
): string {
  const codes = decisionCodes(questions);
  return questions.map((q, i) => {
    const options = optionSets.filter(s => s.questionId === q.id).flatMap(s => s.options);
    const index = options.findIndex(o => o.id === selections.get(q.id));
    return `${codes[i]} ${index < 0 ? '—' : optionCode(index)}`;
  }).join(' · ');
}
