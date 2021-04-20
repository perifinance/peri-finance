const { detectNetworkName } = require('./detectNetwork');
const { connectContract, connectContracts } = require('./connectContract');
const {
	ensureAccountHasEther,
	ensureAccountHasPERI,
	ensureAccountHaspUSD,
	ensureAccountHaspETH,
} = require('./ensureAccountHasBalance');
const { exchangePynths } = require('./exchangePynths');
const { readSetting, writeSetting } = require('./systemSettings');
const { skipWaitingPeriod, skipStakeTime } = require('./skipWaiting');
const { simulateExchangeRates, avoidStaleRates } = require('./exchangeRates');
const { takeDebtSnapshot } = require('./debtSnapshot');
const { mockOptimismBridge } = require('./optimismBridge');
const { implementsVirtualPynths } = require('./virtualPynths');
const { implementsMultiCollateral } = require('./multicollateral');
const { resumeSystem } = require('./systemStatus');

module.exports = {
	detectNetworkName,
	connectContract,
	connectContracts,
	ensureAccountHasEther,
	ensureAccountHaspUSD,
	ensureAccountHasPERI,
	ensureAccountHaspETH,
	exchangePynths,
	readSetting,
	writeSetting,
	skipWaitingPeriod,
	skipStakeTime,
	simulateExchangeRates,
	takeDebtSnapshot,
	mockOptimismBridge,
	implementsVirtualPynths,
	implementsMultiCollateral,
	avoidStaleRates,
	resumeSystem,
};
