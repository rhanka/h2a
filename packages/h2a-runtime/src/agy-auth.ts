export const AGY_AUTH_REQUIRED = {
  code: "agy-auth-required",
  reason: "AGY requires authentication",
  hint: "run agy interactively to sign in, then relaunch",
} as const;

// AGY 1.5.14 emits the first diagnostic with a controlling terminal and the
// second without one. Match provider stderr, never generated stream-json text.
export const AGY_AUTH_DIAGNOSTIC =
  /(?:^|\n)(?:Authentication required\. Please visit the URL to log in:|Error: authentication required\. Run 'agy' to log in, then retry\.)(?:\r?\n|$)/;

// The footer belongs to the active menu. An old login transcript above a
// working composer must not block delivery.
export const AGY_LOGIN_MENU =
  /Select login method:\s*>?\s*1\. Google OAuth\s*>?\s*2\. Use a Google Cloud project\s*↑\/↓ Navigate · enter Select\s*$/i;
