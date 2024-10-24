'use strict';

const { contract } = require('hardhat');

const { addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { toUnit } = require('../utils')();

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { toBytes32 } = require('../..');

contract('CrossChainState', async accounts => {
	// const [, , account1] = accounts;

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
			contracts: ['AddressResolver', 'CrossChainState', 'SystemStatus'],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: crossChainState.abi,
			ignoreParents: ['Owned', 'State'],
			expected: [
				// 'addCrosschain',
				'addIssuedDebt',
				'subtractIssuedDebt',
				'setCrossNetworkActiveDebtAll',
				'setCrossNetworkDebtsAll',
				'setCrossNetworkIssuedDebtAll',
				'setInitialCurrentIssuedDebt',
				'setOutboundSumToCurrentNetwork',
			],
		});
	});

	describe('Should revert as intended', () => {
		it('addIssuedDebt() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.addIssuedDebt,
				args: [toBytes32('1'), toUnit('1')],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('subtractIssuedDebt() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.subtractIssuedDebt,
				args: [toBytes32('1'), toUnit('1')],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('setCrossNetworkDebtsAll() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.setCrossNetworkDebtsAll,
				args: [
					['5', '80001'].map(toBytes32),
					['1000', '1000'].map(toUnit),
					['1000', '1000'].map(toUnit),
					toUnit('0'),
				],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('setOutboundSumToCurrentNetwork() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.setOutboundSumToCurrentNetwork,
				args: [toUnit('0')],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('setInitialCurrentIssuedDebt() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: crossChainState.setInitialCurrentIssuedDebt,
				args: [toUnit('0')],
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
