/**
 * Campaign imagery for the storefront's own pages: the hero, the editorial
 * band and one mood picture per category. These are atmosphere, never product
 * photography — a product's picture always comes from the product itself.
 *
 * Categories are tenant data, so a picture is chosen by keyword in the
 * category's name rather than by id; an unrecognised category gets the
 * general footwear picture.
 */
export const STORE_HERO = '/store/hero.webp';
export const STORE_EDITORIAL = '/store/editorial.webp';

const CATEGORY_IMAGERY: Array<[RegExp, string]> = [
  [/sneaker|zapatilla|tenis/i, '/store/cat-sneakers.webp'],
  [/sandal/i, '/store/cat-sandals.webp'],
  [/boot|bota/i, '/store/cat-boots.webp'],
];

export function categoryImage(name: string): string {
  return CATEGORY_IMAGERY.find(([re]) => re.test(name))?.[1] ?? '/store/cat-shoes.webp';
}
