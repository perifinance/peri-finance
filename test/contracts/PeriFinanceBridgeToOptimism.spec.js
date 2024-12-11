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
} = require('../../');
const { artifacts } = require('hardhat');

contract('PeriFinanceBridgeToOptimism (spec tests) @ovm-skip', accounts => {
	const [, owner, newBridge] = accounts;

	let periFinance,
		periFinanceProxy,
		periFinanceBridgeToOptimism,

		systemSettings,
		rewardsDistribution;

	describe('when deploying the system', () => {
		before('deploy all contracts', async () => {
			({
				PeriFinance: periFinance,
				ProxyERC20PeriFinance: periFinanceProxy,
				PeriFinanceBridgeToOptimism: periFinanceBridgeToOptimism,
				SystemSettings: systemSettings,
				RewardsDistribution: rewardsDistribution,
			} = await setupAllContracts({
				accounts,
				pynths: ['pUSD', 'pBTC', 'pETH'],
				contracts: [
					'PeriFinance',
					'PeriFinanceBridgeToOptimism',
					'SystemSettings',
					'RewardsDistribution',
					'CrossChainManager'
				],
			}));

			// use implementation ABI on the proxy address to simplify calling
			periFinance = await artifacts.require('PeriFinance').at(periFinanceProxy.address);
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

		describe('depositTo', () => {
			const amountToDeposit = toBN(1);

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
					let contractBalanceBefore;

					before('record balances before', async () => {
						userBalanceBefore = await periFinance.balanceOf(owner);
						//contractBalanceBefore = await periFinance.balanceOf(periFinanceBridgeEscrow.address);
					});

					before('perform a deposit to a separate address', async () => {
						await periFinanceBridgeToOptimism.initiateDeposit(amountToDeposit, {
							from: owner,
						});
					});

					it('reduces the user balance', async () => {
						const userBalanceAfter = await periFinance.balanceOf(owner);

						assert.bnEqual(userBalanceBefore.sub(toBN(amountToDeposit)), userBalanceAfter);
					});

					// it("increases the escrow's balance", async () => {
					// 	assert.bnEqual(
					// 		await periFinance.balanceOf(periFinanceBridgeToOptimism.address),
					// 		contractBalanceBefore.add(amountToDeposit)
					// 	);
					// });
				});
			});
		});

		describe('initiateRewardDeposit', () => {
			describe('when a user has provided allowance to the bridge contract', () => {
				const amountToDeposit = toBN(1);

				before('approve PeriFinanceBridgeToOptimism', async () => {
					await periFinance.approve(periFinanceBridgeToOptimism.address, amountToDeposit, {
						from: owner,
					});
				});

				describe('when performing a deposit', () => {
					let userBalanceBefore;
					let contractBalanceBefore;

					before('record balance before', async () => {
						userBalanceBefore = await periFinance.balanceOf(owner);
						contractBalanceBefore = await periFinance.balanceOf(periFinanceBridgeToOptimism.address);

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
							contractBalanceBefore.add(amountToDeposit)
						);
					});
				});
			});
		});

		describe('notifyReward', () => {
			describe('the owner has added PeriFinanceBridgeToOptimism to rewards distributins list', () => {
				const amountToDistribute = toBN(1000);
				before('addRewardDistribution', async () => {
					await rewardsDistribution.addRewardDistribution(
						periFinanceBridgeToOptimism.address,
						amountToDistribute,
						{
							from: owner,
						}
					);
				});

				describe('distributing the rewards', () => {
					let bridgeBalanceBefore;
					let escrowBalanceBefore;

					before('record balance before', async () => {
						bridgeBalanceBefore = await periFinance.balanceOf(periFinanceBridgeToOptimism.address);
						//escrowBalanceBefore = await periFinance.balanceOf(periFinanceBridgeEscrow.address);
					});

					before('transfer amount to be distributed and distributeRewards', async () => {
						// first pawn the authority contract
						await rewardsDistribution.setAuthority(owner, {
							from: owner,
						});
						await periFinance.transfer(rewardsDistribution.address, amountToDistribute, {
							from: owner,
						});
						await rewardsDistribution.distributeRewards(amountToDistribute, {
							from: owner,
						});
					});

					it('the balance of the bridge remains intact', async () => {
						assert.bnEqual(
							await periFinance.balanceOf(periFinanceBridgeToOptimism.address),
							bridgeBalanceBefore
						);
					});

					// it("increases the escrow's balance", async () => {
					// 	assert.bnEqual(
					// 		await periFinance.balanceOf(periFinanceBridgeEscrow.address),
					// 		escrowBalanceBefore.add(amountToDistribute)
					// 	);
					// });
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
