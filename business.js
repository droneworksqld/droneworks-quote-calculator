/*
 * DroneWorks QLD — public business details used on printed / copied quotes.
 * This is public information (from the business brochure). NO PRICING HERE.
 */
(function (root) {
  var BUSINESS = {
    name: 'DroneWorks QLD',
    tagline: 'Precision aerial spraying, spreading, mapping & inspections',
    region: 'Chinchilla · Western Downs QLD',
    contactName: 'Max Mossman',
    phone: '0428 658 790',
    email: 'info@droneworksqld.com.au',
    website: 'droneworksqld.com.au',
    abn: '', // optional: add your ABN here if you want it printed on quotes
    licences: [
      'Remote Pilot Licence (RePL, <150 kg)',
      "Remote Operator's Certificate (ReOC)",
      "QLD Aerial Distribution Contractor's Licence",
      'QLD Pilot Chemical Rating Licence'
    ],
    disclaimer:
      'This quote is an estimate only, based on the information provided. Final pricing is subject to ' +
      'site assessment, paddock boundaries/area confirmation, weather and product label rates and ' +
      'directions. Chemical and product prices may change with supplier pricing. Prices in AUD.'
  };
  if (typeof module === 'object' && module.exports) module.exports = BUSINESS;
  else root.DW_BUSINESS = BUSINESS;
})(typeof self !== 'undefined' ? self : this);
