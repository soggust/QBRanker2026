// Makes an account an admin (or not): the custom claim admin: true on its sign-in token, which the app
// reads (features.ts: MMA, the Bets page and experimental features) and firestore.rules trusts
// (isAdmin()). Only the Admin SDK can set a claim, so no one can make themselves one from the browser.
//
//   node libs/ranker/scripts/accounts/set-admin.mjs <email> [--remove]
//
// Credentials: FIREBASE_SERVICE_ACCOUNT (the service account's JSON, as the Actions secret holds it) or
// GOOGLE_APPLICATION_CREDENTIALS (a path to that JSON). With FIREBASE_AUTH_EMULATOR_HOST set it works on
// the Auth emulator instead, no credentials needed. The key is never printed. The user sees the change
// on their next visit (the app asks for a fresh token when it starts).
import { pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'qbranker2026';

function adminApp() {
  if (getApps().length) return getApps()[0];
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return initializeApp({ projectId: process.env.GCLOUD_PROJECT || PROJECT });
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    let account;
    try {
      account = JSON.parse(json);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT isn’t valid JSON');
    }
    return initializeApp({ credential: cert(account), projectId: account.project_id ?? PROJECT });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ projectId: PROJECT });
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT (the JSON) or GOOGLE_APPLICATION_CREDENTIALS (its path)');
}

// Sets (or clears) the claim, keeping any others the account has; returns the account's claims after
export async function setAdmin(email, admin = true) {
  const auth = getAuth(adminApp());
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}) };
  if (admin) claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(user.uid, Object.keys(claims).length ? claims : null);
  return { uid: user.uid, claims };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const remove = args.includes('--remove');
  const email = args.find((a) => !a.startsWith('--'));
  if (!email) {
    console.error('Usage: node libs/ranker/scripts/accounts/set-admin.mjs <email> [--remove]');
    process.exit(2);
  }
  setAdmin(email, !remove)
    .then(({ uid }) => console.log(`${email} (${uid}): ${remove ? 'no longer an admin' : 'admin'}`))
    .catch((error) => {
      console.error(`Couldn’t update ${email}: ${error.code ?? ''} ${error.message}`.trim());
      process.exit(1);
    });
}
