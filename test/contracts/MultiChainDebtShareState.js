'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { toUnit } = require('../utils')();

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

contract('MultiChainDebtShareState', async accounts => {
	const [, owner] = accounts;

	let multiChainDebtShareState, multiChainDebtShareManager;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			MultiChainDebtShareState: multiChainDebtShareState,
			MultiChainDebtShareManager: multiChainDebtShareManager,
		} = await setupAllContracts({
			accounts,
			contracts: ['MultiChainDebtShareState', 'MultiChainDebtShareManager'],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: multiChainDebtShareState.abi,
			ignoreParents: ['Owned', 'State'],
			expected: ['appendToDebtShareStorage', 'updateDebtShareStorage', 'removeDebtShareStorage'],
		});
	});

	describe('Should revert as intended', () => {
		it('appendToDebtShareStorage() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareState.appendToDebtShareStorage,
				args: [toUnit('1'), true],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('updateDebtShareStorage() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareState.updateDebtShareStorage,
				args: [1, toUnit('1'), true],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});

		it('removeDebtShareStorage() cannot be invoked directly by user', () => {
			onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareState.removeDebtShareStorage,
				args: [1],
				accounts,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('should fetch the contract data', () => {
		beforeEach(async () => {
			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('1'), false, {
				from: owner,
			});
		});

		it('should fetch debtShareStorageInfo at index', async () => {
			const result = await multiChainDebtShareState.debtShareStorageInfoAt(0);
			assert.equal(result.debtShare.toString(), toUnit(1));
		});
	});
});
