import { a2 as head, a4 as escape_html, Z as derived, ab as spread_props, ae as attr_style, a3 as attr, a9 as ensure_array_like, a8 as attributes, a7 as clsx, a6 as attr_class, ag as stringify, aa as bind_props } from '../../../../chunks/index.js-laGHLarB.js';
import { A as AppShell, C as Container, F as Flex, c as Badge, a as Alert, b as Card, B as Button } from '../../../../chunks/AppShell.js-6Pi87dO0.js';
import '../../../../chunks/utils.js-C_3_iViC.js';
import '../../../../chunks/utils2.js-BQzn9ikS.js';

function ProgressBar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      label,
      helperText,
      value = 0,
      max = 100,
      indeterminate = false,
      tone = "neutral",
      size = "md",
      showValue = false,
      valueText,
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const wrapperClasses = () => ["st-progressBar", className].filter(Boolean).join(" ");
    const trackClasses = () => [
      "st-progressBar__track",
      `st-progressBar__track--${size}`,
      `st-progressBar__track--${tone}`,
      indeterminate ? "st-progressBar__track--indeterminate" : null
    ].filter(Boolean).join(" ");
    const clampedValue = () => {
      if (max <= 0) return 0;
      if (value < 0) return 0;
      if (value > max) return max;
      return value;
    };
    const percent = () => indeterminate ? 0 : clampedValue() / max * 100;
    const displayValue = () => {
      if (valueText) return valueText;
      if (indeterminate) return "";
      return `${Math.round(percent())}%`;
    };
    $$renderer2.push(`<div${attributes({ ...rest, class: clsx(wrapperClasses()) }, "svelte-1d165yb")}>`);
    if (label || showValue && !indeterminate) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="st-progressBar__header svelte-1d165yb">`);
      if (label) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="st-progressBar__label svelte-1d165yb">${escape_html(label)}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (showValue && !indeterminate) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="st-progressBar__value svelte-1d165yb" aria-hidden="true">${escape_html(displayValue())}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div${attr_class(clsx(trackClasses()), "svelte-1d165yb")} role="progressbar"${attr("aria-valuemin", indeterminate ? void 0 : 0)}${attr("aria-valuemax", indeterminate ? void 0 : max)}${attr("aria-valuenow", indeterminate ? void 0 : clampedValue())}${attr("aria-valuetext", indeterminate ? void 0 : displayValue())}${attr("aria-label", label)}><div class="st-progressBar__fill svelte-1d165yb"${attr_style(`--st-progressBar-pct: ${stringify(percent())}%`)}></div></div> `);
    if (helperText) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-progressBar__help svelte-1d165yb">${escape_html(helperText)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function SlideIndicator($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      count,
      current = 0,
      onChange,
      size = "md",
      variant = "dots",
      label = "Diapositive",
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => [
      "st-slideIndicator",
      `st-slideIndicator--${size}`,
      `st-slideIndicator--${variant}`,
      className
    ].filter(Boolean).join(" "));
    const items = derived(() => Array.from({ length: Math.max(0, count) }, (_, i) => i));
    $$renderer2.push(`<div${attributes(
      {
        ...rest,
        class: clsx(classes()),
        role: "group",
        "aria-label": label
      },
      "svelte-60hp0l"
    )}><!--[-->`);
    const each_array = ensure_array_like(items());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let index = each_array[$$index];
      $$renderer2.push(`<button type="button"${attr_class("st-slideIndicator__dot svelte-60hp0l", void 0, { "st-slideIndicator__dot--current": index === current })}${attr("aria-current", index === current ? "true" : void 0)}${attr("aria-label", `${label} ${index + 1}`)}${attr("tabindex", index === current ? 0 : -1)}></button>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function Stack($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      gap,
      align,
      justify,
      as = "div",
      class: className,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = derived(() => ["st-stack", className].filter(Boolean).join(" "));
    Flex($$renderer2, spread_props([
      rest,
      {
        as,
        gap,
        align,
        justify,
        direction: "column",
        class: classes(),
        children: ($$renderer3) => {
          children?.($$renderer3);
          $$renderer3.push(`<!---->`);
        },
        $$slots: { default: true }
      }
    ]));
  });
}
function Table($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      columns,
      rows,
      caption,
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => ["st-table", className].filter(Boolean).join(" ");
    const cellValue = (row, key) => String(row[key] ?? "");
    $$renderer2.push(`<div class="st-table-wrap svelte-310erb"><table${attributes({ ...rest, class: clsx(classes()) }, "svelte-310erb")}>`);
    if (caption) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<caption class="svelte-310erb">${escape_html(caption)}</caption>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--><thead><tr><!--[-->`);
    const each_array = ensure_array_like(columns);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let column = each_array[$$index];
      $$renderer2.push(`<th scope="col"${attr_class("svelte-310erb", void 0, {
        "st-table__cell--right": column.align === "right",
        "st-table__cell--center": column.align === "center"
      })}>${escape_html(column.label)}</th>`);
    }
    $$renderer2.push(`<!--]--></tr></thead><tbody class="svelte-310erb"><!--[-->`);
    const each_array_1 = ensure_array_like(rows);
    for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
      let row = each_array_1[$$index_2];
      $$renderer2.push(`<tr class="svelte-310erb"><!--[-->`);
      const each_array_2 = ensure_array_like(columns);
      for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
        let column = each_array_2[$$index_1];
        $$renderer2.push(`<td${attr_class("svelte-310erb", void 0, {
          "st-table__cell--right": column.align === "right",
          "st-table__cell--center": column.align === "center"
        })}>${escape_html(cellValue(row, column.key))}</td>`);
      }
      $$renderer2.push(`<!--]--></tr>`);
    }
    $$renderer2.push(`<!--]--></tbody></table></div>`);
  });
}
function Textarea($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      label,
      helperText,
      errorText,
      invalid = false,
      value = "",
      class: className,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const fieldClasses = () => ["st-field", className].filter(Boolean).join(" ");
    const isInvalid = () => invalid || Boolean(errorText);
    $$renderer2.push(`<div${attr_class(clsx(fieldClasses()), "svelte-zb6qyp")}><label class="st-field__control svelte-zb6qyp">`);
    if (label) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-field__label svelte-zb6qyp">${escape_html(label)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <textarea${attributes(
      {
        ...rest,
        class: "st-textarea",
        "aria-invalid": isInvalid() ? "true" : void 0
      },
      "svelte-zb6qyp"
    )}>`);
    const $$body = escape_html(value);
    if ($$body) {
      $$renderer2.push(`${$$body}`);
    }
    $$renderer2.push(`</textarea></label> `);
    if (errorText) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="st-field__error svelte-zb6qyp">${escape_html(errorText)}</span>`);
    } else if (helperText) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<span class="st-field__help svelte-zb6qyp">${escape_html(helperText)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { value });
  });
}
function Tile($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      variant = "static",
      href,
      selected = false,
      disabled = false,
      title,
      description,
      class: className,
      onclick,
      onselect,
      children,
      $$slots,
      $$events,
      ...rest
    } = $$props;
    const classes = () => [
      "st-tile",
      `st-tile--${variant}`,
      variant === "selectable" && selected ? "st-tile--selected" : null,
      disabled ? "st-tile--disabled" : null,
      className
    ].filter(Boolean).join(" ");
    function body($$renderer3) {
      if (children) {
        $$renderer3.push("<!--[0-->");
        children($$renderer3);
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[-1-->");
        if (title) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="st-tile__title svelte-1vcfi3">${escape_html(title)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> `);
        if (description) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<span class="st-tile__description svelte-1vcfi3">${escape_html(description)}</span>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]-->`);
      }
      $$renderer3.push(`<!--]-->`);
    }
    if (variant === "clickable" && href) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<a${attributes(
        {
          ...rest,
          class: clsx(classes()),
          href,
          "aria-disabled": disabled
        },
        "svelte-1vcfi3"
      )}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></a>`);
    } else if (variant === "clickable") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<button${attributes({ ...rest, type: "button", class: clsx(classes()), disabled }, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></button>`);
    } else if (variant === "selectable") {
      $$renderer2.push("<!--[2-->");
      $$renderer2.push(`<label${attr_class(clsx(classes()), "svelte-1vcfi3")}><input type="checkbox" class="st-tile__input svelte-1vcfi3"${attr("checked", selected, true)}${attr("disabled", disabled, true)}/> <span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></label>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div${attributes({ ...rest, class: clsx(classes()) }, "svelte-1vcfi3")}><span class="st-tile__content svelte-1vcfi3">`);
      body($$renderer2);
      $$renderer2.push(`<!----></span></div>`);
    }
    $$renderer2.push(`<!--]-->`);
    bind_props($$props, { selected });
  });
}
function projectAnswerSet(answerSet, decisions, dossierRevision) {
  if (!answerSet || !answerSet.answers) return null;
  const selections = {};
  const notes = {};
  const applied = [];
  const missingDecisions = [];
  const staleOptions = [];
  for (const [key, entry] of Object.entries(answerSet.answers)) {
    const decision = decisions.find((candidate) => candidate.key === key);
    if (!decision) {
      missingDecisions.push(key);
      continue;
    }
    if (entry.option) {
      if (decision.options.some((option) => option.key === entry.option)) {
        selections[key] = entry.option;
      } else {
        staleOptions.push(`${key} → ${entry.option}`);
      }
    }
    if (typeof entry.note === "string" && entry.note.length > 0) notes[key] = entry.note;
    applied.push(key);
  }
  const unanswered = decisions.filter((decision) => {
    const entry = answerSet.answers[decision.key];
    return !entry || !entry.option && (entry.note ?? "").length === 0;
  }).map((decision) => decision.key);
  return {
    state: { selections, notes },
    report: {
      applied,
      missingDecisions,
      staleOptions,
      unanswered,
      revisionMismatch: answerSet.revision !== dossierRevision
    }
  };
}
function collectAnswers(state, decisions) {
  return decisions.map((decision) => ({
    decisionKey: decision.key,
    optionKey: state.selections[decision.key] ?? null,
    note: (state.notes[decision.key] ?? "").trim()
  }));
}
function collectAnsweredOnly(state, decisions) {
  return collectAnswers(state, decisions).filter((a) => a.optionKey || a.note.length > 0);
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const dossier = derived(() => data.dossier);
    const matrix = derived(() => data.matrix);
    const answerSet = derived(() => data.answerSet);
    const committed = projectAnswerSet(data.answerSet, data.dossier.decisions, data.dossier.revision);
    const decisionsTotal = derived(() => dossier().decisions.length);
    const slidesTotal = derived(() => decisionsTotal() + 1);
    const storageKey = derived(() => `focus:dossier-agent-memory:${dossier().revision}:choix`);
    const notesKey = derived(() => `focus:dossier-agent-memory:${dossier().revision}:notes`);
    let current = 0;
    let selections = { ...committed?.state.selections ?? {} };
    let notes = { ...committed?.state.notes ?? {} };
    let exportState = "idle";
    const divergences = derived(() => []);
    const divergentKeys = derived(() => new Set(divergences().map((d) => d.key)));
    const answerOrigin = derived(() => !committed ? "empty" : divergences().length > 0 ? "draft" : "committed");
    function previous() {
      current = Math.max(0, current - 1);
    }
    function next() {
      current = Math.min(slidesTotal() - 1, current + 1);
    }
    function selectOption(decisionKey, optionKey) {
      selections = { ...selections, [decisionKey]: optionKey };
    }
    function setNote(decisionKey, value) {
      notes = { ...notes, [decisionKey]: value };
      exportState = "idle";
    }
    function useCommitted() {
      if (!committed) return;
      selections = { ...committed.state.selections };
      notes = { ...committed.state.notes };
      exportState = "idle";
      try {
        window.localStorage.removeItem(storageKey());
        window.localStorage.removeItem(notesKey());
      } catch {
      }
    }
    function buildSummary() {
      const lines = [
        `# ${dossier().title}`,
        "",
        `Révision : ${dossier().revision}`,
        ""
      ];
      for (const decision of dossier().decisions) {
        const selected = decision.options.find((option) => option.key === selections[decision.key]);
        const note = notes[decision.key]?.trim();
        lines.push(`## ${decision.key} — ${decision.question}`);
        lines.push(`- Option retenue : ${selected ? selected.title : "(aucune)"}`);
        lines.push(`- Note : ${note ? note : "(aucune)"}`);
        lines.push("");
      }
      return lines.join("\n");
    }
    async function copySummary() {
      try {
        await navigator.clipboard.writeText(buildSummary());
        exportState = "copied";
      } catch {
        exportState = "failed";
      }
    }
    function buildAnswerSetJson() {
      const answers = {};
      for (const decision of dossier().decisions) {
        answers[decision.key] = {
          option: selections[decision.key] ?? null,
          note: notes[decision.key]?.trim() ?? ""
        };
      }
      return `${JSON.stringify(
        {
          dossier: "agent-memory",
          revision: dossier().revision,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          capturedFrom: "focus, dossier /dossier/agent-memory",
          answers
        },
        null,
        2
      )}
`;
    }
    async function copyAnswerSetJson() {
      try {
        await navigator.clipboard.writeText(buildAnswerSetJson());
        exportState = "copied-json";
      } catch {
        exportState = "failed";
      }
    }
    const committedReport = derived(() => committed ? committed.report : null);
    const revisionMismatch = derived(() => Boolean(answerSet()) && answerSet().revision !== dossier().revision);
    let including = null;
    let includeResult = {};
    let h2aTarget = data.h2a.target;
    let h2aLive = data.h2a.live;
    let h2aReason = data.h2a.reason;
    let h2aRemedy = data.h2a.remedy;
    let h2aAmbiguous = data.h2a.ambiguous;
    let showTargets = false;
    let refreshingTargets = false;
    async function refreshTargets() {
      refreshingTargets = true;
      try {
        const res = await fetch("/api/h2a/targets");
        const body = await res.json();
        if (body?.ok) {
          h2aLive = body.live ?? [];
          h2aReason = body.reason;
          h2aRemedy = body.remedy ?? null;
          h2aAmbiguous = Boolean(body.ambiguous);
          if (!h2aTarget || !h2aLive.some((s) => s.instance === h2aTarget)) {
            h2aTarget = body.target ?? null;
          }
        }
      } catch {
      } finally {
        refreshingTargets = false;
      }
    }
    function chooseTarget(instance) {
      h2aTarget = instance;
      showTargets = false;
    }
    function hasSomethingToInclude(decisionKey) {
      return Boolean(selections[decisionKey] || notes[decisionKey]?.trim());
    }
    async function includeChoice(decisionKey) {
      including = decisionKey;
      try {
        const res = await fetch("/api/dossiers/agent-memory/include", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decisionKey,
            optionKey: selections[decisionKey] ?? null,
            note: notes[decisionKey] ?? "",
            target: h2aTarget
          })
        });
        includeResult = { ...includeResult, [decisionKey]: await res.json() };
      } catch (e) {
        includeResult = {
          ...includeResult,
          [decisionKey]: {
            ok: false,
            error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}`
          }
        };
      } finally {
        including = null;
      }
    }
    let sendingAll = false;
    let sendAllResult = null;
    async function sendAll() {
      sendingAll = true;
      sendAllResult = null;
      try {
        const answers = collectAnsweredOnly({ selections, notes }, dossier().decisions);
        const res = await fetch("/api/dossiers/agent-memory/include", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers, target: h2aTarget })
        });
        sendAllResult = await res.json();
      } catch (e) {
        sendAllResult = {
          ok: false,
          error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}`
        };
      } finally {
        sendingAll = false;
      }
    }
    const answeredCount = derived(() => dossier().decisions.filter((decision) => selections[decision.key] || notes[decision.key]?.trim()).length);
    head("e74176", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>${escape_html(dossier().title)}</title>`);
      });
    });
    {
      let main = function($$renderer3) {
        Container($$renderer3, {
          size: "md",
          padding: true,
          children: ($$renderer4) => {
            $$renderer4.push(`<main class="dossier svelte-e74176" aria-labelledby="dossier-title">`);
            Stack($$renderer4, {
              gap: 4,
              children: ($$renderer5) => {
                $$renderer5.push(`<header>`);
                Stack($$renderer5, {
                  gap: 2,
                  children: ($$renderer6) => {
                    Flex($$renderer6, {
                      align: "center",
                      justify: "between",
                      wrap: true,
                      gap: 2,
                      children: ($$renderer7) => {
                        Badge($$renderer7, {
                          tone: "info",
                          children: ($$renderer8) => {
                            $$renderer8.push(`<!---->Dossier décisionnel`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        if (current === 0) {
                          $$renderer7.push("<!--[0-->");
                          Badge($$renderer7, {
                            tone: "neutral",
                            children: ($$renderer8) => {
                              $$renderer8.push(`<!---->État de l’art — aucune décision`);
                            },
                            $$slots: { default: true }
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                          Badge($$renderer7, {
                            tone: "neutral",
                            children: ($$renderer8) => {
                              $$renderer8.push(`<!---->Décision ${escape_html(current)} / ${escape_html(decisionsTotal())}`);
                            },
                            $$slots: { default: true }
                          });
                        }
                        $$renderer7.push(`<!--]-->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> <h1 id="dossier-title">${escape_html(dossier().title)}</h1> <p>${escape_html(dossier().context)}</p> `);
                    ProgressBar($$renderer6, {
                      label: "Progression du dossier",
                      value: current + 1,
                      max: slidesTotal(),
                      valueText: current === 0 ? "État de l’art" : `Décision ${current} / ${decisionsTotal()}`,
                      showValue: true
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></header> `);
                Alert($$renderer5, {
                  tone: "info",
                  title: "Support de décision neutre",
                  message: "Ce dossier ne préconise aucune option. La première carte présente l'état de l'art, ne demande rien, et liste les corrections apportées à la révision précédente ; viennent ensuite les décisions, chacune avec ses alternatives, leur comportement, leur conséquence, les faits de mécanisme qui les éclairent avec leur source, et ce que la recherche n'a PAS pu établir. Le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Les cartes marquées « nouvelle carte » découlent de vos propres réponses du premier passage, citées verbatim. Vos réponses commitées sont chargées depuis le dépôt : « Transmettre à la CLI » les remet à une session h2a live du projet, le presse-papier reste disponible en repli."
                });
                $$renderer5.push(`<!----> `);
                if (!answerSet()) {
                  $$renderer5.push("<!--[0-->");
                  Alert($$renderer5, {
                    tone: "warning",
                    title: "Jeu de réponses commité introuvable",
                    message: "Le fichier docs/decisions/2026-07-25-agent-memory-owner-answers.json n'est pas atteignable depuis ce service. Rien n'a été inventé : le dossier s'ouvre vide, et vos réponses commitées ne sont pas perdues pour autant — elles sont dans le dépôt."
                  });
                } else if (answerOrigin() === "committed") {
                  $$renderer5.push("<!--[1-->");
                  Alert($$renderer5, {
                    tone: "info",
                    title: `Réponses commitées chargées (${Object.keys(committed?.state.notes ?? {}).length} note(s), ${Object.keys(committed?.state.selections ?? {}).length} sélection(s))`,
                    message: `Chargées côté serveur depuis ${answerSet().source} — aucun état de navigateur n'est nécessaire pour les voir. Vos modifications restent locales tant qu'elles ne sont pas commitées, et cette bannière vous dira si elles s'écartent du jeu commité.`
                  });
                } else {
                  $$renderer5.push("<!--[-1-->");
                  Alert($$renderer5, {
                    tone: "warning",
                    title: `Brouillon local différent du jeu commité sur ${divergences().length} décision(s) : ${divergences().map((d) => d.key).join(", ")}`,
                    message: "Ce qui est affiché ci-dessous est votre brouillon local (non commité). Le jeu commité dans le dépôt, lui, est intact. Le détail des écarts est plus bas, avec le retour au jeu commité en un clic."
                  });
                }
                $$renderer5.push(`<!--]--> <div class="swipe-viewport svelte-e74176" role="group" aria-label="Cartes du dossier : l’état de l’art puis les décisions. Faites glisser horizontalement ou utilisez les boutons."${attr_style(void 0)}><div class="swipe-track svelte-e74176"${attr_style(`transform: translateX(-${current * 100}%);`)}><section class="swipe-slide svelte-e74176"${attr("aria-hidden", current !== 0)}${attr("inert", current !== 0, true)}>`);
                Card($$renderer5, {
                  children: ($$renderer6) => {
                    Stack($$renderer6, {
                      gap: 4,
                      children: ($$renderer7) => {
                        Flex($$renderer7, {
                          align: "center",
                          justify: "between",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer8) => {
                            Badge($$renderer8, {
                              tone: "info",
                              children: ($$renderer9) => {
                                $$renderer9.push(`<!---->État de l’art`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer8.push(`<!----> <span>Carte 1 sur ${escape_html(slidesTotal())} — aucune décision ici</span>`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        Stack($$renderer7, {
                          gap: 2,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<h2 id="matrix-title">Matrice de comparaison</h2> <p>Dix-neuf approches du benchmark, comparées sur le stockage, la récupération, la
                        réconciliation, le mode d’écriture, le partage multi-CLI, l’auto-hébergement/RAM, la
                        licence et l’adéquation à la cible (agent persistant, multi-CLI, local-first). Faites
                        défiler horizontalement pour voir toutes les colonnes.</p>`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> <div class="matrix-scroll svelte-e74176" role="presentation">`);
                        Table($$renderer7, {
                          caption: matrix().caption,
                          columns: matrix().columns,
                          rows: matrix().rows
                        });
                        $$renderer7.push(`<!----></div> <p class="matrix-legend svelte-e74176">${escape_html(matrix().legend)}</p> `);
                        if (dossier().corrections?.length) {
                          $$renderer7.push("<!--[0-->");
                          $$renderer7.push(`<section aria-labelledby="corrections-title">`);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h2 id="corrections-title">Corrections à la révision précédente (${escape_html(dossier().corrections.length)})</h2> <p>La recherche de mécanismes a démenti des affirmations que la révision <strong>${escape_html(dossier().previousRevision)}</strong> présentait comme des faits. Elles sont
                            listées ici, et les cellules concernées de la matrice ci-dessus ont été réécrites.</p> <ul class="corrections svelte-e74176"><!--[-->`);
                              const each_array = ensure_array_like(dossier().corrections);
                              for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
                                let correction = each_array[$$index];
                                $$renderer8.push(`<li class="svelte-e74176">`);
                                Stack($$renderer8, {
                                  gap: 1,
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<strong>${escape_html(correction.subject)}</strong> <p class="was-stated svelte-e74176"><em>Était affirmé :</em> ${escape_html(correction.wasStated)}</p> <p><strong>En réalité :</strong> ${escape_html(correction.actually)}</p> <p class="fact-source svelte-e74176">${escape_html(correction.source)}</p>`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!----></li>`);
                              }
                              $$renderer8.push(`<!--]--></ul>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----></section>`);
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        Alert($$renderer7, {
                          tone: "info",
                          title: "Rien à trancher sur cette carte",
                          message: "Passez à la carte suivante pour entrer dans les décisions."
                        });
                        $$renderer7.push(`<!---->`);
                      },
                      $$slots: { default: true }
                    });
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></section> <!--[-->`);
                const each_array_1 = ensure_array_like(dossier().decisions);
                for (let index = 0, $$length = each_array_1.length; index < $$length; index++) {
                  let decision = each_array_1[index];
                  const slide = index + 1;
                  $$renderer5.push(`<section class="swipe-slide svelte-e74176"${attr("aria-hidden", current !== slide)}${attr("inert", current !== slide, true)}>`);
                  Card($$renderer5, {
                    children: ($$renderer6) => {
                      Stack($$renderer6, {
                        gap: 4,
                        children: ($$renderer7) => {
                          Flex($$renderer7, {
                            align: "center",
                            justify: "between",
                            wrap: true,
                            gap: 2,
                            children: ($$renderer8) => {
                              Flex($$renderer8, {
                                align: "center",
                                wrap: true,
                                gap: 2,
                                children: ($$renderer9) => {
                                  Badge($$renderer9, {
                                    tone: "info",
                                    children: ($$renderer10) => {
                                      $$renderer10.push(`<!---->${escape_html(decision.key)}`);
                                    },
                                    $$slots: { default: true }
                                  });
                                  $$renderer9.push(`<!----> `);
                                  if (decision.addedInRevision) {
                                    $$renderer9.push("<!--[0-->");
                                    Badge($$renderer9, {
                                      tone: "neutral",
                                      size: "sm",
                                      children: ($$renderer10) => {
                                        $$renderer10.push(`<!---->Nouvelle carte (révision 2)`);
                                      },
                                      $$slots: { default: true }
                                    });
                                  } else {
                                    $$renderer9.push("<!--[-1-->");
                                  }
                                  $$renderer9.push(`<!--]--> `);
                                  if (divergentKeys().has(decision.key)) {
                                    $$renderer9.push("<!--[0-->");
                                    Badge($$renderer9, {
                                      tone: "warning",
                                      size: "sm",
                                      children: ($$renderer10) => {
                                        $$renderer10.push(`<!---->Brouillon ≠ jeu commité`);
                                      },
                                      $$slots: { default: true }
                                    });
                                  } else {
                                    $$renderer9.push("<!--[-1-->");
                                  }
                                  $$renderer9.push(`<!--]-->`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!----> <span>Décision ${escape_html(slide)} sur ${escape_html(decisionsTotal())}</span>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> `);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h2>${escape_html(decision.question)}</h2> <p>${escape_html(decision.whyNow)}</p>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> `);
                          if (decision.fromAnswer) {
                            $$renderer7.push("<!--[0-->");
                            $$renderer7.push(`<section class="from-answer svelte-e74176"${attr("aria-labelledby", `from-answer-${decision.key}`)}>`);
                            Stack($$renderer7, {
                              gap: 1,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<h3${attr("id", `from-answer-${decision.key}`)}>Découle de votre réponse${escape_html(decision.parent?.length ? ` à ${decision.parent.join(" et ")}` : "")}</h3> <blockquote class="svelte-e74176">${escape_html(decision.fromAnswer)}</blockquote>`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----></section>`);
                          } else {
                            $$renderer7.push("<!--[-1-->");
                          }
                          $$renderer7.push(`<!--]--> <section${attr("aria-labelledby", `options-${decision.key}`)}>`);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h3${attr("id", `options-${decision.key}`)}>Alternatives</h3> <p>Aucune option n’est recommandée par défaut. La sélection est facultative.</p> `);
                              Stack($$renderer8, {
                                gap: 2,
                                children: ($$renderer9) => {
                                  $$renderer9.push(`<!--[-->`);
                                  const each_array_2 = ensure_array_like(decision.options);
                                  for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
                                    let option = each_array_2[$$index_1];
                                    $$renderer9.push(`<div role="presentation">`);
                                    Tile($$renderer9, {
                                      variant: "selectable",
                                      selected: selections[decision.key] === option.key,
                                      onselect: () => selectOption(decision.key, option.key),
                                      children: ($$renderer10) => {
                                        Stack($$renderer10, {
                                          gap: 2,
                                          children: ($$renderer11) => {
                                            Flex($$renderer11, {
                                              align: "center",
                                              justify: "between",
                                              wrap: true,
                                              gap: 2,
                                              children: ($$renderer12) => {
                                                $$renderer12.push(`<strong>${escape_html(option.title)}</strong> `);
                                                if (option.recommended) {
                                                  $$renderer12.push("<!--[0-->");
                                                  Badge($$renderer12, {
                                                    tone: "success",
                                                    size: "sm",
                                                    children: ($$renderer13) => {
                                                      $$renderer13.push(`<!---->Recommandée`);
                                                    },
                                                    $$slots: { default: true }
                                                  });
                                                } else {
                                                  $$renderer12.push("<!--[-1-->");
                                                }
                                                $$renderer12.push(`<!--]--> `);
                                                if (selections[decision.key] === option.key) {
                                                  $$renderer12.push("<!--[0-->");
                                                  Badge($$renderer12, {
                                                    tone: "info",
                                                    size: "sm",
                                                    children: ($$renderer13) => {
                                                      $$renderer13.push(`<!---->Sélectionnée`);
                                                    },
                                                    $$slots: { default: true }
                                                  });
                                                } else {
                                                  $$renderer12.push("<!--[-1-->");
                                                }
                                                $$renderer12.push(`<!--]-->`);
                                              },
                                              $$slots: { default: true }
                                            });
                                            $$renderer11.push(`<!----> <p>${escape_html(option.behavior)}</p> <p><strong>Conséquence :</strong> ${escape_html(option.consequence)}</p>`);
                                          },
                                          $$slots: { default: true }
                                        });
                                      },
                                      $$slots: { default: true }
                                    });
                                    $$renderer9.push(`<!----></div>`);
                                  }
                                  $$renderer9.push(`<!--]-->`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!---->`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----></section> `);
                          if (decision.mechanisms?.length) {
                            $$renderer7.push("<!--[0-->");
                            $$renderer7.push(`<section${attr("aria-labelledby", `mechanisms-${decision.key}`)}>`);
                            Stack($$renderer7, {
                              gap: 2,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<h3${attr("id", `mechanisms-${decision.key}`)}>Comment ça marche réellement (${escape_html(decision.mechanisms.length)})</h3> <ul class="mechanisms svelte-e74176"><!--[-->`);
                                const each_array_3 = ensure_array_like(decision.mechanisms);
                                for (let $$index_2 = 0, $$length2 = each_array_3.length; $$index_2 < $$length2; $$index_2++) {
                                  let mechanism = each_array_3[$$index_2];
                                  $$renderer8.push(`<li class="svelte-e74176">`);
                                  Stack($$renderer8, {
                                    gap: 1,
                                    children: ($$renderer9) => {
                                      Flex($$renderer9, {
                                        align: "center",
                                        wrap: true,
                                        gap: 2,
                                        children: ($$renderer10) => {
                                          $$renderer10.push(`<strong>${escape_html(mechanism.system)}</strong> `);
                                          if (mechanism.status === "unverified") {
                                            $$renderer10.push("<!--[0-->");
                                            Badge($$renderer10, {
                                              tone: "warning",
                                              size: "sm",
                                              children: ($$renderer11) => {
                                                $$renderer11.push(`<!---->Non vérifié`);
                                              },
                                              $$slots: { default: true }
                                            });
                                          } else {
                                            $$renderer10.push("<!--[-1-->");
                                          }
                                          $$renderer10.push(`<!--]-->`);
                                        },
                                        $$slots: { default: true }
                                      });
                                      $$renderer9.push(`<!----> <p>${escape_html(mechanism.fact)}</p> <p class="fact-source svelte-e74176">${escape_html(mechanism.source)}</p>`);
                                    },
                                    $$slots: { default: true }
                                  });
                                  $$renderer8.push(`<!----></li>`);
                                }
                                $$renderer8.push(`<!--]--></ul>`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----></section>`);
                          } else {
                            $$renderer7.push("<!--[-1-->");
                          }
                          $$renderer7.push(`<!--]--> `);
                          if (decision.unknowns?.length) {
                            $$renderer7.push("<!--[0-->");
                            $$renderer7.push(`<section class="unknowns svelte-e74176"${attr("aria-labelledby", `unknowns-${decision.key}`)}>`);
                            Stack($$renderer7, {
                              gap: 2,
                              children: ($$renderer8) => {
                                Flex($$renderer8, {
                                  align: "center",
                                  wrap: true,
                                  gap: 2,
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<h3${attr("id", `unknowns-${decision.key}`)}>Ce que nous n’avons pas pu établir</h3> `);
                                    Badge($$renderer9, {
                                      tone: "warning",
                                      size: "sm",
                                      children: ($$renderer10) => {
                                        $$renderer10.push(`<!---->${escape_html(decision.unknowns.length)}`);
                                      },
                                      $$slots: { default: true }
                                    });
                                    $$renderer9.push(`<!---->`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!----> <ul class="svelte-e74176"><!--[-->`);
                                const each_array_4 = ensure_array_like(decision.unknowns);
                                for (let unknownIndex = 0, $$length2 = each_array_4.length; unknownIndex < $$length2; unknownIndex++) {
                                  let unknown = each_array_4[unknownIndex];
                                  $$renderer8.push(`<li class="svelte-e74176">${escape_html(unknown)}</li>`);
                                }
                                $$renderer8.push(`<!--]--></ul>`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----></section>`);
                          } else {
                            $$renderer7.push("<!--[-1-->");
                          }
                          $$renderer7.push(`<!--]--> `);
                          Alert($$renderer7, {
                            tone: "info",
                            title: "Critère à trancher (neutre)",
                            message: decision.recommendation
                          });
                          $$renderer7.push(`<!----> <div class="note-field svelte-e74176" role="presentation">`);
                          Textarea($$renderer7, {
                            label: "Votre note",
                            helperText: "Pourquoi ce choix, ce qui manque, ce qu'il faut vérifier. Enregistrée dans votre navigateur au fil de la frappe.",
                            rows: 4,
                            value: notes[decision.key] ?? "",
                            oninput: (event) => setNote(decision.key, event.currentTarget.value)
                          });
                          $$renderer7.push(`<!----></div> `);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              Flex($$renderer8, {
                                align: "center",
                                justify: "between",
                                wrap: true,
                                gap: 2,
                                children: ($$renderer9) => {
                                  $$renderer9.push(`<span class="include-hint svelte-e74176">${escape_html(hasSomethingToInclude(decision.key) ? `Votre option et votre note partent ensemble${h2aTarget ? ` vers ${h2aTarget}` : ""}.` : "Sélectionnez une option ou écrivez une note pour pouvoir la transmettre.")}</span> `);
                                  Button($$renderer9, {
                                    variant: "primary",
                                    onclick: () => includeChoice(decision.key),
                                    disabled: including === decision.key || !hasSomethingToInclude(decision.key),
                                    children: ($$renderer10) => {
                                      $$renderer10.push(`<!---->${escape_html(including === decision.key ? "Transmission…" : "Transmettre à la CLI (h2a)")}`);
                                    },
                                    $$slots: { default: true }
                                  });
                                  $$renderer9.push(`<!---->`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!----> `);
                              if (includeResult[decision.key]) {
                                $$renderer8.push("<!--[0-->");
                                const result = includeResult[decision.key];
                                if (result.ok && result.delivered) {
                                  $$renderer8.push("<!--[0-->");
                                  Alert($$renderer8, {
                                    tone: "success",
                                    title: `Transmis à ${result.target}`,
                                    message: result.note ?? ""
                                  });
                                } else if (result.ok) {
                                  $$renderer8.push("<!--[1-->");
                                  Alert($$renderer8, {
                                    tone: "warning",
                                    title: "Non remis — et voici ce qui le permettrait",
                                    message: result.note ?? ""
                                  });
                                } else {
                                  $$renderer8.push("<!--[-1-->");
                                  Alert($$renderer8, {
                                    tone: "error",
                                    title: "Échec de la transmission",
                                    message: result.error ?? "Erreur inconnue."
                                  });
                                }
                                $$renderer8.push(`<!--]-->`);
                              } else {
                                $$renderer8.push("<!--[-1-->");
                              }
                              $$renderer8.push(`<!--]-->`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> `);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h3>Prochain travail</h3> <p>${escape_html(decision.nextWork)}</p>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!---->`);
                        },
                        $$slots: { default: true }
                      });
                    },
                    $$slots: { default: true }
                  });
                  $$renderer5.push(`<!----></section>`);
                }
                $$renderer5.push(`<!--]--></div></div> `);
                Flex($$renderer5, {
                  align: "center",
                  justify: "between",
                  wrap: true,
                  gap: 3,
                  children: ($$renderer6) => {
                    Button($$renderer6, {
                      variant: "secondary",
                      onclick: previous,
                      disabled: current === 0,
                      "aria-label": "Carte précédente",
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!---->Précédente`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> `);
                    SlideIndicator($$renderer6, {
                      count: slidesTotal(),
                      current,
                      onChange: (index) => current = index,
                      label: "Accéder à une carte",
                      variant: "bars"
                    });
                    $$renderer6.push(`<!----> `);
                    Button($$renderer6, {
                      variant: "primary",
                      onclick: next,
                      disabled: current === slidesTotal() - 1,
                      "aria-label": "Carte suivante",
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!---->Suivante`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> <section aria-labelledby="handoff-title">`);
                Stack($$renderer5, {
                  gap: 3,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<h2 id="handoff-title">Transmettre vos réponses</h2> `);
                    Stack($$renderer6, {
                      gap: 2,
                      children: ($$renderer7) => {
                        Flex($$renderer7, {
                          align: "center",
                          justify: "between",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<span class="include-hint svelte-e74176">`);
                            if (h2aTarget) {
                              $$renderer8.push("<!--[0-->");
                              $$renderer8.push(`Destinataire : <strong>${escape_html(h2aTarget)}</strong> `);
                              if (h2aReason === "workspace") {
                                $$renderer8.push("<!--[0-->");
                                $$renderer8.push(`(résolu sur le chemin du checkout)`);
                              } else if (h2aReason === "emitter") {
                                $$renderer8.push("<!--[1-->");
                                $$renderer8.push(`(la session qui sert ce focus)`);
                              } else if (h2aReason === "requested") {
                                $$renderer8.push("<!--[2-->");
                                $$renderer8.push(`(choisi par vous)`);
                              } else if (h2aReason === "configured") {
                                $$renderer8.push("<!--[3-->");
                                $$renderer8.push(`(épinglé par FOCUS_H2A_TARGET)`);
                              } else if (h2aReason === "sole") {
                                $$renderer8.push("<!--[4-->");
                                $$renderer8.push(`(seule session live)`);
                              } else if (h2aReason === "name") {
                                $$renderer8.push("<!--[5-->");
                                $$renderer8.push(`(résolu sur le nom de session)`);
                              } else {
                                $$renderer8.push("<!--[-1-->");
                              }
                              $$renderer8.push(`<!--]-->`);
                            } else {
                              $$renderer8.push("<!--[-1-->");
                              $$renderer8.push(`Aucun destinataire résolu pour l'instant.`);
                            }
                            $$renderer8.push(`<!--]--></span> `);
                            Flex($$renderer8, {
                              align: "center",
                              wrap: true,
                              gap: 2,
                              children: ($$renderer9) => {
                                Button($$renderer9, {
                                  variant: "secondary",
                                  onclick: () => showTargets = !showTargets,
                                  children: ($$renderer10) => {
                                    $$renderer10.push(`<!---->${escape_html(showTargets ? "Masquer les sessions" : "Changer de destinataire")}`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer9.push(`<!----> `);
                                Button($$renderer9, {
                                  variant: "secondary",
                                  onclick: refreshTargets,
                                  disabled: refreshingTargets,
                                  children: ($$renderer10) => {
                                    $$renderer10.push(`<!---->${escape_html(refreshingTargets ? "Actualisation…" : "Actualiser")}`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer9.push(`<!---->`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer8.push(`<!---->`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        if (!h2aTarget && h2aRemedy) {
                          $$renderer7.push("<!--[0-->");
                          Alert($$renderer7, {
                            tone: "warning",
                            title: "Rien à qui remettre — pour l'instant",
                            message: h2aRemedy
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        if (h2aAmbiguous) {
                          $$renderer7.push("<!--[0-->");
                          Alert($$renderer7, {
                            tone: "warning",
                            title: "Plusieurs sessions live répondent pour ce dépôt",
                            message: `Le destinataire retenu est ${h2aTarget}. Les autres sessions live de ce dépôt ne le recevront pas — si ce n'est pas la bonne, choisissez-la ci-dessus avant de transmettre. Les sessions peuvent vivre sur des racines h2a différentes, qui ne se voient pas entre elles.`
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        if (showTargets) {
                          $$renderer7.push("<!--[0-->");
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              if (h2aLive.length === 0) {
                                $$renderer8.push("<!--[0-->");
                                Alert($$renderer8, {
                                  tone: "warning",
                                  title: "Aucune session h2a live",
                                  message: h2aRemedy ?? "Le registre ne contient aucune session live, pour aucun projet. Ouvrez une CLI h2a, puis « Actualiser »."
                                });
                              } else {
                                $$renderer8.push("<!--[-1-->");
                                $$renderer8.push(`<!--[-->`);
                                const each_array_5 = ensure_array_like(h2aLive);
                                for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
                                  let session = each_array_5[$$index_5];
                                  $$renderer8.push(`<div role="presentation">`);
                                  Tile($$renderer8, {
                                    variant: "selectable",
                                    selected: h2aTarget === session.instance,
                                    onselect: () => chooseTarget(session.instance),
                                    children: ($$renderer9) => {
                                      Stack($$renderer9, {
                                        gap: 1,
                                        children: ($$renderer10) => {
                                          Flex($$renderer10, {
                                            align: "center",
                                            justify: "between",
                                            wrap: true,
                                            gap: 2,
                                            children: ($$renderer11) => {
                                              $$renderer11.push(`<strong>${escape_html(session.name ?? session.instance)}</strong> `);
                                              if (session.matchesRepo) {
                                                $$renderer11.push("<!--[0-->");
                                                Badge($$renderer11, {
                                                  tone: "success",
                                                  size: "sm",
                                                  children: ($$renderer12) => {
                                                    $$renderer12.push(`<!---->Ce dépôt`);
                                                  },
                                                  $$slots: { default: true }
                                                });
                                              } else {
                                                $$renderer11.push("<!--[-1-->");
                                              }
                                              $$renderer11.push(`<!--]-->`);
                                            },
                                            $$slots: { default: true }
                                          });
                                          $$renderer10.push(`<!----> <p class="fact-source svelte-e74176">${escape_html(session.instance)}</p> `);
                                          if (session.workspace) {
                                            $$renderer10.push("<!--[0-->");
                                            $$renderer10.push(`<p class="fact-source svelte-e74176">${escape_html(session.workspace)}</p>`);
                                          } else {
                                            $$renderer10.push("<!--[-1-->");
                                          }
                                          $$renderer10.push(`<!--]--> `);
                                          if (session.root) {
                                            $$renderer10.push("<!--[0-->");
                                            $$renderer10.push(`<p class="fact-source svelte-e74176">racine h2a : ${escape_html(session.root)}</p>`);
                                          } else {
                                            $$renderer10.push("<!--[-1-->");
                                          }
                                          $$renderer10.push(`<!--]-->`);
                                        },
                                        $$slots: { default: true }
                                      });
                                    },
                                    $$slots: { default: true }
                                  });
                                  $$renderer8.push(`<!----></div>`);
                                }
                                $$renderer8.push(`<!--]-->`);
                              }
                              $$renderer8.push(`<!--]-->`);
                            },
                            $$slots: { default: true }
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        Flex($$renderer7, {
                          align: "center",
                          justify: "between",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<span class="include-hint svelte-e74176">${escape_html(answeredCount() > 0 ? `${answeredCount()} réponse(s) partiraient en un seul envoi, options ET notes.` : "Aucune réponse à transmettre pour le moment.")}</span> `);
                            Button($$renderer8, {
                              variant: "primary",
                              onclick: sendAll,
                              disabled: sendingAll || answeredCount() === 0,
                              children: ($$renderer9) => {
                                $$renderer9.push(`<!---->${escape_html(sendingAll ? "Transmission…" : "Transmettre toutes mes réponses à la CLI")}`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer8.push(`<!---->`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!----> `);
                        if (sendAllResult) {
                          $$renderer7.push("<!--[0-->");
                          if (sendAllResult.ok && sendAllResult.delivered) {
                            $$renderer7.push("<!--[0-->");
                            Alert($$renderer7, {
                              tone: "success",
                              title: `Transmis à ${sendAllResult.target}`,
                              message: sendAllResult.note ?? ""
                            });
                          } else if (sendAllResult.ok) {
                            $$renderer7.push("<!--[1-->");
                            Alert($$renderer7, {
                              tone: "warning",
                              title: "Non remis — et voici ce qui le permettrait",
                              message: sendAllResult.note ?? ""
                            });
                          } else {
                            $$renderer7.push("<!--[-1-->");
                            Alert($$renderer7, {
                              tone: "error",
                              title: "Échec de la transmission",
                              message: sendAllResult.error ?? "Erreur inconnue."
                            });
                          }
                          $$renderer7.push(`<!--]-->`);
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]-->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></section> <section aria-labelledby="summary-title">`);
                Stack($$renderer5, {
                  gap: 2,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<h2 id="summary-title">Vos notes (repli presse-papier)</h2> `);
                    Flex($$renderer6, {
                      align: "center",
                      justify: "between",
                      wrap: true,
                      gap: 2,
                      children: ($$renderer7) => {
                        $$renderer7.push(`<span>${escape_html(answeredCount())} décision(s) sur ${escape_html(decisionsTotal())} annotée(s) ou sélectionnée(s).</span> `);
                        Flex($$renderer7, {
                          align: "center",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer8) => {
                            Button($$renderer8, {
                              variant: "secondary",
                              onclick: copySummary,
                              children: ($$renderer9) => {
                                $$renderer9.push(`<!---->Copier ma synthèse`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer8.push(`<!----> `);
                            Button($$renderer8, {
                              variant: "secondary",
                              onclick: copyAnswerSetJson,
                              children: ($$renderer9) => {
                                $$renderer9.push(`<!---->Copier le jeu de réponses (JSON)`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer8.push(`<!---->`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!---->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> `);
                    if (exportState === "copied") {
                      $$renderer6.push("<!--[0-->");
                      Alert($$renderer6, {
                        tone: "success",
                        title: "Synthèse copiée",
                        message: "Vos sélections et vos notes sont dans le presse-papier, en markdown. Collez-les où vous voulez : une CLI, un ticket, un message."
                      });
                    } else if (exportState === "copied-json") {
                      $$renderer6.push("<!--[1-->");
                      Alert($$renderer6, {
                        tone: "success",
                        title: "Jeu de réponses copié (JSON)",
                        message: "Même forme que le jeu enregistré : il peut être commité puis rejoué tel quel dans ce dossier, sans retouche à la main."
                      });
                    } else if (exportState === "failed") {
                      $$renderer6.push("<!--[2-->");
                      Alert($$renderer6, {
                        tone: "error",
                        title: "Copie refusée par le navigateur",
                        message: "Le presse-papier n'est pas accessible ici. Vos notes restent enregistrées dans ce navigateur ; sélectionnez-les à la main dans les cartes."
                      });
                    } else {
                      $$renderer6.push("<!--[-1-->");
                    }
                    $$renderer6.push(`<!--]-->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></section> <section aria-labelledby="replay-title">`);
                Stack($$renderer5, {
                  gap: 2,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<h2 id="replay-title">Jeu de réponses commité</h2> `);
                    if (!answerSet()) {
                      $$renderer6.push("<!--[0-->");
                      Alert($$renderer6, {
                        tone: "warning",
                        title: "Jeu commité indisponible",
                        message: "Le jeu de réponses commité n'est pas atteignable depuis ce service (docs/decisions/2026-07-25-agent-memory-owner-answers.json). Rien n'a été inventé : vos réponses locales sont intactes."
                      });
                    } else {
                      $$renderer6.push("<!--[-1-->");
                      $$renderer6.push(`<p>Jeu commité : <code>${escape_html(answerSet().source)}</code> — révision <strong>${escape_html(answerSet().revision)}</strong>${escape_html(answerSet().capturedAt ? `, capturé le ${answerSet().capturedAt}` : "")}${escape_html(answerSet().status ? ` (${answerSet().status})` : "")}. Il est chargé <strong>par défaut</strong>, côté serveur, sélections <strong>et</strong> notes, telles
                  qu'elles ont été écrites — aucun état de navigateur n'est requis pour le voir.</p> `);
                      if (dossier().carryOver) {
                        $$renderer6.push("<!--[0-->");
                        Alert($$renderer6, {
                          tone: "info",
                          title: `Report depuis « ${dossier().carryOver.from} » : ${dossier().carryOver.carried.length} décisions conservées, ${dossier().carryOver.added.length} ajoutées`,
                          message: dossier().carryOver.statement
                        });
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]--> `);
                      if (revisionMismatch()) {
                        $$renderer6.push("<!--[0-->");
                        Alert($$renderer6, {
                          tone: "warning",
                          title: "Révision différente",
                          message: `Ces réponses ont été capturées sur « ${answerSet().revision} », or ce dossier est en « ${dossier().revision} ». Ce qui retombe sur cette révision est chargé ; ce qui n'y retombe plus et ce que ce jeu ne couvre pas sont nommés ci-dessous.`
                        });
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]--> `);
                      if (committedReport()) {
                        $$renderer6.push("<!--[0-->");
                        if (committedReport().missingDecisions.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "error",
                            title: "Réponses non chargeables : décision disparue",
                            message: `Ces clés n'existent plus dans la révision « ${dossier().revision} » et n'ont donc pas pu être chargées : ${committedReport().missingDecisions.join(", ")}. Leurs notes sont toujours dans le jeu commité, pas dans cette page.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]--> `);
                        if (committedReport().staleOptions.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "warning",
                            title: "Options disparues : note chargée, sélection non",
                            message: `Ces options n'existent plus pour leur décision : ${committedReport().staleOptions.join(", ")}. La note a été chargée, la sélection est restée vide — à vous de la reprendre.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]--> `);
                        if (committedReport().unanswered.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "info",
                            title: `${committedReport().unanswered.length} décision(s) sans réponse dans ce jeu`,
                            message: `Ce jeu commité ne couvre pas : ${committedReport().unanswered.join(", ")}. Ce ne sont pas des réponses perdues — ce sont les cartes ajoutées depuis, qui attendent la vôtre.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]-->`);
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]--> `);
                      if (divergences().length > 0) {
                        $$renderer6.push("<!--[0-->");
                        $$renderer6.push(`<section aria-labelledby="divergence-title">`);
                        Stack($$renderer6, {
                          gap: 2,
                          children: ($$renderer7) => {
                            $$renderer7.push(`<h3 id="divergence-title">Deux versions de vos réponses (${escape_html(divergences().length)} écart(s))</h3> <p>La page affiche votre <strong>brouillon local</strong>. Le jeu commité du dépôt dit
                        autre chose sur ces décisions. Choisissez laquelle garder — rien n'est remplacé
                        tant que vous n'avez pas choisi.</p> <ul class="divergences svelte-e74176"><!--[-->`);
                            const each_array_6 = ensure_array_like(divergences());
                            for (let $$index_6 = 0, $$length = each_array_6.length; $$index_6 < $$length; $$index_6++) {
                              let divergence = each_array_6[$$index_6];
                              $$renderer7.push(`<li class="svelte-e74176">`);
                              Stack($$renderer7, {
                                gap: 1,
                                children: ($$renderer8) => {
                                  $$renderer8.push(`<strong>${escape_html(divergence.key)}</strong> <p><em>Jeu commité :</em> ${escape_html(divergence.committedOption ?? "(aucune option)")} —
                                ${escape_html(divergence.committedNote ? divergence.committedNote : "(aucune note)")}</p> <p><em>Votre brouillon (affiché) :</em> ${escape_html(divergence.draftOption ?? "(aucune option)")} —
                                ${escape_html(divergence.draftNote ? divergence.draftNote : "(aucune note)")}</p>`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer7.push(`<!----></li>`);
                            }
                            $$renderer7.push(`<!--]--></ul> `);
                            Flex($$renderer7, {
                              align: "center",
                              justify: "between",
                              wrap: true,
                              gap: 2,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<span class="include-hint svelte-e74176">Garder votre brouillon ne demande aucune action : il est déjà à l'écran.</span> `);
                                Button($$renderer8, {
                                  variant: "secondary",
                                  onclick: useCommitted,
                                  children: ($$renderer9) => {
                                    $$renderer9.push(`<!---->Utiliser le jeu commité du dépôt`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer8.push(`<!---->`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!---->`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer6.push(`<!----></section>`);
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]-->`);
                    }
                    $$renderer6.push(`<!--]-->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></section>`);
              },
              $$slots: { default: true }
            });
            $$renderer4.push(`<!----></main>`);
          },
          $$slots: { default: true }
        });
      };
      AppShell($$renderer2, { variant: "workspace", main });
    }
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-BpR26NMa.js.map
