import { test, expect } from '@playwright/test';
import { en } from '../../src/app/(landing)/i18n/en';
import { tr } from '../../src/app/(landing)/i18n/tr';
import { es } from '../../src/app/(landing)/i18n/es';
import { DEMO_EMAIL, SECTION_IDS } from '../../src/app/(landing)/content';

const DICTIONARIES = { en, tr, es } as const;

test.describe('Landing page', () => {
  for (const [lang, t] of Object.entries(DICTIONARIES)) {
    test(`renders in ${lang}`, async ({ page }) => {
      await page.goto(`/?lang=${lang}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.hero.title);
      await expect(page.locator(`div[lang="${lang}"]`).first()).toBeVisible();
      await expect(page).toHaveTitle(t.meta.title);
    });
  }

  for (const [lang, t] of Object.entries(DICTIONARIES)) {
    for (const width of [360, 768, 1440]) {
      test(`no horizontal scroll (${width}x900, ${lang})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/?lang=${lang}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBe(0);
      });
    }
  }

  test('the switcher persists the choice', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.getByRole('button', { name: 'ES' }).click();
    await page.waitForURL('??lang=es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.hero.title);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.hero.title);
    await expect(page.getByRole('button', { name: 'ES' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('falls back to the browser language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'tr-TR' });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.hero.title);
    } finally {
      await context.close();
    }
  });

  test('content is visible under reduced motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await page.goto('/?lang=en');
      const heading = page.getByRole('heading', { name: en.problem.title, level: 2 });
      await expect(heading.locator('..')).toHaveCSS('opacity', '1');
    } finally {
      await context.close();
    }
  });

  test('the demo CTA mails the demo address', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?lang=en');
    await expect(page.getByRole('link', { name: en.hero.primary }).first()).toHaveAttribute(
      'href',
      `mailto:${DEMO_EMAIL}`,
    );
  });

  test('the header anchors have targets', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?lang=en');
    for (const id of Object.values(SECTION_IDS)) {
      await expect(page.locator(`section[id="${id}"]`)).toHaveCount(1);
    }
  });
});
