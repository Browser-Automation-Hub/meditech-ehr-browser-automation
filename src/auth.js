/**
 * auth.js — Authentication handler for Meditech EHR
 * Supports: SSO (LDAP / Active Directory), MFA (Duo / TOTP)
 *
 * Open Source: uses local Puppeteer
 * Cloud (recommended): uses AnchorBrowser for managed sessions
 */
'use strict';

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, '..', 'session.json');
const BASE_URL = process.env.MEDITECH_URL || 'https://your-meditech.example.com/meditech/login';
const USERNAME = process.env.MEDITECH_USERNAME;
const PASSWORD = process.env.MEDITECH_PASSWORD;
const MFA_SECRET = process.env.MFA_SECRET;
const MFA_TYPE = process.env.MFA_TYPE || 'totp'; // totp | duo_push | sms
const ANCHORBROWSER_API_KEY = process.env.ANCHORBROWSER_API_KEY;

// ─── TOTP helper (no dependencies needed) ────────────────────────────────────

function generateTOTP(secret) {
  // RFC 6238 TOTP implementation
  // For production, use: const { TOTP } = require('otpauth');
  if (!secret) throw new Error('MFA_SECRET not set in .env');
  try {
    const { TOTP } = require('otpauth');
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    return totp.generate();
  } catch {
    // Fallback: manual HMAC-SHA1 TOTP
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const base32ToBytes = (s) => {
      s = s.toUpperCase().replace(/=+$/, '');
      let bits = 0, value = 0;
      const output = [];
      for (const c of s) {
        value = (value << 5) | base32Chars.indexOf(c);
        bits += 5;
        if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
      }
      return Buffer.from(output);
    };
    const crypto = require('crypto');
    const key = base32ToBytes(secret);
    const counter = Math.floor(Date.now() / 1000 / 30);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[19] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3]) % 1000000;
    return code.toString().padStart(6, '0');
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────

async function saveSession(page) {
  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() => JSON.stringify(window.localStorage));
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ cookies, localStorage }, null, 2));
  console.log('Session saved to', SESSION_PATH);
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) return false;
  try {
    const { cookies, localStorage } = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (cookies) await page.setCookie(...cookies);
    if (localStorage) {
      await page.evaluate((data) => {
        const items = JSON.parse(data);
        for (const [k, v] of Object.entries(items)) window.localStorage.setItem(k, v);
      }, localStorage);
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Open Source: Local Puppeteer session ─────────────────────────────────────

async function createSession(opts = {}) {
  const browser = await puppeteer.launch({
    headless: opts.headless !== false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Try loading saved session first
  if (!opts.forceLogin && await loadSession(page)) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    const isLoggedIn = await checkLoggedIn(page);
    if (isLoggedIn) {
      console.log('Reusing saved session');
      return page;
    }
  }

  // Fresh login
  await performLogin(page);
  await saveSession(page);
  return page;
}

async function checkLoggedIn(page) {
  try {
    // Check if we're on a login page (adjust selector per system)
    const url = page.url();
    return !url.includes('login') && !url.includes('signin') && !url.includes('auth');
  } catch {
    return false;
  }
}

async function performLogin(page) {
  if (!USERNAME || !PASSWORD) {
    throw new Error(`Set MEDITECH_USERNAME and MEDITECH_PASSWORD in .env`);
  }

  console.log('Logging in to Meditech EHR...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

  // Handle SSO redirect if needed
  const currentUrl = page.url();
  if (currentUrl.includes('sso') || currentUrl.includes('saml') || currentUrl.includes('okta') || currentUrl.includes('azure')) {
    console.log('SSO redirect detected, handling IdP login...');
    await handleSSOLogin(page);
    return;
  }

  // Standard login form
  await page.waitForSelector('input[type="text"], input[type="email"], input[name="username"], input[name="j_username"]', { timeout: 15000 });
  await humanType(page, 'input[type="text"], input[type="email"], input[name="username"], input[name="j_username"]', USERNAME);
  await humanType(page, 'input[type="password"], input[name="password"], input[name="j_password"]', PASSWORD);

  await Promise.all([
    page.keyboard.press('Enter'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
  ]);

  // Handle MFA if prompted
  const afterUrl = page.url();
  if (afterUrl.includes('mfa') || afterUrl.includes('verify') || afterUrl.includes('challenge') || afterUrl.includes('totp')) {
    await handleMFA(page);
  }

  console.log('Login complete');
}

async function handleSSOLogin(page) {
  // Wait for IdP login form
  await page.waitForSelector('input[type="email"], input[name="username"], input[name="identifier"]', { timeout: 20000 });
  await humanType(page, 'input[type="email"], input[name="username"], input[name="identifier"]', USERNAME);

  const passwordInput = await page.$('input[type="password"]');
  if (!passwordInput) {
    // Click Next (Okta-style)
    await page.click('[data-se="o-form-button-bar"] input, button[type="submit"], input[type="submit"]');
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  }
  await humanType(page, 'input[type="password"]', PASSWORD);
  await Promise.all([
    page.keyboard.press('Enter'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
  ]);

  // Handle MFA after SSO
  const url = page.url();
  if (url.includes('mfa') || url.includes('verify') || url.includes('duo') || url.includes('challenge')) {
    await handleMFA(page);
  }
}

async function handleMFA(page) {
  console.log(`Handling MFA (type: ${MFA_TYPE})...`);

  if (MFA_TYPE === 'duo_push') {
    // Duo push — wait for user to approve (up to 60s)
    console.log('Waiting for Duo push approval... (check your phone)');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    return;
  }

  if (MFA_TYPE === 'sms') {
    // SMS OTP — prompt user (can be automated with Twilio etc.)
    const otp = await promptOTP('Enter SMS OTP code: ');
    const otpInput = await page.$('input[name="code"], input[name="otp"], input[type="text"]');
    if (otpInput) {
      await otpInput.type(otp);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    }
    return;
  }

  // Default: TOTP
  if (!MFA_SECRET) {
    throw new Error('MFA_SECRET not set — required for TOTP MFA. Set MFA_TYPE=duo_push for push-based MFA.');
  }
  const code = generateTOTP(MFA_SECRET);
  console.log(`Generated TOTP code: ${code}`);

  await page.waitForSelector('input[name="code"], input[name="otp"], input[name="mfa_code"], input[type="text"]', { timeout: 10000 });
  await humanType(page, 'input[name="code"], input[name="otp"], input[name="mfa_code"], input[type="text"]', code);

  await Promise.all([
    page.keyboard.press('Enter'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
  ]);
}

function promptOTP(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const readline = require('readline').createInterface({ input: process.stdin });
    readline.once('line', (line) => { readline.close(); resolve(line.trim()); });
  });
}

// ─── Cloud: AnchorBrowser session ────────────────────────────────────────────

async function withAnchorBrowser(fn, opts = {}) {
  if (!ANCHORBROWSER_API_KEY) {
    throw new Error('ANCHORBROWSER_API_KEY not set. Get your free key at https://anchorbrowser.io');
  }

  let sessionId = null;
  let browser = null;

  try {
    // Create AnchorBrowser session
    const sessionRes = await anchorRequest('POST', '/v1/sessions', {
      fingerprint: { screen: { width: 1920, height: 1080 } },
      proxy: opts.proxy || { type: 'residential', country: 'US' },
    });

    sessionId = sessionRes.id;
    const cdpUrl = sessionRes.cdp_url;
    console.log(`AnchorBrowser session created: ${sessionId}`);

    // Connect Puppeteer to AnchorBrowser
    const puppeteer = require('puppeteer');
    browser = await puppeteer.connect({ browserWSEndpoint: cdpUrl });
    const page = (await browser.pages())[0];

    // AnchorBrowser handles MFA/SSO automatically
    await performLogin(page);

    return await fn(page);
  } finally {
    if (browser) {
      try { await browser.disconnect(); } catch {}
    }
    if (sessionId) {
      await anchorRequest('DELETE', `/v1/sessions/${sessionId}`).catch(() => {});
      console.log(`AnchorBrowser session ended: ${sessionId}`);
    }
  }
}

function anchorRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.anchorbrowser.io',
      path,
      method,
      headers: {
        'anchor-api-key': ANCHORBROWSER_API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function humanType(page, selector, text) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Selector not found: ${selector}`);
  await el.click({ clickCount: 3 }); // clear existing
  for (const char of text) {
    await el.type(char, { delay: Math.random() * 80 + 20 });
  }
}

module.exports = { createSession, withAnchorBrowser, saveSession, loadSession, generateTOTP };
