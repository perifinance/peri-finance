'use strict';

const { contract } = require('hardhat');

const { addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { toUnit } = require('../utils')();

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

contract('CrossChainState', async accounts => {
	const [, , account1] = accounts;

	let crossChainState /* , crossChainManager, issuer */;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			CrossChainState: crossChainState,
			/* CrossChainManager: crossChainManager,
			Issuer: issuer, */
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD'],
			contracts: [
				'AddressResolver',
				'CrossChainState',
				'CrossChainManager',
				'StakingState',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'Liquidations',
				'DebtCache',
				'Issuer',
				'PeriFinance',
				'PeriFinanceState',
				'ExchangeRates',
				'SystemSettings',
				'CollateralManager',
				'BridgeStatepUSD',
			],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: crossChainState.abi,
			ignoreParents: ['Owned', 'State'],
			expected: [
				'addCrosschain',
				'addIssuedDebt',
				'addNetworkId',
				'setCrossNetworkUserData',
				'addTotalNetworkDebtLedger',
				'appendTotalNetworkDebtLedger',
				'clearCrossNetworkUserData',
				'setCrossNetworkActiveDebt',
				'setCrossNetworkActiveDebtAll',
				'setCrossNetworkDebtsAll',
				'setCrossNetworkInbound',
				'setCrossNetworkInboundAll',
				'setCrossNetworkIssuedDebt',
				'setCrossNetworkIssuedDebtAll',
				'setCrosschain',
				'setInitialCurrentIssuedDebt',
				'subtractIssuedDebt',
				'subtractTotalNetworkDebtLedger',
			],
		});
	});

	describe('Should revert as intended', () => {
		it('setCrossNetworkUserData() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.setCrossNetworkUserData,
				args: [account1, toUnit('1')],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('clearCrossNetworkUserData() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.clearCrossNetworkUserData,
				args: [account1],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('appendTotalNetworkDebtLedger() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.appendTotalNetworkDebtLedger,
				args: [toUnit('1')],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	// describe('should fetch the contract data', () => {
	//	beforeEach(async () => {
	//		await crossChainState.addTotalNetworkDebtLedger(toUnit(1), {
	//			from: issuer,
	//		});
	//	});

	//	it('should fetch CrossNetworkData at index', async () => {
	//		const result = await crossChainManager.getCurrentTotalNetworkDebt();
	//		assert.equal(result.toString(), toUnit(1));
	//	});
	// });*/
});
