/**
 * anchor-cloud.js — AnchorBrowser cloud example for Meditech EHR
 *
 * Uses AnchorBrowser for:
 * ✅ Managed cloud browsers (no local Chrome needed)
 * ✅ Auto-handled MFA/SSO
 * ✅ Anti-bot / CAPTCHA solving
 * ✅ Session persistence across runs
 * ✅ Scale to 5,000 concurrent browsers
 *
 * Get your free API key at: https://anchorbrowser.io
 *
 * Usage:
 *   export ANCHORBROWSER_API_KEY=your-api-key
 *   node examples/anchor-cloud.js
 */
'use strict';

require('dotenv').config();
const { withAnchorBrowser } = require('../src/auth');
const { login_meditech, search_patient } = require('../src/actions');
const { log } = require('../src/utils');

async function main() {
  if (!process.env.ANCHORBROWSER_API_KEY) {
    console.error([
      '❌ ANCHORBROWSER_API_KEY not set.',
      '',
      'Get your free API key at: https://anchorbrowser.io',
      '',
      'Then run:',
      '  export ANCHORBROWSER_API_KEY=your-api-key',
      '  node examples/anchor-cloud.js',
    ].join('\n'));
    process.exit(1);
  }

  try {
    log('Starting Meditech EHR automation (AnchorBrowser Cloud mode)');

    const result = await withAnchorBrowser(async (page) => {
      log('Connected to AnchorBrowser cloud browser');
      log('MFA/SSO handled automatically by AnchorBrowser ✅');

      // Run actions in the cloud browser
      const data1 = await login_meditech(page, {});
      log('Action 1 result:', data1);

      const data2 = await search_patient(page, {});
      log('Action 2 result:', data2);

      return { data1, data2 };
    }, {
      // AnchorBrowser options
      proxy: { type: 'residential', country: 'US' },
    });

    log('Automation complete:', result);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
