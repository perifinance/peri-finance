'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, setupContract } = require('./setup');

const { currentTime, multiplyDecimal, divideDecimal, toUnit, fastForward } = require('../utils')();

const { ensureOnlyExpectedMutativeFunctions, setStatus } = require('./helpers');

const {
	toBytes32,
	defaults: { ISSUANCE_RATIO, LIQUIDATION_DELAY, LIQUIDATION_PENALTY, LIQUIDATION_RATIO },
} = require('../..');

// const LIQUIDATION_RATIO = toUnit('0.66666666666666');

const MockExchanger = artifacts.require('MockExchanger');
const FlexibleStorage = artifacts.require('FlexibleStorage');

contract('Liquidations', accounts => {
	const [pUSD, PERI, USDC, DAI] = ['pUSD', 'PERI', 'USDC', 'DAI'].map(toBytes32);
	const [deployerAccount, owner, oracle, account1, alice, bob, carol, david] = accounts;
	const week = 3600 * 24 * 7;
	const pUSD100 = toUnit('100');

	let addressResolver,
		exchangeRates,
		liquidations,
		pUSDContract,
		periFinance,
		periFinanceState,
		systemSettings,
		systemStatus,
		feePoolState,
		debtCache,
		issuer,
		timestamp;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			AddressResolver: addressResolver,
			ExchangeRates: exchangeRates,
			Liquidations: liquidations,
			PynthpUSD: pUSDContract,
			PeriFinance: periFinance,
			PeriFinanceState: periFinanceState,
			SystemSettings: systemSettings,
			SystemStatus: systemStatus,
			FeePoolState: feePoolState,
			DebtCache: debtCache,
			Issuer: issuer,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD'],
			contracts: [
				'AddressResolver',
				'ExchangeRates',
				'Exchanger', // required for PeriFinance to check if exchanger().hasWaitingPeriodOrSettlementOwing
				'FeePool',
				'FeePoolState', // required for checking issuance data appended
				'DebtCache',
				'Issuer',
				'Liquidations',
				'SystemStatus', // test system status controls
				'SystemSettings',
				'PeriFinance',
				'PeriFinanceState',
				'CollateralManager',
				'RewardEscrowV2', // required for Issuer._collateral() to load balances
				'StakingState',
				'CrossChainManager',
			],
		}));

		await systemSettings.setLiquidationRatio(LIQUIDATION_RATIO, { from: owner });
	});

	addSnapshotBeforeRestoreAfterEach();

	const fastForwardAndUpdateRates = async seconds => {
		await fastForward(seconds);
		await updateRatesWithDefaults();
	};

	const updateRatesWithDefaults = async () => {
		timestamp = await currentTime();
		// PERI is 6 dolla
		await updatePERIPrice('6');
		await updateUSDCPrice('1');
	};

	const updatePERIPrice = async rate => {
		timestamp = await currentTime();
		await exchangeRates.updateRates([PERI], [rate].map(toUnit), timestamp, {
			from: oracle,
		});
		await debtCache.takeDebtSnapshot();
	};

	const updateUSDCPrice = async rate => {
		timestamp = await currentTime();
		await exchangeRates.updateRates([USDC, DAI], [rate, rate].map(toUnit), timestamp, {
			from: oracle,
		});
		await debtCache.takeDebtSnapshot();
	};

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: liquidations.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'liquidateAccount',
				'flagAccountForLiquidation',
				'removeAccountInLiquidation',
				'checkAndRemoveAccountInLiquidation',
			],
		});
	});

	it('should set constructor params on deployment', async () => {
		const instance = await setupContract({
			contract: 'Liquidations',
			accounts,
			skipPostDeploy: true,
			args: [account1, addressResolver.address],
		});

		assert.equal(await instance.owner(), account1);
		assert.equal(await instance.resolver(), addressResolver.address);
	});

	describe('Default settings', () => {
		it('liquidation (issuance) ratio', async () => {
			const liquidationRatio = await liquidations.liquidationRatio();
			assert.bnEqual(liquidationRatio, LIQUIDATION_RATIO);
		});
		it('liquidation collateral ratio is inverted ratio', async () => {
			const liquidationCollateralRatio = await liquidations.liquidationCollateralRatio();
			assert.bnClose(liquidationCollateralRatio, divideDecimal(toUnit('1'), LIQUIDATION_RATIO), 10);
		});
		it('liquidation penalty ', async () => {
			const liquidationPenalty = await liquidations.liquidationPenalty();
			assert.bnEqual(liquidationPenalty, LIQUIDATION_PENALTY);
		});
		it('liquidation delay', async () => {
			const liquidationDelay = await liquidations.liquidationDelay();
			assert.bnEqual(liquidationDelay, LIQUIDATION_DELAY);
		});
		it('issuance ratio is correctly configured as a default', async () => {
			assert.bnEqual(await liquidations.issuanceRatio(), ISSUANCE_RATIO);
		});
	});

	describe('with issuanceRatio of 0.125', () => {
		beforeEach(async () => {
			// Set issuanceRatio to 800%
			const issuanceRatio800 = toUnit('0.125');
			await systemSettings.setIssuanceRatio(issuanceRatio800, { from: owner });

			await updateRatesWithDefaults();
		});
		describe('system staleness checks', () => {
			describe('when PERI is stale', () => {
				beforeEach(async () => {
					const rateStalePeriod = await exchangeRates.rateStalePeriod();

					// fast forward until rates are stale
					await fastForward(rateStalePeriod + 1);
				});
				it('when flagAccountForLiquidation() is invoked, it reverts for rate stale', async () => {
					await assert.revert(
						liquidations.flagAccountForLiquidation(alice, { from: owner }),
						'Rate invalid or not a pynth'
					);
				});
				it('when checkAndRemoveAccountInLiquidation() is invoked, it reverts for rate stale', async () => {
					await assert.revert(
						liquidations.checkAndRemoveAccountInLiquidation(alice, { from: owner }),
						'Rate invalid or not a pynth'
					);
				});
			});
			describe('when the system is suspended', () => {
				beforeEach(async () => {
					await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				});
				it('when liquidateDelinquentAccount() is invoked, it reverts with operation prohibited', async () => {
					await assert.revert(
						periFinance.liquidateDelinquentAccount(alice, toUnit('10'), { from: owner }),
						'Operation prohibited'
					);
				});
				it('when checkAndRemoveAccountInLiquidation() is invoked, it reverts with operation prohibited', async () => {
					await assert.revert(
						liquidations.checkAndRemoveAccountInLiquidation(alice, { from: owner }),
						'Operation prohibited'
					);
				});
			});
			describe('when the liquidation default params not set', () => {
				let storage;
				beforeEach(async () => {
					storage = await FlexibleStorage.new(addressResolver.address, {
						from: deployerAccount,
					});

					// replace FlexibleStorage in resolver
					await addressResolver.importAddresses(
						['FlexibleStorage'].map(toBytes32),
						[storage.address],
						{
							from: owner,
						}
					);

					await liquidations.rebuildCache();
					await systemSettings.rebuildCache();
				});
				it('when flagAccountForLiquidation() is invoked, it reverts with liquidation ratio not set', async () => {
					await assert.revert(
						liquidations.flagAccountForLiquidation(alice, { from: owner }),
						'Liquidation ratio not set'
					);
				});
				describe('when the liquidationRatio is set', () => {
					beforeEach(async () => {
						// await systemSettings.setIssuanceRatio(ISSUANCE_RATIO, { from: owner });
						await systemSettings.setLiquidationRatio(LIQUIDATION_RATIO, { from: owner });
					});
					it('when flagAccountForLiquidation() is invoked, it reverts with liquidation delay not set', async () => {
						await assert.revert(
							liquidations.flagAccountForLiquidation(alice, { from: owner }),
							'Liquidation delay not set'
						);
					});
				});
			});
		});
		describe('protected methods', () => {
			describe('only internal contracts can call', () => {
				beforeEach(async () => {
					// Overwrite Issuer address to the owner to allow us to invoke removeAccInLiquidation
					await addressResolver.importAddresses(['Issuer'].map(toBytes32), [owner], {
						from: owner,
					});

					// now have Liquidations resync its cache
					await liquidations.rebuildCache();
				});
				// it('removeAccountInLiquidation() can only be invoked by issuer', async () => {
				// 	await onlyGivenAddressCanInvoke({
				// 		fnc: liquidations.removeAccountInLiquidation,
				// 		args: [alice],
				// 		address: owner, // TODO: is this supposed to be issuer.address
				// 		accounts,
				// 		reason: 'Liquidations: Only the Issuer contract can perform this action',
				// 	});
				// });
			});
		});
		describe('calculateAmountToFixCollateral', () => {
			let ratio;
			let penalty;
			let collateralBefore;
			let debtBefore;
			describe('given target ratio of 800%, collateral of $600, debt of $300', () => {
				beforeEach(async () => {
					ratio = toUnit('0.125');

					await systemSettings.setIssuanceRatio(ratio, { from: owner });

					collateralBefore = toUnit('600');
					debtBefore = toUnit('300');
				});
				describe('given liquidation penalty is 10%', () => {
					beforeEach(async () => {
						penalty = toUnit('0.1');
						await systemSettings.setLiquidationPenalty(penalty, { from: owner });
					});
					it('calculates pUSD to fix ratio from 200%, with $600 PERI collateral and $300 debt', async () => {
						const expectedAmount = toUnit('260.869565217391304347');

						// amount of debt to redeem to fix
						const pUSDToLiquidate = await liquidations.calculateAmountToFixCollateral(
							debtBefore,
							collateralBefore
						);

						assert.bnEqual(pUSDToLiquidate, expectedAmount);

						// check expected amount fixes c-ratio to 800%
						const debtAfter = debtBefore.sub(pUSDToLiquidate);
						const collateralAfterMinusPenalty = collateralBefore.sub(
							multiplyDecimal(pUSDToLiquidate, toUnit('1').add(penalty))
						);

						// c-ratio = debt / collateral
						const collateralRatio = divideDecimal(debtAfter, collateralAfterMinusPenalty);

						assert.bnEqual(collateralRatio, ratio);
					});
					it('calculates pUSD to fix ratio from 300%, with $600 PERI collateral and $200 debt', async () => {
						debtBefore = toUnit('200');
						const expectedAmount = toUnit('144.927536231884057971');

						// amount of debt to redeem to fix
						const pUSDToLiquidate = await liquidations.calculateAmountToFixCollateral(
							debtBefore,
							collateralBefore
						);

						assert.bnEqual(pUSDToLiquidate, expectedAmount);

						// check expected amount fixes c-ratio to 800%
						const debtAfter = debtBefore.sub(pUSDToLiquidate);
						const collateralAfterMinusPenalty = collateralBefore.sub(
							multiplyDecimal(pUSDToLiquidate, toUnit('1').add(penalty))
						);

						// c-ratio = debt / collateral
						const collateralRatio = divideDecimal(debtAfter, collateralAfterMinusPenalty);

						assert.bnEqual(collateralRatio, ratio);
					});
				});
			});
		});
		describe('when anyone calls liquidateDelinquentAccount on alice', () => {
			let exchanger;
			describe('then do liquidation checks', () => {
				beforeEach(async () => {
					exchanger = await MockExchanger.new(issuer.address);
					await addressResolver.importAddresses(['Exchanger'].map(toBytes32), [exchanger.address], {
						from: owner,
					});
					await Promise.all([periFinance.rebuildCache(), issuer.rebuildCache()]);
				});

				it('when a liquidator has SettlementOwing from hasWaitingPeriodOrSettlementOwing then revert', async () => {
					// Setup Bob with a settlement oweing
					await exchanger.setReclaim(pUSD100);
					await exchanger.setNumEntries(1);

					await assert.revert(
						periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: bob }),
						'pUSD needs to be settled'
					);
				});
				it('when a liquidator has hasWaitingPeriod from hasWaitingPeriodOrSettlementOwing then revert', async () => {
					// Setup Bob with a waiting period
					await exchanger.setMaxSecsLeft(180);
					await exchanger.setNumEntries(1);
					await assert.revert(
						periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: bob }),
						'pUSD needs to be settled'
					);
				});
				it('when an account is not isOpenForLiquidation then revert', async () => {
					await assert.revert(
						periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: bob }),
						'Account not open for liquidation'
					);
				});
			});
			describe('when Alice is undercollateralized', () => {
				beforeEach(async () => {
					// wen PERI 6 dolla
					await updatePERIPrice('6');

					// Alice issues pUSD $600
					await periFinance.transfer(alice, toUnit('800'), { from: owner });
					await periFinance.issueMaxPynths({ from: alice });

					// Drop PERI value to $1 (Collateral worth $800 after)
					await updatePERIPrice('1');
				});
				it('and liquidation Collateral Ratio is 150%', async () => {
					assert.bnClose(await liquidations.liquidationCollateralRatio(), toUnit('1.5'), 10);
				});
				it('and liquidation penalty is 10%', async () => {
					assert.bnEqual(await liquidations.liquidationPenalty(), LIQUIDATION_PENALTY);
				});
				it('and liquidation delay is 1 days', async () => {
					assert.bnEqual(await liquidations.liquidationDelay(), LIQUIDATION_DELAY);
				});
				describe('when Alice has not been flagged for liquidation', () => {
					it('and Alice calls checkAndRemoveAccountInLiquidation then it reverts', async () => {
						await assert.revert(
							liquidations.checkAndRemoveAccountInLiquidation(alice, {
								from: alice,
							}),
							'Account has no liquidation set'
						);
					});
					it('then isLiquidationDeadlinePassed returns false as no liquidation set', async () => {
						assert.isFalse(await liquidations.isLiquidationDeadlinePassed(alice));
					});
				});
				describe('when Bob flags Alice for liquidation', () => {
					let flagForLiquidationTransaction;
					let timeOfTransaction;
					beforeEach(async () => {
						timeOfTransaction = await currentTime();
						flagForLiquidationTransaction = await liquidations.flagAccountForLiquidation(alice, {
							from: bob,
						});
					});
					it('then sets a deadline liquidation delay of 2 weeks', async () => {
						const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(alice);
						assert.isTrue(liquidationDeadline.gt(0));
						assert.isTrue(liquidationDeadline.gt(timeOfTransaction));
						assert.isTrue(liquidationDeadline.gt(timeOfTransaction + week * 2));
					});
					it('then emits an event accountFlaggedForLiquidation', async () => {
						const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(alice);
						assert.eventEqual(flagForLiquidationTransaction, 'AccountFlaggedForLiquidation', {
							account: alice,
							deadline: liquidationDeadline,
						});
					});
					describe('when deadline has passed and Alice issuance ratio is fixed as PERI price increases', () => {
						beforeEach(async () => {
							const delay = await liquidations.liquidationDelay();

							// fast forward to after deadline
							await fastForward(delay + 100);

							await updatePERIPrice(toUnit('6'));

							const liquidationRatio = await liquidations.liquidationRatio();

							const ratio = await periFinance.collateralisationRatio(alice);
							const targetIssuanceRatio = await liquidations.issuanceRatio();

							// check Alice ratio is below liquidation ratio
							assert.isTrue(ratio.lt(liquidationRatio));

							// check Alice ratio is below or equal to target issuance ratio
							assert.isTrue(ratio.lte(targetIssuanceRatio));
						});
						it('then isLiquidationDeadlinePassed returns true', async () => {
							assert.isTrue(await liquidations.isLiquidationDeadlinePassed(alice));
						});
						it('then isOpenForLiquidation returns false as ratio equal to target issuance ratio', async () => {
							assert.isFalse(await liquidations.isOpenForLiquidation(alice));
						});
					});
					describe('given Alice issuance ratio is higher than the liquidation ratio', () => {
						let liquidationRatio;
						beforeEach(async () => {
							liquidationRatio = await liquidations.liquidationRatio();

							const ratio = await periFinance.collateralisationRatio(alice);
							const targetIssuanceRatio = await liquidations.issuanceRatio();

							// check Alice ratio is above or equal liquidation ratio
							assert.isTrue(ratio.gte(liquidationRatio));

							// check Alice ratio is above target issuance ratio
							assert.isTrue(ratio.gt(targetIssuanceRatio));
						});
						describe('when the liquidation deadline has not passed', () => {
							it('then isOpenForLiquidation returns false as deadline not passed', async () => {
								assert.isFalse(await liquidations.isOpenForLiquidation(alice));
							});
							it('then isLiquidationDeadlinePassed returns false', async () => {
								assert.isFalse(await liquidations.isLiquidationDeadlinePassed(alice));
							});
						});
						describe('fast forward 2 weeks, when the liquidation deadline has passed', () => {
							beforeEach(async () => {
								const delay = await liquidations.liquidationDelay();

								await fastForward(delay + 100);
							});
							it('then isLiquidationDeadlinePassed returns true', async () => {
								assert.isTrue(await liquidations.isLiquidationDeadlinePassed(alice));
							});
							it('then isOpenForLiquidation returns true', async () => {
								assert.isTrue(await liquidations.isOpenForLiquidation(alice));
							});
						});
					});
					describe('when Bob or anyone else tries to flag Alice address for liquidation again', () => {
						it('then it fails for Bob as Alices address is already flagged', async () => {
							await assert.revert(
								liquidations.flagAccountForLiquidation(alice, {
									from: bob,
								}),
								'Account already flagged for liquidation'
							);
						});
						it('then it fails for Carol Baskin as Alices address is already flagged', async () => {
							await assert.revert(
								liquidations.flagAccountForLiquidation(alice, {
									from: carol,
								}),
								'Account already flagged for liquidation'
							);
						});
					});
					describe('when the price of PERI increases', () => {
						let removeFlagTransaction;
						beforeEach(async () => {
							await updatePERIPrice('6');
						});
						describe('when Alice calls checkAndRemoveAccountInLiquidation', () => {
							beforeEach(async () => {
								removeFlagTransaction = await liquidations.checkAndRemoveAccountInLiquidation(
									alice,
									{
										from: alice,
									}
								);
							});
							it('then Alice liquidation entry is removed', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.bnEqual(deadline, 0);
							});
							it('then Alices account is not open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.bnEqual(isOpenForLiquidation, false);
							});
							it('then events AccountRemovedFromLiquidation are emitted', async () => {
								assert.eventEqual(removeFlagTransaction, 'AccountRemovedFromLiquidation', {
									account: alice,
								});
							});
						});
					});
					describe('given the liquidation deadline has passed ', () => {
						beforeEach(async () => {
							await fastForwardAndUpdateRates(week * 2.1);
						});
						describe('when Alice c-ratio is above the liquidation Ratio and Bob liquidates alice', () => {
							beforeEach(async () => {
								await updatePERIPrice('10');

								// Get Bob some pUSD
								await pUSDContract.issue(bob, pUSD100, {
									from: owner,
								});
								await debtCache.takeDebtSnapshot();

								// Bob Liquidates Alice
								await assert.revert(
									periFinance.liquidateDelinquentAccount(alice, pUSD100, {
										from: bob,
									}),
									'Account not open for liquidation'
								);
							});
							it('then Alice liquidation entry remains', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.isTrue(deadline > 0);
							});
							it('then Alices account is not open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.bnEqual(isOpenForLiquidation, false);
							});
							it('then Bob still has 100pUSD', async () => {
								assert.bnEqual(await pUSDContract.balanceOf(bob), pUSD100);
							});
							it('then Bob still has 0 PERI', async () => {
								assert.bnEqual(await periFinance.balanceOf(bob), 0);
							});
							it('then Alice still has 800 PERI', async () => {
								assert.bnEqual(await periFinance.collateral(alice), toUnit('800'));
							});
						});

						describe('when Alice burnPynthsToTarget to fix her c-ratio ', () => {
							let burnTransaction;
							beforeEach(async () => {
								await updatePERIPrice('1');
								burnTransaction = await periFinance.fitToClaimable({
									from: alice,
								});
							});
							// TODO: AccountRemovedFromLiquidation is emitted off the Liquidations contract
							xit('then AccountRemovedFromLiquidation event is emitted', async () => {
								assert.eventEqual(burnTransaction, 'AccountRemovedFromLiquidation', {
									account: alice,
								});
							});
							it('then Alice liquidation entry is removed', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.bnEqual(deadline, 0);
							});
							it('then Alices account is not open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.bnEqual(isOpenForLiquidation, false);
							});
						});
						describe('when Alice burnPynths and her c-ratio is still below issuance ratio', () => {
							let aliceDebtBalance;
							let amountToBurn;
							beforeEach(async () => {
								await updatePERIPrice('1');
								aliceDebtBalance = await periFinance.debtBalanceOf(alice, pUSD);
								amountToBurn = toUnit('10');
								await periFinance.burnPynths(PERI, amountToBurn, { from: alice });
							});
							it('then alice debt balance is less amountToBurn', async () => {
								assert.bnEqual(
									await periFinance.debtBalanceOf(alice, pUSD),
									aliceDebtBalance.sub(amountToBurn)
								);
							});
							it('then Alice liquidation entry is still there', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.isTrue(deadline > 0);
							});
							it('then Alices account is still open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.isTrue(isOpenForLiquidation);
							});
						});
						describe('when Alice burnPynths and her c-ratio is above issuance ratio', () => {
							let aliceDebtBalance;
							let amountToBurn;
							beforeEach(async () => {
								await updatePERIPrice('1');
								aliceDebtBalance = await periFinance.debtBalanceOf(alice, pUSD);

								const maxIssuablePynths = await issuer.maxIssuablePynths(alice);
								amountToBurn = aliceDebtBalance.sub(maxIssuablePynths).abs();

								await periFinance.burnPynths(PERI, amountToBurn, { from: alice });
							});
							it('then alice debt balance is less amountToBurn', async () => {
								assert.bnEqual(
									await periFinance.debtBalanceOf(alice, pUSD),
									aliceDebtBalance.sub(amountToBurn)
								);
							});
							it('then Alice liquidation entry is removed', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.bnEqual(deadline, 0);
							});
							it('then Alices account is not open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.bnEqual(isOpenForLiquidation, false);
							});
						});
						describe('when Alice burns all her debt to fix her c-ratio', () => {
							let aliceDebtBalance;
							let burnTransaction;
							beforeEach(async () => {
								await updatePERIPrice('1');
								await updateUSDCPrice('1');

								aliceDebtBalance = await periFinance.debtBalanceOf(alice, pUSD);

								burnTransaction = await periFinance.burnPynths(PERI, aliceDebtBalance, {
									from: alice,
								});
							});
							it('then alice has no more debt', async () => {
								assert.bnEqual(toUnit(0), await periFinance.debtBalanceOf(alice, pUSD));
							});
							xit('then AccountRemovedFromLiquidation event is emitted', async () => {
								assert.eventEqual(burnTransaction, 'AccountRemovedFromLiquidation', {
									account: alice,
								});
							});
							it('then Alice liquidation entry is removed', async () => {
								const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
								assert.bnEqual(deadline, 0);
							});
							it('then Alices account is not open for liquidation', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.bnEqual(isOpenForLiquidation, false);
							});
						});
						describe('when Alice does not fix her c-ratio ', () => {
							beforeEach(async () => {
								await updatePERIPrice('1');
							});
							it('then isOpenForLiquidation returns true for Alice', async () => {
								const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
								assert.equal(isOpenForLiquidation, true);
							});
							it('when carol calls liquidateDelinquentAccount but has 0 pUSD then revert', async () => {
								assert.bnEqual(await pUSDContract.balanceOf(carol), 0);

								await assert.revert(
									periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: carol }),
									'Not enough pUSD'
								);
							});
							describe('when Bobs liquidates alice for 100 pUSD but only has 99 pUSD then revert', async () => {
								const pUSD99 = toUnit('99');
								beforeEach(async () => {
									// send bob some PERI
									await periFinance.transfer(bob, toUnit('10000'), {
										from: owner,
									});

									await periFinance.issuePynths(PERI, pUSD99, { from: bob });

									assert.bnEqual(await pUSDContract.balanceOf(bob), pUSD99);
								});

								it('it should revert', async () => {
									await assert.revert(
										periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: bob }),
										'Not enough pUSD'
									);
								});
							});
							describe('when Alice calls checkAndRemoveAccountInLiquidation', () => {
								beforeEach(async () => {
									await liquidations.checkAndRemoveAccountInLiquidation(alice, {
										from: alice,
									});
								});
								it('then Alices account is still open for liquidation', async () => {
									const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
									assert.bnEqual(isOpenForLiquidation, true);
								});
								it('then Alice liquidation deadline still exists', async () => {
									const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
									assert.notEqual(deadline, 0);
								});
							});
							describe('when Bob liquidates alice for 100 pUSD to get 110 PERI', () => {
								const PERI110 = toUnit('110');
								let aliceDebtBefore;
								let alicePERIBefore;
								let bobPERIBefore;
								beforeEach(async () => {
									// send bob some PERI
									await periFinance.transfer(bob, toUnit('1000'), {
										from: owner,
									});

									await periFinance.issuePynths(PERI, pUSD100, { from: bob });

									assert.bnEqual(await pUSDContract.balanceOf(bob), pUSD100);

									// Record Alices state
									aliceDebtBefore = await periFinance.debtBalanceOf(alice, pUSD);
									alicePERIBefore = await periFinance.collateral(alice);

									// Record Bob's state
									bobPERIBefore = await periFinance.balanceOf(bob);

									// Bob Liquidates Alice
									await periFinance.liquidateDelinquentAccount(alice, pUSD100, { from: bob });
								});
								it('then Bob pUSD balance is reduced by 100 pUSD', async () => {
									assert.bnEqual(await pUSDContract.balanceOf(bob), 0);
								});
								it('then Alice debt is reduced by 100 pUSD', async () => {
									const aliceDebtAfter = await periFinance.debtBalanceOf(alice, pUSD);
									const difference = aliceDebtBefore.sub(aliceDebtAfter);
									assert.bnEqual(difference, pUSD100);
								});
								it('then Alice has less PERI + penalty', async () => {
									const alicePERIAfter = await periFinance.collateral(alice);
									const difference = alicePERIBefore.sub(alicePERIAfter);
									assert.bnEqual(difference, PERI110);
								});
								it('then Bob has extra 100 PERI + the 10 PERI penalty (110)', async () => {
									const periBalance = await periFinance.balanceOf(bob);
									assert.bnEqual(periBalance, bobPERIBefore.add(PERI110));
								});
								it('then Alice PERI balance is 690', async () => {
									const alicePERIAfter = await periFinance.collateral(alice);
									assert.bnEqual(alicePERIAfter, toUnit('690'));
								});
								it('then Alice issuance ratio is updated in feePoolState', async () => {
									const accountsDebtEntry = await feePoolState.getAccountsDebtEntry(alice, 0);
									const issuanceState = await periFinanceState.issuanceData(alice);

									assert.bnEqual(
										issuanceState.initialDebtOwnership,
										accountsDebtEntry.debtPercentage
									);

									assert.bnEqual(issuanceState.debtEntryIndex, accountsDebtEntry.debtEntryIndex);
								});
								describe('given carol has obtained pUSD to liquidate alice', () => {
									const pUSD5 = toUnit('5');
									const pUSD50 = toUnit('50');
									const PERI55 = toUnit('55');
									let carolPERIBefore;
									beforeEach(async () => {
										// send Carol some PERI for pUSD
										await periFinance.transfer(carol, toUnit('1000'), {
											from: owner,
										});

										await periFinance.issuePynths(PERI, pUSD50, { from: carol });
										assert.bnEqual(await pUSDContract.balanceOf(carol), pUSD50);

										// Record Alices state
										aliceDebtBefore = await periFinance.debtBalanceOf(alice, pUSD);
										alicePERIBefore = await periFinance.collateral(alice);

										// Record Carol State
										carolPERIBefore = await periFinance.balanceOf(carol);
									});
									describe('when carol liquidates Alice with 10 x 5 pUSD', () => {
										beforeEach(async () => {
											for (let i = 0; i < 10; i++) {
												await periFinance.liquidateDelinquentAccount(alice, pUSD5, { from: carol });
											}
										});
										it('then Carols pUSD balance is reduced by 50 pUSD', async () => {
											assert.bnEqual(await pUSDContract.balanceOf(carol), 0);
										});
										it('then Alice debt is reduced by 50 pUSD', async () => {
											const aliceDebtAfter = await periFinance.debtBalanceOf(alice, pUSD);
											const difference = aliceDebtBefore.sub(aliceDebtAfter);
											assert.bnEqual(difference, pUSD50);
										});
										it('then Alice has less PERI + penalty', async () => {
											const alicePERIAfter = await periFinance.collateral(alice);
											const difference = alicePERIBefore.sub(alicePERIAfter);
											assert.bnEqual(difference, PERI55);
										});
										it('then Carol has extra 50 PERI + the 5 PERI penalty (55)', async () => {
											const periBalance = await periFinance.balanceOf(carol);
											assert.bnEqual(periBalance, carolPERIBefore.add(PERI55));
										});
										it('then Alice PERI balance is 635', async () => {
											const alicePERIAfter = await periFinance.collateral(alice);
											assert.bnEqual(alicePERIAfter, toUnit('635'));
										});
										it('then Alice issuance ratio is updated in feePoolState', async () => {
											const accountsDebtEntry = await feePoolState.getAccountsDebtEntry(alice, 0);
											const issuanceState = await periFinanceState.issuanceData(alice);

											assert.bnEqual(
												issuanceState.initialDebtOwnership,
												accountsDebtEntry.debtPercentage
											);

											assert.bnEqual(
												issuanceState.debtEntryIndex,
												accountsDebtEntry.debtEntryIndex
											);
										});
									});
									describe('when carol liquidates Alice with 50 pUSD', () => {
										let liquidationTransaction;
										beforeEach(async () => {
											liquidationTransaction = await periFinance.liquidateDelinquentAccount(
												alice,
												pUSD50,
												{ from: carol }
											);
										});
										it('then Carols pUSD balance is reduced by 50 pUSD', async () => {
											assert.bnEqual(await pUSDContract.balanceOf(carol), 0);
										});
										it('then Alice debt is reduced by 50 pUSD', async () => {
											const aliceDebtAfter = await periFinance.debtBalanceOf(alice, pUSD);
											const difference = aliceDebtBefore.sub(aliceDebtAfter);
											assert.bnEqual(difference, pUSD50);
										});
										it('then Alice has less PERI + penalty', async () => {
											const alicePERIAfter = await periFinance.collateral(alice);
											const difference = alicePERIBefore.sub(alicePERIAfter);
											assert.bnEqual(difference, PERI55);
										});
										it('then Carol has extra 50 PERI + the 5 PERI penalty (55)', async () => {
											const periBalance = await periFinance.balanceOf(carol);
											assert.bnEqual(periBalance, carolPERIBefore.add(PERI55));
										});
										it('then Alice PERI balance is 635', async () => {
											const alicePERIAfter = await periFinance.collateral(alice);
											assert.bnEqual(alicePERIAfter, toUnit('635'));
										});
										it('then Alice issuance ratio is updated in feePoolState', async () => {
											const accountsDebtEntry = await feePoolState.getAccountsDebtEntry(alice, 0);
											const issuanceState = await periFinanceState.issuanceData(alice);

											assert.bnEqual(
												issuanceState.initialDebtOwnership,
												accountsDebtEntry.debtPercentage
											);

											assert.bnEqual(
												issuanceState.debtEntryIndex,
												accountsDebtEntry.debtEntryIndex
											);
										});
										it('then events AccountLiquidated are emitted', async () => {
											assert.eventEqual(liquidationTransaction, 'AccountLiquidated', {
												account: alice,
												periRedeemed: PERI55,
												amountLiquidated: pUSD50,
												liquidator: carol,
											});
										});
										describe('when Bob liqudates Alice with 1000 pUSD', () => {
											const pUSD1000 = toUnit('1000');
											let liquidationTransaction;
											let bobPynthBalanceBefore;
											beforeEach(async () => {
												// send Bob some PERI for pUSD
												await periFinance.transfer(bob, toUnit('10000'), {
													from: owner,
												});

												await periFinance.issuePynths(PERI, pUSD1000, { from: bob });

												bobPynthBalanceBefore = await pUSDContract.balanceOf(bob);
												assert.bnEqual(bobPynthBalanceBefore, pUSD1000);

												// Record Alices state
												aliceDebtBefore = await periFinance.debtBalanceOf(alice, pUSD);
												alicePERIBefore = await periFinance.collateral(alice);

												// Bob Liquidates Alice
												liquidationTransaction = await periFinance.liquidateDelinquentAccount(
													alice,
													pUSD1000,
													{
														from: bob,
													}
												);
											});
											it('then Bobs partially liquidates the 1000 pUSD to repair Alice to target issuance ratio', async () => {
												const susdToFixRatio = await liquidations.calculateAmountToFixCollateral(
													aliceDebtBefore,
													alicePERIBefore
												);

												const aliceDebtAfter = await periFinance.debtBalanceOf(alice, pUSD);
												assert.bnEqual(aliceDebtAfter, aliceDebtBefore.sub(susdToFixRatio));

												const bobPynthBalanceAfter = await pUSDContract.balanceOf(bob);
												assert.bnEqual(
													bobPynthBalanceAfter,
													bobPynthBalanceBefore.sub(susdToFixRatio)
												);
											});
											it('then Alice liquidation entry is removed', async () => {
												const deadline = await liquidations.getLiquidationDeadlineForAccount(alice);
												assert.bnEqual(deadline, 0);
											});
											it('then Alices account is not open for liquidation', async () => {
												const isOpenForLiquidation = await liquidations.isOpenForLiquidation(alice);
												assert.bnEqual(isOpenForLiquidation, false);
											});
											it('then events AccountLiquidated & AccountRemovedFromLiquidation are emitted', async () => {
												assert.eventsEqual(
													liquidationTransaction,
													'AccountLiquidated',
													{
														account: alice,
													},
													'Transfer',
													{
														from: alice,
														to: bob,
													}
													// 'AccountRemovedFromLiquidation', // TODO this should be emitted from liquidation in this test case
													// {
													// 	account: alice,
													// }
												);
											});
											it('then Alice issuanceRatio is now at the target issuanceRatio', async () => {
												const aliceCRatioAfter = await periFinance.collateralisationRatio(alice);
												const issuanceRatio = await liquidations.issuanceRatio();
												assert.bnEqual(aliceCRatioAfter, issuanceRatio);
											});
										});
									});
								});
							});
							describe('given Alice has $600 Debt, $800 worth of PERI Collateral and c-ratio at 133.33%', () => {
								describe('when bob calls liquidate on Alice in multiple calls until fixing the ratio', () => {
									const pUSD1000 = toUnit('1000');
									let aliceDebtBefore;
									let aliceCollateralBefore;
									let bobPynthBalanceBefore;
									let amountToFixRatio;
									beforeEach(async () => {
										// send bob some PERI
										await periFinance.transfer(bob, toUnit('10000'), {
											from: owner,
										});

										await periFinance.issuePynths(PERI, pUSD1000, { from: bob });

										// Record Bob's state
										bobPynthBalanceBefore = await pUSDContract.balanceOf(bob);

										assert.bnEqual(bobPynthBalanceBefore, pUSD1000);

										// Record Alices state
										aliceDebtBefore = await periFinance.debtBalanceOf(alice, pUSD);
										aliceCollateralBefore = await periFinance.collateral(alice);

										// Calc amount to fix ratio
										amountToFixRatio = await liquidations.calculateAmountToFixCollateral(
											aliceDebtBefore,
											aliceCollateralBefore
										);
									});
									it('then Bob can liquidate Alice multiple times until fixing the c-ratio', async () => {
										const liquidateAmount = toUnit('50');
										let iterations = Math.floor(amountToFixRatio.div(liquidateAmount));

										// loop through until just less than amountToFixRato
										while (iterations > 0) {
											await periFinance.liquidateDelinquentAccount(alice, liquidateAmount, {
												from: bob,
											});

											iterations--;
										}

										// Should be able to liquidate one last time and fix c-ratio
										await periFinance.liquidateDelinquentAccount(alice, liquidateAmount, {
											from: bob,
										});

										// Alice should have liquidations closed
										assert.isFalse(await liquidations.isOpenForLiquidation(alice));

										// Alice should have liquidation entry removed
										assert.bnEqual(await liquidations.getLiquidationDeadlineForAccount(david), 0);

										// Bob's pUSD balance should be less amountToFixRatio
										assert.bnEqual(
											await pUSDContract.balanceOf(bob),
											bobPynthBalanceBefore.sub(amountToFixRatio)
										);
									});
								});
							});
						});
					});
				});
			});
		});
		describe('Given Alice has PERI and never issued any debt', () => {
			beforeEach(async () => {
				await periFinance.transfer(alice, toUnit('100'), { from: owner });
			});
			it('then she should not be able to be flagged for liquidation', async () => {
				await assert.revert(
					liquidations.flagAccountForLiquidation(alice),
					'Account issuance ratio is less than liquidation ratio'
				);
			});
			it('then liquidateDelinquentAccount fails', async () => {
				await assert.revert(
					periFinance.liquidateDelinquentAccount(alice, pUSD100),
					'Account not open for liquidation'
				);
			});
		});
		describe('When David collateral value is less than debt issued + penalty) ', () => {
			let davidDebtBefore;
			let davidCollateralBefore;
			beforeEach(async () => {
				await updatePERIPrice('6');

				// David issues pUSD $600
				await periFinance.transfer(david, toUnit('800'), { from: owner });
				await periFinance.issueMaxPynths({ from: david });

				// Drop PERI value to $0.1 (Collateral worth $80)
				await updatePERIPrice('0.1');
			});
			it('then his collateral ratio should be greater than 1 (more debt than collateral)', async () => {
				const issuanceRatio = await periFinance.collateralisationRatio(david);

				assert.isTrue(issuanceRatio.gt(toUnit('1')));

				davidDebtBefore = await periFinance.debtBalanceOf(david, pUSD);
				davidCollateralBefore = await periFinance.collateral(david);
				const collateralInUSD = await exchangeRates.effectiveValue(
					PERI,
					davidCollateralBefore,
					pUSD
				);

				assert.isTrue(davidDebtBefore.gt(collateralInUSD));
			});
			describe('when Bob flags and tries to liquidate David', () => {
				beforeEach(async () => {
					// flag account for liquidation
					await liquidations.flagAccountForLiquidation(david, {
						from: bob,
					});

					// fastForward to after liquidation delay
					const liquidationDeadline = await liquidations.getLiquidationDeadlineForAccount(david);
					await fastForwardAndUpdateRates(liquidationDeadline + 1);

					// Drop PERI value to $0.1 after update rates resets to default
					await updatePERIPrice('0.1');
					await updateUSDCPrice('0.98');

					// ensure Bob has enough pUSD
					await periFinance.transfer(bob, toUnit('100000'), {
						from: owner,
					});
					await periFinance.issueMaxPynths({ from: bob });
				});
				it('then david is openForLiquidation', async () => {
					assert.isTrue(await liquidations.isOpenForLiquidation(david));
				});
				describe('when the PERI rate is stale', () => {
					beforeEach(async () => {
						await fastForward((await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300')));
					});
					it('then liquidate reverts', async () => {
						await assert.revert(
							periFinance.liquidateDelinquentAccount(david, pUSD100, { from: bob }),
							'A pynth or PERI rate is invalid'
						);
					});
				});
				describe('when Bob liquidates all of davids collateral', async () => {
					const pUSD600 = toUnit('600');
					beforeEach(async () => {
						await periFinance.liquidateDelinquentAccount(david, pUSD600, {
							from: bob,
						});
					});
					it('then David should have 0 collateral', async () => {
						assert.bnEqual(await periFinance.collateral(david), toUnit('0'));
					});
					it('then David should have a collateral ratio of 0', async () => {
						const davidCRatioAfter = await periFinance.collateralisationRatio(david);
						assert.bnEqual(davidCRatioAfter, 0);
					});
					it('then David should still have debt owing', async () => {
						const davidDebt = await periFinance.debtBalanceOf(david, pUSD);
						assert.isTrue(davidDebt.gt(0));
					});
					it('then David wont be open for liquidation', async () => {
						assert.isFalse(await liquidations.isOpenForLiquidation(david));
					});
					describe('then David should be able to check and remove liquidation flag as no more collateral left', () => {
						let removeFlagTransaction;
						beforeEach(async () => {
							removeFlagTransaction = await liquidations.checkAndRemoveAccountInLiquidation(david, {
								from: owner,
							});
						});
						it('then David liquidation entry is removed', async () => {
							const deadline = await liquidations.getLiquidationDeadlineForAccount(david);
							assert.bnEqual(deadline, 0);
						});
						it('then David account is not open for liquidation', async () => {
							assert.isFalse(await liquidations.isOpenForLiquidation(david));
						});
						it('then events AccountRemovedFromLiquidation are emitted', async () => {
							assert.eventEqual(removeFlagTransaction, 'AccountRemovedFromLiquidation', {
								account: david,
							});
						});
					});
				});
			});
		});
	});
});
