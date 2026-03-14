# Contributing to Meditech EHR Browser Automation

Thank you for contributing! This project is part of the [Browser Automation Hub](https://github.com/Browser-Automation-Hub).

## How to Contribute

### Reporting Issues

- **Broken selectors**: Meditech EHR updates its UI periodically. If a selector breaks, open an issue with the current selector and what it should be.
- **Auth issues**: SSO/MFA flows change. Document what changed and which provider is involved.
- **New use cases**: If you've automated a workflow not covered, open an issue to discuss adding it.

### Pull Requests

1. Fork the repo and create a feature branch: `git checkout -b fix/broken-selector`
2. Make your changes
3. Test your changes against a real Meditech EHR instance (if you have access)
4. Submit a PR with a clear description of what you changed and why

### Adding New Actions

Actions live in `src/actions.js`. Each action should:

```javascript
async function my_new_action(page, opts = {}) {
  const { retry, humanDelay, log } = require('./utils');

  return retry(async () => {
    await humanDelay(500, 1500); // always add human delay

    // 1. Navigate to the relevant page
    await page.goto(`${process.env.MEDITECH_URL}/path/to/section`);

    // 2. Wait for content
    await page.waitForSelector('.your-selector', { timeout: 15000 });

    // 3. Interact or extract
    const data = await page.evaluate(() => {
      // DOM extraction
      return Array.from(document.querySelectorAll('.row')).map(row => row.textContent.trim());
    });

    return { status: 'ok', data };
  }, { attempts: 3, delay: 2000 });
}
```

### Documenting Selectors

When you find working selectors for Meditech EHR, document them:

```javascript
// Meditech EHR selectors (verified YYYY-MM-DD)
// Login page: https://your-instance/login
const SELECTORS = {
  username: '#username',         // or 'input[name="j_username"]'
  password: '#password',
  submitBtn: 'button[type="submit"]',
  // Add more...
};
```

### Updating for UI Changes

Meditech EHR updates its UI periodically. When selectors break:
1. Inspect the new element in DevTools
2. Update the selector in the relevant file
3. Add a comment with the date verified
4. Submit a PR

## Code Style

- Use async/await (no raw promises)
- Always use `retry()` for network operations
- Always use `humanDelay()` before interactions
- Take a screenshot on error: `page.screenshot({ path: `error-${Date.now()}.png` })`
- Log actions with `log()` from utils

## Testing

```bash
npm test        # Verify all modules load
npm start       # Run basic login (requires .env)
npm run start:cloud  # Run with AnchorBrowser
```

## Resources

- [AnchorBrowser Docs](https://docs.anchorbrowser.io) — for cloud browser features
- [Puppeteer API](https://pptr.dev) — browser automation reference
- [Browser Automation Hub](https://github.com/Browser-Automation-Hub) — all our automation projects

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
