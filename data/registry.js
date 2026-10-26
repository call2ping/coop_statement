// Registry of analysed cooperatives. Each data/<coop>-<year>.js file calls
// registerCoop({...}); index.html loads this file first, then every data file.
window.COOP_DATA = window.COOP_DATA || [];
window.registerCoop = function (coop) {
  window.COOP_DATA.push(coop);
};
