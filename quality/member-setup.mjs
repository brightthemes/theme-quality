// Playwright global setup: signs the test member in once, through the link Ghost made, and keeps
// the session for the signed-in checks (a sign-in link only works a few times)
import { chromium } from '@playwright/test';
import { existsSync, rmSync } from 'fs';
import { member, memberStateFile } from './shared.mjs';

export default async function memberSetup() {
  rmSync(memberStateFile, { force: true });
  if (!member) return;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(member.signinUrl, { waitUntil: 'networkidle' });
    const signedIn = await page.evaluate(() => fetch('/members/api/member/').then((r) => r.status === 200));
    if (signedIn) await context.storageState({ path: memberStateFile });
    else console.warn('The test member could not sign in: the signed-in checks are skipped');
  } finally {
    await browser.close();
  }
  return existsSync(memberStateFile);
}
