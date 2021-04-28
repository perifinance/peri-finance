'use strict';

const { contract } = require('hardhat');
const truffleAssert = require('truffle-assertions');
const { assert } = require('./common');

const {
	constants: { ZERO_ADDRESS },
} = require('../..');

const { setupContract, setupAllContracts } = require('./setup');

contract('StakeStateUsdc', async accounts => {
	let stakeStateUsdc;
	const [deployerAccount, owner, account1, account2, account3] = accounts;

	before(async () => {
		stakeStateUsdc = await setupContract({
			accounts,
			contract: 'StakeStateUsdc',
			args: [owner, deployerAccount],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			assert.equal(owner, await stakeStateUsdc.owner());
			assert.isNotEmpty(await stakeStateUsdc.associatedContract());
		});
	});

	describe('stake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakeStateUsdc.stake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('expect successfully staked', async () => {
			await truffleAssert.passes(
				stakeStateUsdc.stake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('unstake', () => {
		it('Zero address is not allowed', async () => {
			await truffleAssert.reverts(
				stakeStateUsdc.unstake(ZERO_ADDRESS, 100, { from: deployerAccount })
			);
		});

		it('Exceeds staked amount', async () => {
			await truffleAssert.reverts(
				stakeStateUsdc.unstake(deployerAccount, 1000, { from: deployerAccount })
			);
		});

		it('Successfully unstaked', async () => {
			await truffleAssert.passes(
				stakeStateUsdc.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});

		it('Not enough total stake amount', async () => {
			await truffleAssert.reverts(
				stakeStateUsdc.unstake(deployerAccount, 100, { from: deployerAccount })
			);
		});
	});

	describe('getStakeState', () => {
		it('get users stake state', async () => {
			await truffleAssert.passes(stakeStateUsdc.getStakeState(deployerAccount));
		});
	});

	describe('getTotalStake', () => {
		it('should return totalStake', async () => {
			await truffleAssert.passes(stakeStateUsdc.getTotalStake({ from: deployerAccount }));
		});
	});
});
