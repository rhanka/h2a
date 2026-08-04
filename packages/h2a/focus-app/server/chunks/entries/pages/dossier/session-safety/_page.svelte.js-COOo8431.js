import { a2 as head, a4 as escape_html, Z as derived, ae as attr_style, a9 as ensure_array_like, a3 as attr } from '../../../../chunks/index.js-laGHLarB.js';
import { A as AppShell, C as Container, F as Flex, c as Badge, b as Card, B as Button, a as Alert } from '../../../../chunks/AppShell.js-6Pi87dO0.js';
import { S as Stack, P as ProgressBar, a as SlideIndicator, T as Tile } from '../../../../chunks/Tile.js-C0eb5drf.js';
import '../../../../chunks/utils.js-C_3_iViC.js';
import '../../../../chunks/utils2.js-BQzn9ikS.js';

function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const dossier = derived(() => data.dossier);
    const total = derived(() => dossier().decisions.length);
    let current = 0;
    let selections = {};
    let including = null;
    let includeResults = {};
    let h2aTarget = data.h2a.target;
    let h2aLive = data.h2a.live;
    let h2aReason = data.h2a.reason;
    let h2aRemedy = data.h2a.remedy;
    let h2aAmbiguous = data.h2a.ambiguous;
    let showTargets = false;
    let refreshingTargets = false;
    function previous() {
      current = Math.max(0, current - 1);
    }
    function next() {
      current = Math.min(total() - 1, current + 1);
    }
    function selectOption(decisionKey, optionKey) {
      selections = { ...selections, [decisionKey]: optionKey };
      const nextResults = { ...includeResults };
      delete nextResults[decisionKey];
      includeResults = nextResults;
    }
    async function refreshTargets() {
      refreshingTargets = true;
      try {
        const response = await fetch("/api/h2a/targets");
        const body = await response.json();
        if (body?.ok) {
          h2aLive = body.live ?? [];
          h2aReason = body.reason;
          h2aRemedy = body.remedy ?? null;
          h2aAmbiguous = Boolean(body.ambiguous);
          if (!h2aTarget || !h2aLive.some((session) => session.instance === h2aTarget)) {
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
    async function includeSelection(decisionKey) {
      const optionKey = selections[decisionKey];
      if (!optionKey) return;
      including = decisionKey;
      try {
        const response = await fetch("/api/dossiers/session-safety/include", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decisionKey, optionKey, target: h2aTarget })
        });
        includeResults = { ...includeResults, [decisionKey]: await response.json() };
      } catch (error) {
        includeResults = {
          ...includeResults,
          [decisionKey]: { ok: false, error: String(error) }
        };
      } finally {
        including = null;
      }
    }
    head("z2o5k4", $$renderer2, ($$renderer3) => {
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
            $$renderer4.push(`<main class="dossier svelte-z2o5k4" aria-labelledby="dossier-title">`);
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
                        Badge($$renderer7, {
                          tone: "neutral",
                          children: ($$renderer8) => {
                            $$renderer8.push(`<!---->Décision ${escape_html(current + 1)} / ${escape_html(total())}`);
                          },
                          $$slots: { default: true }
                        });
                        $$renderer7.push(`<!---->`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> <h1 id="dossier-title">${escape_html(dossier().title)}</h1> <p>${escape_html(dossier().context)}</p> `);
                    ProgressBar($$renderer6, {
                      label: "Progression du dossier",
                      value: current + 1,
                      max: total(),
                      valueText: `${current + 1} / ${total()}`,
                      showValue: true
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----></header> <div class="swipe-viewport svelte-z2o5k4" role="group" aria-label="Cartes de décisions : faites glisser horizontalement ou utilisez les boutons"><div class="swipe-track svelte-z2o5k4"${attr_style(`transform: translateX(-${current * 100}%);`)}><!--[-->`);
                const each_array = ensure_array_like(dossier().decisions);
                for (let index = 0, $$length = each_array.length; index < $$length; index++) {
                  let decision = each_array[index];
                  $$renderer5.push(`<section class="swipe-slide svelte-z2o5k4"${attr("aria-hidden", index !== current)}${attr("inert", index !== current, true)}>`);
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
                                  $$renderer9.push(`<!---->${escape_html(decision.key)}`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!----> <span>Carte ${escape_html(index + 1)} sur ${escape_html(total())}</span>`);
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
                          $$renderer7.push(`<!----> <section${attr("aria-labelledby", `options-${decision.key}`)}>`);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h3${attr("id", `options-${decision.key}`)}>Votre choix</h3> <p>Sélectionnez une seule option. Aucune option n’est choisie par défaut.</p> `);
                              Stack($$renderer8, {
                                gap: 2,
                                children: ($$renderer9) => {
                                  $$renderer9.push(`<!--[-->`);
                                  const each_array_1 = ensure_array_like(decision.options);
                                  for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
                                    let option = each_array_1[$$index];
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
                          Alert($$renderer7, {
                            tone: "info",
                            title: "Recommandation du dossier",
                            message: decision.recommendation
                          });
                          $$renderer7.push(`<!----> `);
                          Stack($$renderer7, {
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<h3>Prochain travail</h3> <p>${escape_html(decision.nextWork)}</p>`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> `);
                          Flex($$renderer7, {
                            align: "center",
                            justify: "between",
                            wrap: true,
                            gap: 2,
                            children: ($$renderer8) => {
                              $$renderer8.push(`<span>`);
                              if (selections[decision.key]) {
                                $$renderer8.push("<!--[0-->");
                                $$renderer8.push(`Choix prêt à être remis à une CLI live.`);
                              } else {
                                $$renderer8.push("<!--[-1-->");
                                $$renderer8.push(`Sélectionnez une option pour l’inclure dans la CLI.`);
                              }
                              $$renderer8.push(`<!--]--></span> `);
                              Button($$renderer8, {
                                variant: "primary",
                                onclick: () => includeSelection(decision.key),
                                disabled: !selections[decision.key] || including === decision.key,
                                children: ($$renderer9) => {
                                  $$renderer9.push(`<!---->${escape_html(including === decision.key ? "Inclusion…" : "Inclure ce choix dans la CLI")}`);
                                },
                                $$slots: { default: true }
                              });
                              $$renderer8.push(`<!---->`);
                            },
                            $$slots: { default: true }
                          });
                          $$renderer7.push(`<!----> `);
                          if (includeResults[decision.key]) {
                            $$renderer7.push("<!--[0-->");
                            if (includeResults[decision.key].ok && includeResults[decision.key].delivered) {
                              $$renderer7.push("<!--[0-->");
                              Alert($$renderer7, {
                                tone: "success",
                                title: `Remis à ${includeResults[decision.key].target}`,
                                message: includeResults[decision.key].note
                              });
                            } else if (includeResults[decision.key].ok) {
                              $$renderer7.push("<!--[1-->");
                              Alert($$renderer7, {
                                tone: "warning",
                                title: "Aucune CLI live",
                                message: includeResults[decision.key].note
                              });
                            } else {
                              $$renderer7.push("<!--[-1-->");
                              Alert($$renderer7, {
                                tone: "error",
                                title: "Échec de la remise",
                                message: includeResults[decision.key].error
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
                      "aria-label": "Décision précédente",
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!---->Précédente`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!----> `);
                    SlideIndicator($$renderer6, {
                      count: total(),
                      current,
                      onChange: (index) => current = index,
                      label: "Accéder à une décision",
                      variant: "bars"
                    });
                    $$renderer6.push(`<!----> `);
                    Button($$renderer6, {
                      variant: "primary",
                      onclick: next,
                      disabled: current === total() - 1,
                      "aria-label": "Décision suivante",
                      children: ($$renderer7) => {
                        $$renderer7.push(`<!---->Suivante`);
                      },
                      $$slots: { default: true }
                    });
                    $$renderer6.push(`<!---->`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> `);
                Card($$renderer5, {
                  children: ($$renderer6) => {
                    $$renderer6.push(`<div class="target-card svelte-z2o5k4">`);
                    Stack($$renderer6, {
                      gap: 2,
                      children: ($$renderer7) => {
                        Flex($$renderer7, {
                          align: "center",
                          justify: "between",
                          wrap: true,
                          gap: 2,
                          children: ($$renderer8) => {
                            $$renderer8.push(`<div><strong>Destinataire CLI h2a</strong> <div class="muted svelte-z2o5k4">`);
                            if (h2aTarget) {
                              $$renderer8.push("<!--[0-->");
                              $$renderer8.push(`Cible : <strong>${escape_html(h2aTarget)}</strong>`);
                            } else {
                              $$renderer8.push("<!--[-1-->");
                              $$renderer8.push(`Aucune cible résolue.`);
                            }
                            $$renderer8.push(`<!--]--></div></div> `);
                            Flex($$renderer8, {
                              gap: 2,
                              wrap: true,
                              children: ($$renderer9) => {
                                Button($$renderer9, {
                                  variant: "secondary",
                                  size: "sm",
                                  onclick: () => showTargets = !showTargets,
                                  children: ($$renderer10) => {
                                    $$renderer10.push(`<!---->${escape_html(showTargets ? "Masquer les sessions" : "Choisir la session")}`);
                                  },
                                  $$slots: { default: true }
                                });
                                $$renderer9.push(`<!----> `);
                                Button($$renderer9, {
                                  variant: "ghost",
                                  size: "sm",
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
                        if (h2aAmbiguous && h2aTarget) {
                          $$renderer7.push("<!--[0-->");
                          Alert($$renderer7, {
                            tone: "warning",
                            title: "Plusieurs sessions correspondent à ce dépôt",
                            message: `La session retenue est ${h2aTarget}. Si ce n'est pas la bonne, choisissez-la avant d'inclure un choix.`
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        if (!h2aTarget && h2aRemedy) {
                          $$renderer7.push("<!--[0-->");
                          Alert($$renderer7, {
                            tone: "warning",
                            title: "Aucune remise possible pour l'instant",
                            message: h2aRemedy
                          });
                        } else {
                          $$renderer7.push("<!--[-1-->");
                        }
                        $$renderer7.push(`<!--]--> `);
                        if (showTargets) {
                          $$renderer7.push("<!--[0-->");
                          if (h2aLive.length === 0) {
                            $$renderer7.push("<!--[0-->");
                            Alert($$renderer7, {
                              tone: "warning",
                              title: "Aucune session live visible",
                              message: h2aRemedy ?? h2aReason
                            });
                          } else {
                            $$renderer7.push("<!--[-1-->");
                            Stack($$renderer7, {
                              gap: 2,
                              children: ($$renderer8) => {
                                $$renderer8.push(`<!--[-->`);
                                const each_array_2 = ensure_array_like(h2aLive);
                                for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
                                  let session = each_array_2[$$index_2];
                                  Tile($$renderer8, {
                                    variant: "selectable",
                                    selected: h2aTarget === session.instance,
                                    onselect: () => chooseTarget(session.instance),
                                    children: ($$renderer9) => {
                                      Flex($$renderer9, {
                                        align: "center",
                                        justify: "between",
                                        wrap: true,
                                        gap: 2,
                                        children: ($$renderer10) => {
                                          $$renderer10.push(`<div><strong>${escape_html(session.instance)}</strong> <div class="muted svelte-z2o5k4">${escape_html(session.workspace ?? "workspace inconnu")}${escape_html(session.root ? ` · racine ${session.root}` : "")}</div></div> `);
                                          if (session.matchesRepo) {
                                            $$renderer10.push("<!--[0-->");
                                            Badge($$renderer10, {
                                              tone: "success",
                                              size: "sm",
                                              children: ($$renderer11) => {
                                                $$renderer11.push(`<!---->Ce dépôt`);
                                              },
                                              $$slots: { default: true }
                                            });
                                          } else {
                                            $$renderer10.push("<!--[-1-->");
                                          }
                                          $$renderer10.push(`<!--]--> `);
                                          if (session.default) {
                                            $$renderer10.push("<!--[0-->");
                                            Badge($$renderer10, {
                                              tone: "info",
                                              size: "sm",
                                              children: ($$renderer11) => {
                                                $$renderer11.push(`<!---->Défaut`);
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
                                    },
                                    $$slots: { default: true }
                                  });
                                }
                                $$renderer8.push(`<!--]-->`);
                              },
                              $$slots: { default: true }
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
                    $$renderer6.push(`<!----></div>`);
                  },
                  $$slots: { default: true }
                });
                $$renderer5.push(`<!----> `);
                Alert($$renderer5, {
                  tone: "info",
                  title: "Remise à la CLI",
                  message: "L’inclusion dépose le contexte complet dans l’inbox d’une CLI live choisie ou résolue depuis le registre h2a. Elle ne règle ni ne signe une décision Track permanente."
                });
                $$renderer5.push(`<!---->`);
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
//# sourceMappingURL=_page.svelte.js-COOo8431.js.map
