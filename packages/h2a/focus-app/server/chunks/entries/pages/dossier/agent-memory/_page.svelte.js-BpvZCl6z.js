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
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const dossier = derived(() => data.dossier);
    const matrix = derived(() => data.matrix);
    const answerSet = derived(() => data.answerSet);
    const decisionsTotal = derived(() => dossier().decisions.length);
    const slidesTotal = derived(() => decisionsTotal() + 1);
    let current = 0;
    let selections = {};
    let notes = {};
    let exportState = "idle";
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
    let replayReport = null;
    let replayPendingConfirm = false;
    const revisionMismatch = derived(() => Boolean(answerSet()) && answerSet().revision !== dossier().revision);
    function requestReplay() {
      if (!answerSet()) return;
      replayReport = null;
      if (
        /**
        * Applique le jeu enregistré. Toute réponse qui ne retombe pas sur cette révision est RAPPORTÉE,
        * jamais écartée en silence : une absence invisible est un mensonge de plus dans un dossier de
        * décision. Les réponses sont rejouées telles quelles — y compris une sélection qui contredit sa
        * propre note : c'est ce que l'humain a écrit, ce n'est pas à l'interface de le réconcilier.
        */
        // Nommer les décisions de cette révision que le jeu ne couvre pas : un rejeu doit être honnête dans
        // les DEUX sens — ce qui n'a pas pu être rejoué, et ce qui n'a jamais été répondu.
        // On atterrit sur la première décision : un rejeu qu'on ne voit pas n'est pas un rejeu.
        /** Il n'y a quelque chose à transmettre que si le lecteur a choisi une option OU écrit une note. */
        /**
         * Le presse-papier rend le choix transportable ; ceci le fait ARRIVER. La note part avec le choix :
         * c'est elle qui porte le raisonnement, la transmettre sans elle n'aurait aucun intérêt.
         */
        answeredCount() > 0
      ) {
        replayPendingConfirm = true;
        return;
      }
      applyReplay();
    }
    function cancelReplay() {
      replayPendingConfirm = false;
    }
    function applyReplay() {
      const set = answerSet();
      if (!set) return;
      const nextSelections = {};
      const nextNotes = {};
      const applied = [];
      const missingDecisions = [];
      const staleOptions = [];
      for (const [key, entry] of Object.entries(set.answers)) {
        const decision = dossier().decisions.find((candidate) => candidate.key === key);
        if (!decision) {
          missingDecisions.push(key);
          continue;
        }
        if (entry.option) {
          if (decision.options.some((option) => option.key === entry.option)) {
            nextSelections[key] = entry.option;
          } else {
            staleOptions.push(`${key} → ${entry.option}`);
          }
        }
        if (entry.note.length > 0) nextNotes[key] = entry.note;
        applied.push(key);
      }
      const unanswered = dossier().decisions.filter((decision) => {
        const entry = set.answers[decision.key];
        return !entry || !entry.option && entry.note.length === 0;
      }).map((decision) => decision.key);
      selections = nextSelections;
      notes = nextNotes;
      replayPendingConfirm = false;
      exportState = "idle";
      replayReport = {
        applied,
        missingDecisions,
        staleOptions,
        unanswered,
        revisionMismatch: revisionMismatch()
      };
      current = 1;
    }
    let including = null;
    let includeResult = {};
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
            note: notes[decisionKey] ?? ""
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
                  message: "Ce dossier ne préconise aucune option. La première carte présente l'état de l'art, ne demande rien, et liste les corrections apportées à la révision précédente ; viennent ensuite les décisions, chacune avec ses alternatives, leur comportement, leur conséquence, les faits de mécanisme qui les éclairent avec leur source, et ce que la recherche n'a PAS pu établir. Le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Les cartes marquées « nouvelle carte » découlent de vos propres réponses du premier passage, citées verbatim. Votre sélection et votre note sont conservées dans votre navigateur : « Copier ma synthèse » les met au presse-papier, « Inclure ce choix dans la CLI » les remet à une CLI live du projet."
                });
                $$renderer5.push(`<!----> <div class="swipe-viewport svelte-e74176" role="group" aria-label="Cartes du dossier : l’état de l’art puis les décisions. Faites glisser horizontalement ou utilisez les boutons."${attr_style(void 0)}><div class="swipe-track svelte-e74176"${attr_style(`transform: translateX(-${current * 100}%);`)}><section class="swipe-slide svelte-e74176"${attr("aria-hidden", current !== 0)}${attr("inert", current !== 0, true)}>`);
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
                                  $$renderer9.push(`<span class="include-hint svelte-e74176">${escape_html(hasSomethingToInclude(decision.key) ? "Votre option et votre note partent ensemble vers la CLI live du projet." : "Sélectionnez une option ou écrivez une note pour pouvoir la transmettre.")}</span> `);
                                  Button($$renderer9, {
                                    variant: "secondary",
                                    onclick: () => includeChoice(decision.key),
                                    disabled: including === decision.key || !hasSomethingToInclude(decision.key),
                                    children: ($$renderer10) => {
                                      $$renderer10.push(`<!---->${escape_html(including === decision.key ? "Transmission…" : "Inclure ce choix dans la CLI")}`);
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
                                    title: "Aucune CLI live sur ce projet",
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
                $$renderer5.push(`<!----> <section aria-labelledby="summary-title">`);
                Stack($$renderer5, {
                  gap: 2,
                  children: ($$renderer6) => {
                    $$renderer6.push(`<h2 id="summary-title">Vos notes</h2> `);
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
                    $$renderer6.push(`<h2 id="replay-title">Rejouer un jeu de réponses</h2> `);
                    if (!answerSet()) {
                      $$renderer6.push("<!--[0-->");
                      Alert($$renderer6, {
                        tone: "warning",
                        title: "Rejeu indisponible",
                        message: "Le jeu de réponses enregistré n'est pas atteignable depuis ce service (docs/decisions/2026-07-25-agent-memory-owner-answers.json). Rien n'a été inventé : vos réponses locales sont intactes."
                      });
                    } else {
                      $$renderer6.push("<!--[-1-->");
                      $$renderer6.push(`<p>Jeu enregistré : <code>${escape_html(answerSet().source)}</code> — révision <strong>${escape_html(answerSet().revision)}</strong>${escape_html(answerSet().capturedAt ? `, capturé le ${answerSet().capturedAt}` : "")}${escape_html(answerSet().status ? ` (${answerSet().status})` : "")}. Le rejeu restaure les
                  sélections <strong>et</strong> les notes, telles qu'elles ont été écrites.</p> `);
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
                          message: `Ces réponses ont été capturées sur « ${answerSet().revision} », or ce dossier est en « ${dossier().revision} ». Le rejeu dira précisément ce qui retombe sur cette révision, ce qui n'y retombe plus, et quelles décisions ce jeu ne couvre pas.`
                        });
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]--> `);
                      Flex($$renderer6, {
                        align: "center",
                        justify: "between",
                        wrap: true,
                        gap: 2,
                        children: ($$renderer7) => {
                          $$renderer7.push(`<span class="include-hint svelte-e74176">${escape_html(answeredCount() > 0 ? "Vous avez déjà des réponses ici : le rejeu les remplacera, après confirmation." : "Aucune réponse locale : le rejeu peut être appliqué directement.")}</span> `);
                          Button($$renderer7, {
                            variant: "secondary",
                            onclick: requestReplay,
                            disabled: replayPendingConfirm,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<!---->Rejouer les réponses enregistrées`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!---->`);
                        },
                        $$slots: { default: true }
                      });
                      $$renderer6.push(`<!----> `);
                      if (replayPendingConfirm) {
                        $$renderer6.push("<!--[0-->");
                        Alert($$renderer6, {
                          tone: "warning",
                          title: "Remplacer vos réponses actuelles ?",
                          message: `Le rejeu va remplacer vos réponses locales (${answeredCount()} décision(s) annotée(s) ou sélectionnée(s)) par le jeu enregistré. Cette action est volontaire et ne peut pas être annulée.`
                        });
                        $$renderer6.push(`<!----> `);
                        Flex($$renderer6, {
                          align: "center",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer7) => {
                            Button($$renderer7, {
                              variant: "primary",
                              onclick: applyReplay,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<!---->Remplacer et rejouer`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!----> `);
                            Button($$renderer7, {
                              variant: "secondary",
                              onclick: cancelReplay,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<!---->Annuler`);
                              },
                              $$slots: { default: true }
                            });
                            $$renderer7.push(`<!---->`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer6.push(`<!---->`);
                      } else {
                        $$renderer6.push("<!--[-1-->");
                      }
                      $$renderer6.push(`<!--]--> `);
                      if (replayReport) {
                        $$renderer6.push("<!--[0-->");
                        Alert($$renderer6, {
                          tone: replayReport.missingDecisions.length || replayReport.staleOptions.length ? "warning" : "success",
                          title: `${replayReport.applied.length} réponse(s) rejouée(s)`,
                          message: `Sélections et notes restaurées pour : ${replayReport.applied.join(", ") || "(aucune)"}.`
                        });
                        $$renderer6.push(`<!----> `);
                        if (replayReport.missingDecisions.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "error",
                            title: "Réponses non rejouables : décision disparue",
                            message: `Ces clés n'existent plus dans la révision « ${dossier().revision} » et n'ont donc pas pu être rejouées : ${replayReport.missingDecisions.join(", ")}. Leurs notes sont toujours dans le jeu enregistré, pas dans cette page.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]--> `);
                        if (replayReport.staleOptions.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "warning",
                            title: "Options disparues : note rejouée, sélection non",
                            message: `Ces options n'existent plus pour leur décision : ${replayReport.staleOptions.join(", ")}. La note a été restaurée, la sélection est restée vide — à vous de la reprendre.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]--> `);
                        if (replayReport.unanswered.length) {
                          $$renderer6.push("<!--[0-->");
                          Alert($$renderer6, {
                            tone: "info",
                            title: `${replayReport.unanswered.length} décision(s) sans réponse dans ce jeu`,
                            message: `Ce jeu enregistré ne couvre pas : ${replayReport.unanswered.join(", ")}. Ce ne sont pas des réponses perdues — ce sont les cartes ajoutées depuis, qui attendent la vôtre.`
                          });
                        } else {
                          $$renderer6.push("<!--[-1-->");
                        }
                        $$renderer6.push(`<!--]-->`);
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
//# sourceMappingURL=_page.svelte.js-BpvZCl6z.js.map
