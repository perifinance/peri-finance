'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { toUnit } = require('../utils')();

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

contract('MultiChainDebtShareManager', async accounts => {
	let multiChainDebtShareManager;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({ MultiChainDebtShareManager: multiChainDebtShareManager } = await setupAllContracts({
			accounts,
			contracts: ['MultiChainDebtShareManager'],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: multiChainDebtShareManager.abi,
			ignoreParents: ['Owned'],
			expected: [
				'setCurrentExternalDebtEntry',
				'removeCurrentExternalDebtEntry',
				'setMultiChainDebtShareState',
			],
		});
	});
});
