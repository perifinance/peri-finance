const { contract, web3 } = require('hardhat');
const { setupAllContracts } = require('./setup');
const { assert } = require('./common');
const { toBN } = web3.utils;
const {
	defaults: {
		CROSS_DOMAIN_DEPOSIT_GAS_LIMIT,
		CROSS_DOMAIN_ESCROW_GAS_LIMIT,
		CROSS_DOMAIN_REWARD_GAS_LIMIT,
		CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT,
	},
} = require('../..');

contract('PeriFinanceBridgeToOptimism (spec tests)', accounts => {
	const [, owner, newBridge] = accounts;

	let periFinance, periFinanceBridgeToOptimism, systemSettings;

	describe.skip('when deploying the system', () => {
		before('deploy all contracts', async () => {
			({
				PeriFinance: periFinance,
				PeriFinanceBridgeToOptimism: periFinanceBridgeToOptimism,
				SystemSettings: systemSettings,
			} = await setupAllContracts({
				accounts,
				contracts: ['PeriFinance', 'Issuer', 'PeriFinanceBridgeToOptimism', 'StakingStateUSDC'],
			}));
		});

		it('returns the expected cross domain message gas limit', async () => {
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(0),
				CROSS_DOMAIN_DEPOSIT_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(1),
				CROSS_DOMAIN_ESCROW_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(2),
				CROSS_DOMAIN_REWARD_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(3),
				CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT
			);
		});

		describe('initiateEscrowMigration', () => {
			it('reverts when an entriesId subarray contains an empty array', async () => {
				const entryIdsEmpty = [[1, 2, 3], []];
				await assert.revert(
					periFinanceBridgeToOptimism.initiateEscrowMigration(entryIdsEmpty),
					'Entry IDs required'
				);
			});
		});

		describe('initiateEscrowMigration', () => {
			it('reverts when an entriesId subarray contains an empty array', async () => {
				const entryIdsEmpty = [[], [1, 2, 3]];
				await assert.revert(
					periFinanceBridgeToOptimism.depositAndMigrateEscrow(1, entryIdsEmpty),
					'Entry IDs required'
				);
			});
		});

		describe('initiateDeposit', () => {
			const amountToDeposit = 1;

			describe('when a user has not provided allowance to the bridge contract', () => {
				it('the deposit should fail', async () => {
					await assert.revert(
						periFinanceBridgeToOptimism.initiateDeposit(amountToDeposit, { from: owner }),
						'SafeMath: subtraction overflow'
					);
				});
			});

			describe('when a user has provided allowance to the bridge contract', () => {
				before('approve PeriFinanceBridgeToOptimism', async () => {
					await periFinance.approve(periFinanceBridgeToOptimism.address, amountToDeposit, {
						from: owner,
					});
				});

				describe('when performing a deposit', () => {
					let userBalanceBefore;

					before('record balance before', async () => {
						userBalanceBefore = await periFinance.balanceOf(owner);
					});

					before('perform a deposit', async () => {
						await periFinanceBridgeToOptimism.initiateDeposit(amountToDeposit, {
							from: owner,
						});
					});

					it('reduces the user balance', async () => {
						const userBalanceAfter = await periFinance.balanceOf(owner);

						assert.bnEqual(userBalanceBefore.sub(toBN(amountToDeposit)), userBalanceAfter);
					});

					it("increases the contract's balance", async () => {
						assert.bnEqual(
							await periFinance.balanceOf(periFinanceBridgeToOptimism.address),
							amountToDeposit
						);
					});
				});
			});
		});

		describe('initiateRewardDeposit', () => {
			describe('when a user has provided allowance to the bridge contract', () => {
				const amountToDeposit = 1;

				before('approve PeriFinanceBridgeToOptimism', async () => {
					await periFinance.approve(periFinanceBridgeToOptimism.address, amountToDeposit, {
						from: owner,
					});
				});

				describe('when performing a deposit', () => {
					let userBalanceBefore;

					before('record balance before', async () => {
						userBalanceBefore = await periFinance.balanceOf(owner);
					});

					before('perform a initiateRewardDeposit', async () => {
						await periFinanceBridgeToOptimism.initiateRewardDeposit(amountToDeposit, {
							from: owner,
						});
					});

					it('reduces the user balance', async () => {
						const userBalanceAfter = await periFinance.balanceOf(owner);

						assert.bnEqual(userBalanceBefore.sub(toBN(amountToDeposit)), userBalanceAfter);
					});

					it("increases the contract's balance", async () => {
						assert.bnEqual(
							await periFinance.balanceOf(periFinanceBridgeToOptimism.address),
							amountToDeposit * 2
						);
					});
				});
			});
		});

		describe('migrateBridge', () => {
			describe('when the owner migrates the bridge', () => {
				let bridgeBalance;

				before('record balance', async () => {
					bridgeBalance = await periFinance.balanceOf(periFinanceBridgeToOptimism.address);
				});

				before('migrate the bridge', async () => {
					await periFinanceBridgeToOptimism.migrateBridge(newBridge, {
						from: owner,
					});
				});

				it('transfers the whoel balacne to the new bridge', async () => {
					assert.bnEqual(await periFinance.balanceOf(periFinanceBridgeToOptimism.address), 0);
					assert.bnEqual(await periFinance.balanceOf(newBridge), bridgeBalance);
				});
			});
		});
	});
});
