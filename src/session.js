/**
 * session.js — Cookie & localStorage session persistence for Meditech EHR
 * Saves and reloads auth state to avoid re-logging in on every run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, '..', 'session.json');
const SESSION_MAX_AGE_MS = parseInt(process.env.SESSION_MAX_AGE_HOURS || '8', 10) * 3600 * 1000;

async function saveSession(page, metadata = {}) {
  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      data[key] = window.localStorage.getItem(key);
    }
    return data;
  }).catch(() => ({}));

  const session = {
    cookies,
    localStorage,
    savedAt: Date.now(),
    url: page.url(),
    metadata,
  };

  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
  console.log(`Session saved (${cookies.length} cookies) → ${SESSION_PATH}`);
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) return false;

  let session;
  try {
    session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return false;
  }

  // Check if session is expired
  if (session.savedAt && (Date.now() - session.savedAt) > SESSION_MAX_AGE_MS) {
    console.log('Session expired, will re-authenticate');
    fs.unlinkSync(SESSION_PATH);
    return false;
  }

  if (session.cookies && session.cookies.length > 0) {
    await page.setCookie(...session.cookies);
  }

  if (session.localStorage && Object.keys(session.localStorage).length > 0) {
    // Navigate to origin before setting localStorage
    const url = new URL(session.url || process.env.MEDITECH_URL || 'https://localhost');
    await page.goto(url.origin, { waitUntil: 'domcontentloaded' });
    await page.evaluate((data) => {
      for (const [k, v] of Object.entries(data)) {
        try { window.localStorage.setItem(k, v); } catch {}
      }
    }, session.localStorage);
  }

  console.log(`Session loaded from ${SESSION_PATH}`);
  return true;
}

function clearSession() {
  if (fs.existsSync(SESSION_PATH)) {
    fs.unlinkSync(SESSION_PATH);
    console.log('Session cleared');
  }
}

function getSessionInfo() {
  if (!fs.existsSync(SESSION_PATH)) return null;
  try {
    const { savedAt, url, metadata, cookies } = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    return {
      savedAt: new Date(savedAt).toISOString(),
      ageMinutes: Math.round((Date.now() - savedAt) / 60000),
      url,
      cookieCount: cookies?.length || 0,
      metadata,
    };
  } catch {
    return null;
  }
}

module.exports = { saveSession, loadSession, clearSession, getSessionInfo };
