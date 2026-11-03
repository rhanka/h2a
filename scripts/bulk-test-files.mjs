// Fixed production partition; never supplied by an environment selector.
export const BULK_FILES = ['mh-l6-package', 'mh-l6-runtime-package', 'drive-consent-index',
  'candidate-artifacts', 'mh-l1-package', 'mh-l6-components', 'mh-l6-entry',
  'mh-l6-native', 'mh-l6-native-copy'].map(name => `packages/h2a/test/${name}.test.js`);
