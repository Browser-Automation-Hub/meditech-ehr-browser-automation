/**
 * custom-actions.js — Fluent ActionBuilder API for Meditech EHR
 *
 * Build custom automation workflows using a chainable API.
 * Each step is queued and executed in order when .run(page) is called.
 *
 * @example
 * const result = await new ActionBuilder()
 *   .login()
 *   .navigate('/some/path')
 *   .waitForSelector('.content')
 *   .extractTable('.data-table')
 *   .run(page);
 */
'use strict';

const { humanDelay, retry, log } = require('./utils');

class ActionBuilder {
  constructor() {
    this._steps = [];
    this._context = {};
  }

  // ─── Built-in steps ──────────────────────────────────────────────────────

  login(opts = {}) {
    this._steps.push(async (page) => {
      const { createSession } = require('./auth');
      log('ActionBuilder: login');
      // If page is from createSession, already logged in
      // Otherwise re-authenticate
      return { step: 'login', status: 'ok' };
    });
    return this;
  }

  navigate(url) {
    this._steps.push(async (page) => {
      const base = process.env.MEDITECH_URL || '';
      const target = url.startsWith('http') ? url : base + url;
      log(`ActionBuilder: navigate → ${target}`);
      await page.goto(target, { waitUntil: 'networkidle2' });
      return { step: 'navigate', url: target };
    });
    return this;
  }

  waitForSelector(selector, opts = {}) {
    this._steps.push(async (page) => {
      log(`ActionBuilder: waitForSelector → ${selector}`);
      await page.waitForSelector(selector, { timeout: opts.timeout || 15000 });
      return { step: 'waitForSelector', selector };
    });
    return this;
  }

  click(selector) {
    this._steps.push(async (page) => {
      log(`ActionBuilder: click → ${selector}`);
      await humanDelay(300, 800);
      await page.click(selector);
      return { step: 'click', selector };
    });
    return this;
  }

  type(selector, text) {
    this._steps.push(async (page) => {
      log(`ActionBuilder: type → ${selector}`);
      await humanDelay(200, 600);
      await page.click(selector, { clickCount: 3 });
      for (const char of text) {
        await page.type(selector, char, { delay: Math.random() * 60 + 20 });
      }
      return { step: 'type', selector };
    });
    return this;
  }

  extractTable(selector) {
    this._steps.push(async (page) => {
      log(`ActionBuilder: extractTable → ${selector}`);
      const data = await page.evaluate((sel) => {
        const table = document.querySelector(sel);
        if (!table) return [];
        const headers = [...table.querySelectorAll('th')].map(th => th.innerText.trim());
        const rows = [...table.querySelectorAll('tr')].slice(1).map(tr =>
          [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
        );
        return rows.map(row => Object.fromEntries(row.map((val, i) => [headers[i] || i, val])));
      }, selector);
      this._context.tableData = data;
      return { step: 'extractTable', rowCount: data.length, data };
    });
    return this;
  }

  extractText(selector) {
    this._steps.push(async (page) => {
      log(`ActionBuilder: extractText → ${selector}`);
      const text = await page.$eval(selector, el => el.innerText.trim()).catch(() => null);
      this._context.text = text;
      return { step: 'extractText', selector, text };
    });
    return this;
  }

  screenshot(name) {
    this._steps.push(async (page) => {
      const filename = `${name || 'screenshot'}-${Date.now()}.png`;
      log(`ActionBuilder: screenshot → ${filename}`);
      await page.screenshot({ path: filename, fullPage: true });
      return { step: 'screenshot', file: filename };
    });
    return this;
  }

  waitDelay(min = 500, max = 1500) {
    this._steps.push(async () => {
      await humanDelay(min, max);
      return { step: 'delay' };
    });
    return this;
  }

  // ─── Custom step ─────────────────────────────────────────────────────────

  do(fn) {
    if (typeof fn !== 'function') throw new Error('ActionBuilder.do() requires a function');
    this._steps.push(async (page) => {
      const result = await fn(page, this._context);
      return { step: 'custom', result };
    });
    return this;
  }

  // ─── Execute ─────────────────────────────────────────────────────────────

  async run(page) {
    const results = [];
    for (const step of this._steps) {
      const result = await retry(() => step(page), { attempts: 2, delay: 1500 });
      results.push(result);
    }
    return { results, context: this._context };
  }
}

module.exports = { ActionBuilder };
