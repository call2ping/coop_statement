// Registry of analysed cooperatives. Each data/<coop>-<year>.js file calls
// registerCoop({...}); index.html loads this file first, then every data file.
window.COOP_DATA = window.COOP_DATA || [];
window.registerCoop = function (coop) {
  window.COOP_DATA.push(coop);
};

// Litigation and complaint records live in data/litigation.js, keyed by coop id.
window.COOP_LITIGATION = window.COOP_LITIGATION || {};
window.registerLitigation = function (id, record) {
  window.COOP_LITIGATION[id] = record;
};
