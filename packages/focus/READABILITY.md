# Readable decision dossiers

The owner asks for decisions that preserve their intent, explain the real stakes,
and can be read in about two minutes per question. Double review protects against
risk and hidden choices; it must not produce longer, coded dossiers.

Presentation validates structure, semantics and readability before rendering.
Structural validation remains compatible with historical documents: all additions
to schema version 1 are optional. Historical Track projections lacking the new
information remain readable as data, but cannot be presented as decision dossiers.
The adapter must never invent an owner quotation or consequences to pass the gate.

The dossier quotes the literal request, states plain stakes and declares their
level. Maximum total reading budgets are 2 minutes for low stakes (a small,
reversible inconvenience), 8 for medium stakes (meaningful cost or disruption),
and 30 for high stakes (lasting, contractual or major personal impact). These
are presentation defaults, not an automatic assessment of the actual stakes.
Every question has context, 2–4 flat options with consequences, a recommended
option with a reason, and a positive reading estimate no greater than 2 minutes.
A 180-word/minute lower bound catches obviously understated estimates; shared
text also counts against the dossier budget.

Option sets and decision outcomes refer to explicit questions. Choice-bearing
prose also refers to its question. Simple choice/list markers help find omissions,
but cannot prove that all semantic choices are exposed. Author and reviewer must
check that each implied commitment is either the subject of a question or is
already authorized. They must also verify quotation authenticity, proportional
stakes and plain language; string validation cannot establish those properties.

Opaque codes and acronyms in reader-facing content need definitions in the visible
glossary. Transport IDs and provenance bindings are not interpreted as prose.
The three renderers show the request, stakes, context, times, consequences and
glossary. Snapshot actions remain disabled; clickable choices are outside this
validator-and-skill change.

Independent design reviews (correctness and owner readability) agreed on public
gate enforcement, visible metadata, optional schema additions, proportional
budgets and explicit question links. Their findings are implemented in this scope.
The separate harness review protocol requires native h2a launches, forbidden by
the owner's confinement; no native review consensus is claimed.

## Owner feedback supplied for this change

2026-10-14, literal request:

> depuis quelques temps nos dossiers sont trop technocratiques et abscons, collecte l'emsemble de mes feedback pour permettre a h-cond de développer une nouvelle version du focus: l'objectif des doubles relectures ne doit pas être de faire des dossiers imbitables: il s'agit d'encadrer les risques et de mettre l'utilisateur au centre de la gestion. Une décision est censé déterminer un chemin ou permettre de gérer un vrai probleme dont le risque implique l'utilisateur. Les dossiers doivent permettre une lecture dans un délai raisonnable vis a vis de l'enjeu, d'etre LISIBLE (autoporteur), en limitant le nombre d'acronymes ou codes (eg L06b) masuqnt le sens et de décision cachées également. L'utilisateur doit retrouver la tracabilité de ses demandes, et on doit éviter de porter le focus sur de faux problemes techniques tout en favorisant le maintien du cap de l'intention.

2026-10-13:

> chaque quesiton doit être pouvoir lue en 2 minute avec un contexte complex et représentatif et des options avec reco

2026-06-27:

> je ne vais pas "ratifier" un dossier dont la porté ne m'est pas présentée, les enjeux ne sont pas précisés, et les options proposées avec préconisation

2026-10-16, renderer:

> les fiches sont pas clicables pour le choix … 4 fiches en parallelle surper longues - avec en plus des sous-optoins imbitables … le focus devrait être un renderer qui prend les options et layout tout seul

The gate and visible metadata address scope, stakes, traceability, timing, glossary
and explicit flat choices. The shipped skill teaches intention and editorial review.
Live clickable choices and a new application layout are outside this requested
validator-and-skill scope; snapshot affordances remain disabled.
