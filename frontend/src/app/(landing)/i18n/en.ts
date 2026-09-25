/**
 * English landing copy — the source of truth for the dictionary shape.
 * Generated from docs/design/QUBERTY_LANDING_2026-09-25.md §6; edit the copy there first.
 * Deliberately not annotated: `LandingDictionary` is derived from this object.
 */
export const en = {
  meta: {
    title: 'Quberty ERP — one system for your whole business',
    description:
      'Sales, purchasing, inventory, warehouse and finance in one place, with a point of sale and an online store that write to the same books. Built for businesses of 5 to 50 people.',
  },
  nav: { product: 'Product', capabilities: 'Capabilities', how: 'How it works', signIn: 'Sign in', demo: 'Request a demo', languageLabel: 'Language' },
  hero: {
    eyebrow: 'ERP for growing businesses',
    title: 'Run your whole business on one system.',
    subtitle:
      'Quberty brings sales, purchasing, stock, warehouse and finance together — with a point of sale and an online store that write to the same books. Built for teams of 5 to 50.',
    primary: 'Request a demo',
    secondary: 'See how it works',
    proof: ['One stock figure across every store', 'Books that close themselves', 'Set up in days, not months'],
  },
  problem: {
    title: 'Sound familiar?',
    intro: 'Most growing businesses run on a patchwork that worked at five people and breaks at twenty.',
    items: [
      { title: 'Spreadsheets everywhere', body: 'Orders in one file, stock in another, prices in someone’s head. Every report starts with copy and paste.' },
      { title: 'Stock you can’t trust', body: 'The shelf says one thing, the system says another, and the online store sells what you no longer have.' },
      { title: 'Month-end takes weeks', body: 'The accountant rebuilds the books from receipts because sales and purchases never reached them properly.' },
    ],
  },
  oneSystem: {
    title: 'One system. Every channel.',
    intro: 'Your back office, your shops, your web store and your warehouse — working from the same data, in real time.',
    tiles: [
      { title: 'Back office', body: 'Sales, purchasing, finance and people.' },
      { title: 'Point of sale', body: 'A fast checkout app for every store.' },
      { title: 'Online store', body: 'Sell online from the same catalogue and stock.' },
      { title: 'Warehouse', body: 'Receive, put away, pick and ship with guided work.' },
    ],
    ledgerLine: 'Every sale, receipt and payment lands in the same stock and the same books — no exports, no re-typing.',
  },
  capabilities: {
    title: 'Everything you need. Nothing you don’t.',
    intro: 'The core of a serious ERP, shaped for a business that doesn’t have an IT department.',
    items: [
      { title: 'Customers', body: 'From first contact to signed quote.', includes: ['Prospects and contacts', 'Quotations', 'Customer history'] },
      { title: 'Sales', body: 'Orders that flow straight to stock and invoice.', includes: ['Sales orders', 'Invoicing', 'Customer balances'] },
      { title: 'Purchasing', body: 'Buy on time, at the right price.', includes: ['Purchase requests', 'Purchase orders', 'Vendor bills'] },
      { title: 'Warehouse', body: 'Know where every item is, and move it with purpose.', includes: ['Receiving and put-away', 'Picking waves', 'Bin locations'] },
      { title: 'Finance', body: 'Real double-entry accounting, not a cash book.', includes: ['Journals and periods', 'Bank reconciliation', 'P&L and balance sheet'] },
      { title: 'People', body: 'Your team, their roles and their access.', includes: ['Employees', 'Roles and permissions', 'Store assignments'] },
      { title: 'Reports', body: 'The numbers you need, without building them.', includes: ['Owner dashboard', 'Sales and stock reports', 'Aged receivables and payables'] },
      { title: 'Control', body: 'See who changed what, and when.', includes: ['Full audit trail', 'Approval-ready documents', 'Data import'] },
    ],
  },
  flows: {
    title: 'How the work flows',
    intro: 'Every document knows where it came from and where it goes next. Nothing is typed twice.',
    selling: {
      label: 'Selling',
      steps: ['Prospect', 'Quotation', 'Order', 'Pick & ship', 'Invoice', 'Payment'],
      note: 'A quote becomes an order, the order reserves stock, and the invoice posts itself to the books.',
    },
    buying: {
      label: 'Buying',
      steps: ['Request', 'Purchase order', 'Receive', 'Put away', 'Vendor bill', 'Payment'],
      note: 'What you receive is what you pay for — matched to the order before the bill is paid.',
    },
  },
  foundation: {
    title: 'Simple on the surface. Serious underneath.',
    intro: 'Quberty is easy to start with, and built on the same foundations as enterprise systems — so you never have to switch again.',
    items: [
      { title: 'Real accounting', body: 'Every transaction is a balanced journal entry your accountant can trust.' },
      { title: 'Grows with you', body: 'Start with what you need today; turn on more when you need it, without migrating.' },
      { title: 'Many stores, one view', body: 'Run several stores and warehouses with stock and results for each — and for the whole business.' },
      { title: 'Nothing disappears', body: 'Corrections are recorded, not erased. You can always see what happened.' },
    ],
  },
  finalCta: {
    title: 'See Quberty with your own data.',
    body: 'Book a 30-minute walkthrough. We’ll show you your day in Quberty — orders, stock and books.',
    primary: 'Request a demo',
  },
  footer: { rights: 'All rights reserved.', signIn: 'Sign in' },
};
