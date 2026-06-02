// Renders manual.html to a print-quality PDF using the Chromium that ships with Playwright.
// Run:  node docs/manual/build-pdf.js   (from the frontend folder, where @playwright/test is installed)
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../frontend/node_modules/@playwright/test'));

(async () => {
  const dir = __dirname;
  const htmlPath = 'file://' + path.join(dir, 'manual.html').replace(/\\/g, '/');
  const outPath = path.join(dir, 'Quberty_ERP_Manual_Usuario.pdf');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(htmlPath, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });

  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  });

  await browser.close();
  console.log('PDF generado en:', outPath);
})().catch(e => { console.error(e); process.exit(1); });
