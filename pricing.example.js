/*
 * ============================================================
 *  EXAMPLE PRICING ONLY — THESE ARE NOT REAL DRONEWORKS QLD RATES
 * ============================================================
 * This repository is public (GitHub Pages). Never put real rates or
 * product costs in this file. Real pricing is entered in the app's
 * Settings panel and stored only in the browser (localStorage).
 * The numbers below are deliberately round placeholders.
 */
(function (root) {
  var EXAMPLE_PRICING = {
    schemaVersion: 1,
    currency: 'AUD',
    gstRate: 0.10,               // 10% GST
    minimumCharge: 500,          // minimum job / call-out charge (ex GST), applies to the application fee
    quoteValidityDays: 30,
    chemicalMarkupPct: 10,       // markup on DroneWorks-supplied product
    travel: {
      perKm: 2,                  // $ per km charged (ex GST)
      freeKm: 50                 // first X charged km are free
    },
    surcharges: {
      rushPct: 20,               // rush / time-critical job, % of application fee
      terrainPct: 15             // difficult terrain / waterlogged, % of application fee
    },
    jobTypes: [
      { id: 'spraying',  label: 'Spraying',  ratePerHa: 30, unit: 'L'  },
      { id: 'spreading', label: 'Spreading (fertiliser / granular)', ratePerHa: 20, unit: 'kg' },
      { id: 'seeding',   label: 'Seeding',   ratePerHa: 20, unit: 'kg' }
    ],
    products: [
      { id: 'ex-herbicide',   name: 'Example Herbicide',   unit: 'L',  unitPrice: 10, defaultRate: 2,   jobTypes: ['spraying'] },
      { id: 'ex-insecticide', name: 'Example Insecticide', unit: 'L',  unitPrice: 20, defaultRate: 1,   jobTypes: ['spraying'] },
      { id: 'ex-fungicide',   name: 'Example Fungicide',   unit: 'L',  unitPrice: 15, defaultRate: 1,   jobTypes: ['spraying'] },
      { id: 'ex-fertiliser',  name: 'Example Fertiliser',  unit: 'kg', unitPrice: 1,  defaultRate: 100, jobTypes: ['spreading'] },
      { id: 'ex-seed',        name: 'Example Seed',        unit: 'kg', unitPrice: 5,  defaultRate: 10,  jobTypes: ['seeding'] }
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = EXAMPLE_PRICING;
  else root.DW_EXAMPLE_PRICING = EXAMPLE_PRICING;
})(typeof self !== 'undefined' ? self : this);
