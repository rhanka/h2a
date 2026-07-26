import { a4 as escape_html, a5 as getContext, Q as noop } from '../../chunks/index.js-laGHLarB.js';
import { w as writable } from '../../chunks/exports.js-CdqPbjm1.js';
import '../../chunks/utils.js-C_3_iViC.js';
import '../../chunks/root.js-CtVQOgDw.js';
import '../../chunks/utils2.js-BQzn9ikS.js';
import '../../chunks/false.js-B2gHlHjM.js';

function create_updated_store() {
  const { set, subscribe } = writable(false);
  {
    return {
      subscribe,
      // eslint-disable-next-line @typescript-eslint/require-await
      check: async () => false
    };
  }
}
const is_legacy = noop.toString().includes("$$") || /function \w+\(\) \{\}/.test(noop.toString());
const placeholder_url = "a:";
if (is_legacy) {
  ({
    url: new URL(placeholder_url)
  });
}
const stores = {
  updated: /* @__PURE__ */ create_updated_store()
};
({
  check: stores.updated.check
});
function context() {
  return getContext("__request__");
}
const page$1 = {
  get error() {
    return context().page.error;
  },
  get status() {
    return context().page.status;
  }
};
const page = page$1;
function Error$1($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<h1>${escape_html(page.status)}</h1> <p>${escape_html(page.error?.message)}</p>`);
  });
}

export { Error$1 as default };
//# sourceMappingURL=error.svelte.js-RbeaNF5a.js.map
