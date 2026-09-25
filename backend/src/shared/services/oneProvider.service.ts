import { AppError } from '../errors/AppError';

/**
 * OneProvider image client — optional product-media generation.
 *
 * OneProvider is a third-party gateway exposing an OpenAI-compatible Images API
 * (https://oneprovider.dev/docs). Only `/v1/images/edits` is used here: it takes a
 * reference photo and returns a new image, which is what keeps a generated view
 * recognisably the same product.
 *
 * The key is read from ONEPROVIDER_API_KEY and never logged or returned. When it
 * is absent the feature answers 501, exactly as the FAL.ai video feature does.
 *
 * Video generation (`/v1/videos/generations`) is deliberately not wired: on
 * 2026-09-24 OneProvider answered 503 "Video generation is not configured" and
 * does not document how a reference image is passed.
 */

const ONEPROVIDER_BASE = 'https://api.oneprovider.dev/v1';
const REQUEST_TIMEOUT_MS = 180_000;

export const PRODUCT_VIEWS = ['front', 'back', 'left', 'right'] as const;
export type ProductView = typeof PRODUCT_VIEWS[number];

/** The `quality` values gpt-image-2 accepts, per OneProvider's model catalog. */
export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;
export type ImageQuality = typeof IMAGE_QUALITIES[number];

const VIEW_PROMPTS: Record<ProductView, string> = {
  front:
    'Front view: the product faces the camera straight on (for footwear, the toe points directly at the camera).',
  back:
    'Back view: the camera looks straight at the rear of the product (for footwear, the heel faces the camera).',
  left:
    'Left side profile: a pure 90-degree side view with the front of the product pointing to the left of the frame.',
  right:
    'Right side profile: a pure 90-degree side view with the front of the product pointing to the right of the frame.',
};

function viewPrompt(view: ProductView): string {
  return [
    'Professional e-commerce product photo of the exact same product shown in the reference image.',
    VIEW_PROMPTS[view],
    'Keep every design detail identical: shape, materials, colours, logos, stripes, stitching and sole.',
    'Do not add, remove or restyle anything. Single product only, no people, no text overlays.',
    'Clean seamless light-grey studio background, soft even lighting, subtle contact shadow, sharp focus, centred.',
  ].join(' ');
}

export function isOneProviderConfigured(): boolean {
  return Boolean(process.env.ONEPROVIDER_API_KEY);
}

export interface GeneratedImage {
  bytes: ArrayBuffer;
  contentType: string;
  ext: string;
}

/** Generates one view of the product in `reference` through OneProvider's Images API. */
export async function generateProductView(
  reference: { bytes: ArrayBuffer; contentType: string },
  view: ProductView,
  quality?: ImageQuality,
): Promise<GeneratedImage> {
  const apiKey = process.env.ONEPROVIDER_API_KEY;
  if (!apiKey) throw new AppError('AI image generation is not configured. Set ONEPROVIDER_API_KEY.', 501);

  const ext = reference.contentType.split('/')[1] ?? 'png';
  const form = new FormData();
  form.append('model', process.env.ONEPROVIDER_IMAGE_MODEL ?? 'gpt-image-2');
  form.append('prompt', viewPrompt(view));
  form.append('image[]', new Blob([reference.bytes], { type: reference.contentType }), `reference.${ext}`);
  form.append('size', '1024x1024');
  form.append('quality', quality ?? process.env.ONEPROVIDER_IMAGE_QUALITY ?? 'medium');
  form.append('n', '1');

  const res = await fetch(`${ONEPROVIDER_BASE}/images/edits`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body:    form,
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new AppError(`OneProvider image request failed (${res.status}): ${err}`, 502);
  }

  const body = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = body.data?.[0];

  if (first?.b64_json) {
    const buf = Buffer.from(first.b64_json, 'base64');
    return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), contentType: 'image/png', ext: 'png' };
  }

  if (first?.url) {
    const imgRes = await fetch(first.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!imgRes.ok) throw new AppError('OneProvider returned an image URL that could not be downloaded', 502);
    const contentType = imgRes.headers.get('content-type') ?? 'image/png';
    return { bytes: await imgRes.arrayBuffer(), contentType, ext: contentType.split('/')[1] ?? 'png' };
  }

  throw new AppError('OneProvider returned no image', 502);
}
