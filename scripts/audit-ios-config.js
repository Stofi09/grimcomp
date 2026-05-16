#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

const easPath = path.join(repoRoot, 'eas.json');
if (!fs.existsSync(easPath)) {
  fail(`missing eas.json at ${easPath}`);
} else {
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  const submit = eas?.submit?.production?.ios ?? {};

  for (const key of ['appleId', 'appleTeamId']) {
    const v = submit[key];
    if (!v || /^REPLACE_WITH_/i.test(v)) {
      fail(`eas.json submit.production.ios.${key} is missing or still a placeholder ("${v ?? ''}")`);
    }
  }
  if (submit.appleTeamId && !/^[A-Z0-9]{10}$/.test(submit.appleTeamId)) {
    warn(`eas.json appleTeamId "${submit.appleTeamId}" doesn't match the 10-char Apple Team ID format`);
  }
  if (!submit.ascAppId) {
    warn('eas.json submit.production.ios.ascAppId is not set yet — first `submit:ios:testflight` will create the App Store Connect entry and you should paste the resulting ascAppId back here so future submits are unattended');
  }

  const buildProd = eas?.build?.production ?? {};
  if (buildProd.autoIncrement !== true) {
    warn('eas.json build.production.autoIncrement should be true so TestFlight build numbers march forward');
  }
  if (eas?.cli?.appVersionSource !== 'remote') {
    warn('eas.json cli.appVersionSource should be "remote" so EAS owns the buildNumber');
  }
}

const appJsonPath = path.join(repoRoot, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  fail(`missing app.json at ${appJsonPath}`);
} else {
  const cfg = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const ios = cfg?.expo?.ios ?? {};

  if (!ios.bundleIdentifier) {
    fail('app.json expo.ios.bundleIdentifier is missing');
  } else if (/example|test|placeholder/i.test(ios.bundleIdentifier)) {
    fail(`app.json expo.ios.bundleIdentifier "${ios.bundleIdentifier}" looks like a placeholder — TestFlight upload locks this permanently`);
  }

  if (ios.infoPlist?.ITSAppUsesNonExemptEncryption !== false && ios.infoPlist?.ITSAppUsesNonExemptEncryption !== true) {
    warn('app.json expo.ios.infoPlist.ITSAppUsesNonExemptEncryption should be explicitly set (false unless you ship custom crypto)');
  }

  if (!cfg?.expo?.extra?.eas?.projectId) {
    fail('app.json expo.extra.eas.projectId is empty — run `eas init` to link this project');
  }

  if (!cfg?.expo?.owner) {
    warn('app.json expo.owner is not set — EAS uses the logged-in account, but pinning the owner is safer for shared machines');
  }

  if (!cfg?.expo?.version) {
    fail('app.json expo.version is missing');
  }
}

console.log('[audit:ios] checks complete');
if (warnings.length) {
  console.log('\n[audit:ios] warnings:');
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.error('\n[audit:ios] blockers:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('[audit:ios] no blockers — ready for `npm run submit:ios:testflight`');
