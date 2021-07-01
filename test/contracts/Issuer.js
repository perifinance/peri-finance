'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, mockToken } = require('./setup');

const MockEtherCollateral = artifacts.require('MockEtherCollateral');

const { currentTime, multiplyDecimal, divideDecimal, toUnit, fastForward } = require('../utils')();

const {
	// setExchangeWaitingPeriod,
	setExchangeFeeRateForPynths,
	// getDecodedLogs,
	// decodedEventEqual,
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setStatus,
} = require('./helpers');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
	defaults: { ISSUANCE_RATIO, MINIMUM_STAKE_TIME },
} = require('../..');
const {
	ContractFunctionVisibility,
} = require('hardhat/internal/hardhat-network/stack-traces/model');
const { AssertionError } = require('chai');
const { lte } = require('semver');

contract('Issuer (via PeriFinance)', async accounts => {
	const WEEK = 604800;

	const [pUSD, PERI, USDC] = ['pUSD', 'PERI', 'USDC'].map(toBytes32);
	const pynthKeys = [pUSD];

	const [, owner, oracle, account1, account2, account3, account6] = accounts;

	let periFinance,
		exchangeRates,
		periFinanceState,
		feePool,
		delegateApprovals,
		systemStatus,
		systemSettings,
		pUSDContract,
		escrow,
		rewardEscrowV2,
		timestamp,
		debtCache,
		issuer,
		pynths,
		addressResolver,
		stakingStateUSDC,
		tempKovanOracle,
		usdc;

	const getRemainingIssuablePynths = async account =>
		(await periFinance.remainingIssuablePynths(account))[0];

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		pynths = ['pUSD', 'PERI', 'USDC'];
		({
			PeriFinance: periFinance,
			PeriFinanceState: periFinanceState,
			SystemStatus: systemStatus,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			PeriFinanceEscrow: escrow,
			RewardEscrowV2: rewardEscrowV2,
			PynthpUSD: pUSDContract,
			FeePool: feePool,
			DebtCache: debtCache,
			Issuer: issuer,
			DelegateApprovals: delegateApprovals,
			AddressResolver: addressResolver,
			ExternalRateAggregator: externalRateAggregator,
			StakingStateUSDC: stakingStateUSDC,
			USDC: usdc,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'ExchangeRates',
				'FeePool',
				'FeePoolEternalStorage',
				'AddressResolver',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'SystemSettings',
				'Issuer',
				'DebtCache',
				'Exchanger', // necessary for burnPynths to check settlement of pUSD
				'DelegateApprovals', // necessary for *OnBehalf functions
				'FlexibleStorage',
				'CollateralManager',
				'FeePoolStateUSDC',
				'ExternalRateAggregator',
				'StakingStateUSDC',
			],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timestamp = await currentTime();

		await exchangeRates.updateRates([PERI, USDC], ['0.2', '0.98'].map(toUnit), timestamp, {
			from: oracle,
		});

		// set a 0.3% default exchange fee rate
		const exchangeFeeRate = toUnit('0.003');
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});

		await exchangeRates.setOracleKovan(tempKovanOracle.address);

		await debtCache.takeDebtSnapshot();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: issuer.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'addPynth',
				'addPynths',
				'issueMaxPynths',
				'issuePynthsAndStakeUSDC',
				'burnPynthsAndUnstakeUSDC',
				'burnPynthsAndUnstakeUSDCToTarget',
				'removePynth',
				'removePynths',
				'liquidateDelinquentAccount',
			],
		});
	});

	it('minimum stake time is correctly configured as a default', async () => {
		assert.bnEqual(await issuer.minimumStakeTime(), MINIMUM_STAKE_TIME);
	});

	it('issuance ratio is correctly configured as a default', async () => {
		assert.bnEqual(await issuer.issuanceRatio(), ISSUANCE_RATIO);
	});

	describe('protected methods', () => {
		it('issueMaxPynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.issueMaxPynths,
				args: [account1],
				accounts,
				reason: 'Only the periFinance contract can perform this action',
			});
		});
		it('issuePynthsAndStakeUSDC() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.issuePynthsAndStakeUSDC,
				args: [account1, toUnit('1'), toUnit('1')],
				accounts,
				reason: 'Only the periFinance contract can perform this action',
			});
		});
		it('burnPynthsAndUnstakeUSDC() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.burnPynthsAndUnstakeUSDC,
				args: [account, toUnit('1'), toUnit('1')],
				accounts,
				reason: 'Only the periFinance contract can perform this action',
			});
		});
	});

	describe('when minimum stake time is set to 0', () => {
		beforeEach(async () => {
			// set minimumStakeTime on issue and burning to 0
			await systemSettings.setMinimumStakeTime(0, { from: owner });
		});
		describe('when the issuanceRatio is 0.2', () => {
			beforeEach(async () => {
				// set default issuance ratio of 0.2
				await systemSettings.setIssuanceRatio(toUnit('0.2'), { from: owner });
			});

			describe('minimumStakeTime - recording last issue and burn timestamp', async () => {
				let now;

				beforeEach(async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });
					// Give some USDC to owner
					await usdc.transfer(owner, '1000000');

					// approve USDC allowance
					await usdc.approve(issuer.address, '1000000', { from: owner });

					// transfer some usdc to account1
					await usdc.transfer(account1, '10000000000');
					await usdc.approve(issuer.address, '1000000000000000', { from: account1 });

					// issue pynths
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });

					now = await currentTime();
				});

				it('should issue pynths and store issue timestamp after now', async () => {
					// issue pynths
					await periFinance.issuePynthsAndStakeUSDC(web3.utils.toBN('5'), 0, { from: account1 });

					// issue timestamp should be greater than now in future
					const issueTimestamp = await issuer.lastIssueEvent(owner);
					assert.ok(issueTimestamp.gte(now));
				});

				it('should stake USDC And Issue Pynths and store issue timestamp after now', async () => {
					// stake usdc and issue pynths
					await periFinance.issuePynthsAndStakeUSDC(toUnit('1'), '100000', {
						from: account1,
					});

					// issue timestamp should be greater than now in future
					const issueTimestamp = await issuer.lastIssueEvent(owner);
					assert.ok(issueTimestamp.gte(now));
				});

				describe('require wait time on next burn pynth after minting', async () => {
					it('should revert when burning any pynths within minStakeTime', async () => {
						// set minimumStakeTime
						await systemSettings.setMinimumStakeTime(60 * 60 * 8, { from: owner });

						// issue pynths first
						await periFinance.issuePynthsAndStakeUSDC(web3.utils.toBN('5'), 0, { from: account1 });

						await assert.revert(
							periFinance.burnPynthsAndUnstakeUSDC(web3.utils.toBN('5'), 0, { from: account1 }),
							'Minimum stake time not reached'
						);
					});

					it('should set minStakeTime to 120 seconds and able to burn after wait time', async () => {
						// set minimumStakeTime
						await systemSettings.setMinimumStakeTime(120, { from: owner });

						// issue pynths first
						await periFinance.issuePynthsAndStakeUSDC(web3.utils.toBN('5'), 0, { from: account1 });

						// fastForward 30 seconds
						await fastForward(10);

						await assert.revert(
							periFinance.burnPynthsAndUnstakeUSDC(web3.utils.toBN('5'), 0, { from: account1 }),
							'Minimum stake time not reached'
						);

						// fastForward 115 seconds
						await fastForward(125);

						// burn pynths
						await periFinance.burnPynthsAndUnstakeUSDC(web3.utils.toBN('5'), 0, { from: account1 });
					});
				});
			});

			describe('totalIssuedPynths()', () => {
				describe('when exchange rates set', () => {
					beforeEach(async () => {
						await fastForward(10);
						// Send a price update to give the pynth rates
						await exchangeRates.updateRates([PERI], ['1'].map(toUnit), await currentTime(), {
							from: oracle,
						});
						await debtCache.takeDebtSnapshot();
					});

					describe('when numerous issues in one currency', () => {
						beforeEach(async () => {
							// as our pynths are mocks, let's issue some amount to users
							await pUSDContract.issue(account1, toUnit('1000'));
							await pUSDContract.issue(account2, toUnit('100'));
							await pUSDContract.issue(account3, toUnit('10'));
							await pUSDContract.issue(account1, toUnit('1'));

							// and since we are are bypassing the usual issuance flow here, we must cache the debt snapshot
							assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('0'));
							await debtCache.takeDebtSnapshot();
						});
						it('then totalIssuedPynths in should correctly calculate the total issued pynths in pUSD', async () => {
							assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('1111'));
						});
						it('and in PERI', async () => {
							assert.bnEqual(await periFinance.totalIssuedPynths(PERI), divideDecimal('1111', '1'));
						});
					});

					describe('when numerous issues in many currencies', () => {
						beforeEach(async () => {
							// as our pynths are mocks, let's issue some amount to users
							await pUSDContract.issue(account1, toUnit('1000'));

							// pAUD, pEUR, pETH....

							// and since we are are bypassing the usual issuance flow here, we must cache the debt snapshot
							assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('0'));
							await debtCache.takeDebtSnapshot();
						});
						it('then totalIssuedPynths in should correctly calculate the total issued pynths in pUSD', async () => {
							assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('1000'));
						});
						it('and in PERI', async () => {
							assert.bnEqual(await periFinance.totalIssuedPynths(PERI), divideDecimal('1000', '1'));
						});
					});
				});
			});

			describe('debtBalance()', () => {
				// it('should not change debt balance % if exchange rates change', async () => {
				// 	let newPeriRate = toUnit('1');
				// 	let timestamp = await currentTime();
				// 	await exchangeRates.updateRates([PERI], [newPeriRate], timestamp, { from: oracle });
				// 	await debtCache.takeDebtSnapshot();

				// 	await periFinance.transfer(account1, toUnit('20000'), {
				// 		from: owner,
				// 	});
				// 	await periFinance.transfer(account2, toUnit('20000'), {
				// 		from: owner,
				// 	});

				// 	const amountIssuedAcc1 = toUnit('30');
				// 	const amountIssuedAcc2 = toUnit('50');

				// 	await periFinance.issuePynthsAndStakeUSDC(amountIssuedAcc1, toUnit('1'), { from: account1 });
				// 	await periFinance.issuePynthsAndStakeUSDC(amountIssuedAcc2, toUnit('1'), { from: account2 });

				// 	await periFinance.exchange(pUSD, amountIssuedAcc2, PERI, { from: account2 });

				// 	const PRECISE_UNIT = web3.utils.toWei(web3.utils.toBN('1'), 'gether');
				// 	let totalIssuedPynthpUSD = await periFinance.totalIssuedPynths(pUSD);
				// 	const account1DebtRatio = divideDecimal(
				// 		amountIssuedAcc1,
				// 		totalIssuedPynthpUSD,
				// 		PRECISE_UNIT
				// 	);
				// 	const account2DebtRatio = divideDecimal(
				// 		amountIssuedAcc2,
				// 		totalIssuedPynthpUSD,
				// 		PRECISE_UNIT
				// 	);

				// 	timestamp = await currentTime();
				// 	newPeriRate = toUnit('1');
				// 	await exchangeRates.updateRates([pUSD], [newPeriRate], timestamp, { from: oracle });
				// 	await debtCache.takeDebtSnapshot();

				// 	totalIssuedPynthpUSD = await periFinance.totalIssuedPynths(pUSD);
				// 	const conversionFactor = web3.utils.toBN(1000000000);
				// 	const expectedDebtAccount1 = multiplyDecimal(
				// 		account1DebtRatio,
				// 		totalIssuedPynthpUSD.mul(conversionFactor),
				// 		PRECISE_UNIT
				// 	).div(conversionFactor);
				// 	const expectedDebtAccount2 = multiplyDecimal(
				// 		account2DebtRatio,
				// 		totalIssuedPynthpUSD.mul(conversionFactor),
				// 		PRECISE_UNIT
				// 	).div(conversionFactor);

				// 	assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), expectedDebtAccount1);
				// 	assert.bnClose(await periFinance.debtBalanceOf(account2, pUSD), expectedDebtAccount2);
				// });

				it("should correctly calculate a user's debt balance without prior issuance", async () => {
					await periFinance.transfer(account1, toUnit('200000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('10000'), {
						from: owner,
					});

					const debt1 = await periFinance.debtBalanceOf(account1, toBytes32('PERI'));
					const debt2 = await periFinance.debtBalanceOf(account2, toBytes32('PERI'));
					assert.bnEqual(debt1, 0);
					assert.bnEqual(debt2, 0);
				});

				it("should correctly calculate a user's debt balance with prior issuance", async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('200000'), {
						from: owner,
					});

					// Issue
					const issuedPynths = toUnit('1001');
					await periFinance.issuePynthsAndStakeUSDC(issuedPynths, 0, { from: account1 });

					const debt = await periFinance.debtBalanceOf(account1, toBytes32('pUSD'));
					assert.bnEqual(debt, issuedPynths);
				});
			});

			describe('remainingIssuablePynths()', () => {
				it("should correctly calculate a user's remaining issuable pynths with prior issuance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const issuanceRatio = await systemSettings.issuanceRatio();

					const issuedPeriFinances = web3.utils.toBN('200012');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const amountIssued = toUnit('2011');
					await periFinance.issuePynthsAndStakeUSDC(amountIssued, { from: account1 });

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(peri2usdRate, issuanceRatio)
					).sub(amountIssued);

					const remainingIssuable = await getRemainingIssuablePynths(account1);
					assert.bnEqual(remainingIssuable, expectedIssuablePynths);
				});

				it("should correctly calculate a user's remaining issuable pynths without prior issuance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const issuanceRatio = await systemSettings.issuanceRatio();

					const issuedPeriFinances = web3.utils.toBN('20');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(peri2usdRate, issuanceRatio)
					);

					const remainingIssuable = await getRemainingIssuablePynths(account1);
					assert.bnEqual(remainingIssuable, expectedIssuablePynths);
				});
			});

			describe('maxIssuablePynths()', () => {
				it("should correctly calculate a user's maximum issuable pynths without prior issuance", async () => {
					const rate = await exchangeRates.rateForCurrency(toBytes32('PERI'));
					const issuedPeriFinances = web3.utils.toBN('200000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});
					const issuanceRatio = await systemSettings.issuanceRatio();

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(rate, issuanceRatio)
					);
					const maxIssuablePynths = await periFinance.maxIssuablePynths(account1);

					assert.bnEqual(expectedIssuablePynths, maxIssuablePynths);
				});

				it("should correctly calculate a user's maximum issuable pynths without any PERI", async () => {
					const maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
					assert.bnEqual(0, maxIssuablePynths);
				});

				it("should correctly calculate a user's maximum issuable pynths with prior issuance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);

					const issuedPeriFinances = web3.utils.toBN('320001');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					const issuanceRatio = await systemSettings.issuanceRatio();
					const amountIssued = web3.utils.toBN('1234');
					await periFinance.issuePynthsAndStakeUSDC(toUnit(amountIssued), 0, { from: account1 });

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(peri2usdRate, issuanceRatio)
					);

					const maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
					assert.bnEqual(expectedIssuablePynths, maxIssuablePynths);
				});
			});

			describe('adding and removing pynths', () => {
				it('should allow adding a Pynth contract', async () => {
					const previousPynthCount = await periFinance.availablePynthCount();

					const { token: pynth } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					const txn = await issuer.addPynth(pynth.address, { from: owner });

					const currencyKey = toBytes32('sXYZ');

					// Assert that we've successfully added a Pynth
					assert.bnEqual(
						await periFinance.availablePynthCount(),
						previousPynthCount.add(web3.utils.toBN(1))
					);
					// Assert that it's at the end of the array
					assert.equal(await periFinance.availablePynths(previousPynthCount), pynth.address);
					// Assert that it's retrievable by its currencyKey
					assert.equal(await periFinance.pynths(currencyKey), pynth.address);

					// Assert event emitted
					assert.eventEqual(txn.logs[0], 'PynthAdded', [currencyKey, pynth.address]);
				});

				it('should disallow adding a Pynth contract when the user is not the owner', async () => {
					const { token: pynth } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					await onlyGivenAddressCanInvoke({
						fnc: issuer.addPynth,
						accounts,
						args: [pynth.address],
						address: owner,
						reason: 'Only the contract owner may perform this action',
					});
				});

				it('should disallow double adding a Pynth contract with the same address', async () => {
					const { token: pynth } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					await issuer.addPynth(pynth.address, { from: owner });
					await assert.revert(issuer.addPynth(pynth.address, { from: owner }), 'Pynth exists');
				});

				it('should disallow double adding a Pynth contract with the same currencyKey', async () => {
					const { token: pynth1 } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					const { token: pynth2 } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					await issuer.addPynth(pynth1.address, { from: owner });
					await assert.revert(issuer.addPynth(pynth2.address, { from: owner }), 'Pynth exists');
				});

				describe('when another pynth is added with 0 supply', () => {
					let currencyKey, pynth;

					beforeEach(async () => {
						const symbol = 'pBTC';
						currencyKey = toBytes32(symbol);

						({ token: pynth } = await mockToken({
							pynth: symbol,
							accounts,
							name: 'test',
							symbol,
							supply: 0,
							skipInitialAllocation: true,
						}));

						await issuer.addPynth(pynth.address, { from: owner });
					});

					it('should be able to query multiple pynth addresses', async () => {
						const pynthAddresses = await issuer.getPynths([currencyKey, pUSD, PERI]);
						assert.equal(pynthAddresses[0], pynth.address);
						assert.equal(pynthAddresses[1], pUSDContract.address);
						// assert.equal(pynthAddresses[2], PERIContract.address);
						assert.equal(pynthAddresses.length, 3);
					});

					it('should allow removing a Pynth contract when it has no issued balance', async () => {
						const pynthCount = await periFinance.availablePynthCount();

						assert.notEqual(await periFinance.pynths(currencyKey), ZERO_ADDRESS);

						const txn = await issuer.removePynth(currencyKey, { from: owner });

						// Assert that we have one less pynth, and that the specific currency key is gone.
						assert.bnEqual(
							await periFinance.availablePynthCount(),
							pynthCount.sub(web3.utils.toBN(1))
						);
						assert.equal(await periFinance.pynths(currencyKey), ZERO_ADDRESS);

						assert.eventEqual(txn, 'PynthRemoved', [currencyKey, pynth.address]);
					});

					it('should disallow removing a token by a non-owner', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: issuer.removePynth,
							args: [currencyKey],
							accounts,
							address: owner,
							reason: 'Only the contract owner may perform this action',
						});
					});

					describe('when that pynth has issued', () => {
						beforeEach(async () => {
							await pynth.issue(account1, toUnit('100'));
						});
						it('should disallow removing a Pynth contract when it has an issued balance', async () => {
							// Assert that we can't remove the pynth now
							await assert.revert(
								issuer.removePynth(currencyKey, { from: owner }),
								'Pynth supply exists'
							);
						});
					});
				});

				it('should disallow removing a Pynth contract when requested by a non-owner', async () => {
					// Note: This test depends on state in the migration script, that there are hooked up pynths
					// without balances
					await assert.revert(issuer.removePynth(pUSD, { from: account1 }));
				});

				it('should revert when requesting to remove a non-existent pynth', async () => {
					// Note: This test depends on state in the migration script, that there are hooked up pynths
					// without balances
					const currencyKey = toBytes32('NOPE');

					// Assert that we can't remove the pynth
					await assert.revert(issuer.removePynth(currencyKey, { from: owner }));
				});

				it('should revert when requesting to remove pUSD', async () => {
					// Note: This test depends on state in the migration script, that there are hooked up pynths
					// without balances
					const currencyKey = toBytes32('pUSD');

					// Assert that we can't remove the pynth
					await assert.revert(issuer.removePynth(currencyKey, { from: owner }));
				});

				describe('multiple add/remove pynths', () => {
					let currencyKey, pynth;

					beforeEach(async () => {
						const symbol = 'pBTC';
						currencyKey = toBytes32(symbol);

						({ token: pynth } = await mockToken({
							pynth: symbol,
							accounts,
							name: 'test',
							symbol,
							supply: 0,
							skipInitialAllocation: true,
						}));

						await issuer.addPynth(pynth.address, { from: owner });
					});

					it('should allow adding multiple Pynth contracts at once', async () => {
						const previousPynthCount = await periFinance.availablePynthCount();

						const { token: pynth1 } = await mockToken({
							accounts,
							pynth: 'sXYZ',
							skipInitialAllocation: true,
							supply: 0,
							name: 'XYZ',
							symbol: 'XYZ',
						});

						const { token: pynth2 } = await mockToken({
							accounts,
							pynth: 'sABC',
							skipInitialAllocation: true,
							supply: 0,
							name: 'ABC',
							symbol: 'ABC',
						});

						const txn = await issuer.addPynths([pynth1.address, pynth2.address], { from: owner });

						const currencyKey1 = toBytes32('sXYZ');
						const currencyKey2 = toBytes32('sABC');

						// Assert that we've successfully added two Pynths
						assert.bnEqual(
							await periFinance.availablePynthCount(),
							previousPynthCount.add(web3.utils.toBN(2))
						);
						// Assert that they're at the end of the array
						assert.equal(await periFinance.availablePynths(previousPynthCount), pynth1.address);
						assert.equal(
							await periFinance.availablePynths(previousPynthCount.add(web3.utils.toBN(1))),
							pynth2.address
						);
						// Assert that they are retrievable by currencyKey
						assert.equal(await periFinance.pynths(currencyKey1), pynth1.address);
						assert.equal(await periFinance.pynths(currencyKey2), pynth2.address);

						// Assert events emitted
						assert.eventEqual(txn.logs[0], 'PynthAdded', [currencyKey1, pynth1.address]);
						assert.eventEqual(txn.logs[1], 'PynthAdded', [currencyKey2, pynth2.address]);
					});

					it('should disallow adding Pynth contracts if the user is not the owner', async () => {
						const { token: pynth } = await mockToken({
							accounts,
							pynth: 'sXYZ',
							skipInitialAllocation: true,
							supply: 0,
							name: 'XYZ',
							symbol: 'XYZ',
						});

						await onlyGivenAddressCanInvoke({
							fnc: issuer.addPynths,
							accounts,
							args: [[pynth.address]],
							address: owner,
							reason: 'Only the contract owner may perform this action',
						});
					});

					it('should disallow multi-adding the same Pynth contract', async () => {
						const { token: pynth } = await mockToken({
							accounts,
							pynth: 'sXYZ',
							skipInitialAllocation: true,
							supply: 0,
							name: 'XYZ',
							symbol: 'XYZ',
						});

						await assert.revert(
							issuer.addPynths([pynth.address, pynth.address], { from: owner }),
							'Pynth exists'
						);
					});

					it('should disallow multi-adding pynth contracts with the same currency key', async () => {
						const { token: pynth1 } = await mockToken({
							accounts,
							pynth: 'sXYZ',
							skipInitialAllocation: true,
							supply: 0,
							name: 'XYZ',
							symbol: 'XYZ',
						});

						const { token: pynth2 } = await mockToken({
							accounts,
							pynth: 'sXYZ',
							skipInitialAllocation: true,
							supply: 0,
							name: 'XYZ',
							symbol: 'XYZ',
						});

						await assert.revert(
							issuer.addPynths([pynth1.address, pynth2.address], { from: owner }),
							'Pynth exists'
						);
					});

					it('should disallow removing Pynths by a non-owner', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: issuer.removePynths,
							args: [[currencyKey]],
							accounts,
							address: owner,
							reason: 'Only the contract owner may perform this action',
						});
					});

					it('should disallow removing non-existent pynths', async () => {
						const fakeCurrencyKey = toBytes32('NOPE');

						// Assert that we can't remove the pynth
						await assert.revert(
							issuer.removePynths([currencyKey, fakeCurrencyKey], { from: owner }),
							'Pynth does not exist'
						);
					});

					it('should disallow removing pUSD', async () => {
						// Assert that we can't remove pUSD
						await assert.revert(
							issuer.removePynths([currencyKey, pUSD], { from: owner }),
							'Cannot remove pynth'
						);
					});

					it('should allow removing pynths with no balance', async () => {
						const symbol2 = 'sFOO';
						const currencyKey2 = toBytes32(symbol2);

						const { token: pynth2 } = await mockToken({
							pynth: symbol2,
							accounts,
							name: 'foo',
							symbol2,
							supply: 0,
							skipInitialAllocation: true,
						});

						await issuer.addPynth(pynth2.address, { from: owner });

						const previousPynthCount = await periFinance.availablePynthCount();

						const tx = await issuer.removePynths([currencyKey, currencyKey2], { from: owner });

						assert.bnEqual(
							await periFinance.availablePynthCount(),
							previousPynthCount.sub(web3.utils.toBN(2))
						);

						// Assert events emitted
						assert.eventEqual(tx.logs[0], 'PynthRemoved', [currencyKey, pynth.address]);
						assert.eventEqual(tx.logs[1], 'PynthRemoved', [currencyKey2, pynth2.address]);
					});

					it('should disallow removing pynths if any of them has a positive balance', async () => {
						const symbol2 = 'sFOO';
						const currencyKey2 = toBytes32(symbol2);

						const { token: pynth2 } = await mockToken({
							pynth: symbol2,
							accounts,
							name: 'foo',
							symbol2,
							supply: 0,
							skipInitialAllocation: true,
						});

						await issuer.addPynth(pynth2.address, { from: owner });
						await pynth2.issue(account1, toUnit('100'));

						await assert.revert(
							issuer.removePynths([currencyKey, currencyKey2], { from: owner }),
							'Pynth supply exists'
						);
					});
				});
			});

			describe('issuance', () => {
				describe('potential blocking conditions', () => {
					beforeEach(async () => {
						// ensure user has pynths to issue from
						await periFinance.transfer(account1, toUnit('1000'), { from: owner });
					});

					['System', 'Issuance'].forEach(section => {
						describe(`when ${section} is suspended`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: true });
							});
							it('then calling issue() reverts', async () => {
								await assert.revert(
									periFinance.issuePynthsAndStakeUSDC(toUnit('1'), 0, { from: account1 }),
									'Operation prohibited'
								);
							});
							it('and calling issueMaxPynths() reverts', async () => {
								await assert.revert(
									periFinance.issueMaxPynths({ from: account1 }),
									'Operation prohibited'
								);
							});
							describe(`when ${section} is resumed`, () => {
								beforeEach(async () => {
									await setStatus({ owner, systemStatus, section, suspend: false });
								});
								it('then calling issue() succeeds', async () => {
									await periFinance.issuePynthsAndStakeUSDC(toUnit('1'), 0, { from: account1 });
								});
								it('and calling issueMaxPynths() succeeds', async () => {
									await periFinance.issueMaxPynths({ from: account1 });
								});
							});
						});
					});
					['PERI', 'USDC', 'pUSD', ['PERI', 'USDC'], 'none'].forEach(type => {
						describe(`when ${type} is stale`, () => {
							beforeEach(async () => {
								await fastForward(
									(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('3000'))
								);

								// set all rates minus those to ignore
								const ratesToUpdate = ['PERI']
									.concat(pynths)
									.filter(key => key !== 'pUSD' && ![].concat(type).includes(key));

								const timestamp = await currentTime();

								await exchangeRates.updateRates(
									ratesToUpdate.map(toBytes32),
									ratesToUpdate.map(() => toUnit('1')),
									timestamp,
									{
										from: oracle,
									}
								);
								await debtCache.takeDebtSnapshot();
							});

							if (type === 'none' || type === 'pUSD') {
								it('then calling issuePynthsAndStakeUSDC succeeds', async () => {
									await periFinance.issuePynthsAndStakeUSDC(toUnit('1'), toUnit('0'), {
										from: account1,
									});
								});
								it('and calling issueMaxPynths() succeeds', async () => {
									await periFinance.issueMaxPynths({ from: account1 });
								});
							} else {
								it('reverts on issuePynthsAndStakeUSDC()', async () => {
									await assert.revert(
										periFinance.issuePynthsAndStakeUSDC(toUnit('1'), toUnit('0'), {
											from: account1,
										}),
										'A pynth or PERI rate is invalid'
									);
								});
								it('reverts on issueMaxPynths()', async () => {
									await assert.revert(
										periFinance.issueMaxPynths({ from: account1 }),
										'A pynth or PERI rate is invalid'
									);
								});
							}
						});
					});
				});
				it('should allow the issuance of a small amount of pynths', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });

					// account1 should be able to issue
					// Note: If a too small amount of pynths are issued here, the amount may be
					// rounded to 0 in the debt register. This will revert. As such, there is a minimum
					// number of pynths that need to be issued each time issue is invoked. The exact
					// amount depends on the Pynth exchange rate and the total supply.
					await periFinance.issuePynthsAndStakeUSDC(web3.utils.toBN('5'), 0, { from: account1 });
				});

				it('should be possible to issue the maximum amount of pynths via issuePynthsAndStakeUSDC', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });

					const maxPynths = await periFinance.maxIssuablePynths(account1);

					// account1 should be able to issue
					await periFinance.issuePynthsAndStakeUSDC(maxPynths, 0, { from: account1 });
				});

				it('should allow an issuer to issue pynths in one flavour', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });

					// account1 should be able to issue
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });

					// There should be 10 pUSD of value in the system
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('10'));

					// And account1 should own 100% of the debt.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('10'));
				});

				// TODO: Check that the rounding errors are acceptable
				it('should allow two issuers to issue pynths in one flavour', async () => {
					// Give some PERI to account1 and account2
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('20'), 0, { from: account2 });

					// There should be 30pUSD of value in the system
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('30'));

					// And the debt should be split 50/50.
					// But there's a small rounding error.
					// This is ok, as when the last person exits the system, their debt percentage is always 100% so
					// these rounding errors don't cause the system to be out of balance.
					assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), toUnit('10'));
					assert.bnClose(await periFinance.debtBalanceOf(account2, pUSD), toUnit('20'));
				});

				it('should allow multi-issuance in one flavour', async () => {
					// Give some PERI to account1 and account2
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('20'), 0, { from: account2 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });

					// There should be 40 pUSD of value in the system
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('40'));

					// And the debt should be split 50/50.
					// But there's a small rounding error.
					// This is ok, as when the last person exits the system, their debt percentage is always 100% so
					// these rounding errors don't cause the system to be out of balance.
					assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), toUnit('20'));
					assert.bnClose(await periFinance.debtBalanceOf(account2, pUSD), toUnit('20'));
				});

				describe('issueMaxPynths', () => {
					it('should allow an issuer to issue max pynths in one flavour', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('10000'), {
							from: owner,
						});

						// Issue
						await periFinance.issueMaxPynths({ from: account1 });

						// There should be 40000 pUSD of value in the system
						// account1's PERI = 20000, IssuanceRatio = 0.2, ExRate(USD/PERI) = 10
						// maxPUSD = 20000 * 10 * 0.2 = 40000
						assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('40000'));

						// And account1 should own all of it.
						assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('40000'));
					});
				});

				beforeEach(async () => {
					// Setting USD/PERI exchange rate to 10
					// await tempKovanOracle.setRate(PERI, toUnit('10'));
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI], [toUnit('10')], timestamp, { from: oracle });

					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});
				});

				it('should allow an issuer to issue max pynths via the standard issue call', async () => {
					// Determine maximum amount that can be issued.
					const maxIssuable = await periFinance.maxIssuablePynths(account1);

					// Issue
					await periFinance.issuePynthsAndStakeUSDC(maxIssuable, 0, { from: account1 });

					// There should be 20000 pUSD of value in the system
					// USD/PERI = 10, PERI Balance = 10^4, IssuanceRatio = 0.2
					// MaxIssuable = 20000 = 10^4 * 10 * 0.2
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('20000'));

					// And account1 should own all of it.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('20000'));

					const remainingIssuableResult_after = await periFinance.remainingIssuablePynths(account1);

					assert.bnEqual(remainingIssuableResult_after.maxIssuable, toUnit('0'));
					assert.bnEqual(remainingIssuableResult_after.alreadyIssued, toUnit('20000'));
					assert.bnEqual(remainingIssuableResult_after.totalSystemDebt, toUnit('20000'));

					// Expected C-Ratio = User debt(USD) / Peri Balance * ExRate(USD/PERI)
					const cratio = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(cratio, divideDecimal(toUnit('20000'), toUnit('100000')));
				});

				it('should disallow an issuer from issuing pynths beyond their remainingIssuablePynths', async () => {
					// They should now be able to issue pUSD
					const issuablePynths = await getRemainingIssuablePynths(account1);
					assert.bnEqual(issuablePynths, toUnit('20000'));

					// Issue that amount.
					await periFinance.issuePynthsAndStakeUSDC(issuablePynths, 0, { from: account1 });

					// They should now have 0 issuable pynths.
					assert.bnEqual(await getRemainingIssuablePynths(account1), '0');

					// And trying to issue the smallest possible unit of one should fail.
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC('1', 0, { from: account1 }),
						'Amount too large'
					);
				});
			});

			describe('issuance USDC staking', () => {
				beforeEach(async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('0.9')], timestamp, {
						from: oracle,
					});

					await periFinance.transfer(account1, toUnit('20000'), { from: owner });
					await periFinance.transfer(account2, toUnit('20000'), { from: owner });
					await usdc.transfer(account1, toUnit('1000'), { from: owner });
					await usdc.approve(issuer.address, toUnit('1000'), { from: account1 });
				});

				it('should initiate correctly', async () => {
					const usdcBalance = await usdc.balanceOf(account1);
					const usdcAllowance = await usdc.allowance(account1, issuer.address);
					const usdcExRate = await exchangeRates.rateForCurrency(USDC);

					assert.equal(usdcBalance.toString(), toUnit('1000'));
					assert.equal(usdcAllowance.toString(), toUnit('1000'));
					assert.equal(usdcExRate.toString(), toUnit('0.9'));
				});

				it('should NOT stake if try to stake more than issue', async () => {
					const remainingIssuableResult = await periFinance.remainingIssuablePynths(account1);

					assert.bnEqual(remainingIssuableResult.maxIssuable, toUnit('40000'));
					assert.bnEqual(remainingIssuableResult.alreadyIssued, toUnit('0'));
					assert.bnEqual(remainingIssuableResult.totalSystemDebt, toUnit('0'));

					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(toUnit('2'), toUnit('12'), { from: account1 }),
						'Staking amount exceeds issueing amount'
					);
				});

				it('should NOT stake USDC if there is no PERI locked amount', async () => {
					const debtBalance_1 = await periFinance.debtBalanceOf(account1, pUSD);
					const pUSDBalance_1 = await pUSDContract.balanceOf(account1);
					const usdcStakedAmount_1 = await stakingStateUSDC.stakedAmountOf(account1);

					// Be sure there is no staking data
					assert.bnEqual(debtBalance_1, 0);
					assert.bnEqual(pUSDBalance_1, 0);
					assert.bnEqual(usdcStakedAmount_1, 0);

					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const issuanceRatio = await issuer.issuanceRatio();
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(
							toUnit('1'),
							multiplyDecimal(divideDecimal(toUnit('1'), issuanceRatio), usdcExRate)
						),
						'Input amount exceeds available staking amount'
					);

					// There is a few amount debt existing and try to stake exceeding this amount
					await periFinance.issuePynthsAndStakeUSDC(123456, 0, { from: account1 });
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(
							toUnit('1'),
							multiplyDecimal(divideDecimal(toUnit('1'), issuanceRatio), usdcExRate)
						),
						'Input amount exceeds available staking amount'
					);
				});

				it('should NOT stake USDC if there is no issue amount', async () => {
					// debt will be 10000 USD
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), 0, { from: account1 });

					// only stake, not issue pUSD
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(0, '1111' + '1'.repeat(18), { from: account1 }),
						'Staking amount exceeds issueing amount'
					);
				});

				it('should issue pynths', async () => {
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), 0, { from: account1 });

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance_1,
						debtBalance_1,
						totalIssuedPUSD,
						usdcQuota,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						periFinance.usdcTotalStakedAmount(),
						periFinance.totalUSDCStakerCount(),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						periFinance.currentUSDCDebtQuota(account1),
					]);

					assert.equal(stakedAmount.toString(), '0');
					assert.equal(totalStaked.toString(), '0');
					assert.equal(numOfStaker.toString(), '0');
					assert.bnEqual(pUSDBalance_1, toUnit('10000'));
					assert.bnEqual(debtBalance_1, toUnit('10000'));
					assert.bnEqual(totalIssuedPUSD, toUnit('10000'));
					assert.bnEqual(usdcQuota.toString(), '0');
				});

				it('should stake USDC and issue pynths', async () => {
					// debt will be 10000 USD
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), 0, {
						from: account1,
					});

					// 0.9 (USD/USDC). And issuance ratio is 0.2.
					// Current debt is 10000 USD and available USDC staking amount is about 11111 USDC (2000 * exRate / issuanceRatio).
					// If account1 issues additional 10000 pUSD, new debt will be 20000 USD,
					// then available USDC staking amount is 20000 * 0.2 * exRate / issuanceRatio = 22222.222222222....
					// Below one would be reverted since it exceeds USDC debt quota, even though it satisfies input condition.
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), toUnit('55555'), {
							from: account1,
						}),
						'Input amount exceeds available staking amount'
					);

					// Though its maximum input stking amount is 55555.5555... = 10000 / IR / usdcExRate,
					// its maximum staking amount is 22222.2222...
					// Result should be 20% of debt. (Maximum USDC quota)
					const stakingAmount = '22222' + '2'.repeat(18);
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), stakingAmount, {
						from: account1,
					});

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance_1,
						debtBalance_1,
						totalIssuedPUSD,
						usdcQuota,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						periFinance.usdcTotalStakedAmount(),
						periFinance.totalUSDCStakerCount(),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						periFinance.currentUSDCDebtQuota(account1),
					]);

					assert.bnEqual(
						stakedAmount,
						web3.utils
							.toBN(stakingAmount)
							.div(web3.utils.toBN(10 ** 12))
							.mul(web3.utils.toBN(10 ** 12))
					);
					assert.bnEqual(
						totalStaked,
						web3.utils
							.toBN(stakingAmount)
							.div(web3.utils.toBN(10 ** 12))
							.mul(web3.utils.toBN(10 ** 12))
					);
					assert.bnEqual(numOfStaker, '1');
					assert.bnEqual(pUSDBalance_1, toUnit('20000'));
					assert.bnEqual(debtBalance_1, toUnit('20000'));
					assert.bnEqual(totalIssuedPUSD, toUnit('20000'));
					assert.bnClose(usdcQuota, toUnit('0.199999999998'));
				});

				it('should set lastDebtLedgerEntry to 1 when a user added to a debtRegister and no debt exists', async () => {
					const account1Debt = toUnit('10000');
					const account2Debt = toUnit('20000');
					await periFinance.issuePynthsAndStakeUSDC(account1Debt, toUnit('0'), {
						from: account1,
					});

					await periFinance.issuePynthsAndStakeUSDC(account1Debt, toUnit('0'), {
						from: account1,
					});

					let debtBalanceOfAcc1 = await issuer.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalanceOfAcc1, account1Debt.mul(web3.utils.toBN('2')));
					let debtBalanceOfAcc2 = await issuer.debtBalanceOf(account2, pUSD);
					assert.bnEqual(debtBalanceOfAcc2, 0);

					let lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(toUnit('500000000'), lastDebtLedgerEntry);

					await periFinance.issuePynthsAndStakeUSDC(account2Debt, toUnit('0'), {
						from: account2,
					});

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(toUnit('250000000'), lastDebtLedgerEntry);

					await periFinance.burnPynthsAndUnstakeUSDC(account1Debt.mul(web3.utils.toBN('2')), 0, {
						from: account1,
					});

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(toUnit('500000000'), lastDebtLedgerEntry);

					await periFinance.burnPynthsAndUnstakeUSDC(account2Debt, 0, {
						from: account2,
					});

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual('0', lastDebtLedgerEntry);

					debtBalanceOfAcc1 = await issuer.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalanceOfAcc1, 0);
					debtBalanceOfAcc2 = await issuer.debtBalanceOf(account2, pUSD);
					assert.bnEqual(debtBalanceOfAcc2, 0);

					await periFinance.issuePynthsAndStakeUSDC(account1Debt, toUnit('0'), {
						from: account1,
					});

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(toUnit('1000000000'), lastDebtLedgerEntry);

					debtBalanceOfAcc1 = await issuer.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalanceOfAcc1, account1Debt);

					const debtLedgerLength = await periFinanceState.debtLedgerLength();
					assert.bnEqual(debtLedgerLength, 6);
				});

				it('should issue pynths when USDC quota exceeds threshold', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('1')], timestamp, {
						from: oracle,
					});

					const targetRatio = await issuer.issuanceRatio();
					await periFinance.issuePynthsAndStakeUSDC(
						toUnit('1000'),
						divideDecimal(toUnit('200'), targetRatio),
						{ from: account1 }
					);

					assert.bnEqual(await periFinance.currentUSDCDebtQuota(account1), toUnit('0.2'));

					const timestamp2 = await currentTime();
					await exchangeRates.updateRates([USDC], [toUnit('1.2')], timestamp2, {
						from: oracle,
					});

					const quota_beforeIssue = await periFinance.currentUSDCDebtQuota(account1);
					const cratio_beforeIssue = await periFinance.collateralisationRatio(account1);
					assert.bnGt(quota_beforeIssue, toUnit('0.2'));
					assert.bnLt(cratio_beforeIssue, targetRatio);

					// should throw error for it cannot stake than its issue amount * targetRatio
					await assert.revert(
						periFinance.issuePynthsAndStakeUSDC(
							toUnit('1000'),
							divideDecimal(multiplyDecimal(toUnit('200'), toUnit('1.2')), targetRatio),
							{ from: account1 }
						),
						'Input amount exceeds available staking amount'
					);

					// Max USDC Quota = 2000 * 0.2
					// availableStakingAmount = TargetRatio * (Max USDC Quota * Quota - StakedAmount * usdcExRate) / IR / usdcExRate
					// = 666.666666.....  => It makes quota 20%
					await periFinance.issuePynthsAndStakeUSDC(toUnit('1000'), '666' + '6'.repeat(18), {
						from: account1,
					});

					const quota_afterIssue = await periFinance.currentUSDCDebtQuota(account1);
					const cratio_afterIssue = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(quota_afterIssue, toUnit('0.19999999992'));
					assert.bnLt(cratio_afterIssue, targetRatio);
				});

				it('should issue max pynths when USDC quota exceeds threshold', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('1')], timestamp, {
						from: oracle,
					});

					const targetRatio = await issuer.issuanceRatio();
					await periFinance.issuePynthsAndStakeUSDC(
						toUnit('1000'),
						divideDecimal(toUnit('200'), targetRatio),
						{ from: account1 }
					);

					assert.bnEqual(await periFinance.currentUSDCDebtQuota(account1), toUnit('0.2'));

					const timestamp2 = await currentTime();
					await exchangeRates.updateRates([USDC], [toUnit('1.2')], timestamp2, {
						from: oracle,
					});

					await periFinance.issueMaxPynths({ from: account1 });

					const quota_afterIssue = await periFinance.currentUSDCDebtQuota(account1);
					const cratio_afterIssue = await periFinance.collateralisationRatio(account1);
					assert.bnLt(quota_afterIssue, toUnit('0.2'));
					assert.bnEqual(cratio_afterIssue, targetRatio);
				});
			});

			describe('issuance USDC max staking', () => {
				beforeEach(async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates(
						[PERI, USDC],
						[toUnit('10'), toUnit('1.001')],
						timestamp,
						{
							from: oracle,
						}
					);

					await periFinance.transfer(account1, toUnit('10000'), { from: owner });
					await usdc.transfer(account1, '1000' + '0'.repeat(6), { from: accounts[0] });
					await usdc.approve(issuer.address, '100000' + '0'.repeat(6), { from: account1 });
				});

				it('should initiate correctly', async () => {
					const usdcBalance = await usdc.balanceOf(account1);
					const usdcAllowance = await usdc.allowance(account1, issuer.address);

					assert.equal(usdcBalance.toString(), '1000' + '0'.repeat(6));
					assert.equal(usdcAllowance.toString(), '100000' + '0'.repeat(6));
				});

				it('should stake issue amount x issuance ratio', async () => {
					const [
						stakedAmount_before,
						usdcBalance_1_before,
						usdcBalance_state_before,
						debtBalance_1_before,
						usdcQuota_before,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingStateUSDC.address),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.currentUSDCDebtQuota(account1),
					]);

					await periFinance.issuePynthsAndStakeMaxUSDC(toUnit('1000'), { from: account1 });

					const [
						stakedAmount_after,
						usdcBalance_1_after,
						usdcBalance_state_after,
						debtBalance_1_after,
						usdcQuota_after,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingStateUSDC.address),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.currentUSDCDebtQuota(account1),
					]);

					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const targetRatio = await issuer.issuanceRatio();
					const expectedStakingAmount = divideDecimal(
						multiplyDecimal(divideDecimal(toUnit('1000'), usdcExRate), toUnit('0.2')),
						targetRatio
					);
					const expectedUSDCBalance = expectedStakingAmount.div(web3.utils.toBN(10 ** 12));

					// It has an unit digit error
					assert.bnClose(stakedAmount_before.add(expectedStakingAmount), stakedAmount_after);
					assert.bnEqual(usdcBalance_1_before.sub(expectedUSDCBalance), usdcBalance_1_after);
					assert.bnEqual(
						usdcBalance_state_before.add(expectedUSDCBalance),
						usdcBalance_state_after
					);
					assert.bnEqual(debtBalance_1_before.add(toUnit('1000')), debtBalance_1_after);
					assert.bnEqual(usdcQuota_before, toUnit('0'));
					assert.bnEqual(usdcQuota_after, toUnit('0.2'));
				});

				it('should stake less than amount x issuance ratio if usdc balance is not enough', async () => {
					// It is going to stake all USDC balance
					await periFinance.issuePynthsAndStakeMaxUSDC(toUnit('10000'), { from: account1 });

					const [
						stakedAmount_after,
						usdcBalance_1_after,
						usdcBalance_state_after,
						debtBalance_1_after,
						usdcQuota_after,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingStateUSDC.address),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.currentUSDCDebtQuota(account1),
					]);

					assert.bnEqual(stakedAmount_after, toUnit('1000'));
					assert.bnEqual(usdcBalance_1_after, toUnit('0'));
					assert.bnEqual(usdcBalance_state_after, '1000' + '0'.repeat(6));
					assert.bnEqual(debtBalance_1_after, toUnit('10000'));
					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const targetRatio = await issuer.issuanceRatio();
					assert.bnEqual(
						usdcQuota_after,
						divideDecimal(
							multiplyDecimal(toUnit('1000'), usdcExRate),
							divideDecimal(debtBalance_1_after, targetRatio)
						)
					);
				});
			});

			describe('burning', () => {
				describe('potential blocking conditions', () => {
					beforeEach(async () => {
						// ensure user has pynths to burb
						await periFinance.transfer(account1, toUnit('1000'), { from: owner });
						await periFinance.issueMaxPynths({ from: account1 });
					});
					['System', 'Issuance'].forEach(section => {
						describe(`when ${section} is suspended`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: true });
							});
							it('then calling burn() reverts', async () => {
								await assert.revert(
									periFinance.burnPynthsAndUnstakeUSDC(toUnit('1'), 0, { from: account1 }),
									'Operation prohibited'
								);
							});
							it('and calling burnPynthsAndUnstakeUSDCToTarget() reverts', async () => {
								await assert.revert(
									periFinance.burnPynthsAndUnstakeUSDCToTarget({ from: account1 }),
									'Operation prohibited'
								);
							});
							describe(`when ${section} is resumed`, () => {
								beforeEach(async () => {
									await setStatus({ owner, systemStatus, section, suspend: false });
								});
								it('then calling burnPynths() succeeds', async () => {
									await periFinance.burnPynthsAndUnstakeUSDC(toUnit('1'), 0, { from: account1 });
								});
								it('and calling burnPynthsAndUnstakeUSDCToTarget() succeeds', async () => {
									await periFinance.burnPynthsAndUnstakeUSDCToTarget({ from: account1 });
								});
							});
						});
					});

					['PERI', 'pUSD', 'USDC', ['PERI', 'USDC'], 'none'].forEach(type => {
						describe(`when ${type} is stale`, () => {
							beforeEach(async () => {
								await fastForward(
									(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300'))
								);

								// set all rates minus those to ignore
								const ratesToUpdate = ['PERI']
									.concat(pynths)
									.filter(key => key !== 'pUSD' && ![].concat(type).includes(key));

								const timestamp = await currentTime();

								await exchangeRates.updateRates(
									ratesToUpdate.map(toBytes32),
									ratesToUpdate.map(rate => toUnit(rate === 'PERI' ? '0.1' : '1')),
									timestamp,
									{
										from: oracle,
									}
								);
								await debtCache.takeDebtSnapshot();
							});

							if (type === 'none' || type === 'pUSD') {
								it('then calling burnPynths() succeeds', async () => {
									await periFinance.burnPynthsAndUnstakeUSDC(toUnit('1'), 0, { from: account1 });
								});
								it('and calling burnPynthsToTarget() succeeds', async () => {
									await periFinance.burnPynthsToTarget({ from: account1 });
								});
							} else {
								it('then calling burn() reverts', async () => {
									await assert.revert(
										periFinance.burnPynthsAndUnstakeUSDC(toUnit('1'), 0, { from: account1 }),
										'A pynth or PERI rate is invalid'
									);
								});
								it('and calling burnPynthsToTarget() reverts', async () => {
									await assert.revert(
										periFinance.burnPynthsToTarget({ from: account1 }),
										'A pynth or PERI rate is invalid'
									);
								});
							}
						});
					});
				});

				it('should allow an issuer with outstanding debt to burn pynths and decrease debt', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issueMaxPynths({ from: account1 });

					// account1 should now have 400 pUSD of debt.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('400'));

					// Burn 100 pUSD
					await periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), 0, { from: account1 });

					// account1 should now have 100 pUSD of debt.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('300'));
				});

				it('should disallow an issuer without outstanding debt from burning pynths', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issueMaxPynths({ from: account1 });

					// account2 should not have anything and can't burn.
					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('10'), 0, { from: account2 }),
						'No debt to forgive'
					);

					// And even when we give account2 pynths, it should not be able to burn.
					await pUSDContract.transfer(account2, toUnit('100'), {
						from: account1,
					});

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('10'), 0, { from: account2 }),
						'No debt to forgive'
					);
				});

				it('should revert when trying to burn pynths that do not exist', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issueMaxPynths({ from: account1 });

					// Transfer all newly issued pynths to account2
					await pUSDContract.transfer(account2, toUnit('400'), {
						from: account1,
					});

					const debtBefore = await periFinance.debtBalanceOf(account1, pUSD);
					assert.ok(!debtBefore.isNeg());

					// Burning any amount of pUSD beyond what is owned will cause a revert
					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC('1', 0, { from: account1 }),
						'SafeMath: subtraction overflow'
					);
				});

				it("should only burn up to a user's actual debt level", async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('10000'), {
						from: owner,
					});

					// Issue
					const fullAmount = toUnit('400');
					const account1Payment = toUnit('100');
					const account2Payment = fullAmount.sub(account1Payment);
					await periFinance.issuePynthsAndStakeUSDC(account1Payment, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(account2Payment, 0, { from: account2 });

					// Transfer all of account2's pynths to account1
					const amountTransferred = toUnit('200');
					await pUSDContract.transfer(account1, amountTransferred, {
						from: account2,
					});

					const balanceOfAccount1 = await pUSDContract.balanceOf(account1);

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await periFinance.burnPynthsAndUnstakeUSDC(balanceOfAccount1, 0, { from: account1 });
					const balanceOfAccount1AfterBurn = await pUSDContract.balanceOf(account1);

					// Recording debts in the debt ledger reduces accuracy.
					//   Let's allow for a 0 margin of error.
					assert.bnClose(balanceOfAccount1AfterBurn, amountTransferred, '0');
				});

				it("should successfully burn all user's pynths @gasprofile", async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issuePynthsAndStakeUSDC(toUnit('199'), 0, { from: account1 });

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await periFinance.burnPynthsAndUnstakeUSDC(await pUSDContract.balanceOf(account1), 0, {
						from: account1,
					});

					assert.bnEqual(await pUSDContract.balanceOf(account1), web3.utils.toBN(0));
				});

				it('should burn the correct amount of pynths', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('200000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('200000'), {
						from: owner,
					});

					// Issue
					await periFinance.issuePynthsAndStakeUSDC(toUnit('199'), 0, { from: account1 });

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await periFinance.burnPynthsAndUnstakeUSDC(await pUSDContract.balanceOf(account1), 0, {
						from: account1,
					});

					assert.bnEqual(await pUSDContract.balanceOf(account1), web3.utils.toBN(0));
				});

				it('should burn the correct amount of pynths', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('200000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('200000'), {
						from: owner,
					});

					// Issue
					const issuedPynthsPt1 = toUnit('2000');
					const issuedPynthsPt2 = toUnit('2000');
					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt1, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt2, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('1000'), 0, { from: account2 });

					const debt = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debt, toUnit('4000'));
				});

				describe('debt calculation in multi-issuance scenarios', () => {
					it('should correctly calculate debt in a multi-issuance multi-burn scenario @gasprofile', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('500000'), {
							from: owner,
						});
						await periFinance.transfer(account2, toUnit('140000'), {
							from: owner,
						});
						await periFinance.transfer(account3, toUnit('1400000'), {
							from: owner,
						});

						// Issue
						const issuedPynths1 = toUnit('2000');
						const issuedPynths2 = toUnit('2000');
						const issuedPynths3 = toUnit('2000');

						// Send more than their pynth balance to burn all
						const burnAllPynths = toUnit('2050');

						await periFinance.issuePynthsAndStakeUSDC(issuedPynths1, 0, { from: account1 });
						await periFinance.issuePynthsAndStakeUSDC(issuedPynths2, 0, { from: account2 });
						await periFinance.issuePynthsAndStakeUSDC(issuedPynths3, 0, { from: account3 });

						await periFinance.burnPynthsAndUnstakeUSDC(burnAllPynths, 0, { from: account1 });
						await periFinance.burnPynthsAndUnstakeUSDC(burnAllPynths, 0, { from: account2 });
						await periFinance.burnPynthsAndUnstakeUSDC(burnAllPynths, 0, { from: account3 });

						const debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						const debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);
						const debtBalance3After = await periFinance.debtBalanceOf(account3, pUSD);

						assert.bnEqual(debtBalance1After, '0');
						assert.bnEqual(debtBalance2After, '0');
						assert.bnEqual(debtBalance3After, '0');
					});

					it('should allow user to burn all pynths issued even after other users have issued', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('500000'), {
							from: owner,
						});
						await periFinance.transfer(account2, toUnit('140000'), {
							from: owner,
						});
						await periFinance.transfer(account3, toUnit('1400000'), {
							from: owner,
						});

						// Issue
						const issuedPynths1 = toUnit('2000');
						const issuedPynths2 = toUnit('2000');
						const issuedPynths3 = toUnit('2000');

						await periFinance.issuePynthsAndStakeUSDC(issuedPynths1, 0, { from: account1 });
						await periFinance.issuePynthsAndStakeUSDC(issuedPynths2, 0, { from: account2 });
						await periFinance.issuePynthsAndStakeUSDC(issuedPynths3, 0, { from: account3 });

						const debtBalanceBefore = await periFinance.debtBalanceOf(account1, pUSD);
						await periFinance.burnPynthsAndUnstakeUSDC(debtBalanceBefore, 0, { from: account1 });
						const debtBalanceAfter = await periFinance.debtBalanceOf(account1, pUSD);

						assert.bnEqual(debtBalanceAfter, '0');
					});

					it('should allow a user to burn up to their balance if they try too burn too much', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('500000'), {
							from: owner,
						});

						// Issue
						const issuedPynths1 = toUnit('10');

						await periFinance.issuePynthsAndStakeUSDC(issuedPynths1, 0, { from: account1 });
						await periFinance.burnPynthsAndUnstakeUSDC(issuedPynths1.add(toUnit('9000')), 0, {
							from: account1,
						});
						const debtBalanceAfter = await periFinance.debtBalanceOf(account1, pUSD);

						assert.bnEqual(debtBalanceAfter, '0');
					});

					it('should allow users to burn their debt and adjust the debtBalanceOf correctly for remaining users', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('40000000'), {
							from: owner,
						});
						await periFinance.transfer(account2, toUnit('40000000'), {
							from: owner,
						});

						// Issue
						const issuedPynths1 = toUnit('150000');
						const issuedPynths2 = toUnit('50000');

						await periFinance.issuePynthsAndStakeUSDC(issuedPynths1, 0, { from: account1 });
						await periFinance.issuePynthsAndStakeUSDC(issuedPynths2, 0, { from: account2 });

						let debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						let debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);

						// debtBalanceOf has rounding error but is within tolerance
						assert.bnClose(debtBalance1After, toUnit('150000'));
						assert.bnClose(debtBalance2After, toUnit('50000'));

						// Account 1 burns 100,000
						await periFinance.burnPynthsAndUnstakeUSDC(toUnit('100000'), 0, { from: account1 });

						debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);

						assert.bnClose(debtBalance1After, toUnit('50000'));
						assert.bnClose(debtBalance2After, toUnit('50000'));
					});

					it('should revert if sender tries to issue pynths with 0 amount', async () => {
						// Issue 0 amount of pynth
						const issuedPynths1 = toUnit('0');

						await assert.revert(
							periFinance.issuePynthsAndStakeUSDC(issuedPynths1, 0, { from: account1 }),
							'SafeMath: division by zero'
						);
					});
				});

				describe('burnPynthsToTarget', () => {
					beforeEach(async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('40000'), {
							from: owner,
						});
						// Set PERI price to 1
						await exchangeRates.updateRates([PERI], ['1'].map(toUnit), timestamp, {
							from: oracle,
						});
						// Issue
						await periFinance.issueMaxPynths({ from: account1 });
						assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), toUnit('8000'));

						// Set minimumStakeTime to 1 hour
						await systemSettings.setMinimumStakeTime(60 * 60, { from: owner });
					});

					describe('when the PERI price drops 50%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['.5'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
							assert.equal(await feePool.isFeesClaimable(account1), false);
						});

						it('then the maxIssuablePynths drops 50%', async () => {
							assert.bnClose(maxIssuablePynths, toUnit('4000'));
						});
						it('then calling burnPynthsToTarget() reduces pUSD to c-ratio target', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), toUnit('4000'));
						});
						it('then fees are claimable', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price drops 10%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['.9'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths drops 10%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('7200'));
						});
						it('then calling burnPynthsToTarget() reduces pUSD to c-ratio target', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('7200'));
						});
						it('then fees are claimable', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price drops 90%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['.1'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths drops 10%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('800'));
						});
						it('then calling burnPynthsToTarget() reduces pUSD to c-ratio target', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('800'));
						});
						it('then fees are claimable', async () => {
							await periFinance.burnPynthsToTarget({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price increases 100%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['2'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await periFinance.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths increases 100%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('16000'));
						});
						it('then calling burnPynthsToTarget() reverts', async () => {
							await assert.revert(
								periFinance.burnPynthsToTarget({ from: account1 }),
								'SafeMath: subtraction overflow'
							);
						});
					});
				});

				/**
				describe('burnPynths() after exchange()', () => {
					describe('given the waiting period is set to 60s', () => {
						let amount;
						const exchangeFeeRate = toUnit('0');
						beforeEach(async () => {
							amount = toUnit('1250');
							await setExchangeWaitingPeriod({ owner, systemSettings, secs: 60 });

							// set the exchange fee to 0 to effectively ignore it
							await setExchangeFeeRateForPynths({
								owner,
								systemSettings,
								pynthKeys,
								exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
							});
						});

						 describe('and a user has 1250 pUSD issued', () => {
							 beforeEach(async () => {
								 await periFinance.transfer(account1, toUnit('1000000'), { from: owner });
								 await periFinance.issuePynthsAndStakeUSDC(amount, toUnit('0'), { from: account1 });
							 });
							 describe('and is has been exchanged into pEUR at a rate of 1.25:1 and the waiting period has expired', () => {
								 beforeEach(async () => {
									 await periFinance.exchange(pUSD, amount, pEUR, { from: account1 });
									 await fastForward(90); // make sure the waiting period is expired on this
								 });
								 describe('and they have exchanged all of it back into pUSD', () => {
									 beforeEach(async () => {
										 await periFinance.exchange(pEUR, toUnit('1000'), pUSD, { from: account1 });
									 });
									 describe('when they attempt to burn the pUSD', () => {
										 it('then it fails as the waiting period is ongoing', async () => {
											 await assert.revert(
												 periFinance.burnPynths(amount, { from: account1 }),
												 'Cannot settle during waiting period'
											 );
										 });
									 });
									 describe('and 60s elapses with no change in the pEUR rate', () => {
										 beforeEach(async () => {
											 fastForward(60);
										 });
										 describe('when they attempt to burn the pUSD', () => {
											 let txn;
											 beforeEach(async () => {
												 txn = await periFinance.burnPynths(amount, { from: account1 });
											 });
											 it('then it succeeds and burns the entire pUSD amount', async () => {
												 const logs = await getDecodedLogs({
													 hash: txn.tx,
													 contracts: [periFinance, pUSDContract],
												 });
 
												 decodedEventEqual({
													 event: 'Burned',
													 emittedFrom: pUSDContract.address,
													 args: [account1, amount],
													 log: logs.find(({ name } = {}) => name === 'Burned'),
												 });
 
												 const pUSDBalance = await pUSDContract.balanceOf(account1);
												 assert.equal(pUSDBalance, '0');
 
												 const debtBalance = await periFinance.debtBalanceOf(account1, pUSD);
												 assert.equal(debtBalance, '0');
											 });
										 });
									 });
									 describe('and the pEUR price decreases by 20% to 1', () => {
										 beforeEach(async () => {
											 await exchangeRates.updateRates([pEUR], ['1'].map(toUnit), timestamp, {
												 from: oracle,
											 });
											 await debtCache.takeDebtSnapshot();
										 });
										 describe('and 60s elapses', () => {
											 beforeEach(async () => {
												 fastForward(60);
											 });
											 describe('when they attempt to burn the entire amount pUSD', () => {
												 let txn;
												 beforeEach(async () => {
													 txn = await periFinance.burnPynths(amount, { from: account1 });
												 });
												 it('then it succeeds and burns their pUSD minus the reclaim amount from settlement', async () => {
													 const logs = await getDecodedLogs({
														 hash: txn.tx,
														 contracts: [periFinance, pUSDContract],
													 });
 
													 decodedEventEqual({
														 event: 'Burned',
														 emittedFrom: pUSDContract.address,
														 args: [account1, amount.sub(toUnit('250'))],
														 log: logs
															 .reverse()
															 .filter(l => !!l)
															 .find(({ name }) => name === 'Burned'),
													 });
 
													 const pUSDBalance = await pUSDContract.balanceOf(account1);
													 assert.equal(pUSDBalance, '0');
												 });
												 it('and their debt balance is now 0 because they are the only debt holder in the system', async () => {
													 // the debt balance remaining is what was reclaimed from the exchange
													 const debtBalance = await periFinance.debtBalanceOf(account1, pUSD);
													 // because this user is the only one holding debt, when we burn 250 pUSD in a reclaim,
													 // it removes it from the totalIssuedPynths and
													 assert.equal(debtBalance, '0');
												 });
											 });
											 describe('when another user also has the same amount of debt', () => {
												 beforeEach(async () => {
													 await periFinance.transfer(account2, toUnit('1000000'), { from: owner });
													 await periFinance.issuePynthsAndStakeUSDC(amount, toUnit('0'), { from: account2 });
												 });
												 describe('when the first user attempts to burn the entire amount pUSD', () => {
													 let txn;
													 beforeEach(async () => {
														 txn = await periFinance.burnPynths(amount, { from: account1 });
													 });
													 it('then it succeeds and burns their pUSD minus the reclaim amount from settlement', async () => {
														 const logs = await getDecodedLogs({
															 hash: txn.tx,
															 contracts: [periFinance, pUSDContract],
														 });
 
														 decodedEventEqual({
															 event: 'Burned',
															 emittedFrom: pUSDContract.address,
															 args: [account1, amount.sub(toUnit('250'))],
															 log: logs
																 .reverse()
																 .filter(l => !!l)
																 .find(({ name }) => name === 'Burned'),
														 });
 
														 const pUSDBalance = await pUSDContract.balanceOf(account1);
														 assert.equal(pUSDBalance, '0');
													 });
													 it('and their debt balance is now half of the reclaimed balance because they owe half of the pool', async () => {
														 // the debt balance remaining is what was reclaimed from the exchange
														 const debtBalance = await periFinance.debtBalanceOf(account1, pUSD);
														 // because this user is holding half the debt, when we burn 250 pUSD in a reclaim,
														 // it removes it from the totalIssuedPynths and so both users have half of 250
														 // in owing pynths
														 assert.bnEqual(debtBalance, divideDecimal('250', 2));
													 });
												 });
											 });
										 });
									 });
								 });
							 });
						 });
						});
					});
					*/
			});

			describe('burning and unstake USDC', () => {
				const updateRates = async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('0.9')], timestamp, {
						from: oracle,
					});
				};

				beforeEach(async () => {
					await systemSettings.setMinimumStakeTime(86400, { from: owner });

					await updateRates();

					await Promise.all([
						periFinance.transfer(account1, toUnit('100000'), { from: owner }),
						usdc.transfer(account1, toUnit('100000'), { from: owner }),
						usdc.approve(issuer.address, toUnit('100000'), { from: account1 }),
					]);

					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), 0, { from: account1 });

					await fastForward(86400 + 1);

					await updateRates();

					await debtCache.takeDebtSnapshot();
				});

				it('should initiate', async () => {
					const stakeTime = await systemSettings.minimumStakeTime();

					assert.bnEqual(stakeTime, web3.utils.toBN('86400'));
				});

				it('should burn', async () => {
					const stakedAmount = web3.utils.toBN(toUnit('20000'));
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), stakedAmount, {
						from: account1,
					});

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), 0, { from: account1 }),
						'Minimum stake time not reached'
					);

					await fastForward(86400 + 1);

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), 0, { from: account1 }),
						'A pynth or PERI rate is invalid'
					);

					await updateRates();

					await debtCache.takeDebtSnapshot();

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), 0),
						'No debt to forgive'
					);

					const pUSDBalance_1_before = await pUSDContract.balanceOf(account1);
					const usdcStakedAmount_1_before = await stakingStateUSDC.stakedAmountOf(account1);
					const debtBalance_1_before = await periFinance.debtBalanceOf(account1, pUSD);
					const quota_before = await periFinance.currentUSDCDebtQuota(account1);
					const usdcBalance_1_before = await usdc.balanceOf(account1);

					assert.bnLt(quota_before, toUnit('0.2'));

					// It exceeds
					await periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), 0, { from: account1 });

					const pUSDBalance_1_after = await pUSDContract.balanceOf(account1);
					const usdcStakedAmount_1_after = await stakingStateUSDC.stakedAmountOf(account1);
					const debtBalance_1_after = await periFinance.debtBalanceOf(account1, pUSD);
					const quota_after = await periFinance.currentUSDCDebtQuota(account1);
					const usdcBalance_1_after = await usdc.balanceOf(account1);

					assert.bnEqual(pUSDBalance_1_before.sub(toUnit('100')), pUSDBalance_1_after);
					assert.bnEqual(debtBalance_1_before.sub(toUnit('100')), debtBalance_1_after);
					assert.bnEqual(usdcStakedAmount_1_before, usdcStakedAmount_1_after);
					assert.bnEqual(usdcBalance_1_after, usdcBalance_1_before);
					assert.bnGt(quota_after, quota_before);
				});

				it('should burn and unstake USDC', async () => {
					const stakeAmount = web3.utils.toBN('22222' + '2'.repeat(18));
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), stakeAmount, {
						from: account1,
					});

					await fastForward(86400 + 1);
					await updateRates();
					await debtCache.takeDebtSnapshot();

					const pUSDBalance_1_before = await pUSDContract.balanceOf(account1);
					const usdcStakedAmount_1_before = await stakingStateUSDC.stakedAmountOf(account1);
					const debtBalance_1_before = await periFinance.debtBalanceOf(account1, pUSD);
					const quota_before = await periFinance.currentUSDCDebtQuota(account1);
					const usdcBalance_1_before = await usdc.balanceOf(account1);
					const usdcBalance_state_before = await usdc.balanceOf(stakingStateUSDC.address);

					assert.bnEqual(usdcBalance_state_before, stakeAmount.div(web3.utils.toBN(10 ** 12)));
					// since stakeing state value would be parsed to 10**12
					assert.bnEqual(quota_before, toUnit('0.199999999998'));

					// Currently user has maximum quota staked. (pUSD, USDC) = (20000 , 22222.222222)
					// If user burns 100 pUSD with 20 USDC untaking,
					// although it satisfies input amount, it violates maximum quota in a result.
					// After quota = (22202.222222 * ExRate * issuanceRatio) / 19900 = 0.2008241206...
					const unstakeAmount_fail = web3.utils.toBN('20' + '0'.repeat(18));
					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), unstakeAmount_fail, {
							from: account1,
						}),
						'USDC staked exceeds quota'
					);

					const unstakeAmount = web3.utils.toBN('500' + '0'.repeat(18));
					await periFinance.burnPynthsAndUnstakeUSDC(toUnit('100'), unstakeAmount, {
						from: account1,
					});

					const pUSDBalance_1_after = await pUSDContract.balanceOf(account1);
					const usdcStakedAmount_1_after = await stakingStateUSDC.stakedAmountOf(account1);
					const debtBalance_1_after = await periFinance.debtBalanceOf(account1, pUSD);
					const quota_after = await periFinance.currentUSDCDebtQuota(account1);
					const usdcBalance_1_after = await usdc.balanceOf(account1);
					const usdcBalance_state_after = await usdc.balanceOf(stakingStateUSDC.address);

					assert.bnEqual(pUSDBalance_1_before.sub(toUnit('100')), pUSDBalance_1_after);
					assert.bnEqual(usdcStakedAmount_1_before.sub(unstakeAmount), usdcStakedAmount_1_after);
					assert.bnEqual(debtBalance_1_before.sub(toUnit('100')), debtBalance_1_after);
					assert.bnEqual(
						usdcBalance_1_before.add(unstakeAmount.div(web3.utils.toBN(10 ** 12))),
						usdcBalance_1_after
					);
					assert.bnEqual(
						usdcBalance_state_before.sub(unstakeAmount.div(web3.utils.toBN(10 ** 12))),
						usdcBalance_state_after
					);
					assert.bnLte(quota_after, toUnit('0.2'));

					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const issuanceRatio = await issuer.issuanceRatio();
					assert.bnClose(
						quota_after,
						divideDecimal(
							multiplyDecimal(
								multiplyDecimal(stakeAmount.sub(unstakeAmount), usdcExRate),
								issuanceRatio
							),
							toUnit('20000').sub(toUnit('100'))
						),
						10 ** 7
					);
				});

				it('should NOT burn if burn amount exceeds USDC staked amount', async () => {
					// value "1" would be ignored(rounded), minimum input amount should be larger than 10**12 (since staking state would be parsed).
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), '1' + '0'.repeat(12), {
						from: account1,
					});

					await fastForward(86400 + 1);
					await updateRates();
					await debtCache.takeDebtSnapshot();

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('20000'), 0, { from: account1 }),
						'Burn amount exceeds available amount'
					);
				});

				it('should NOT unstake more than the amount of user staked', async () => {
					await usdc.transfer(stakingStateUSDC.address, '10000' + '0'.repeat(6), {
						from: accounts[0],
					}),
						await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), toUnit('100'), {
							from: account1,
						});

					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('1000'), toUnit('101'), { from: account1 }),
						"User doesn't have enough staked amount"
					);
				});

				it('should NOT burn USDC amount that makes no Peri lock', async () => {
					const stakeAmount = web3.utils.toBN(toUnit('5000'));
					await periFinance.issuePynthsAndStakeUSDC(toUnit('10000'), stakeAmount, {
						from: account1,
					});

					const debtBalance_1_before = await periFinance.debtBalanceOf(account1, pUSD);
					const usdcStakedAmount_1_before = await stakingStateUSDC.stakedAmountOf(account1);

					assert.bnEqual(debtBalance_1_before, toUnit('20000'));
					assert.bnEqual(usdcStakedAmount_1_before, stakeAmount);

					await fastForward(86400 + 1);
					await updateRates();
					await debtCache.takeDebtSnapshot();

					// Try to unlock all PERI
					await assert.revert(
						periFinance.burnPynthsAndUnstakeUSDC(toUnit('19100'), 0, { from: account1 }),
						'USDC staked exceeds quota'
					);

					await periFinance.burnPynthsAndUnstakeUSDC(toUnit('15500'), 0, { from: account1 });
				});

				it('should fit to claimable if C-Ratio < threshhold, not exceeds debt quota', async () => {
					// transfer back to deployer to adjust amounts
					await periFinance.transfer(accounts[0], toUnit('90000'), { from: account1 });

					// Set issued max (Fit to max quota and target C-Ratio)
					const stakingAmount = '27777' + '7'.repeat(17) + '8';
					await periFinance.issuePynthsAndStakeUSDC(toUnit('15000'), stakingAmount, {
						from: account1,
					});

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance_1,
						debtBalance_1,
						totalIssuedPUSD,
						usdcQuota,
						cRatio_before,
					] = await Promise.all([
						periFinance.usdcStakedAmountOf(account1),
						periFinance.usdcTotalStakedAmount(),
						periFinance.totalUSDCStakerCount(),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						periFinance.currentUSDCDebtQuota(account1),
						periFinance.collateralisationRatio(account1),
					]);

					assert.bnEqual(
						stakedAmount,
						web3.utils
							.toBN(stakingAmount)
							.div(web3.utils.toBN(10 ** 12))
							.mul(web3.utils.toBN(10 ** 12))
					);
					assert.bnEqual(
						totalStaked,
						web3.utils
							.toBN(stakingAmount)
							.div(web3.utils.toBN(10 ** 12))
							.mul(web3.utils.toBN(10 ** 12))
					);
					assert.bnEqual(numOfStaker, '1');
					assert.bnEqual(pUSDBalance_1, toUnit('25000'));
					assert.bnEqual(debtBalance_1, toUnit('25000'));
					assert.bnEqual(totalIssuedPUSD, toUnit('25000'));
					assert.bnClose(usdcQuota, toUnit('0.2'), 10 ** 12);
					assert.bnClose(cRatio_before, toUnit('0.2'), 10 ** 12);

					// As Peri price is going down, C-Ratio would be increased.
					// Meanwhile, usdc quota is not be changed.
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['5', '0.9'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					const cRatio_beforeFit = await periFinance.collateralisationRatio(account1);
					const quota_beforeFit = await periFinance.currentUSDCDebtQuota(account1);
					// C-Ratio is expected less than 500%
					assert.bnGt(cRatio_beforeFit, toUnit('0.2'));
					assert.bnClose(quota_beforeFit, toUnit('0.2'), 10 ** 7);

					await periFinance.burnPynthsAndUnstakeUSDCToTarget({ from: account1 });
					const cRatio_afterFit = await periFinance.collateralisationRatio(account1);
					const quota_afterFit = await periFinance.currentUSDCDebtQuota(account1);
					assert.bnClose(cRatio_afterFit, toUnit('0.2'), 10 ** 12);
					assert.bnClose(quota_afterFit, toUnit('0.2'), 10 ** 12);
				});

				it('should fit to claimable if C-Ratio < 0 and exceeds debt quota', async () => {
					// transfer back to deployer to adjust amounts
					await periFinance.transfer(accounts[0], toUnit('90000'), { from: account1 });

					// Set issued max (Fit to max quota and target C-Ratio)
					const stakingAmount = '27777' + '7'.repeat(17) + '8';
					await periFinance.issuePynthsAndStakeUSDC(toUnit('15000'), stakingAmount, {
						from: account1,
					});

					// As Peri price is going down, C-Ratio would be increased.
					// Meanwhile, usdc quota is not be changed.
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['5', '1.2'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					const [usdcQuota_beforeFit, cRatio_beforeFit] = await Promise.all([
						periFinance.currentUSDCDebtQuota(account1),
						periFinance.collateralisationRatio(account1),
					]);

					assert.bnGt(usdcQuota_beforeFit, toUnit('0.2'));
					assert.bnGt(cRatio_beforeFit, toUnit('0.2'));

					await periFinance.burnPynthsAndUnstakeUSDCToTarget({ from: account1 });

					const cRatio_afterFit = await periFinance.collateralisationRatio(account1);
					const quota_afterFit = await periFinance.currentUSDCDebtQuota(account1);
					assert.bnClose(cRatio_afterFit, toUnit('0.2'), 10 ** 12);
					assert.bnClose(quota_afterFit, toUnit('0.2'), 10 ** 12);
				});

				it('should fit to claimable if C-Ratio > threshhold, exceeds quota', async () => {
					// transfer back to deployer to adjust amounts
					await periFinance.transfer(accounts[0], toUnit('90000'), { from: account1 });

					// Set issued max
					const stakingAmount = '27777' + '7'.repeat(17) + '8';
					await periFinance.issuePynthsAndStakeUSDC(toUnit('15000'), stakingAmount, {
						from: account1,
					});

					// As USDC Price going up, its debt quota would also be increased.
					// C-Ratio is expected to be larger than 400%, meanwhile quota is above threshold)
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['10', '1.2'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					const cRatio_beforeFit = await periFinance.collateralisationRatio(account1);
					const quota_beforeFit = await periFinance.currentUSDCDebtQuota(account1);
					assert.bnLt(cRatio_beforeFit, toUnit('0.2'));
					assert.bnGt(quota_beforeFit, toUnit('0.2'));

					await periFinance.burnPynthsAndUnstakeUSDCToTarget({ from: account1 });
					const cRatio_afterFit = await periFinance.collateralisationRatio(account1);
					const quota_afterFit = await periFinance.currentUSDCDebtQuota(account1);
					// It doesn't fit C-Ratio if it already satisfies target ratio.
					assert.bnLt(cRatio_afterFit, toUnit('0.2'));
					assert.bnClose(quota_afterFit, toUnit('0.2'), 10 ** 12);
				});
			});

			describe('debt calculation in multi-issuance scenarios', () => {
				it('should correctly calculate debt in a multi-issuance scenario', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('200000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('200000'), {
						from: owner,
					});

					// Issue
					const issuedPynthsPt1 = toUnit('2000');
					const issuedPynthsPt2 = toUnit('2000');
					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt1, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt2, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('1000'), 0, { from: account2 });

					const debt = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debt, toUnit('4000'));
				});

				// it("should correctly calculate debt in a multi-usdc ")

				it('should correctly calculate debt in a multi-issuance multi-burn scenario', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('500000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('14000'), {
						from: owner,
					});

					// Issue
					const issuedPynthsPt1 = toUnit('2000');
					const burntPynthsPt1 = toUnit('1500');
					const issuedPynthsPt2 = toUnit('1600');
					const burntPynthsPt2 = toUnit('500');

					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt1, 0, { from: account1 });
					await periFinance.burnPynthsAndUnstakeUSDC(burntPynthsPt1, 0, { from: account1 });
					await periFinance.issuePynthsAndStakeUSDC(issuedPynthsPt2, 0, { from: account1 });

					await periFinance.issuePynthsAndStakeUSDC(toUnit('100'), 0, { from: account2 });
					await periFinance.issuePynthsAndStakeUSDC(toUnit('51'), 0, { from: account2 });
					await periFinance.burnPynthsAndUnstakeUSDC(burntPynthsPt2, 0, { from: account1 });

					const debt = await periFinance.debtBalanceOf(account1, toBytes32('pUSD'));
					const expectedDebt = issuedPynthsPt1
						.add(issuedPynthsPt2)
						.sub(burntPynthsPt1)
						.sub(burntPynthsPt2);

					assert.bnClose(debt, expectedDebt);
				});

				it("should allow me to burn all pynths I've issued when there are other issuers", async () => {
					const totalSupply = await periFinance.totalSupply();
					const account2PeriFinances = toUnit('120000');
					const account1PeriFinances = totalSupply.sub(account2PeriFinances);

					await periFinance.transfer(account1, account1PeriFinances, {
						from: owner,
					}); // Issue the massive majority to account1
					await periFinance.transfer(account2, account2PeriFinances, {
						from: owner,
					}); // Issue a small amount to account2

					// Issue from account1
					const account1AmountToIssue = await periFinance.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					// Issue and burn from account 2 all debt
					await periFinance.issuePynthsAndStakeUSDC(toUnit('43'), 0, { from: account2 });
					let debt = await periFinance.debtBalanceOf(account2, pUSD);
					await periFinance.burnPynthsAndUnstakeUSDC(toUnit('43'), 0, { from: account2 });
					debt = await periFinance.debtBalanceOf(account2, pUSD);

					assert.bnEqual(debt, 0);

					// Should set user issuanceData to 0 debtOwnership and retain debtEntryIndex of last action
					assert.deepEqual(await periFinanceState.issuanceData(account2), {
						initialDebtOwnership: 0,
						debtEntryIndex: 2,
					});
				});
			});

			// These tests take a long time to run
			// ****************************************
			describe('multiple issue and burn scenarios', () => {
				it('should correctly calculate debt in a high issuance and burn scenario', async () => {
					const getRandomInt = (min, max) => {
						return min + Math.floor(Math.random() * Math.floor(max));
					};

					const totalSupply = await periFinance.totalSupply();
					const account2PeriFinances = toUnit('120000');
					const account1PeriFinances = totalSupply.sub(account2PeriFinances);

					await periFinance.transfer(account1, account1PeriFinances, {
						from: owner,
					}); // Issue the massive majority to account1
					await periFinance.transfer(account2, account2PeriFinances, {
						from: owner,
					}); // Issue a small amount to account2

					const account1AmountToIssue = await periFinance.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = web3.utils.toBN('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
						const amount = toUnit('43');
						await periFinance.issuePynthsAndStakeUSDC(amount, 0, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

						const desiredAmountToBurn = toUnit(web3.utils.toBN(getRandomInt(4, 14)));
						const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
							? desiredAmountToBurn
							: expectedDebtForAccount2;
						await periFinance.burnPynthsAndUnstakeUSDC(amountToBurn, 0, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);

						// Useful debug logging
						// const db = await periFinance.debtBalanceOf(account2, pUSD);
						// const variance = fromUnit(expectedDebtForAccount2.sub(db));
						// console.log(
						// 	`#### debtBalance: ${db}\t\t expectedDebtForAccount2: ${expectedDebtForAccount2}\t\tvariance: ${variance}`
						// );
					}
					const debtBalance = await periFinance.debtBalanceOf(account2, pUSD);

					// Here we make the variance a calculation of the number of times we issue/burn.
					// This is less than ideal, but is the result of calculating the debt based on
					// the results of the issue/burn each time.
					const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
					assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
				}).timeout(60e3);

				it('should correctly calculate debt in a high (random) issuance and burn scenario', async () => {
					const getRandomInt = (min, max) => {
						return min + Math.floor(Math.random() * Math.floor(max));
					};

					const totalSupply = await periFinance.totalSupply();
					const account2PeriFinances = toUnit('120000');
					const account1PeriFinances = totalSupply.sub(account2PeriFinances);

					await periFinance.transfer(account1, account1PeriFinances, {
						from: owner,
					}); // Issue the massive majority to account1
					await periFinance.transfer(account2, account2PeriFinances, {
						from: owner,
					}); // Issue a small amount to account2

					const account1AmountToIssue = await periFinance.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = web3.utils.toBN('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
						const amount = toUnit(web3.utils.toBN(getRandomInt(40, 49)));
						await periFinance.issuePynthsAndStakeUSDC(amount, 0, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

						const desiredAmountToBurn = toUnit(web3.utils.toBN(getRandomInt(37, 46)));
						const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
							? desiredAmountToBurn
							: expectedDebtForAccount2;
						await periFinance.burnPynthsAndUnstakeUSDC(amountToBurn, 0, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.sub(amountToBurn);

						// Useful debug logging
						// const db = await periFinance.debtBalanceOf(account2, pUSD);
						// const variance = fromUnit(expectedDebtForAccount2.sub(db));
						// console.log(
						// 	`#### debtBalance: ${db}\t\t expectedDebtForAccount2: ${expectedDebtForAccount2}\t\tvariance: ${variance}`
						// );
					}
					const debtBalance = await periFinance.debtBalanceOf(account2, pUSD);

					// Here we make the variance a calculation of the number of times we issue/burn.
					// This is less than ideal, but is the result of calculating the debt based on
					// the results of the issue/burn each time.
					const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
					assert.bnClose(debtBalance, expectedDebtForAccount2, variance);
				}).timeout(60e3);

				it('should correctly calculate debt in a high volume contrast issuance and burn scenario', async () => {
					const totalSupply = await periFinance.totalSupply();

					// Give only 100 PeriFinance to account2
					const account2PeriFinances = toUnit('100');

					// Give the vast majority to account1 (ie. 99,999,900)
					const account1PeriFinances = totalSupply.sub(account2PeriFinances);

					await periFinance.transfer(account1, account1PeriFinances, {
						from: owner,
					}); // Issue the massive majority to account1
					await periFinance.transfer(account2, account2PeriFinances, {
						from: owner,
					}); // Issue a small amount to account2

					const account1AmountToIssue = await periFinance.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = web3.utils.toBN('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						const amount = toUnit('0.000000000000000002');
						await periFinance.issuePynthsAndStakeUSDC(amount, 0, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);
					}
					const debtBalance2 = await periFinance.debtBalanceOf(account2, pUSD);

					// Here we make the variance a calculation of the number of times we issue/burn.
					// This is less than ideal, but is the result of calculating the debt based on
					// the results of the issue/burn each time.
					const variance = web3.utils.toBN(totalTimesToIssue).mul(web3.utils.toBN('2'));
					assert.bnClose(debtBalance2, expectedDebtForAccount2, variance);
				}).timeout(60e3);
			});

			// ****************************************
			/**
			it("should prevent more issuance if the user's collaterisation changes to be insufficient", async () => {
				// Set pEUR for purposes of this test
				const timestamp1 = await currentTime();
				await exchangeRates.updateRates([pEUR], [toUnit('0.75')], timestamp1, { from: oracle });
				await debtCache.takeDebtSnapshot();

				const issuedPeriFinances = web3.utils.toBN('200000');
				await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
					from: owner,
				});

				const maxIssuablePynths = await periFinance.maxIssuablePynths(account1);

				// Issue
				const pynthsToNotIssueYet = web3.utils.toBN('2000');
				const issuedPynths = maxIssuablePynths.sub(pynthsToNotIssueYet);
				await periFinance.issuePynthsAndStakeUSDC(issuedPynths, toUnit('0'), { from: account1 });

				// exchange into pEUR
				await periFinance.exchange(pUSD, issuedPynths, pEUR, { from: account1 });

				// Increase the value of pEUR relative to periFinance
				const timestamp2 = await currentTime();
				await exchangeRates.updateRates([pEUR], [toUnit('1.10')], timestamp2, { from: oracle });
				await debtCache.takeDebtSnapshot();

				await assert.revert(
					periFinance.issuePynthsAndStakeUSDC(pynthsToNotIssueYet, toUnit('0'), { from: account1 }),
					'Amount too large'
				);
			});
			*/

			// Check user's collaterisation ratio

			describe('check collaterisation ratio', () => {
				const duration = 52 * WEEK;
				beforeEach(async () => {
					// setup rewardEscrowV2 with mocked feePool address
					await addressResolver.importAddresses([toBytes32('FeePool')], [account6], {
						from: owner,
					});

					// update the cached addresses
					await rewardEscrowV2.rebuildCache({ from: owner });
				});
				it('should return 0 if user has no periFinance when checking the collaterisation ratio', async () => {
					const ratio = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(ratio, new web3.utils.BN(0));
				});

				it('Any user can check the collaterisation ratio for a user', async () => {
					const issuedPeriFinances = web3.utils.toBN('320000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const issuedPynths = toUnit(web3.utils.toBN('6400'));
					await periFinance.issuePynthsAndStakeUSDC(issuedPynths, 0, { from: account1 });

					await periFinance.collateralisationRatio(account1, { from: account2 });
				});

				it('should be able to read collaterisation ratio for a user with periFinance but no debt', async () => {
					const issuedPeriFinances = web3.utils.toBN('30000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					const ratio = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(ratio, new web3.utils.BN(0));
				});

				it('should be able to read collaterisation ratio for a user with periFinance and debt', async () => {
					const issuedPeriFinances = web3.utils.toBN('320000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const issuedPynths = toUnit(web3.utils.toBN('6400'));
					await periFinance.issuePynthsAndStakeUSDC(issuedPynths, 0, { from: account1 });

					const debtBalanceOf = await periFinance.debtBalanceOf(account1, pUSD);

					const ratio = await periFinance.collateralisationRatio(account1, { from: account2 });
					assert.unitEqual(ratio, '0.1');
				});

				it("should include escrowed periFinance when calculating a user's collaterisation ratio", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const transferredPeriFinances = toUnit('60000');
					await periFinance.transfer(account1, transferredPeriFinances, {
						from: owner,
					});

					// Setup escrow
					const oneWeek = 60 * 60 * 24 * 7;
					const twelveWeeks = oneWeek * 12;
					const now = await currentTime();
					const escrowedPeriFinances = toUnit('30000');
					await periFinance.transfer(escrow.address, escrowedPeriFinances, {
						from: owner,
					});
					await escrow.appendVestingEntry(
						account1,
						web3.utils.toBN(now + twelveWeeks),
						escrowedPeriFinances,
						{
							from: owner,
						}
					);

					// Issue
					const maxIssuable = await periFinance.maxIssuablePynths(account1);
					await periFinance.issuePynthsAndStakeUSDC(maxIssuable, 0, { from: account1 });

					// Compare
					const collaterisationRatio = await periFinance.collateralisationRatio(account1);
					const expectedCollaterisationRatio = divideDecimal(
						maxIssuable,
						multiplyDecimal(escrowedPeriFinances.add(transferredPeriFinances), peri2usdRate)
					);
					assert.bnEqual(collaterisationRatio, expectedCollaterisationRatio);
				});

				it("should include escrowed reward periFinance when calculating a user's collateralisation ratio", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const transferredPeriFinances = toUnit('60000');
					await periFinance.transfer(account1, transferredPeriFinances, {
						from: owner,
					});

					const escrowedPeriFinances = toUnit('30000');
					await periFinance.transfer(rewardEscrowV2.address, escrowedPeriFinances, {
						from: owner,
					});
					await rewardEscrowV2.appendVestingEntry(account1, escrowedPeriFinances, duration, {
						from: account6,
					});

					// Issue
					const maxIssuable = await periFinance.maxIssuablePynths(account1);
					await periFinance.issuePynthsAndStakeUSDC(maxIssuable, 0, { from: account1 });
					// Compare
					const collaterisationRatio = await periFinance.collateralisationRatio(account1);
					const expectedCollaterisationRatio = divideDecimal(
						maxIssuable,
						multiplyDecimal(escrowedPeriFinances.add(transferredPeriFinances), peri2usdRate)
					);
					assert.bnEqual(collaterisationRatio, expectedCollaterisationRatio);
				});

				it('should permit user to issue pUSD debt with only escrowed PERI as collateral (no PERI in wallet)', async () => {
					const oneWeek = 60 * 60 * 24 * 7;
					const twelveWeeks = oneWeek * 12;
					const now = await currentTime();

					// ensure collateral of account1 is empty
					let collateral = await periFinance.collateral(account1, { from: account1 });
					assert.bnEqual(collateral, 0);

					// ensure account1 has no PERI balance
					const periBalance = await periFinance.balanceOf(account1);
					assert.bnEqual(periBalance, 0);

					// Append escrow amount to account1
					const escrowedAmount = toUnit('15000');
					await periFinance.transfer(escrow.address, escrowedAmount, {
						from: owner,
					});
					await escrow.appendVestingEntry(
						account1,
						web3.utils.toBN(now + twelveWeeks),
						escrowedAmount,
						{
							from: owner,
						}
					);

					// collateral should include escrowed amount
					collateral = await periFinance.collateral(account1, { from: account1 });
					assert.bnEqual(collateral, escrowedAmount);

					// Issue max pynths. (600 pUSD)
					await periFinance.issueMaxPynths({ from: account1 });

					// There should be 600 pUSD of value for account1
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('600'));
				});

				it('should permit user to issue pUSD debt with only reward escrow as collateral (no PERI in wallet)', async () => {
					// ensure collateral of account1 is empty
					let collateral = await periFinance.collateral(account1, { from: account1 });
					assert.bnEqual(collateral, 0);

					// ensure account1 has no PERI balance
					const periBalance = await periFinance.balanceOf(account1);
					assert.bnEqual(periBalance, 0);

					// Append escrow amount to account1
					const escrowedAmount = toUnit('15000');
					await periFinance.transfer(rewardEscrowV2.address, escrowedAmount, {
						from: owner,
					});
					await rewardEscrowV2.appendVestingEntry(account1, escrowedAmount, duration, {
						from: account6,
					});

					// collateral now should include escrowed amount
					collateral = await periFinance.collateral(account1, { from: account1 });
					assert.bnEqual(collateral, escrowedAmount);

					// Issue max pynths. (600 pUSD)
					await periFinance.issueMaxPynths({ from: account1 });

					// There should be 600 pUSD of value for account1
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('600'));
				});

				it("should permit anyone checking another user's collateral", async () => {
					const amount = toUnit('60000');
					await periFinance.transfer(account1, amount, { from: owner });
					const collateral = await periFinance.collateral(account1, { from: account2 });
					assert.bnEqual(collateral, amount);
				});

				it("should include escrowed periFinance when checking a user's collateral", async () => {
					const oneWeek = 60 * 60 * 24 * 7;
					const twelveWeeks = oneWeek * 12;
					const now = await currentTime();
					const escrowedAmount = toUnit('15000');
					await periFinance.transfer(escrow.address, escrowedAmount, {
						from: owner,
					});
					await escrow.appendVestingEntry(
						account1,
						web3.utils.toBN(now + twelveWeeks),
						escrowedAmount,
						{
							from: owner,
						}
					);

					const amount = toUnit('60000');
					await periFinance.transfer(account1, amount, { from: owner });
					const collateral = await periFinance.collateral(account1, { from: account2 });
					assert.bnEqual(collateral, amount.add(escrowedAmount));
				});

				it("should include escrowed reward periFinance when checking a user's collateral", async () => {
					const escrowedAmount = toUnit('15000');
					await periFinance.transfer(rewardEscrowV2.address, escrowedAmount, {
						from: owner,
					});
					await rewardEscrowV2.appendVestingEntry(account1, escrowedAmount, duration, {
						from: account6,
					});
					const amount = toUnit('60000');
					await periFinance.transfer(account1, amount, { from: owner });
					const collateral = await periFinance.collateral(account1, { from: account2 });
					assert.bnEqual(collateral, amount.add(escrowedAmount));
				});

				it("should calculate a user's remaining issuable pynths", async () => {
					const transferredPeriFinances = toUnit('60000');
					await periFinance.transfer(account1, transferredPeriFinances, {
						from: owner,
					});

					// Issue
					const maxIssuable = await periFinance.maxIssuablePynths(account1);
					const issued = maxIssuable.div(web3.utils.toBN(3));
					await periFinance.issuePynthsAndStakeUSDC(issued, 0, { from: account1 });
					const expectedRemaining = maxIssuable.sub(issued);
					const remaining = await getRemainingIssuablePynths(account1);
					assert.bnEqual(expectedRemaining, remaining);
				});

				it("should correctly calculate a user's max issuable pynths with escrowed periFinance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const transferredPeriFinances = toUnit('60000');
					await periFinance.transfer(account1, transferredPeriFinances, {
						from: owner,
					});

					// Setup escrow
					const oneWeek = 60 * 60 * 24 * 7;
					const twelveWeeks = oneWeek * 12;
					const now = await currentTime();
					const escrowedPeriFinances = toUnit('30000');
					await periFinance.transfer(escrow.address, escrowedPeriFinances, {
						from: owner,
					});
					await escrow.appendVestingEntry(
						account1,
						web3.utils.toBN(now + twelveWeeks),
						escrowedPeriFinances,
						{
							from: owner,
						}
					);

					const maxIssuable = await periFinance.maxIssuablePynths(account1);
					await periFinance.issuePynthsAndStakeUSDC(maxIssuable, toUnit('0'), { from: account1 });

					// Compare
					const issuanceRatio = await systemSettings.issuanceRatio();
					const expectedMaxIssuable = multiplyDecimal(
						multiplyDecimal(escrowedPeriFinances.add(transferredPeriFinances), peri2usdRate),
						issuanceRatio
					);
					assert.bnEqual(maxIssuable, expectedMaxIssuable);
				});
			});

			describe('when etherCollateral is set', async () => {
				const collateralKey = 'EtherCollateral';

				it('should have zero totalIssuedPynths', async () => {
					// totalIssuedPynthsExcludeEtherCollateral equal totalIssuedPynths
					assert.bnEqual(
						await periFinance.totalIssuedPynths(pUSD),
						await periFinance.totalIssuedPynthsExcludeEtherCollateral(pUSD)
					);
				});
				describe('creating a loan on etherCollateral to issue pETH', async () => {
					let etherCollateral;
					beforeEach(async () => {
						// mock etherCollateral
						etherCollateral = await MockEtherCollateral.new({ from: owner });
						// have the owner simulate being MultiCollateral so we can invoke issue and burn
						await addressResolver.importAddresses(
							[toBytes32(collateralKey)],
							[etherCollateral.address],
							{ from: owner }
						);

						// ensure Issuer has the latest EtherCollateral
						await issuer.rebuildCache();

						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('1000'), { from: owner });

						// account1 should be able to issue
						await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), 0, { from: account1 });
						// set owner as PeriFinance on resolver to allow issuing by owner
						await addressResolver.importAddresses([toBytes32('PeriFinance')], [owner], {
							from: owner,
						});
					});

					/**
					it('should be able to exclude pETH issued by ether Collateral from totalIssuedPynths', async () => {
						const totalSupplyBefore = await periFinance.totalIssuedPynths(pETH);

						// issue pETH
						const amountToIssue = toUnit('10');
						await pETHContract.issue(account1, amountToIssue, { from: owner });
						// openLoan of same amount on Ether Collateral
						await etherCollateral.openLoan(amountToIssue, { from: owner });
						// totalSupply of pynths should exclude Ether Collateral issued pynths
						assert.bnEqual(
							totalSupplyBefore,
							await periFinance.totalIssuedPynthsExcludeEtherCollateral(pETH)
						);

						// totalIssuedPynths after includes amount issued
						assert.bnEqual(
							await periFinance.totalIssuedPynths(pETH),
							totalSupplyBefore.add(amountToIssue)
						);
					});
					
					it('should exclude pETH issued by ether Collateral from debtBalanceOf', async () => {
						// account1 should own 100% of the debt.
						const debtBefore = await periFinance.debtBalanceOf(account1, pUSD);
						assert.bnEqual(debtBefore, toUnit('10'));
						
						// issue pETH to mimic loan
						const amountToIssue = toUnit('10');
						await pETHContract.issue(account1, amountToIssue, { from: owner });
						await etherCollateral.openLoan(amountToIssue, { from: owner });
						
						// After account1 owns 100% of pUSD debt.
						assert.bnEqual(
							await periFinance.totalIssuedPynthsExcludeEtherCollateral(pUSD),
							toUnit('10')
						);
						assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), debtBefore);
					});
					*/
				});
			});
		});
	});
});
