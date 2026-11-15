/*
 * ============================================================
 *  EXAMPLE PRICING ONLY — THESE ARE NOT REAL DRONEWORKS QLD RATES
 * ============================================================
 * This repository is public (GitHub Pages). Never put real rates,
 * product costs, LiDAR rates or hire supplier details in this file.
 * Real pricing comes from a PRIVATE versioned rate sheet (.json) that is
 * imported in the app's Settings and stored only in the browser (localStorage).
 * The numbers below are deliberately round placeholders.
 */
(function (root) {
  var EXAMPLE_PRICING = {
    schemaVersion: 2,
    currency: 'AUD',
    rateSheet: { version: 'EXAMPLE', date: '', note: 'Example placeholder numbers — not real rates' },
    gstRate: 0.10,               // 10% GST (Australia)
    minimumCharge: 500,          // minimum job / call-out charge (ex GST), applies to the application fee
    setupFee: 50,                // EXAMPLE $ per set up / pack up / clean up event (ex GST); on top of the minimum
    quoteValidityDays: 14,
    chemicalMarkupPct: 10,       // markup on DroneWorks-supplied product
    labourRatePerHour: 80,       // EXAMPLE internal labour cost per hour (time breakdown)
    overheadPerJob: 100,         // EXAMPLE equipment / insurance allowance per job
    targetMarginPct: 25,         // EXAMPLE target profit margin (% of pre-GST selling price)
    defaultRoundTo: 10,          // round quotes up to the nearest $1 / $10 / $50 / $100
    travel: {
      perKm: 2,                  // $ per km charged (ex GST)
      freeKm: 50                 // first X charged km are free
    },
    surcharges: {
      rushPct: 20,               // rush / time-critical job, % of application fee
      terrainPct: 15             // difficult terrain / waterlogged, % of application fee
    },
    jobTypes: [
      { id: 'spraying',  label: 'Spraying',  ratePerHa: 30, unit: 'L',  haPerHour: 10, example: true },
      { id: 'spreading', label: 'Spreading (fertiliser / granular)', ratePerHa: 20, unit: 'kg', haPerHour: 15, example: true },
      { id: 'seeding',   label: 'Seeding',   ratePerHa: 20, unit: 'kg', haPerHour: 15, example: true },
      { id: 'lidar',     label: 'LiDAR mapping', kind: 'lidar', ratePerHa: 0, unit: 'kg', example: true }
    ],
    // EXAMPLE LiDAR rates (ex GST). Real LiDAR rates live only in the private rate sheet.
    lidar: {
      example: true,
      halfDayPrice: 2000,        // EXAMPLE half-day capture price
      halfDayFloor: 2000,        // EXAMPLE half-day floor (also the floor for hourly jobs on a hired unit)
      halfDayHours: 4,
      fullDayTarget: 3000,       // EXAMPLE full-day target
      fullDayFloor: 2500,        // EXAMPLE full-day floor (never quote below this)
      fullDayHours: 8,
      hourlyRate: 450,           // EXAMPLE hourly reference rate (on-site: setup, safety checks, flying)
      hourlyFloor: 400,          // EXAMPLE lowest hourly rate
      suggestFullDayAboveHours: 4,
      processingPerHour: 90,     // EXAMPLE processing rate per hour
      processingHoursTypical: [10, 16],
      minBillableHoursEnabled: true, // approved: minimum billable hours for owned kit / hire week already covered
      minBillableHours: 2
    },
    // EXAMPLE hire costs used to work out the hire-week cash break-even.
    hire: {
      example: true,
      insurance: 80,
      consumables: 40,
      fuel: 40,
      suppliers: [
        { name: 'Example Hire Co', cost: 2000, period: 'week', jobTypes: ['lidar'] }
      ]
    },
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
