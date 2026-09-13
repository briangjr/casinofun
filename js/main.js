/* =========================================================
   main.js — app bootstrap
   ========================================================= */

(function init(){
  applyFeltColor();
  refreshWalletHud();
  renderLobby();
  updateBetSetupUI();
  goTo('lobby');

  // Save periodically-relevant screens in sync if the account was migrated on load.
  saveState(account);
})();
