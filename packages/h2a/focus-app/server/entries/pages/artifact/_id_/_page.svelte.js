import { _ as attr, a as derived, b as run, c as head, s as ensure_array_like, x as escape_html } from "../../../../chunks/server2.js";
import "../../../../chunks/index-server.js";
import { t as AppHeader } from "../../../../chunks/AppHeader.js";
import { c as Badge, i as Container, o as Card, r as Flex, t as AppShell } from "../../../../chunks/AppShell.js";
import { n as Tile, r as Stack, t as ArtifactReviewHost } from "../../../../chunks/ArtifactReviewHost.js";
// src/routes/artifact/[id]/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		const artifact = derived(() => data.artifact);
		const artifactReview = derived(() => data.artifactReview);
		let selectedOptions = {};
		let reviewMode = run(() => data.artifactReview.initialMode);
		function selectOption(questionId, optionId) {
			selectedOptions = {
				...selectedOptions,
				[questionId]: optionId
			};
		}
		head("mz3l9z", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>${escape_html(artifact().title)}</title>`);
			});
		});
		{
			function topChrome($$renderer) {
				{
					function actions($$renderer) {
						Flex($$renderer, {
							gap: 2,
							align: "center",
							wrap: true,
							children: ($$renderer) => {
								Badge($$renderer, {
									tone: "neutral",
									size: "sm",
									children: ($$renderer) => {
										$$renderer.push(`<!---->${escape_html(artifact().ref)}`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Badge($$renderer, {
									tone: "info",
									size: "sm",
									children: ($$renderer) => {
										$$renderer.push(`<!---->${escape_html(artifact().hash)}`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							},
							$$slots: { default: true }
						});
					}
					AppHeader($$renderer, {
						brandName: "Focus",
						productName: "Artifact Review",
						brandMode: "full",
						actions,
						$$slots: { actions: true }
					});
				}
			}
			function main($$renderer) {
				Container($$renderer, {
					size: reviewMode === "review" ? "xl" : "md",
					padding: true,
					children: ($$renderer) => {
						$$renderer.push(`<div class="artifact-page svelte-mz3l9z">`);
						ArtifactReviewHost($$renderer, {
							artifactId: artifact().ref,
							artifactVersion: artifact().hash,
							reviewConfig: artifactReview(),
							onModeChange: (next) => reviewMode = next,
							children: ($$renderer) => {
								$$renderer.push(`<main class="artifact-doc svelte-mz3l9z" aria-labelledby="artifact-title">`);
								Stack($$renderer, {
									gap: 4,
									children: ($$renderer) => {
										$$renderer.push(`<header class="artifact-doc__header">`);
										Stack($$renderer, {
											gap: 1,
											children: ($$renderer) => {
												$$renderer.push(`<h1 id="artifact-title" class="svelte-mz3l9z">${escape_html(artifact().title)}</h1> <p class="artifact-doc__subtitle svelte-mz3l9z">${escape_html(artifact().subtitle)}</p>`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----></header> <!--[-->`);
										const each_array = ensure_array_like(artifact().sections);
										for (let $$index_2 = 0, $$length = each_array.length; $$index_2 < $$length; $$index_2++) {
											let section = each_array[$$index_2];
											if (section.kind === "prose") {
												$$renderer.push(`<!--[0--><section${attr("data-anchor-id", section.targetRef)} data-commentable="">`);
												Card($$renderer, {
													children: ($$renderer) => {
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																$$renderer.push(`<h2 class="svelte-mz3l9z">${escape_html(section.heading)}</h2> <p class="svelte-mz3l9z">${escape_html(section.body)}</p>`);
															},
															$$slots: { default: true }
														});
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else if (section.kind === "question") {
												$$renderer.push(`<!--[1--><section${attr("data-anchor-id", section.targetRef)} data-commentable="">`);
												Card($$renderer, {
													children: ($$renderer) => {
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																Flex($$renderer, {
																	gap: 2,
																	align: "center",
																	wrap: true,
																	children: ($$renderer) => {
																		Badge($$renderer, {
																			tone: "info",
																			children: ($$renderer) => {
																				$$renderer.push(`<!---->${escape_html(section.code)}`);
																			},
																			$$slots: { default: true }
																		});
																		$$renderer.push(`<!----> <h2 class="svelte-mz3l9z">${escape_html(section.question)}</h2>`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!----> <p class="svelte-mz3l9z">${escape_html(section.context)}</p> `);
																if (section.recommendedAnswer) $$renderer.push(`<!--[0--><p class="artifact-doc__reco svelte-mz3l9z"><strong>Recommandation :</strong> ${escape_html(section.recommendedAnswer)}</p>`);
																else $$renderer.push("<!--[-1-->");
																$$renderer.push(`<!--]-->`);
															},
															$$slots: { default: true }
														});
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else if (section.kind === "optionSet") {
												$$renderer.push(`<!--[2--><section${attr("data-anchor-id", section.targetRef)}>`);
												Card($$renderer, {
													children: ($$renderer) => {
														Stack($$renderer, {
															gap: 3,
															children: ($$renderer) => {
																$$renderer.push(`<h2 class="svelte-mz3l9z">${escape_html(section.title)}</h2> `);
																Stack($$renderer, {
																	gap: 2,
																	children: ($$renderer) => {
																		$$renderer.push(`<!--[-->`);
																		const each_array_1 = ensure_array_like(section.options);
																		for (let $$index = 0, $$length = each_array_1.length; $$index < $$length; $$index++) {
																			let option = each_array_1[$$index];
																			$$renderer.push(`<div${attr("data-anchor-id", option.targetRef)} data-commentable="">`);
																			Tile($$renderer, {
																				variant: "selectable",
																				selected: selectedOptions[section.questionId] === option.id,
																				onselect: () => selectOption(section.questionId, option.id),
																				children: ($$renderer) => {
																					Stack($$renderer, {
																						gap: 1,
																						children: ($$renderer) => {
																							Flex($$renderer, {
																								align: "center",
																								justify: "between",
																								gap: 2,
																								wrap: true,
																								children: ($$renderer) => {
																									$$renderer.push(`<strong>${escape_html(option.label)}</strong> `);
																									if (selectedOptions[section.questionId] === option.id) {
																										$$renderer.push("<!--[0-->");
																										Badge($$renderer, {
																											tone: "info",
																											size: "sm",
																											children: ($$renderer) => {
																												$$renderer.push(`<!---->Sélectionnée`);
																											},
																											$$slots: { default: true }
																										});
																									} else $$renderer.push("<!--[-1-->");
																									$$renderer.push(`<!--]-->`);
																								},
																								$$slots: { default: true }
																							});
																							$$renderer.push(`<!----> <p class="svelte-mz3l9z">${escape_html(option.body)}</p> <p class="artifact-doc__consequence svelte-mz3l9z"><strong>Conséquence :</strong> ${escape_html(option.consequence)}</p>`);
																						},
																						$$slots: { default: true }
																					});
																				},
																				$$slots: { default: true }
																			});
																			$$renderer.push(`<!----></div>`);
																		}
																		$$renderer.push(`<!--]-->`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!---->`);
															},
															$$slots: { default: true }
														});
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else if (section.kind === "decision") {
												$$renderer.push(`<!--[3--><section${attr("data-anchor-id", section.targetRef)} data-commentable="">`);
												Card($$renderer, {
													children: ($$renderer) => {
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																Badge($$renderer, {
																	tone: "success",
																	size: "sm",
																	children: ($$renderer) => {
																		$$renderer.push(`<!---->${escape_html(section.modality)}`);
																	},
																	$$slots: { default: true }
																});
																$$renderer.push(`<!----> <p class="svelte-mz3l9z">${escape_html(section.statement)}</p>`);
															},
															$$slots: { default: true }
														});
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else if (section.kind === "trace") {
												$$renderer.push(`<!--[4--><section${attr("data-anchor-id", section.targetRef)} data-commentable="">`);
												Card($$renderer, {
													children: ($$renderer) => {
														Stack($$renderer, {
															gap: 2,
															children: ($$renderer) => {
																$$renderer.push(`<h2 class="svelte-mz3l9z">${escape_html(section.title)}</h2> <ol class="artifact-doc__trace svelte-mz3l9z"><!--[-->`);
																const each_array_2 = ensure_array_like(section.steps);
																for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
																	let step = each_array_2[$$index_1];
																	$$renderer.push(`<li><strong>${escape_html(step.label)} :</strong> ${escape_html(step.detail)}</li>`);
																}
																$$renderer.push(`<!--]--></ol>`);
															},
															$$slots: { default: true }
														});
													},
													$$slots: { default: true }
												});
												$$renderer.push(`<!----></section>`);
											} else $$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]-->`);
										}
										$$renderer.push(`<!--]-->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----></main>`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----></div>`);
					},
					$$slots: { default: true }
				});
			}
			AppShell($$renderer, {
				variant: "workspace",
				topChrome,
				main,
				$$slots: {
					topChrome: true,
					main: true
				}
			});
		}
	});
}
export { _page as default };

//# sourceMappingURL=_page.svelte.js.map