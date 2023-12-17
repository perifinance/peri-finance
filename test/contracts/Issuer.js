'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, mockToken } = require('./setup');

const MockEtherCollateral = artifacts.require('MockEtherCollateral');

const {
	toBigNbr,
	currentTime,
	multiplyDecimal,
	divideDecimal,
	toUnit,
	fromUnit,
	toPreciseUnit,
	// fromPreciseUnit,
	divideDecimalRound,
	multiplyDecimalRoundPrecise,
	divideDecimalRoundPrecise,
	to3Unit,
	fastForward,
} = require('../utils')();

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
// const {
// 	ContractFunctionVisibility,
// } = require('hardhat/internal/hardhat-network/stack-traces/model');
// const { AssertionError } = require('chai');
// const { lte } = require('semver');

contract('Issuer via PeriFinance', async accounts => {
	const WEEK = 604800;

	const [pUSD, pETH, PERI, USDC, DAI] = ['pUSD', 'pETH', 'PERI', 'USDC', 'DAI'].map(toBytes32);
	const pynthKeys = [pUSD, pETH];

	const [, owner, oracle, account1, account2, account3, account6] = accounts;

	let periFinance,
		exchangeRates,
		periFinanceState,
		feePool,
		// delegateApprovals,
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
		stakingState,
		externalTokenStakeManager,
		usdc,
		dai,
		stables;

	const getRemainingIssuablePynths = async account =>
		(await periFinance.remainingIssuablePynths(account))[0];

	const getStakingAmount = async (token, tryingDebt) => {
		const issuanceRatio = await systemSettings.issuanceRatio();
		// console.log(`issuanceRatio is ${issuanceRatio}`);
		const owingDebt = divideDecimalRound(tryingDebt, issuanceRatio);
		// console.log(`amountToStake is ${owingDebt}`);

		const tokenRate = await exchangeRates.rateForCurrency(token);
		const convertedAmount = divideDecimalRound(owingDebt, tokenRate);

		// console.log(`convertedAmount is ${convertedAmount}`);
		const targetDecimals = await stakingState.tokenDecimals(token);
		// console.log(`${token} targetDecimals in StakingState is ${targetDecimals}`);

		const zroNumber = toBigNbr(10 ** toBigNbr(18).sub(targetDecimals));
		const stakingAmount = toBigNbr(convertedAmount)
			.divRound(zroNumber)
			.mul(zroNumber);
		// console.log(`stakingAmount is ${stakingAmount}`);
		return stakingAmount;
	};

	const doPreTest = async doTest => {
		if (!doTest) {
			return doTest;
		}

		const existDebt = toUnit('40300');
		const maxAllowedExDebt = divideDecimal(
			multiplyDecimal(divideDecimal(existDebt, toUnit('0.2')), toUnit('0.2')),
			toUnit('0.8')
		);

		console.log(`maxAllowedExDebt is ${maxAllowedExDebt}`);

		// const unit1 = toUnit('1');
		// const preciseUnit1 = toPreciseUnit('2');
		// const result = multiplyDecimalRoundPrecise(toPreciseUnit(fromUnit(unit1)), preciseUnit1);
		// console.log(`unit1 is ${unit1}. preciseUnit1 is ${preciseUnit1}`);
		// console.log(`result is ${result}`);

		// const unitFrom = fromUnit(unit1);
		// console.log(`fromUnit from toUnit(1) is ${unitFrom}`);

		return doTest;
	};

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		if (await doPreTest(false)) {
			assert.fail('test is done!!');
		}
		pynths = ['pUSD', 'pETH'];
		stables = ['USDC', 'DAI'];
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
			// DelegateApprovals: delegateApprovals,
			AddressResolver: addressResolver,
			StakingState: stakingState,
			ExternalTokenStakeManager: externalTokenStakeManager,
			USDC: usdc,
			DAI: dai,
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
				'FeePoolState',
				'StakingState',
				'CrossChainManager',
			],
			stables,
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timestamp = await currentTime();

		await exchangeRates.updateRates(
			[PERI, USDC, DAI, pETH],
			['0.2', '0.98', '0.99', '1200'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);

		// set a 0.3% default exchange fee rate
		const exchangeFeeRate = toUnit('0.003');
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});

		// await exchangeRates.setOracleKovan(tempKovanOracle.address);

		await debtCache.takeDebtSnapshot();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: issuer.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'addPynths',
				'burnPynths',
				'exit',
				'fitToClaimable',
				'fixDebtRegister',
				'issueMaxPynths',
				'issuePynths',
				'issuePynthsToMaxQuota',
				'liquidateDelinquentAccount',
				'removePynth',
			],
		});
	});

	it('minimum stake time is correctly configured as a default', async () => {
		assert.bnEqual(await systemSettings.minimumStakeTime(), MINIMUM_STAKE_TIME);
	});

	it('issuance ratio is correctly configured as a default', async () => {
		assert.bnEqual(await systemSettings.issuanceRatio(), ISSUANCE_RATIO);
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
		it('issuePynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.issuePynths,
				args: [account1, PERI, toUnit('1')],
				accounts,
				reason: 'Only the periFinance contract can perform this action',
			});
		});
		it('burnPynths() cannot be invoked directly by a user', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: issuer.burnPynths,
				args: [account1, pUSD, toUnit('1')],
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

					// await usdc.faucet(account1);
					// const usdcBalance = await usdc.balanceOf(account1);
					// console.log(`${usdcBalance} USDC as been issued`);
					// Give some USDC to owner
					await usdc.transfer(account1, to3Unit('10000'), { from: owner });

					// approve USDC allowance
					await usdc.approve(externalTokenStakeManager.address, to3Unit('10000'), {
						from: owner,
					});
					await usdc.approve(externalTokenStakeManager.address, to3Unit('10000'), {
						from: account1,
					});

					// issue pynths
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });

					now = await currentTime();
				});

				it('should issue pynths and store issue timestamp after now', async () => {
					// issue pynths
					await periFinance.issuePynths(PERI, toBigNbr('5'), { from: account1 });

					// issue timestamp should be greater than now in future
					const issueTimestamp = await issuer.lastIssueEvent(owner);
					assert.ok(issueTimestamp.gte(now));
				});

				it('should stake USDC And Issue Pynths and store issue timestamp after now', async () => {
					// stake usdc and issue pynths
					await periFinance.issuePynths(PERI, toUnit('10'), {
						from: account1,
					});

					await periFinance.issuePynths(USDC, toUnit('2'), {
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
						await periFinance.issuePynths(PERI, toBigNbr('5'), { from: account1 });

						await assert.revert(
							periFinance.burnPynths(PERI, toBigNbr('5'), { from: account1 }),
							'Minimum stake time not reached'
						);
					});

					it('should set minStakeTime to 120 seconds and able to burn after wait time', async () => {
						// set minimumStakeTime
						await systemSettings.setMinimumStakeTime(120, { from: owner });

						// issue pynths first
						await periFinance.issuePynths(PERI, toBigNbr('5'), { from: account1 });

						// fastForward 30 seconds
						await fastForward(10);

						await assert.revert(
							periFinance.burnPynths(PERI, toBigNbr('5'), { from: account1 }),
							'Minimum stake time not reached'
						);

						// fastForward 115 seconds
						await fastForward(125);

						// burn pynths
						await periFinance.burnPynths(PERI, toBigNbr('5'), { from: account1 });
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

				// 	await periFinance.issuePynths(PERI, amountIssuedAcc1, { from: account1 });
				// 	await periFinance.issuePynths(PERI, amountIssuedAcc2, { from: account2 });

				// 	await periFinance.exchange(pUSD, amountIssuedAcc2, PERI, { from: account2 });

				// 	const PRECISE_UNIT = web3.utils.toWei(toBigNbr('1'), 'gether');
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
				// 	const conversionFactor = toBigNbr(1000000000);
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
					await periFinance.issuePynths(PERI, issuedPynths, { from: account1 });

					const debt = await periFinance.debtBalanceOf(account1, toBytes32('pUSD'));
					assert.bnEqual(debt, issuedPynths);
				});
			});

			describe('remainingIssuablePynths()', () => {
				it("should correctly calculate a user's remaining issuable pynths with prior issuance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);
					const issuanceRatio = await systemSettings.issuanceRatio();

					const issuedPeriFinances = toBigNbr('200012');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const amountIssued = toUnit('2011');
					await periFinance.issuePynths(PERI, amountIssued, { from: account1 });

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

					const issuedPeriFinances = toBigNbr('20');
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
					const issuedPeriFinances = toBigNbr('200000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});
					const issuanceRatio = await systemSettings.issuanceRatio();

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(rate, issuanceRatio)
					);
					const maxIssuablePynths = await issuer.maxIssuablePynths(account1);

					assert.bnEqual(expectedIssuablePynths, maxIssuablePynths);
				});

				it("should correctly calculate a user's maximum issuable pynths without any PERI", async () => {
					const maxIssuablePynths = await issuer.maxIssuablePynths(account1);
					assert.bnEqual(0, maxIssuablePynths);
				});

				it("should correctly calculate a user's maximum issuable pynths with prior issuance", async () => {
					const peri2usdRate = await exchangeRates.rateForCurrency(PERI);

					const issuedPeriFinances = toBigNbr('320001');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					const issuanceRatio = await systemSettings.issuanceRatio();
					const amountIssued = toBigNbr('1234');
					await periFinance.issuePynths(PERI, toUnit(amountIssued), { from: account1 });

					const expectedIssuablePynths = multiplyDecimal(
						toUnit(issuedPeriFinances),
						multiplyDecimal(peri2usdRate, issuanceRatio)
					);

					const maxIssuablePynths = await issuer.maxIssuablePynths(account1);
					assert.bnEqual(expectedIssuablePynths, maxIssuablePynths);
				});
			});

			describe('adding and removing pynths', () => {
				it('should allow adding a Pynth contract', async () => {
					const previousPynthCount = await issuer.availablePynthCount();

					const { token: pynth } = await mockToken({
						accounts,
						pynth: 'sXYZ',
						skipInitialAllocation: true,
						supply: 0,
						name: 'XYZ',
						symbol: 'XYZ',
					});

					await issuer.addPynths([pynth.address], { from: owner });

					const currencyKey = toBytes32('sXYZ');

					// Assert that we've successfully added a Pynth
					assert.bnEqual(await issuer.availablePynthCount(), previousPynthCount.add(toBigNbr(1)));
					// Assert that it's at the end of the array
					assert.equal(await issuer.availablePynths(previousPynthCount), pynth.address);
					// Assert that it's retrievable by its currencyKey
					assert.equal(await issuer.pynths(currencyKey), pynth.address);

					// Assert event emitted
					// assert.eventEqual(txn.logs[0], 'PynthAdded', [currencyKey, pynth.address]);
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
						fnc: issuer.addPynths,
						accounts,
						args: [[pynth.address]],
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

					await issuer.addPynths([pynth.address], { from: owner });
					await assert.revert(issuer.addPynths([pynth.address], { from: owner }), 'Pynth exists');
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

					await issuer.addPynths([pynth1.address], { from: owner });
					await assert.revert(issuer.addPynths([pynth2.address], { from: owner }), 'Pynth exists');
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

						await issuer.addPynths([pynth.address], { from: owner });
					});

					it('should be able to query multiple pynth addresses', async () => {
						const pynthAddresses = await issuer.getPynths([currencyKey, pUSD, PERI]);
						assert.equal(pynthAddresses[0], pynth.address);
						assert.equal(pynthAddresses[1], pUSDContract.address);
						// assert.equal(pynthAddresses[2], PERIContract.address);
						assert.equal(pynthAddresses.length, 3);
					});

					it('should allow removing a Pynth contract when it has no issued balance', async () => {
						const pynthCount = await issuer.availablePynthCount();

						assert.notEqual(await issuer.pynths(currencyKey), ZERO_ADDRESS);

						await issuer.removePynth(currencyKey, { from: owner });

						// Assert that we have one less pynth, and that the specific currency key is gone.
						assert.bnEqual(await issuer.availablePynthCount(), pynthCount.sub(toBigNbr(1)));
						assert.equal(await issuer.pynths(currencyKey), ZERO_ADDRESS);

						// assert.eventEqual(txn, 'PynthRemoved', [currencyKey, pynth.address]);
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

				it.skip('should revert when requesting to remove pUSD', async () => {
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

						await issuer.addPynths([pynth.address], { from: owner });
					});

					it('should allow adding multiple Pynth contracts at once', async () => {
						const previousPynthCount = await issuer.availablePynthCount();

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

						await issuer.addPynths([pynth1.address, pynth2.address], { from: owner });

						const currencyKey1 = toBytes32('sXYZ');
						const currencyKey2 = toBytes32('sABC');

						// Assert that we've successfully added two Pynths
						assert.bnEqual(await issuer.availablePynthCount(), previousPynthCount.add(toBigNbr(2)));
						// Assert that they're at the end of the array
						assert.equal(await issuer.availablePynths(previousPynthCount), pynth1.address);
						assert.equal(
							await issuer.availablePynths(previousPynthCount.add(toBigNbr(1))),
							pynth2.address
						);
						// Assert that they are retrievable by currencyKey
						assert.equal(await issuer.pynths(currencyKey1), pynth1.address);
						assert.equal(await issuer.pynths(currencyKey2), pynth2.address);

						// Assert events emitted
						// assert.eventEqual(txn.logs[0], 'PynthAddeds', [currencyKey1, pynth1.address]);
						// assert.eventEqual(txn.logs[1], 'PynthAddeds', [currencyKey2, pynth2.address]);
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
							fnc: issuer.removePynth,
							args: [currencyKey],
							accounts,
							address: owner,
							reason: 'Only the contract owner may perform this action',
						});
					});

					it('should disallow removing non-existent pynths', async () => {
						const fakeCurrencyKey = toBytes32('NOPE');

						// Assert that we can't remove the pynth
						await assert.revert(
							issuer.removePynth(fakeCurrencyKey, { from: owner }),
							'Pynth does not exist'
						);
					});

					it.skip('should disallow removing pUSD', async () => {
						// Assert that we can't remove pUSD --> alllowed for updating MultiCollateralPynth upgrade
						await assert.revert(issuer.removePynth(pUSD, { from: owner }), 'Cannot remove pynth');
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

						await issuer.addPynths([pynth2.address], { from: owner });

						const previousPynthCount = await issuer.availablePynthCount();

						await issuer.removePynth(currencyKey2, { from: owner });

						assert.bnEqual(await issuer.availablePynthCount(), previousPynthCount.sub(toBigNbr(1)));

						// Assert events emitted
						// assert.eventEqual(tx.logs[0], 'PynthRemoved', [currencyKey, pynth.address]);
						// assert.eventEqual(tx.logs[1], 'PynthRemoved', [currencyKey2, pynth2.address]);
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

						await issuer.addPynths([pynth2.address], { from: owner });
						await pynth2.issue(account1, toUnit('100'));

						await assert.revert(
							issuer.removePynth(currencyKey2, { from: owner }),
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
									periFinance.issuePynths(PERI, toUnit('1'), { from: account1 }),
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
									await periFinance.issuePynths(PERI, toUnit('1'), { from: account1 });
								});
								it('and calling issueMaxPynths() succeeds', async () => {
									await periFinance.issueMaxPynths({ from: account1 });
								});
							});
						});
					});
					['PERI', 'USDC', 'DAI', 'pUSD', 'pETH', 'none'].forEach(type => {
						describe(`when ${type} is stale`, () => {
							beforeEach(async () => {
								await fastForward((await exchangeRates.rateStalePeriod()).add(toBigNbr('3000')));

								// set all rates minus those to ignore
								const ratesToUpdate = ['PERI', 'USDC', 'DAI', 'pUSD', 'pETH'].filter(
									key => key !== 'pUSD' && ![].concat(type).includes(key)
								);

								// console.log(`ratesToUpdate is ${ratesToUpdate}`);

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
								it('then calling issuePynths and issueMaxPynths() succeeds', async () => {
									await periFinance.issuePynths(PERI, toUnit('1'), {
										from: account1,
									});

									await periFinance.issueMaxPynths({ from: account1 });
								});
							} else {
								it('reverts on issuePynths() and issueMaxPynths()', async () => {
									// console.log(`type is ${type}`);
									await assert.revert(
										periFinance.issuePynths(toBytes32(type), toUnit('1'), {
											from: account1,
										}),
										'A pynth or PERI rate is invalid'
									);
									// Todo to fix to block issueing or burning when the staker try to stake any of stables which price is invalid.
									if (type === 'PERI') {
										await assert.revert(
											periFinance.issueMaxPynths({ from: account1 }),
											'A pynth or PERI rate is invalid'
										);
									}
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
					await periFinance.issuePynths(PERI, toBigNbr('5'), { from: account1 });
				});

				it('should be possible to issue the maximum amount of pynths via issuePynths', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });

					const maxPynths = await issuer.maxIssuablePynths(account1);

					// account1 should be able to issue
					await periFinance.issuePynths(PERI, maxPynths, { from: account1 });
				});

				it('should allow an issuer to issue pynths in one flavour', async () => {
					// Give some PERI to account1
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });

					// account1 should be able to issue
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });

					// There should be 10 pUSD of value in the system
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('10'));

					// And account1 should own 100% of the debt.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('10'));
				});

				it('should allow two issuers to issue pynths in one flavour', async () => {
					// Give some PERI to account1 and account2
					await periFinance.transfer(account1, toUnit('10000'), {
						from: owner,
					});
					await periFinance.transfer(account2, toUnit('10000'), {
						from: owner,
					});

					// Issue
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });
					await periFinance.issuePynths(PERI, toUnit('20'), { from: account2 });

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
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });
					await periFinance.issuePynths(PERI, toUnit('20'), { from: account2 });
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });

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
					const maxIssuable = await issuer.maxIssuablePynths(account1);

					// Issue
					await periFinance.issuePynths(PERI, maxIssuable, { from: account1 });

					// There should be 20000 pUSD of value in the system
					// USD/PERI = 10, PERI Balance = 10^4, IssuanceRatio = 0.2
					// MaxIssuable = 20000 = 10^4 * 10 * 0.2
					assert.bnEqual(await periFinance.totalIssuedPynths(pUSD), toUnit('20000'));

					// And account1 should own all of it.
					assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('20000'));

					const issuablePynths = await periFinance.remainingIssuablePynths(account1);

					assert.bnEqual(issuablePynths.maxIssuable, toUnit('0'));
					assert.bnEqual(issuablePynths.alreadyIssued, toUnit('20000'));
					assert.bnEqual(issuablePynths.totalSystemDebt, toUnit('20000'));

					// Expected C-Ratio = User debt(USD) / Peri Balance * ExRate(USD/PERI)
					const cratio = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(cratio, divideDecimal(toUnit('20000'), toUnit('100000')));
				});

				it('should disallow an issuer from issuing pynths beyond their remainingIssuablePynths', async () => {
					// They should now be able to issue pUSD
					const issuablePynths = await getRemainingIssuablePynths(account1);
					assert.bnEqual(issuablePynths, toUnit('20000'));

					// Issue that amount.
					await periFinance.issuePynths(PERI, issuablePynths, { from: account1 });

					// They should now have 0 issuable pynths.
					assert.bnEqual(await getRemainingIssuablePynths(account1), '0');

					// And trying to issue the smallest possible unit of one should fail.
					await assert.revert(
						periFinance.issuePynths(PERI, '1', { from: account1 }),
						'Amount too large'
					);
				});
			});

			describe('issuance USDC staking', () => {
				beforeEach(async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates(
						[PERI, USDC, DAI],
						['10', '0.9', '1'].map(toUnit),
						timestamp,
						{ from: oracle }
					);

					// await usdc.faucet(owner);
					// assert.bnEqual(await usdc.balanceOf(account1), toUnit('1000000'));

					await periFinance.transfer(account1, toUnit('20000'), { from: owner });
					await periFinance.transfer(account2, toUnit('20000'), { from: owner });
					await usdc.transfer(account1, to3Unit('10000'), { from: owner });
					await usdc.approve(externalTokenStakeManager.address, to3Unit('10000'), {
						from: account1,
					});

					// await periFinance.exit({ from: account1 });
					// await periFinance.exit({ from: account2 });
				});

				it('should initiate correctly', async () => {
					const usdcBalance = await usdc.balanceOf(account1);
					const usdcAllowance = await usdc.allowance(account1, externalTokenStakeManager.address);
					const usdcExRate = await exchangeRates.rateForCurrency(USDC);

					assert.bnEqual(usdcBalance, to3Unit('10000'));
					assert.bnEqual(usdcAllowance, to3Unit('10000'));
					assert.bnEqual(usdcExRate, toUnit('0.9'));
				});

				it('should NOT stake if try to stake more than issue', async () => {
					const exTokenStakedAmt = await externalTokenStakeManager.combinedStakedAmountOf(
						issuer.address,
						pUSD
					);
					const issuableResult = await periFinance.remainingIssuablePynths(account1);

					assert.bnEqual(exTokenStakedAmt, toUnit('0'));
					assert.bnEqual(issuableResult.maxIssuable, toUnit('40000'));
					assert.bnEqual(issuableResult.alreadyIssued, toUnit('0'));
					assert.bnEqual(issuableResult.totalSystemDebt, toUnit('0'));

					await assert.revert(
						periFinance.issuePynths(PERI, toUnit('40001'), { from: account1 }),
						'Staking amount exceeds issueing amount'
					);
				});

				it('should NOT stake USDC if there is no PERI locked amount', async () => {
					const debt = await periFinance.debtBalanceOf(account1, pUSD);
					const pUSDBalance = await pUSDContract.balanceOf(account1);
					const stakedAmount = await stakingState.stakedAmountOf(pUSD, account1);

					// Be sure there is no staking data
					assert.bnEqual(debt, 0);
					assert.bnEqual(pUSDBalance, 0);
					assert.bnEqual(stakedAmount, 0);

					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const issuanceRatio = await systemSettings.issuanceRatio();
					periFinance.issuePynths(PERI, toUnit('1'), { from: account1 });
					await assert.revert(
						periFinance.issuePynths(
							USDC,
							multiplyDecimal(divideDecimal(toUnit('1'), issuanceRatio), usdcExRate),
							{ from: account1 }
						),
						'Input amount exceeds available staking amount'
					);

					// There is a few amount debt existing and try to stake exceeding this amount
					await periFinance.issuePynths(PERI, 123456, { from: account1 });
					await assert.revert(
						periFinance.issuePynths(
							USDC,
							multiplyDecimal(divideDecimal(toUnit('1'), issuanceRatio), usdcExRate),
							{ from: account1 }
						),
						'Input amount exceeds available staking amount'
					);
				});

				it('should NOT stake USDC if there is no issue amount', async () => {
					// debt will be 10000 USD
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					// only stake, not issue pUSD
					await assert.revert(
						periFinance.issuePynths(USDC, toUnit('2050'), { from: account1 }),
						'Staking amount exceeds issueing amount'
					);
				});

				it('should issue pynths', async () => {
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance,
						debtBalance,
						totalIssuedPUSD,
						usdcQuota,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						stakingState.totalStakedAmount(USDC),
						stakingState.totalStakerCount(USDC),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
					]);

					assert.equal(stakedAmount.toString(), '0');
					assert.equal(totalStaked.toString(), '0');
					assert.equal(numOfStaker.toString(), '0');
					assert.bnEqual(pUSDBalance, toUnit('10000'));
					assert.bnEqual(debtBalance, toUnit('10000'));
					assert.bnEqual(totalIssuedPUSD, toUnit('10000'));
					assert.bnEqual(usdcQuota.toString(), '0');
				});

				it('should stake USDC and issue pynths', async () => {
					const debtPERI = toUnit('4000');
					const debtUSDC = toUnit('1000');
					// debt will be 4000 USD
					await periFinance.issuePynths(PERI, debtPERI, { from: account1 });

					await assert.revert(
						periFinance.issuePynths(USDC, debtUSDC.add(toUnit('10')), { from: account1 }),
						'Input amount exceeds available staking amount'
					);

					const tryIssuingAmt = debtUSDC;
					const stakingAmount = await getStakingAmount(USDC, tryIssuingAmt);

					await periFinance.issuePynths(USDC, tryIssuingAmt, { from: account1 });

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance,
						debtBalance,
						totalIssuedPUSD,
						usdcQuota,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						stakingState.totalStakedAmount(USDC),
						stakingState.totalStakerCount(USDC),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
					]);

					assert.bnEqual(stakedAmount, stakingAmount);
					assert.bnEqual(totalStaked, stakingAmount);
					assert.bnEqual(numOfStaker, '1');
					assert.bnEqual(pUSDBalance, debtPERI.add(debtUSDC));
					assert.bnEqual(debtBalance, debtPERI.add(debtUSDC));
					assert.bnEqual(totalIssuedPUSD, debtPERI.add(debtUSDC));
					assert.bnClose(
						usdcQuota,
						divideDecimalRound(tryIssuingAmt, debtBalance),
						toUnit(10 ** 12)
					);
				});

				it('should set lastDebtLedgerEntry to 1 when a user added to a debtRegister and no debt exists', async () => {
					const debtPERI1 = toUnit('10000');
					const debtPERI2 = toUnit('20000');
					const debtUSDC = toUnit('1000');
					const debtPERI1Precise = toPreciseUnit(fromUnit(debtPERI1));
					const debtPERI2Precise = toPreciseUnit(fromUnit(debtPERI2));
					const debtUSDCPrecise = toPreciseUnit(fromUnit(debtUSDC));
					const preciseUnit = toPreciseUnit('1');

					// 10000 debt issued on account1
					await periFinance.issuePynths(PERI, debtPERI1, {
						from: account1,
					});

					let debtAmount = debtPERI1Precise;
					let lastDelta = divideDecimalRoundPrecise(debtAmount, debtAmount);

					let lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(lastDelta, lastDebtLedgerEntry);

					// 1000 debt issued on account1
					await periFinance.issuePynths(USDC, debtUSDC, {
						from: account1,
					});

					let debtBalanceOfAcc1 = await issuer.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalanceOfAcc1, debtPERI1.add(debtUSDC));

					debtAmount = debtUSDCPrecise.add(debtAmount);
					lastDelta = preciseUnit.sub(divideDecimalRoundPrecise(debtUSDCPrecise, debtAmount));

					let lastLedgerEntryCal = multiplyDecimalRoundPrecise(
						lastDebtLedgerEntry,
						preciseUnit.sub(divideDecimalRoundPrecise(debtUSDCPrecise, debtAmount))
					);

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(lastLedgerEntryCal, lastDebtLedgerEntry);

					// 20000 debt issued on account2
					await periFinance.issuePynths(PERI, debtPERI2, {
						from: account2,
					});

					let debtBalanceOfAcc2 = await issuer.debtBalanceOf(account2, pUSD);
					assert.bnEqual(debtBalanceOfAcc2, debtPERI2);

					debtAmount = debtAmount.add(debtPERI2Precise);
					lastLedgerEntryCal = multiplyDecimalRoundPrecise(
						lastDebtLedgerEntry,
						preciseUnit.sub(divideDecimalRoundPrecise(debtPERI2Precise, debtAmount))
					);

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(lastLedgerEntryCal, lastDebtLedgerEntry);

					await periFinance.issuePynths(PERI, debtPERI1, {
						from: account1,
					});

					debtAmount = debtAmount.add(debtPERI1Precise);
					lastLedgerEntryCal = multiplyDecimalRoundPrecise(
						lastDebtLedgerEntry,
						preciseUnit.sub(divideDecimalRoundPrecise(debtPERI1Precise, debtAmount))
					);

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(lastLedgerEntryCal, lastDebtLedgerEntry);

					await periFinance.burnPynths(USDC, debtUSDC, {
						from: account1,
					});

					assert.bnEqual(lastLedgerEntryCal, lastDebtLedgerEntry);
					let debtLedgerLength = await periFinanceState.debtLedgerLength();
					assert.bnEqual(debtLedgerLength, 5);

					await periFinance.exit({ from: account1 });
					await periFinance.exit({ from: account2 });

					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual('0', lastDebtLedgerEntry);

					debtBalanceOfAcc1 = await issuer.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalanceOfAcc1, 0);
					debtBalanceOfAcc2 = await issuer.debtBalanceOf(account2, pUSD);
					assert.bnEqual(debtBalanceOfAcc2, 0);

					await periFinance.issuePynths(PERI, debtPERI2, {
						from: account2,
					});

					debtLedgerLength = await periFinanceState.debtLedgerLength();
					assert.bnEqual(debtLedgerLength, 8);
					lastDebtLedgerEntry = await periFinanceState.lastDebtLedgerEntry();
					assert.bnEqual(preciseUnit, lastDebtLedgerEntry);
				});

				it('should issue pynths when USDC quota exceeds threshold', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('1')], timestamp, {
						from: oracle,
					});

					const initDebtUSDC = toUnit('250');
					const initDebtPERI = toUnit('1000');
					const targetRatio = await systemSettings.issuanceRatio();
					await periFinance.issuePynths(PERI, initDebtPERI, { from: account1 });
					await periFinance.issuePynths(USDC, initDebtUSDC, { from: account1 });

					assert.bnEqual(await issuer.externalTokenQuota(account1, 0, 0, true), toUnit('0.2'));

					const timestamp2 = await currentTime();
					await exchangeRates.updateRates([USDC], [toUnit('1.2')], timestamp2, {
						from: oracle,
					});

					const quotaPreIssue = await issuer.externalTokenQuota(account1, 0, 0, true);
					const cRatioPreIssue = await periFinance.collateralisationRatio(account1);
					assert.bnGt(quotaPreIssue, toUnit('0.2'));
					assert.bnLt(cRatioPreIssue, targetRatio);

					await periFinance.issuePynths(PERI, initDebtPERI, { from: account1 });
					// should throw error for it cannot stake than its issue amount * targetRatio
					await assert.revert(
						periFinance.issuePynths(USDC, initDebtUSDC, { from: account1 }),
						'Input amount exceeds available staking amount'
					);

					const maxExQuota = await systemSettings.externalTokenQuota();
					const usdcPrice = await exchangeRates.rateForCurrency(USDC);
					const usdcStakedAmt = await stakingState.stakedAmountOf(USDC, account1);
					console.log(`usdcStakedAmt: ${usdcStakedAmt}`);

					const stakedUSDCDebt = multiplyDecimal(
						multiplyDecimal(usdcStakedAmt, usdcPrice),
						targetRatio
					);
					// console.log(`stakedUSDCDebt before: ${stakedUSDCDebt}`);
					// console.log(`toUnit('500').sub(stakedUSDCDebt): ${toUnit('500').sub(stakedUSDCDebt)}`);

					// try {
					// 	const usdcStakingValue = divideDecimalRound(toUnit('200'), maxExQuota);
					// 	console.log(`usdcStakingValue: ${usdcStakingValue}`);

					// 	await issuer.stake(account1, usdcStakingValue, USDC, pUSD, { from: account1 });

					// 	const usdcStakedAmt2 = await stakingState.stakedAmountOf(USDC, account1);

					// 	console.log(`usdcStakedAmt2: ${usdcStakedAmt2}`);

					// 	const exTokenAmount = await getStakingAmount(USDC, toUnit('200'));
					// 	assert.bnEqual(usdcStakedAmt2.sub(usdcStakedAmt), exTokenAmount);

					// 	console.log(`exTokenAmount: ${exTokenAmount}`);

					// 	const {
					// 		maxIssuable,
					// 		alreadyIssued,
					// 		totalSystemDebt,
					// 	} = await periFinance.remainingIssuablePynths(account1);
					// 	console.log(`alreadyIssued: ${alreadyIssued}`);
					// 	console.log(`maxIssuable: ${maxIssuable}`);
					// 	console.log(`totalSystemDebt: ${totalSystemDebt}`);
					// } catch (err) {
					// 	console.log(`error occurs: ${err.toString()}`);
					// }
					// const estimatedQuota = await externalTokenStakeManager.externalTokenQuota(
					// 	account1,
					// 	toUnit('2500'),
					// 	0,
					// 	0,
					// 	true
					// );

					// console.log(`estimatedExternalTokenQuota: ${estimatedQuota}`);
					// existing debt from USDC has risen up to 1250 * 1.2 = 1500, 1500 * 0.2 = 300
					// existing debt from PERI has come down to 1000 + 1000 - 50 = 1950
					// so, the remained the quota amount of debt for USDC is 1950 * 1/4 = 287.5
					const usdcIssuableDebt = divideDecimal(
						multiplyDecimal(
							multiplyDecimal(initDebtPERI, toUnit(2)).sub(stakedUSDCDebt.sub(initDebtUSDC)),
							maxExQuota
						),
						toUnit(1).sub(maxExQuota)
					);

					// console.log(
					// 	`usdcIssuableDebt.sub(initDebtUSDC): ${usdcIssuableDebt.sub(stakedUSDCDebt)}`
					// );
					await periFinance.issuePynths(USDC, usdcIssuableDebt.sub(stakedUSDCDebt), {
						from: account1,
					});

					// stakedUSDCDebt = multiplyDecimal(multiplyDecimal(usdcStakedAmt, usdcPrice), targetRatio);
					// console.log(`stakedUSDCDebt after: ${stakedUSDCDebt}`);

					const quotaPostIssue = await issuer.externalTokenQuota(account1, 0, 0, true);
					const cratioPostIssue = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(quotaPostIssue, toUnit('0.2'));
					assert.bnLt(cratioPostIssue, targetRatio);
				});

				it('should issue max pynths when USDC quota exceeds threshold', async () => {
					await usdc.transfer(account1, to3Unit('100000'), { from: owner });
					await usdc.approve(externalTokenStakeManager.address, to3Unit('100000'), {
						from: account1,
					});

					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('1')], timestamp, {
						from: oracle,
					});
					const initDebtUSDC = toUnit('250');
					const initDebtPERI = toUnit('1000');
					const targetRatio = await systemSettings.issuanceRatio();
					await periFinance.issuePynths(PERI, initDebtPERI, { from: account1 });
					await periFinance.issuePynths(USDC, initDebtUSDC, {
						from: account1,
					});

					assert.bnEqual(await issuer.externalTokenQuota(account1, 0, 0, true), toUnit('0.2'));
					const prevDebtAmount = await periFinance.debtBalanceOf(account1, pUSD);
					// const prevUSDCAmount = await stakingState.stakedAmountOf(USDC, account1);

					const timestamp2 = await currentTime();
					await exchangeRates.updateRates([USDC], [toUnit('1.2')], timestamp2, {
						from: oracle,
					});

					const midDebtAmount = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnEqual(midDebtAmount, prevDebtAmount);

					await periFinance.issueMaxPynths({ from: account1 });

					const postDebtAmount = await periFinance.debtBalanceOf(account1, pUSD);
					const postIssueQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					const postIssueCRatio = await periFinance.collateralisationRatio(account1);
					// const postUSDCAmount = await stakingState.stakedAmountOf(USDC, account1);
					// const { alreadyIssued } = await periFinance.remainingIssuablePynths(account1);

					assert.bnGt(postDebtAmount, prevDebtAmount);
					assert.bnLt(postIssueQuota, toUnit('0.2'));
					assert.bnEqual(postIssueCRatio, targetRatio);
					// console.log(`prevUSDCAmount: ${prevUSDCAmount}, postUSDCAmount: ${postUSDCAmount}`);
					// console.log(`prevDebtAmount: ${prevDebtAmount}, postDebtAmount: ${postDebtAmount}`);
					// console.log(`alreadyIssued: ${alreadyIssued}`);

					const usdcBalanceOfAccoun1 = await usdc.balanceOf(account1);
					console.log(`usdcBalanceOfAccoun1: ${usdcBalanceOfAccoun1}`);

					// const { issueAmount, stakeAmount } = await issuer.maxExternalTokenStakeAmount(
					// 	account1,
					// 	alreadyIssued,
					// 	exTokenStakedAmt,
					// 	USDC
					// );

					// console.log(`issueAmount: ${issueAmount}, stakeAmount: ${stakeAmount}`);

					await periFinance.issuePynthsToMaxQuota(USDC, { from: account1 });

					// const lastDebtAmount = await periFinance.debtBalanceOf(account1, pUSD);
					const lastIssueQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					// const lastUSDCAmount = await stakingState.totalStakedAmount(USDC);
					// const combinedStakedAmt = await externalTokenStakeManager.combinedStakedAmountOf(
					// 	account1,
					// 	pUSD
					// );

					// console.log(`combinedStakedAmt: ${combinedStakedAmt}`);
					// console.log(`lastDebtAmount: ${lastDebtAmount}`);
					// console.log(`postIssueQuota: ${postIssueQuota}, lastIssueQuota: ${lastIssueQuota}`);
					// console.log(`postUSDCAmount: ${postUSDCAmount}, lastUSDCAmount: ${lastUSDCAmount}`);

					assert.bnClose(lastIssueQuota, toUnit('0.2'), toUnit(10 ** 12));
				});
			});

			describe('issuance USDC max staking', () => {
				const debtExToken = toUnit('1000');
				const debtPERI = toUnit('4000');
				beforeEach(async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['10', '1'].map(toUnit), timestamp, {
						from: oracle,
					});

					await usdc.faucet(accounts[0]);
					await periFinance.transfer(account1, toUnit('10000'), { from: owner });
					await usdc.transfer(account1, to3Unit('5000'), { from: accounts[0] });
					await usdc.approve(externalTokenStakeManager.address, to3Unit('100000'), {
						from: account1,
					});
				});

				it('should initiate correctly', async () => {
					const usdcBalance = await usdc.balanceOf(account1);
					const usdcAllowance = await usdc.allowance(account1, externalTokenStakeManager.address);

					assert.bnEqual(usdcBalance, to3Unit('5000'));
					assert.bnEqual(usdcAllowance, to3Unit('100000'));
				});

				it('should stake issue amount x issuance ratio', async () => {
					const [
						prevUSDCStakedAmount,
						prevUSDCBalance,
						prevUSDCStakingState,
						prevDebtBalance,
						prevQuote,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingState.address),
						periFinance.debtBalanceOf(account1, pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
					]);

					const maxExQuota = await systemSettings.externalTokenQuota();
					const exTokenAmount = await getStakingAmount(USDC, debtExToken);
					const stakingUSDC = exTokenAmount.div(toBigNbr(10 ** 12));
					await periFinance.issuePynths(PERI, debtPERI, { from: account1 });
					await periFinance.issuePynths(USDC, debtExToken, { from: account1 });

					const [
						postUSDCStakedAmount,
						postUSDCBalance,
						postUSDCStakingState,
						postDebtBalance,
						postQuota,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingState.address),
						periFinance.debtBalanceOf(account1, pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
					]);

					// It has an unit digit error
					assert.bnClose(prevUSDCStakedAmount.add(exTokenAmount), postUSDCStakedAmount);
					assert.bnEqual(
						prevUSDCBalance.sub(exTokenAmount.div(toBigNbr(10 ** 12))),
						postUSDCBalance
					);
					assert.bnEqual(prevUSDCStakingState.add(stakingUSDC), postUSDCStakingState);
					assert.bnEqual(prevDebtBalance.add(debtExToken).add(debtPERI), postDebtBalance);
					assert.bnEqual(prevQuote, toUnit('0'));
					assert.bnEqual(postQuota, maxExQuota);
				});

				it('should stake less than amount x issuance ratio if usdc balance is not enough', async () => {
					// It is going to stake all USDC balance
					const exTokenAmount = await getStakingAmount(USDC, debtExToken);
					const stakingUSDC = exTokenAmount.div(toBigNbr(10 ** 12));
					await periFinance.issuePynths(PERI, debtPERI, { from: account1 });
					await periFinance.issuePynths(USDC, debtExToken, { from: account1 });

					const [
						postUSDCStakedAmount,
						postUSDCBalance,
						postUSDCStakingState,
						postDebtBalance,
						postQuota,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						usdc.balanceOf(account1),
						usdc.balanceOf(stakingState.address),
						periFinance.debtBalanceOf(account1, pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
					]);

					assert.bnEqual(postUSDCStakedAmount, exTokenAmount);
					assert.bnEqual(postUSDCBalance, toUnit('0'));
					assert.bnEqual(postUSDCStakingState, stakingUSDC);
					assert.bnEqual(postDebtBalance, debtExToken.add(debtPERI));
					assert.bnEqual(postQuota, divideDecimal(debtExToken, postDebtBalance));
				});
			});

			describe('burning', () => {
				describe('potential blocking conditions', () => {
					beforeEach(async () => {
						const timestamp = await currentTime();
						await exchangeRates.updateRates([PERI, USDC], [toUnit('10'), toUnit('1')], timestamp, {
							from: oracle,
						});
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
									periFinance.burnPynths(PERI, toUnit('1'), { from: account1 }),
									'Operation prohibited'
								);
							});
							it('and calling fitToClaimable() reverts', async () => {
								await assert.revert(
									periFinance.fitToClaimable({ from: account1 }),
									'Operation prohibited'
								);
							});
							describe(`when ${section} is resumed`, () => {
								beforeEach(async () => {
									await setStatus({ owner, systemStatus, section, suspend: false });
								});
								it('then calling burnPynths() succeeds', async () => {
									await periFinance.burnPynths(PERI, toUnit('1'), { from: account1 });
								});
								it('and calling fitToClaimable() succeeds', async () => {
									const timestamp = await currentTime();
									await exchangeRates.updateRates(
										[PERI, USDC],
										[toUnit('9'), toUnit('0.9')],
										timestamp,
										{ from: oracle }
									);
									await debtCache.takeDebtSnapshot();
									await periFinance.fitToClaimable({ from: account1 });
								});
							});
						});
					});

					['PERI', 'pUSD', 'USDC'].forEach(type => {
						describe(`when ${type} is stale`, () => {
							beforeEach(async () => {
								await fastForward((await exchangeRates.rateStalePeriod()).add(toBigNbr('300')));

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

							// if (type === 'pUSD') {
							// 	it('then calling burnPynths() succeeds', async () => {
							// 		await periFinance.burnPynths(PERI, toUnit('1'), { from: account1 });
							// 	});
							// 	it('and calling fitToClaimable() succeeds', async () => {
							// 		await periFinance.fitToClaimable({ from: account1 });
							// 	});
							// } else {
							it('then calling burn() reverts', async () => {
								await assert.revert(
									periFinance.burnPynths(toBytes32(type), toUnit('1'), { from: account1 }),
									'A pynth or PERI rate is invalid'
								);
							});
							it('and calling fitToClaimable() reverts', async () => {
								await assert.revert(
									periFinance.fitToClaimable({ from: account1 }),
									'A pynth or PERI rate is invalid'
								);
							});
							// }
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
					await periFinance.burnPynths(PERI, toUnit('100'), { from: account1 });

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
						periFinance.burnPynths(PERI, toUnit('10'), { from: account2 }),
						'No debt to forgive'
					);

					// And even when we give account2 pynths, it should not be able to burn.
					await pUSDContract.transfer(account2, toUnit('100'), {
						from: account1,
					});

					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('10'), { from: account2 }),
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
						periFinance.burnPynths(pETH, toUnit('1'), { from: account1 }),
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
					await periFinance.issuePynths(PERI, account1Payment, { from: account1 });
					await periFinance.issuePynths(PERI, account2Payment, { from: account2 });

					// Transfer all of account2's pynths to account1
					const amountTransferred = toUnit('200');
					await pUSDContract.transfer(account1, amountTransferred, {
						from: account2,
					});

					const balanceOfAccount1 = await pUSDContract.balanceOf(account1);

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await assert.revert(
						periFinance.burnPynths(PERI, balanceOfAccount1, { from: account1 }),
						'Tried to burn too much'
					);
					await periFinance.exit({ from: account1 });
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
					await periFinance.issuePynths(PERI, toUnit('199'), { from: account1 });

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await periFinance.burnPynths(PERI, await pUSDContract.balanceOf(account1), {
						from: account1,
					});

					assert.bnEqual(await pUSDContract.balanceOf(account1), toBigNbr(0));
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
					await periFinance.issuePynths(PERI, toUnit('199'), { from: account1 });

					const pUSDBalance = await pUSDContract.balanceOf(account1);

					// Then try to burn them all. Only 10 pynths (and fees) should be gone.
					await periFinance.burnPynths(PERI, pUSDBalance, {
						from: account1,
					});

					assert.bnEqual(await pUSDContract.balanceOf(account1), toBigNbr(0));
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
					await periFinance.issuePynths(PERI, issuedPynthsPt1, { from: account1 });
					await periFinance.issuePynths(PERI, issuedPynthsPt2, { from: account1 });
					await periFinance.issuePynths(PERI, toUnit('1000'), { from: account2 });

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
						const burnAllPynths = toUnit('2000');

						await periFinance.issuePynths(PERI, issuedPynths1, { from: account1 });
						await periFinance.issuePynths(PERI, issuedPynths2, { from: account2 });
						await periFinance.issuePynths(PERI, issuedPynths3, { from: account3 });

						await assert.revert(
							periFinance.burnPynths(PERI, burnAllPynths.add(toUnit('50')), { from: account1 }),
							'Tried to burn more amount than the debt'
						);
						await periFinance.burnPynths(PERI, burnAllPynths, { from: account2 });
						await periFinance.exit({ from: account3 });

						const debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						const debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);
						const debtBalance3After = await periFinance.debtBalanceOf(account3, pUSD);

						assert.bnEqual(debtBalance1After, toUnit('2000'));
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

						await periFinance.issuePynths(PERI, issuedPynths1, { from: account1 });
						await periFinance.issuePynths(PERI, issuedPynths2, { from: account2 });
						await periFinance.issuePynths(PERI, issuedPynths3, { from: account3 });

						const debtBalanceBefore = await periFinance.debtBalanceOf(account1, pUSD);
						await periFinance.burnPynths(PERI, debtBalanceBefore, { from: account1 });
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

						await periFinance.issuePynths(PERI, issuedPynths1, { from: account1 });

						await assert.revert(
							periFinance.burnPynths(PERI, issuedPynths1.add(toUnit('9000')), { from: account1 }),
							'Trying to burn more than the debt amount'
						);
					});

					it('should allow users to burn their debt and adjust the debtBalanceOf correctly for remaining users', async () => {
						// Give some PERI to account1
						await periFinance.transfer(account1, toUnit('400000'), {
							from: owner,
						});
						await periFinance.transfer(account2, toUnit('400000'), {
							from: owner,
						});

						// Issue
						const issuedPynths1 = toUnit('15000');
						const issuedPynths2 = toUnit('5000');

						await periFinance.issuePynths(PERI, issuedPynths1, { from: account1 });
						await periFinance.issuePynths(PERI, issuedPynths2, { from: account2 });

						let debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						let debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);

						// debtBalanceOf has rounding error but is within tolerance
						assert.bnClose(debtBalance1After, toUnit('15000'));
						assert.bnClose(debtBalance2After, toUnit('5000'));

						// Account 1 burns 100,000
						await periFinance.burnPynths(PERI, toUnit('10000'), { from: account1 });

						debtBalance1After = await periFinance.debtBalanceOf(account1, pUSD);
						debtBalance2After = await periFinance.debtBalanceOf(account2, pUSD);

						assert.bnClose(debtBalance1After, toUnit('5000'));
						assert.bnClose(debtBalance2After, toUnit('5000'));
					});

					it('should revert if sender tries to issue pynths with 0 amount', async () => {
						// Issue 0 amount of pynth
						const issuedPynths1 = toUnit('0');

						await assert.revert(
							periFinance.issuePynths(PERI, issuedPynths1, { from: account1 }),
							'SafeMath: division by zero'
						);
					});
				});

				describe('fitToClaimable', () => {
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
							maxIssuablePynths = await issuer.maxIssuablePynths(account1);
							assert.equal(await feePool.isFeesClaimable(account1), false);
						});

						it('then the maxIssuablePynths drops 50%', async () => {
							assert.bnClose(maxIssuablePynths, toUnit('4000'));
						});
						it('then calling fitToClaimable() reduces pUSD to c-ratio target', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.bnClose(await periFinance.debtBalanceOf(account1, pUSD), toUnit('4000'));
						});
						it('then fees are claimable', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price drops 10%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['.9'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await issuer.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths drops 10%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('7200'));
						});
						it('then calling fitToClaimable() reduces pUSD to c-ratio target', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('7200'));
						});
						it('then fees are claimable', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price drops 90%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['.1'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await issuer.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths drops 10%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('800'));
						});
						it('then calling fitToClaimable() reduces pUSD to c-ratio target', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.bnEqual(await periFinance.debtBalanceOf(account1, pUSD), toUnit('800'));
						});
						it('then fees are claimable', async () => {
							await periFinance.fitToClaimable({ from: account1 });
							assert.equal(await feePool.isFeesClaimable(account1), true);
						});
					});

					describe('when the PERI price increases 100%', () => {
						let maxIssuablePynths;
						beforeEach(async () => {
							await exchangeRates.updateRates([PERI], ['2'].map(toUnit), timestamp, {
								from: oracle,
							});
							maxIssuablePynths = await issuer.maxIssuablePynths(account1);
						});

						it('then the maxIssuablePynths increases 100%', async () => {
							assert.bnEqual(maxIssuablePynths, toUnit('16000'));
						});
						it('then calling fitToClaimable() reverts', async () => {
							await assert.revert(
								periFinance.fitToClaimable({ from: account1 }),
								'SafeMath: subtraction overflow'
							);
						});
					});
				});
			});

			describe('burning and unstake USDC', () => {
				const updateRates = async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates(
						[PERI, USDC, DAI, pETH],
						['10', '0.9', '1', '1200'].map(toUnit),
						timestamp,
						{
							from: oracle,
						}
					);
				};

				beforeEach(async () => {
					await systemSettings.setMinimumStakeTime(86400, { from: owner });

					await updateRates();

					const amountT = toUnit('100000').div(toBigNbr(10 ** 12));
					await Promise.all([
						periFinance.transfer(account1, toUnit('100000'), { from: owner }),
						usdc.transfer(account1, amountT, { from: owner }),
						usdc.approve(externalTokenStakeManager.address, amountT, { from: account1 }),
						usdc.approve(stakingState.address, amountT, { from: account1 }),
						dai.transfer(account1, toUnit('100000'), { from: owner }),
						dai.approve(externalTokenStakeManager.address, toUnit('100000'), { from: account1 }),
					]);

					assert.bnEqual(await usdc.balanceOf(account1), amountT);

					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					await fastForward(86400 + 1);

					await updateRates();

					await debtCache.takeDebtSnapshot();
				});

				it('should initiate', async () => {
					const stakeTime = await systemSettings.minimumStakeTime();

					assert.bnEqual(stakeTime, toBigNbr('86400'));
				});

				it('should burn', async () => {
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('100'), { from: account1 }),
						'Minimum stake time not reached'
					);

					await fastForward((await exchangeRates.rateStalePeriod()).add(toBigNbr('10')));

					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('100'), { from: account1 }),
						'A pynth or PERI rate is invalid'
					);

					await updateRates();

					await debtCache.takeDebtSnapshot();

					const prevpUSDBalance = await pUSDContract.balanceOf(account1);
					const prevStakingAmount = await stakingState.stakedAmountOf(pUSD, account1);
					const prevDebtBalance = await periFinance.debtBalanceOf(account1, pUSD);
					const prevUSDCBalance = await usdc.balanceOf(account1);

					// It exceeds
					await periFinance.burnPynths(PERI, toUnit('100'), { from: account1 });

					const postpUSDBalance = await pUSDContract.balanceOf(account1);
					const postStakingAmount = await stakingState.stakedAmountOf(pUSD, account1);
					const postDebtBalance = await periFinance.debtBalanceOf(account1, pUSD);
					const postUSDCBalance = await usdc.balanceOf(account1);

					assert.bnEqual(prevpUSDBalance.sub(toUnit('100')), postpUSDBalance);
					assert.bnEqual(prevDebtBalance.sub(toUnit('100')), postDebtBalance);
					assert.bnEqual(prevStakingAmount, postStakingAmount);
					assert.bnEqual(postUSDCBalance, prevUSDCBalance);
				});

				it('should burn and unstake USDC', async () => {
					const stakeAmount = toUnit('2500');
					await periFinance.exit({ from: account1 });
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });
					await periFinance.issuePynths(USDC, stakeAmount, { from: account1 });

					await fastForward(86400 + 1);
					await updateRates();
					await debtCache.takeDebtSnapshot();

					const prevpUSDBalance = await pUSDContract.balanceOf(account1);
					const prevpStakingAmount = await stakingState.stakedAmountOf(USDC, account1);
					const prevDebtBalance = await periFinance.debtBalanceOf(account1, pUSD);
					const prevQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					const prevUSDCBalance = await usdc.balanceOf(account1);
					const prevUSDCStakingState = await usdc.balanceOf(stakingState.address);

					const stakedUSDC = await getStakingAmount(USDC, stakeAmount);
					assert.bnClose(
						prevUSDCStakingState.mul(toBigNbr(10 ** 12)),
						stakedUSDC,
						toBigNbr(10 ** 12)
					);
					// since stakeing state value would be parsed to 10**12
					assert.bnClose(prevQuota, toUnit('0.2'), toBigNbr(10 ** 12));

					// Currently user has maximum quota staked. (pUSD, USDC) = (20000 , 22222.222222)
					// If user burns 100 pUSD with 20 USDC untaking,
					// although it satisfies input amount, it violates maximum quota in a result.
					// After quota = (22202.222222 * ExRate * issuanceRatio) / 19900 = 0.2008241206...
					const unstakeAmountToFailed = toUnit('20');
					await periFinance.burnPynths(USDC, unstakeAmountToFailed, { from: account1 });
					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('200'), {
							from: account1,
						}),
						'USDC staked exceeds quota'
					);

					const unstakeAmount = toUnit('500');
					await periFinance.burnPynths(USDC, unstakeAmount, { from: account1 });
					await periFinance.burnPynths(PERI, toUnit('100'), { from: account1 });

					const postpUSDBalance = await pUSDContract.balanceOf(account1);
					const postStakingAmount = await stakingState.stakedAmountOf(USDC, account1);
					const postDebtBalance = await periFinance.debtBalanceOf(account1, pUSD);
					const postQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					const postUSDCBalance = await usdc.balanceOf(account1);
					const postUSDCStakingState = await usdc.balanceOf(stakingState.address);
					const unstakedUSDC = await getStakingAmount(
						USDC,
						unstakeAmount.add(unstakeAmountToFailed)
					);

					assert.bnEqual(
						prevpUSDBalance.sub(toUnit('100').add(unstakeAmountToFailed.add(unstakeAmount))),
						postpUSDBalance
					);
					assert.bnClose(
						prevpStakingAmount.sub(unstakedUSDC),
						postStakingAmount,
						toBigNbr(10 ** 13)
					);
					assert.bnEqual(
						prevDebtBalance.sub(toUnit('100').add(unstakeAmountToFailed.add(unstakeAmount))),
						postDebtBalance
					);
					assert.bnClose(
						prevUSDCBalance.add(unstakedUSDC.divRound(toBigNbr(10 ** 12))),
						postUSDCBalance
					);
					assert.bnClose(
						prevUSDCStakingState.sub(unstakedUSDC.div(toBigNbr(10 ** 12))),
						postUSDCStakingState
					);
					assert.bnLte(postQuota, toUnit('0.2'));

					const usdcExRate = await exchangeRates.rateForCurrency(USDC);
					const issuanceRatio = await systemSettings.issuanceRatio();
					const debtUSDC = multiplyDecimal(
						multiplyDecimal(stakedUSDC.sub(unstakedUSDC), usdcExRate),
						issuanceRatio
					);
					const totalDebt = await periFinance.totalIssuedPynths(pUSD);

					assert.bnClose(postQuota, divideDecimal(debtUSDC, totalDebt), toBigNbr(10 ** 12));
				});

				it('should NOT burn if burn amount exceeds staked amount', async () => {
					// value "1" would be ignored(rounded), minimum input amount should be larger than 10**12 (since staking state would be parsed).
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					await periFinance.issuePynths(USDC, '1' + '0'.repeat(6), { from: account1 });

					await fastForward(86400 + 1);
					await updateRates();
					await debtCache.takeDebtSnapshot();

					await assert.revert(
						periFinance.burnPynths(USDC, toUnit('20000'), { from: account1 }),
						'Burn amount exceeds available amount'
					);
				});

				it('should NOT unstake more than the amount of user staked', async () => {
					await usdc.transfer(stakingState.address, '10000' + '0'.repeat(6), {
						from: owner,
					});
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('10001'), { from: account1 }),
						'Trying to burn more than debt'
					);
				});

				it('should fit claimable when C-Ratio > Target-Ratio and USDC debt <= debt quota', async () => {
					await periFinance.exit({ from: account1 });
					// transfer back to deployer to adjust amounts
					await periFinance.transfer(accounts[0], toUnit('95000'), { from: account1 });

					// const periBalance = await periFinance.balanceOf(account1);
					// console.log(`PERI balance on account1 pre-staking: ${periBalance}`);

					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

					// Set issued max (Fit to max quota and target C-Ratio)
					const tryingAmount = toUnit('2500');
					const stakingAmount = await getStakingAmount(USDC, tryingAmount);

					// const accout11Balance = await usdc.balanceOf(account1);
					// console.log(`USDC balance on account1 pre-staking: ${accout11Balance}`);

					await periFinance.issuePynths(USDC, tryingAmount, { from: account1 });

					const [
						stakedAmount,
						totalStaked,
						numOfStaker,
						pUSDBalance,
						debtBalance,
						totalIssuedPUSD,
						usdcQuota,
						initCRatio,
					] = await Promise.all([
						stakingState.stakedAmountOf(USDC, account1),
						stakingState.totalStakedAmount(USDC),
						stakingState.totalStakerCount(USDC),
						pUSDContract.balanceOf(account1),
						periFinance.debtBalanceOf(account1, pUSD),
						periFinance.totalIssuedPynths(pUSD),
						issuer.externalTokenQuota(account1, 0, 0, true),
						periFinance.collateralisationRatio(account1),
					]);

					assert.bnEqual(stakedAmount, stakingAmount);
					assert.bnEqual(totalStaked, stakingAmount);
					assert.bnEqual(numOfStaker, '1');
					assert.bnEqual(pUSDBalance, toUnit('12500'));
					assert.bnEqual(debtBalance, toUnit('12500'));
					assert.bnEqual(totalIssuedPUSD, toUnit('12500'));
					assert.bnClose(usdcQuota, toUnit('0.2'), 10 ** 12);
					assert.bnClose(initCRatio, toUnit('0.2'), 10 ** 12);

					// As Peri price is going down, C-Ratio decreases.
					// Meanwhile, usdc quota is not be changed.
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['5', '0.9'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					const prevCRatio = await periFinance.collateralisationRatio(account1);
					const preQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					// C-Ratio is expected less than 500%
					assert.bnGt(prevCRatio, toUnit('0.2'));
					assert.bnClose(preQuota, toUnit('0.2'), 10 ** 12);

					await periFinance.fitToClaimable({ from: account1 });
					const postCRatio = await periFinance.collateralisationRatio(account1);
					const postQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					assert.bnClose(postCRatio, toUnit('0.2'), 10 ** 12);
					assert.bnClose(postQuota, toUnit('0.2'), 10 ** 12);
				});

				it('should fit claimable when C-Ratio > Target-Ratio and USDC debt > debt quota', async () => {
					await periFinance.exit({ from: account1 });
					// transfer back to deployer to adjust amounts
					await periFinance.transfer(accounts[0], toUnit('95000'), { from: account1 });

					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });
					// Set issued max (Fit to max quota and target C-Ratio)
					const tryingAmount = toUnit('2500');
					await periFinance.issuePynths(USDC, tryingAmount, { from: account1 });

					// As Peri price is going up, C-Ratio would be increased.
					// Meanwhile, usdc quota is not be changed.
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, USDC], ['10', '1.2'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					const [prevQuote, prevCRatio] = await Promise.all([
						issuer.externalTokenQuota(account1, 0, 0, true),
						periFinance.collateralisationRatio(account1),
					]);

					assert.bnGt(prevQuote, toUnit('0.2'));
					assert.bnLt(prevCRatio, toUnit('0.2'));

					await periFinance.fitToClaimable({ from: account1 });

					const [postQuota, postCRatio] = await Promise.all([
						issuer.externalTokenQuota(account1, 0, 0, true),
						periFinance.collateralisationRatio(account1),
					]);

					assert.bnLt(postCRatio, prevCRatio);
					assert.bnClose(postQuota, toUnit('0.2'), 10 ** 12);
				});

				it('should fit to claimable if C-Ratio < threshhold and the quota < the thershold', async () => {
					// transfer back to deployer to adjust amounts
					await periFinance.exit({ from: account1 });
					await periFinance.transfer(accounts[0], toUnit('95000'), { from: account1 });

					await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });
					// Set issued max (Fit to max quota and target C-Ratio)
					const tryingUSDCAmt = toUnit('1500');
					await periFinance.issuePynths(USDC, tryingUSDCAmt, { from: account1 });
					const tryingDAICAmt = toUnit('1000');
					await periFinance.issuePynths(DAI, tryingDAICAmt, { from: account1 });

					// As USDC Price going up, its debt quota would also be increased.
					// C-Ratio is expected to be larger than 400%, meanwhile quota is above threshold)
					await fastForward(86400 + 1);
					const timestamp = await currentTime();
					await exchangeRates.updateRates(
						[PERI, USDC, DAI],
						['10', '0.8', '0.9'].map(toUnit),
						timestamp,
						{
							from: oracle,
						}
					);
					await debtCache.takeDebtSnapshot();

					const prevCRatio = await periFinance.collateralisationRatio(account1);
					const preQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					assert.bnGt(prevCRatio, toUnit('0.2'));
					assert.bnLt(preQuota, toUnit('0.2'));

					await periFinance.fitToClaimable({ from: account1 });
					const postCRatio = await periFinance.collateralisationRatio(account1);
					const postQuota = await issuer.externalTokenQuota(account1, 0, 0, true);
					// It doesn't fit C-Ratio if it already satisfies target ratio.
					assert.bnClose(postCRatio, toUnit('0.2'), 10 ** 12);
					assert.bnGt(postQuota, preQuota);
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
					await periFinance.issuePynths(PERI, issuedPynthsPt1, { from: account1 });
					await periFinance.issuePynths(PERI, issuedPynthsPt2, { from: account1 });
					await periFinance.issuePynths(PERI, toUnit('1000'), { from: account2 });

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

					await periFinance.issuePynths(PERI, issuedPynthsPt1, { from: account1 });
					await periFinance.burnPynths(PERI, burntPynthsPt1, { from: account1 });
					await periFinance.issuePynths(PERI, issuedPynthsPt2, { from: account1 });

					await periFinance.issuePynths(PERI, toUnit('100'), { from: account2 });
					await periFinance.issuePynths(PERI, toUnit('100'), { from: account2 });
					await periFinance.issuePynths(PERI, toUnit('51'), { from: account2 });
					await periFinance.burnPynths(PERI, burntPynthsPt2, { from: account1 });

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
					const account1AmountToIssue = await issuer.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					// Issue and burn from account 2 all debt
					await periFinance.issuePynths(PERI, toUnit('43'), { from: account2 });
					let debt = await periFinance.debtBalanceOf(account2, pUSD);
					await periFinance.burnPynths(PERI, toUnit('43'), { from: account2 });
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

					const account1AmountToIssue = await issuer.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = toBigNbr('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
						const amount = toUnit('43');
						await periFinance.issuePynths(PERI, amount, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

						const desiredAmountToBurn = toUnit(toBigNbr(getRandomInt(4, 14)));
						const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
							? desiredAmountToBurn
							: expectedDebtForAccount2;
						await periFinance.burnPynths(PERI, amountToBurn, { from: account2 });
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
					const variance = toBigNbr(totalTimesToIssue).mul(toBigNbr('2'));
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

					const account1AmountToIssue = await issuer.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnClose(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = toBigNbr('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						// Seems that in this case, issuing 43 each time leads to increasing the variance regularly each time.
						const amount = toUnit(toBigNbr(getRandomInt(40, 49)));
						await periFinance.issuePynths(PERI, amount, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);

						const desiredAmountToBurn = toUnit(toBigNbr(getRandomInt(37, 46)));
						const amountToBurn = desiredAmountToBurn.lte(expectedDebtForAccount2)
							? desiredAmountToBurn
							: expectedDebtForAccount2;
						await periFinance.burnPynths(PERI, amountToBurn, { from: account2 });
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
					const variance = toBigNbr(totalTimesToIssue).mul(toBigNbr('2'));
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

					const account1AmountToIssue = await issuer.maxIssuablePynths(account1);
					await periFinance.issueMaxPynths({ from: account1 });
					const debtBalance1 = await periFinance.debtBalanceOf(account1, pUSD);
					assert.bnEqual(debtBalance1, account1AmountToIssue);

					let expectedDebtForAccount2 = toBigNbr('0');
					const totalTimesToIssue = 40;
					for (let i = 0; i < totalTimesToIssue; i++) {
						const amount = toUnit('0.000000000000000002');
						await periFinance.issuePynths(PERI, amount, { from: account2 });
						expectedDebtForAccount2 = expectedDebtForAccount2.add(amount);
					}
					const debtBalance2 = await periFinance.debtBalanceOf(account2, pUSD);

					// Here we make the variance a calculation of the number of times we issue/burn.
					// This is less than ideal, but is the result of calculating the debt based on
					// the results of the issue/burn each time.
					const variance = toBigNbr(totalTimesToIssue).mul(toBigNbr('2'));
					assert.bnClose(debtBalance2, expectedDebtForAccount2, variance);
				}).timeout(60e3);
			});

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
					const issuedPeriFinances = toBigNbr('320000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const issuedPynths = toUnit(toBigNbr('6400'));
					await periFinance.issuePynths(PERI, issuedPynths, { from: account1 });

					await periFinance.collateralisationRatio(account1, { from: account2 });
				});

				it('should be able to read collaterisation ratio for a user with periFinance but no debt', async () => {
					const issuedPeriFinances = toBigNbr('30000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					const ratio = await periFinance.collateralisationRatio(account1);
					assert.bnEqual(ratio, new web3.utils.BN(0));
				});

				it('should be able to read collaterisation ratio for a user with periFinance and debt', async () => {
					const issuedPeriFinances = toBigNbr('320000');
					await periFinance.transfer(account1, toUnit(issuedPeriFinances), {
						from: owner,
					});

					// Issue
					const issuedPynths = toUnit(toBigNbr('6400'));
					await periFinance.issuePynths(PERI, issuedPynths, { from: account1 });

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
						toBigNbr(now + twelveWeeks),
						escrowedPeriFinances,
						{
							from: owner,
						}
					);

					// Issue
					const maxIssuable = await issuer.maxIssuablePynths(account1);
					await periFinance.issuePynths(PERI, maxIssuable, { from: account1 });

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
					const maxIssuable = await issuer.maxIssuablePynths(account1);
					await periFinance.issuePynths(PERI, maxIssuable, { from: account1 });
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
					await escrow.appendVestingEntry(account1, toBigNbr(now + twelveWeeks), escrowedAmount, {
						from: owner,
					});

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
					await escrow.appendVestingEntry(account1, toBigNbr(now + twelveWeeks), escrowedAmount, {
						from: owner,
					});

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
					const maxIssuable = await issuer.maxIssuablePynths(account1);
					const issued = maxIssuable.div(toBigNbr(3));
					await periFinance.issuePynths(PERI, issued, { from: account1 });
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
						toBigNbr(now + twelveWeeks),
						escrowedPeriFinances,
						{
							from: owner,
						}
					);

					const maxIssuable = await issuer.maxIssuablePynths(account1);
					await periFinance.issuePynths(PERI, maxIssuable, { from: account1 });

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
						await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });
						// set owner as PeriFinance on resolver to allow issuing by owner
						await addressResolver.importAddresses([toBytes32('PeriFinance')], [owner], {
							from: owner,
						});
					});
				});
			});
		});
	});
});
