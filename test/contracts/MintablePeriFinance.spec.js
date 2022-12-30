const { contract, web3 } = require('hardhat');
const { assert } = require('./common');
const { setupAllContracts } = require('./setup');
const { toWei } = web3.utils;
const { toBytes32 } = require('../..');
const BN = require('bn.js');

const PERIFINANCE_TOTAL_SUPPLY = toWei('100000000');

contract('MintablePeriFinance (spec tests)', accounts => {
	const [, owner, periFinanceBridgeToBase, account1] = accounts;

	let mintablePeriFinance;
	let addressResolver;
	let rewardsDistribution;
	let rewardEscrow;
	describe.skip('when system is setup', () => {
		before('deploy a new instance', async () => {
			({
				PeriFinance: mintablePeriFinance, // we request PeriFinance instead of MintablePeriFinance because it is renamed in setup.js
				AddressResolver: addressResolver,
				RewardsDistribution: rewardsDistribution,
				RewardEscrowV2: rewardEscrow,
			} = await setupAllContracts({
				accounts,
				contracts: [
					'AddressResolver',
					'MintablePeriFinance',
					'RewardsDistribution',
					'RewardEscrowV2',
					'StakingStateUSDC',
				],
			}));
			// update resolver
			await addressResolver.importAddresses(
				[toBytes32('PeriFinanceBridgeToBase')],
				[periFinanceBridgeToBase],
				{
					from: owner,
				}
			);
			// sync cache
			await mintablePeriFinance.rebuildCache();
		});

		describe('mintSecondary()', async () => {
			let mintSecondaryTx;
			const amount = 100;
			before('when PeriFinanceBridgeToBase calls mintSecondary()', async () => {
				mintSecondaryTx = await mintablePeriFinance.mintSecondary(account1, amount, {
					from: periFinanceBridgeToBase,
				});
			});

			it('should tranfer the tokens to the right account', async () => {
				assert.equal(await mintablePeriFinance.balanceOf(account1), amount);
			});

			it('should increase the total supply', async () => {
				const newSupply = new BN(PERIFINANCE_TOTAL_SUPPLY).add(new BN(amount));
				assert.bnEqual(await mintablePeriFinance.totalSupply(), newSupply);
			});

			it('should emit a Transfer event', async () => {
				assert.eventEqual(mintSecondaryTx, 'Transfer', {
					from: mintablePeriFinance.address,
					to: account1,
					value: amount,
				});
			});
		});

		describe('mintSecondaryRewards()', async () => {
			let mintSecondaryRewardsTx;
			const amount = 100;
			let currentSupply;
			before('record current supply', async () => {
				currentSupply = await mintablePeriFinance.totalSupply();
			});

			before('when PeriFinanceBridgeToBase calls mintSecondaryRewards()', async () => {
				mintSecondaryRewardsTx = await mintablePeriFinance.mintSecondaryRewards(amount, {
					from: periFinanceBridgeToBase,
				});
			});

			it('should tranfer the tokens initially to RewardsDistribution which  transfers them to RewardEscrowV2 (no distributions)', async () => {
				assert.equal(await mintablePeriFinance.balanceOf(rewardsDistribution.address), 0);
				assert.equal(await mintablePeriFinance.balanceOf(rewardEscrow.address), amount);
			});

			it('should increase the total supply', async () => {
				const newSupply = currentSupply.add(new BN(amount));
				assert.bnEqual(await mintablePeriFinance.totalSupply(), newSupply);
			});

			it('should emit a Transfer event', async () => {
				assert.eventEqual(mintSecondaryRewardsTx, 'Transfer', {
					from: mintablePeriFinance.address,
					to: rewardsDistribution.address,
					value: amount,
				});
			});
		});

		describe('burnSecondary()', async () => {
			let burnSecondaryTx;
			const amount = 100;
			let currentSupply;
			before('record current supply', async () => {
				currentSupply = await mintablePeriFinance.totalSupply();
			});

			before('when PeriFinanceBridgeToBase calls burnSecondary()', async () => {
				burnSecondaryTx = await mintablePeriFinance.burnSecondary(account1, amount, {
					from: periFinanceBridgeToBase,
				});
			});
			it('should tranfer the tokens to the right account', async () => {
				assert.equal(await mintablePeriFinance.balanceOf(account1), 0);
			});

			it('should decrease the total supply', async () => {
				const newSupply = currentSupply.sub(new BN(amount));
				assert.bnEqual(await mintablePeriFinance.totalSupply(), newSupply);
			});

			it('should emit a Transfer event', async () => {
				assert.eventEqual(burnSecondaryTx, 'Transfer', {
					from: account1,
					to: '0x0000000000000000000000000000000000000000',
					value: amount,
				});
			});
		});
	});
});
