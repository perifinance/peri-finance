'use strict';

const { contract } = require('hardhat');
const truffleAssert = require('truffle-assertions');
const { assert } = require('./common');

const {
	constants: { ZERO_ADDRESS },
} = require('../..');

const { setupContract, setupAllContracts } = require('./setup');

contract('StakingStateUSDC', async accounts => {
	let stakingStateUSDC;
	const [deployerAccount, owner, account1, account2, account3] = accounts;

	before(async () => {
		stakingStateUSDC = await setupContract({
			accounts,
			contract: 'StakingStateUSDC',
			args: [owner, deployerAccount],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			assert.equal(owner, await stakingStateUSDC.owner());
			assert.isNotEmpty(await stakingStateUSDC.associatedContract());
		});
	});

	describe('stake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakingStateUSDC.stake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('expect successfully staked', async () => {
			await truffleAssert.passes(
				stakingStateUSDC.stake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('unstake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakingStateUSDC.unstake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('Exceeds staked amount', async () => {
			await truffleAssert.reverts(
				stakingStateUSDC.unstake(deployerAccount, 1000, { from: deployerAccount })
			);
		});

		it('Successfully unstaked', async () => {
			await truffleAssert.passes(
				stakingStateUSDC.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});

		it('Not enough total stake amount', async () => {
			await truffleAssert.reverts(
				stakingStateUSDC.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('getStakeState', () => {
		it('get users stake state', async () => {
			await truffleAssert.passes(stakingStateUSDC.getStakeState(deployerAccount));
		});
	});

	describe('getTotalStake', () => {
		it('should return totalStake', async () => {
			await truffleAssert.passes(stakingStateUSDC.getTotalStake({ from: deployerAccount }));
		});
	});
});
