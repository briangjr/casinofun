/* =========================================================
   main.js — app bootstrap
   ========================================================= */

(function init(){
  applyFeltColor();
  refreshWalletHud();
  renderLobby();
  updateBetSetupUI();
  document.getElementById('shoe-count').textContent = game.cardsRemaining();
  goTo('lobby');

  // Save periodically-relevant screens in sync if the account was migrated on load.
  saveState(account);
})();
