'use strict';

const { contract } = require('hardhat');
const truffleAssert = require('truffle-assertions');
const { assert } = require('./common');

const {
	constants: { ZERO_ADDRESS },
} = require('../../.');

const { setupContract, setupAllContracts } = require('./setup');

contract('StakeStateUSDC', async accounts => {
	let stakeStateUSDC;
	const [deployerAccount, owner, account1, account2, account3] = accounts;

	before(async () => {
		stakeStateUSDC = await setupContract({
			accounts,
			contract: 'StakeStateUSDC',
			args: [owner, deployerAccount],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			assert.equal(owner, await stakeStateUSDC.owner());
			assert.isNotEmpty(await stakeStateUSDC.associatedContract());
		});
	});

	describe('stake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakeStateUSDC.stake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('expect successfully staked', async () => {
			await truffleAssert.passes(
				stakeStateUSDC.stake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('unstake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakeStateUSDC.unstake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('Exceeds staked amount', async () => {
			await truffleAssert.reverts(
				stakeStateUSDC.unstake(deployerAccount, 1000, { from: deployerAccount })
			);
		});

		it('Successfully unstaked', async () => {
			await truffleAssert.passes(
				stakeStateUSDC.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});

		it('Not enough total stake amount', async () => {
			await truffleAssert.reverts(
				stakeStateUSDC.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('getStakeState', () => {
		it('get users stake state', async () => {
			await truffleAssert.passes(stakeStateUSDC.getStakeState(deployerAccount));
		});
	});

	describe('getTotalStake', () => {
		it('should return totalStake', async () => {
			await truffleAssert.passes(stakeStateUSDC.getTotalStake({ from: deployerAccount }));
		});
	});
});
