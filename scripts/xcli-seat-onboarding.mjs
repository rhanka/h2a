// Bench-owned reviewed extension of the published llm-mesh 0.33.0 API.
// Keep the vendor module pure; every bench consumer imports this facade.
import { AGY_REQUIRED_COMPLETED_STEPS } from './xcli-seat-vendor/seat-onboarding.js';
export * from './xcli-seat-vendor/seat-onboarding.js';

// Reviewed 2026-11-07 against the Linux x86-64 ELF identified below
// (supersedes the 2026-11-06 review of 1.5.2, dossier:
// docs/reviews/xcli-r32-agy-1_5_3.md).
// Embedded jetbox_state_pb descriptor evidence, byte offsets in that ELF:
// PostOnboardingState: offset 105856536, length 103,
// sha256 e479351811fe1686621bad52f28a1277fadefbb28b8a0a8f3f0c9ba74ea6bf64.
// State.post_onboarding: offset 105865837, length 77,
// sha256 ea25e8d8dd2d0234d4523f6e3f1b342c560ddec907250e8d3c12452e139488b1.
// PostOnboardingStepType: offset 105867013, length 252,
// sha256 b3a87909f9ae41e884179f5e3126a8b027a1a54dc6648a968130bfb3220406c9.
// All three carved blobs are byte-identical to the reviewed 1.5.2 blobs:
// the transported projection has no schema delta across the vendor update.
// post_onboarding is message field 1. PostOnboardingState contains only
// completed_steps, repeated enum field 1. Enum 0 is UNSPECIFIED; the four
// values below are 1..4. UNSPECIFIED is not a completed step.
// This records schema review, not an executed interactive onboarding run.
export const AGY_ONBOARDING_REVIEW = Object.freeze({
  nativeCliVersion: '1.5.3',
  binaryBytes: 246837648,
  binarySha256: '7ca212748ca0dfda718efbc39a776a104472e7e9344d4b6ea147c543684f96a3',
  completedSteps: Object.freeze([
    'POST_ONBOARDING_STEP_TYPE_MANAGER_WELCOME',
    'POST_ONBOARDING_STEP_TYPE_USAGE_MODE',
    'POST_ONBOARDING_STEP_TYPE_AGENT_CONFIGURATION',
    'POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE',
  ]),
});

const { nativeCliVersion, completedSteps } = AGY_ONBOARDING_REVIEW;
if (Object.hasOwn(AGY_REQUIRED_COMPLETED_STEPS, nativeCliVersion)) {
  if (JSON.stringify(AGY_REQUIRED_COMPLETED_STEPS[nativeCliVersion]) !==
      JSON.stringify(completedSteps)) {
    throw new Error(`agy-onboarding-review-conflict:${nativeCliVersion}`);
  }
} else {
  Object.defineProperty(AGY_REQUIRED_COMPLETED_STEPS, nativeCliVersion, {
    value: completedSteps, enumerable: true, writable: false, configurable: false,
  });
}

// Runtime qualification is separate from offline envelope validation:
// the published envelope schema has no executable-digest field.
export function agyOnboardingBinaryRefusal(version, digest) {
  if (!Object.hasOwn(AGY_REQUIRED_COMPLETED_STEPS, version)) {
    return 'onboarding-version-unreviewed';
  }
  if (version === AGY_ONBOARDING_REVIEW.nativeCliVersion &&
      digest !== AGY_ONBOARDING_REVIEW.binarySha256) {
    return 'onboarding-binary-unreviewed';
  }
  return null;
}
