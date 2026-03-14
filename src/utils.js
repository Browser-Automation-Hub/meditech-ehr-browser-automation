/**
 * utils.js — Shared utilities for Meditech EHR browser automation
 * retry(), humanDelay(), log(), error types
 */
'use strict';

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn
 * @param {Object} opts - { attempts, delay, backoff }
 */
async function retry(fn, opts = {}) {
  const { attempts = 3, delay = 1000, backoff = 1.5 } = opts;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const wait = Math.round(delay * Math.pow(backoff, i));
        log(`Attempt ${i + 1} failed: ${err.message}. Retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

/**
 * Human-like random delay between min and max milliseconds.
 */
function humanDelay(min = 500, max = 2000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Simple structured logger.
 */
function log(message, data) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${ts}] ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(`[${ts}] ${message}`);
  }
}

/**
 * Custom error classes for better error handling.
 */
class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

class SelectorNotFoundError extends Error {
  constructor(selector) {
    super(`Selector not found: ${selector}`);
    this.name = 'SelectorNotFoundError';
    this.selector = selector;
  }
}

class SessionExpiredError extends Error {
  constructor() {
    super('Session expired — re-authentication required');
    this.name = 'SessionExpiredError';
  }
}

class RateLimitError extends Error {
  constructor() {
    super('Rate limit detected — adding delay before retry');
    this.name = 'RateLimitError';
  }
}

/**
 * Wait for network to be idle (no requests for 500ms)
 */
async function waitForNetworkIdle(page, timeout = 30000) {
  return page.waitForNetworkIdle({ idleTime: 500, timeout }).catch(() => {});
}

/**
 * Safe page evaluate with error handling
 */
async function safeEvaluate(page, fn, ...args) {
  try {
    return await page.evaluate(fn, ...args);
  } catch (err) {
    log(`evaluate failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  retry,
  humanDelay,
  log,
  waitForNetworkIdle,
  safeEvaluate,
  AuthenticationError,
  SelectorNotFoundError,
  SessionExpiredError,
  RateLimitError,
};
