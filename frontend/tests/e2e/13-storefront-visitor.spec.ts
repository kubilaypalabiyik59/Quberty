import { test, expect } from '@playwright/test';

/**
 * A visitor who has not signed in can browse the shop: products, categories
 * and a product page, from the public catalogue. Needs
 * NEXT_PUBLIC_STOREFRONT_TENANT_SLUG (see .env.local.example).
 */
test.describe('Storefront for a visitor', () => {
  test('browses products and categories without signing in', async ({ page }) => {
    const refused: string[] = [];
    page.on('response', (r) => { if (r.status() === 401 || r.status() === 403) refused.push(`${r.status()} ${new URL(r.url()).pathname}`); });

    await page.goto('/shop');
    const cards = page.locator('#catalog a[href^="/shop/"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#categories button').first()).toBeVisible();

    // Filter by the first category from its tile.
    await page.locator('#categories button').first().click();
    await expect(page).toHaveURL(/category=/);

    // A product page opens for the visitor too.
    await page.goto('/shop');
    await cards.first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    expect(refused, 'no catalogue call may be refused for a visitor').toEqual([]);
  });

  test('the public catalogue says in stock or not, never how many, and no costs', async ({ request }) => {
    const slug = process.env.NEXT_PUBLIC_STOREFRONT_TENANT_SLUG ?? 'skarpine-demo';
    const res = await request.get(`http://localhost:3001/api/v1/storefront/${slug}/products?limit=5`);
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const p of data) {
      expect(typeof p.in_stock).toBe('boolean');
      expect(p).not.toHaveProperty('total_stock');
      expect(p).not.toHaveProperty('cost_price');
      expect(p).not.toHaveProperty('item_group_id');
      for (const v of p.variants) {
        expect(typeof v.available).toBe('boolean');
        expect(v).not.toHaveProperty('available_stock');
      }
    }
    expect((await request.get(`http://localhost:3001/api/v1/storefront/no-such-store/products`)).status()).toBe(404);
  });
});
