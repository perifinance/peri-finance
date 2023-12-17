'use strict';

const { artifacts, contract } = require('hardhat');

const { ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const { addSnapshotBeforeRestoreAfterEach } = require('./common');

let Collateral;

contract('Collateral', async accounts => {
	addSnapshotBeforeRestoreAfterEach();

	before(async () => {
		Collateral = artifacts.require(`Collateral`);
	});

	it('should ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: Collateral.abi,
			ignoreParents: ['Owned', 'Pausable', 'MixinResolver', 'Proxy'],
			expected: [
				'addRewardsContracts',
				'addPynths',
				'setCanOpenLoans',
				'setInteractionDelay',
				'setIssueFeeRate',
				'setManager',
				'setMinCratio',
			],
		});
	});
});
