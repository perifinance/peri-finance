'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const {
	currentTime,
	fastForward,
	// fastForwardTo,
	toUnit,
	toPreciseUnit,
	fromUnit,
	multiplyDecimal,
	multiplyDecimalRoundPrecise,
	divideDecimalRoundPrecise,
} = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
	setStatus,
	getDecodedLogs,
	decodedEventEqual,
	proxyThruTo,
	setExchangeFeeRateForPynths,
} = require('./helpers');

const { setupAllContracts } = require('./setup');

const {
	toBytes32,
	defaults: { ISSUANCE_RATIO, FEE_PERIOD_DURATION, TARGET_THRESHOLD },
	// constants: { inflationStartTimestampInSecs },
} = require('../..');
const { logger } = require('ethers');

contract('Fee Pool', async accounts => {
	// CURRENCIES
	const [pUSD, pBTC, pETH, PERI, USDC] = ['pUSD', 'pBTC', 'pETH', 'PERI', 'USDC'].map(toBytes32);

	const FeePool = artifacts.require('FeePool');
	const FlexibleStorage = artifacts.require('FlexibleStorage');

	const [
		deployerAccount,
		owner,
		oracle,
		account1,
		debtManager,
		account2,
		account3,
		,
		,
		minterRole,
	] = accounts;

	// Updates rates with defaults so they're not stale.
	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[pBTC, pETH, PERI, USDC],
			['4000', '2000', '10', '0.9'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);
		await debtCache.takeDebtSnapshot();
	};

	const closeFeePeriod = async (inflationMint, account, feeRewards = []) => {
		const feePeriodDuration = Number(await feePool.feePeriodDuration()) + 60 * 60 * 3;
		await fastForward(feePeriodDuration);

		let mintAmount;
		if (inflationMint) {
			const supplyToMint = await supplySchedule.mintableSupply();
			assert.notEqual(
				supplyToMint,
				'0',
				'Amount to be minted can only be 0 when the total supply reaches to MAX.'
			);

			await periFinance.inflationalMint({ from: minterRole });
			mintAmount = supplyToMint;
		}

		await feePool.distributeFeeRewards(feeRewards, { from: debtManager });
		await feePool.closeCurrentFeePeriod({ from: account });
		await updateRatesWithDefaults();

		return { mintAmount };
	};

	async function getFeesAvailable(account, key) {
		const result = await feePool.feesAvailable(account, key);
		return result[0];
	}

	const exchangeFeeRate = toUnit('0.003'); // 30 bips
	const amountReceivedFromExchange = amountToExchange => {
		return multiplyDecimal(amountToExchange, toUnit('1').sub(exchangeFeeRate));
	};

	let feePool,
		debtCache,
		feePoolProxy,
		periFinance,
		systemStatus,
		systemSettings,
		exchangeRates,
		feePoolState,
		delegateApprovals,
		pUSDContract,
		// pBTCContract,
		// pETHContract,
		// USDCContract,
		addressResolver,
		// stakingStateUSDC,
		crossChainManager,
		supplySchedule,
		rewardEscrowV2,
		FEE_ADDRESS,
		pynths;

	before(async () => {
		pynths = ['pUSD', 'pBTC', 'pETH'];
		({
			AddressResolver: addressResolver,
			DelegateApprovals: delegateApprovals,
			ExchangeRates: exchangeRates,
			FeePool: feePool,
			FeePoolState: feePoolState,
			DebtCache: debtCache,
			ProxyFeePool: feePoolProxy,
			PeriFinance: periFinance,
			SystemSettings: systemSettings,
			SystemStatus: systemStatus,
			PynthpUSD: pUSDContract,
			// PynthpBTC: pBTCContract,
			// PynthpETH: pETHContract,
			SystemStatus: systemStatus,
			// USDC: USDCContract,
			// StakingStateUSDC: stakingStateUSDC,
			// TempKovanOracle: tempKovanOracle,
			SupplySchedule: supplySchedule,
			RewardEscrowV2: rewardEscrowV2,
			// Issuer: issuer,
			CrossChainManager: crossChainManager,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'ExchangeRates',
				'Exchanger',
				'FeePool',
				'FeePoolEternalStorage',
				'FeePoolState',
				'DebtCache',
				'Proxy',
				'PeriFinance',
				'PeriFinanceState',
				'SystemSettings',
				'SystemStatus',
				'RewardEscrowV2',
				'DelegateApprovals',
				'CollateralManager',
				'StakingStateUSDC',
				'TempKovanOracle',
				'SupplySchedule',
				'Issuer',
				'RewardsDistribution',
				'CrossChainManager',
			],
		}));

		FEE_ADDRESS = await feePool.FEE_ADDRESS();
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		// Send a price update to guarantee we're not stale.
		await updateRatesWithDefaults();

		// set a 0.3% default exchange fee rate                                                                                 │        { contract: 'ExchangeState' },
		const exchangeFeeRate = toUnit('0.003');
		const pynthKeys = [pBTC, pETH];
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});
	});

	describe('The instance must be spawned correctly', () => {
		it('ensure only known functions are mutative', () => {
			ensureOnlyExpectedMutativeFunctions({
				abi: feePool.abi,
				ignoreParents: ['Proxyable', 'LimitedSetup', 'MixinResolver'],
				expected: [
					'appendAccountIssuanceRecord',
					'claimFees',
					'claimOnBehalf',
					'closeCurrentFeePeriod',
					'distributeFeeRewards',
					'recordFeePaid',
					'setQuotaTolerance',
					'setRecentPeriodStartTime',
					'setRewardsToDistribute',
					'setInitialFeePeriods',
				],
			});
		});

		it('should set constructor params on deployment', async () => {
			FeePool.link(await artifacts.require('SafeDecimalMath').new());
			const instance = await FeePool.new(
				account1, // proxy
				account2, // owner
				addressResolver.address, // resolver
				{
					from: deployerAccount,
				}
			);

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.owner(), account2);
			assert.equal(await instance.resolver(), addressResolver.address);

			// Assert that our first period is open.
			assert.deepEqual(await instance.recentFeePeriods(0), {
				feePeriodId: 1,
				startingDebtIndex: 0,
				feesToDistribute: 0,
				feesClaimed: 0,
			});

			// And that the second period is not yet open
			assert.deepEqual(await instance.recentFeePeriods(1), {
				feePeriodId: 0,
				startTime: 0,
				startingDebtIndex: 0,
				feesToDistribute: 0,
				feesClaimed: 0,
			});
		});

		it('issuance ratio is correctly configured as a default', async () => {
			assert.bnEqual(await feePool.issuanceRatio(), ISSUANCE_RATIO);
		});

		it('the default is set correctly', async () => {
			assert.bnEqual(await feePool.targetThreshold(), toUnit(TARGET_THRESHOLD / 100));
		});

		it('fee period duration is correctly configured as a default', async () => {
			assert.bnEqual(await feePool.feePeriodDuration(), FEE_PERIOD_DURATION);
		});
	});

	describe('restricted methods', () => {
		it('appendAccountIssuanceRecord() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: feePool.appendAccountIssuanceRecord,
				accounts,
				args: [account1, toUnit('0.001'), '0'],
				reason: 'Issuer and PeriFinanceState only',
			});
		});
	});

	describe('when users claim', () => {
		beforeEach(async () => {
			await periFinance.transfer(account1, toUnit('20000'), { from: owner });
			await periFinance.transfer(account2, toUnit('20000'), { from: owner });
			await periFinance.transfer(account3, toUnit('20000'), { from: owner });

			await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });
			await periFinance.issuePynths(PERI, toUnit('10000'), { from: account2 });
			await periFinance.issuePynths(PERI, toUnit('10000'), { from: account3 });
		});

		describe('the reward is to be as followed', async () => {
			beforeEach(async () => {
				await closeFeePeriod(true, account1);
				await updateRatesWithDefaults();
			});
			it('all claimed amount should be escrowed', async () => {
				// get available rewards
				const availableFees1 = await feePool.feesAvailable(account1);
				const availableFees2 = await feePool.feesAvailable(account2);
				const availableFees3 = await feePool.feesAvailable(account3);
				const totalReward = await feePool.totalRewardsAvailable();

				// claim reward on account1 and account2
				await feePool.claimFees({ from: account1 });
				await feePool.claimFees({ from: account2 });

				const rewardEscrow1 = await rewardEscrowV2.balanceOf(account1);
				const rewardEscrow2 = await rewardEscrowV2.balanceOf(account2);
				const rewardEscrow3 = await rewardEscrowV2.balanceOf(account3);
				const totalEscrowedBalance = await rewardEscrowV2.totalEscrowedBalance();
				const remainedTotalReward = await feePool.totalRewardsAvailable();

				const feePeriod = await feePool.recentFeePeriods(1);

				// check escrowed balance that is to be as same as claimed reward.
				assert.bnEqual(availableFees1[1], rewardEscrow1);
				assert.bnEqual(availableFees2[1], rewardEscrow2);
				assert.bnNotEqual(availableFees3[1], toUnit(0));
				assert.bnEqual(rewardEscrow3, toUnit(0));

				// total escrowed reward amount should be as same as total claimed reward amount
				assert.bnEqual(totalEscrowedBalance, rewardEscrow1.add(rewardEscrow2));

				// First period
				assert.deepEqual(feePeriod, {
					feePeriodId: 1,
					startingDebtIndex: 0,
					rewardsToDistribute: totalReward,
					rewardsClaimed: availableFees1[1].add(availableFees2[1]),
				});

				const unclaimedReward = feePeriod[5].sub(feePeriod[6]);
				assert.bnEqual(remainedTotalReward, unclaimedReward);
			});

			it('the ramnant rewards of a period should be added to next inflation reward', async () => {
				// claim rewards on account1 and account2
				await feePool.claimFees({ from: account1 });
				await feePool.claimFees({ from: account2 });

				const { rewardsToDistribute, rewardsClaimed } = await feePool.recentFeePeriods(1);
				const unclaimedReward = rewardsToDistribute.sub(rewardsClaimed);
				const totalEscrowed1st = await rewardEscrowV2.totalEscrowedBalance();

				// 2nd minting
				const { mintAmount } = await closeFeePeriod(true, account1);
				await updateRatesWithDefaults();

				const totalReward = await feePool.totalRewardsAvailable();
				assert.bnEqual(totalReward, mintAmount.add(unclaimedReward));

				// claim rewards on account3 only
				await feePool.claimFees({ from: account3 });

				const totalEscrowed2nd = await rewardEscrowV2.totalEscrowedBalance();

				// the claimed rewards = 2nd period's total escrowed balance of + 1st period's total escrowed balance
				assert.deepEqual(await feePool.recentFeePeriods(1), {
					feePeriodId: 2,
					startingDebtIndex: 3,
					rewardsToDistribute: mintAmount.add(unclaimedReward),
					rewardsClaimed: totalEscrowed2nd.sub(totalEscrowed1st),
				});
			});
		});
	});

	describe('when the issuanceRatio is 0.25', () => {
		beforeEach(async () => {
			// set default issuance ratio of 0.2
			await systemSettings.setIssuanceRatio(toUnit('0.25'), { from: owner });
		});

		it('should track fee withdrawals correctly', async () => {
			const amount = toUnit('10000');

			// Issue pUSD for two different accounts.
			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});
			await periFinance.transfer(account2, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, amount, { from: account1 });
			await periFinance.issuePynths(PERI, amount, { from: account2 });

			await closeFeePeriod(false, account1);

			// Generate a fee.
			const exchange = toUnit('10');
			await periFinance.exchange(pUSD, exchange, pBTC, { from: account1 });

			await closeFeePeriod(false, account1);

			await debtCache.takeDebtSnapshot();

			// Then claim the owner's fees
			await feePool.claimFees({ from: account1 });

			// At this stage there should be a single pending period, one that's half claimed, and an empty one.
			const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();
			const feeInUSD = exchange.sub(amountReceivedFromExchange(exchange));

			// First period
			assert.deepEqual(await feePool.recentFeePeriods(0), {
				feePeriodId: 3,
				startingDebtIndex: 2,
				feesToDistribute: 0,
				feesClaimed: 0,
			});

			// Second period
			assert.deepEqual(await feePool.recentFeePeriods(1), {
				feePeriodId: 2,
				startingDebtIndex: 2,
				feesToDistribute: feeInUSD,
				feesClaimed: feeInUSD.divRound(web3.utils.toBN('2')),
			});

			// Everything else should be zero
			for (let i = 3; i < length; i++) {
				assert.deepEqual(await feePool.recentFeePeriods(i), {
					feePeriodId: 0,
					startingDebtIndex: 0,
					feesToDistribute: 0,
					feesClaimed: 0,
				});
			}

			// And once we roll the periods forward enough we should be able to see the correct
			// roll over happening.
			for (let i = 0; i < length * 2; i++) {
				await closeFeePeriod(false, account1);
			}

			// All periods except last should now be 0
			for (let i = 0; i < length - 1; i++) {
				assert.deepEqual(await feePool.recentFeePeriods(i), {
					feesToDistribute: 0,
					feesClaimed: 0,
				});
			}

			// Last period should have rolled over fees to distribute
			assert.deepEqual(await feePool.recentFeePeriods(length - 1), {
				feesToDistribute: feeInUSD.div(web3.utils.toBN('2')),
				feesClaimed: 0,
			});
		});

		it('should correctly calculate the totalFeesAvailable for a single open period', async () => {
			const amount = toUnit('10000');
			const fee = amount.sub(amountReceivedFromExchange(amount));

			// Issue pUSD for two different accounts.
			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, amount, { from: owner });
			await periFinance.issuePynths(PERI, amount.mul(web3.utils.toBN('2')), {
				from: account1,
			});

			// Generate a fee.
			await periFinance.exchange(pUSD, amount, pBTC, { from: owner });

			// Should be no fees available yet because the period is still pending.
			assert.bnEqual(await feePool.totalFeesAvailable(), 0);

			// So close out the period
			await closeFeePeriod(false, account1);

			// Now we should have some fees.
			assert.bnEqual(await feePool.totalFeesAvailable(), fee);
		});

		it('should correctly calculate the totalFeesAvailable for multiple periods', async () => {
			const amount1 = toUnit('10000');
			const amount2 = amount1.mul(web3.utils.toBN('2'));
			const fee1 = amount1.sub(amountReceivedFromExchange(amount1));

			// Issue pUSD for two different accounts.
			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, amount1, { from: owner });
			await periFinance.issuePynths(PERI, amount2, { from: account1 });

			// Generate a fee.
			await periFinance.exchange(pUSD, amount1, pBTC, { from: owner });

			// Should be no fees available yet because the period is still pending.
			assert.bnEqual(await feePool.totalFeesAvailable(), 0);

			// So close out the period
			await closeFeePeriod(false, account1);

			// Now we should have some fees.
			assert.bnEqual(await feePool.totalFeesAvailable(), fee1);

			// Ok, and do it again but with account1's pynths this time.
			const fee2 = amount2.sub(amountReceivedFromExchange(amount2));

			// Generate a fee.
			await periFinance.exchange(pUSD, amount2, pBTC, { from: account1 });

			// Should be only the previous fees available because the period is still pending.
			assert.bnEqual(await feePool.totalFeesAvailable(), fee1);

			// Close out the period
			await closeFeePeriod(false, account1);

			// Now we should have both fees.
			assert.bnClose(await feePool.totalFeesAvailable(), fee1.add(fee2));
		});

		it('should correctly calculate the feesAvailable for a single user in an open period', async () => {
			const amount = toUnit('10000');
			const fee = amount.sub(amountReceivedFromExchange(amount));

			// Issue pUSD for two different accounts.
			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, amount, { from: owner });
			await periFinance.issuePynths(PERI, amount.mul(web3.utils.toBN('2')), {
				from: account1,
			});

			// Close out the period to allow both users to be part of the whole fee period.
			await closeFeePeriod(false, account1);

			// Generate a fee.
			await periFinance.exchange(pUSD, amount, pBTC, { from: owner });

			// Should be no fees available yet because the period is still pending.
			let feesAvailable;
			feesAvailable = await feePool.feesAvailable(owner);
			assert.bnEqual(feesAvailable[0], 0);

			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnEqual(feesAvailable[0], 0);

			feesAvailable = await feePool.feesAvailable(account2);
			assert.bnEqual(feesAvailable[0], 0);

			// Make the period no longer pending
			await closeFeePeriod(false, account1);

			// Now we should have some fees.
			feesAvailable = await feePool.feesAvailable(owner);
			assert.bnClose(feesAvailable[0], fee.div(web3.utils.toBN('3')));

			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnClose(
				feesAvailable[0],
				fee.div(web3.utils.toBN('3')).mul(web3.utils.toBN('2')),
				'11'
			);

			// But account2 shouldn't be entitled to anything.
			feesAvailable = await feePool.feesAvailable(account2);
			assert.bnEqual(feesAvailable[0], 0);
		});

		it('should correctly calculate the feesAvailable for a single user in multiple periods when fees are partially claimed', async () => {
			const oneThird = number => number.div(web3.utils.toBN('3'));
			const twoThirds = number => oneThird(number).mul(web3.utils.toBN('2'));

			const amount = toUnit('10000');
			const fee = amount.sub(amountReceivedFromExchange(amount));
			const FEE_PERIOD_LENGTH = await feePool.FEE_PERIOD_LENGTH();

			// Issue pUSD for two different accounts.
			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, amount, { from: owner });
			await periFinance.issuePynths(PERI, amount.mul(web3.utils.toBN('2')), {
				from: account1,
			});

			// Close out the period to allow both users to be part of the whole fee period.
			await closeFeePeriod(false, account1);

			// Generate a fee.
			await periFinance.exchange(pUSD, amount, pBTC, { from: owner });

			let feesAvailable;
			// Should be no fees available yet because the period is still pending.
			feesAvailable = await feePool.feesAvailable(owner);
			assert.bnEqual(feesAvailable[0], 0);
			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnEqual(feesAvailable[0], 0);
			feesAvailable = await feePool.feesAvailable(account2);
			assert.bnEqual(feesAvailable[0], 0);

			// Make the period no longer pending
			await closeFeePeriod(false, account1);

			// Now we should have some fees.
			feesAvailable = await feePool.feesAvailable(owner);
			assert.bnClose(feesAvailable[0], oneThird(fee));
			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnClose(feesAvailable[0], twoThirds(fee), '11');

			// The owner decides to claim their fees.
			await feePool.claimFees({ from: owner });

			// account1 should still have the same amount of fees available.
			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnClose(feesAvailable[0], twoThirds(fee), '11');

			// If we close the next FEE_PERIOD_LENGTH fee periods off without claiming, their
			// fee amount that was unclaimed will roll forward, but will get proportionally
			// redistributed to everyone.
			for (let i = 0; i < FEE_PERIOD_LENGTH; i++) {
				await closeFeePeriod(false, account1);
			}

			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnClose(feesAvailable[0], twoThirds(twoThirds(fee)));

			// But once they claim they should have zero.
			await feePool.claimFees({ from: account1 });
			feesAvailable = await feePool.feesAvailable(account1);
			assert.bnEqual(feesAvailable[0], 0);
		});

		describe('closeCurrentFeePeriod()', () => {
			describe('fee period duration not set', () => {
				beforeEach(async () => {
					const storage = await FlexibleStorage.new(addressResolver.address, {
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

					await feePool.rebuildCache();
				});
				it('when closeCurrentFeePeriod() is invoked, it reverts with Fee Period Duration not set', async () => {
					await assert.revert(
						feePool.closeCurrentFeePeriod({ from: owner }),
						'Fee Period Duration not set'
					);
				});
			});
			describe('suspension conditions', () => {
				beforeEach(async () => {
					const feePeriodDuration = await feePool.feePeriodDuration();
					await fastForward(feePeriodDuration);
					// await feePool.distributeFeeRewards({ from: debtManager });
				});
				['System', 'Issuance'].forEach(section => {
					describe(`when ${section} is suspended`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: true });
						});
						it('then calling closeCurrentFeePeriod() reverts', async () => {
							await assert.revert(closeFeePeriod(false, account1), 'Operation prohibited');
						});
						describe(`when ${section} is resumed`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: false });
							});
							it('then calling closeCurrentFeePeriod() succeeds', async () => {
								await feePool.closeCurrentFeePeriod({ from: account1 });
							});
						});
					});
				});
			});
			it('should allow account1 to close the current fee period', async () => {
				await fastForward(await feePool.feePeriodDuration());
				// await feePool.distributeFeeRewards({ from: debtManager });
				const transaction = await feePool.closeCurrentFeePeriod({ from: account1 });

				assert.eventEqual(await transaction, 'FeePeriodClosed', { feePeriodId: 1 });

				// Assert that our first period is new.
				assert.deepEqual(await feePool.recentFeePeriods(0), {
					feePeriodId: 2,
					startingDebtIndex: 0,
					feesToDistribute: 0,
					feesClaimed: 0,
				});

				// And that the second was the old one
				assert.deepEqual(await feePool.recentFeePeriods(1), {
					feePeriodId: 1,
					startingDebtIndex: 0,
					feesToDistribute: 0,
					feesClaimed: 0,
				});

				// fast forward and close another fee Period
				await fastForward(await feePool.feePeriodDuration());
				// await feePool.distributeFeeRewards({ from: debtManager });
				const secondPeriodClose = await feePool.closeCurrentFeePeriod({ from: account1 });

				assert.eventEqual(secondPeriodClose, 'FeePeriodClosed', { feePeriodId: 2 });
			});
			it('should allow the feePoolProxy to close feePeriod', async () => {
				await fastForward(await feePool.feePeriodDuration());

				// await feePool.distributeFeeRewards({ from: debtManager });

				const { tx: hash } = await proxyThruTo({
					proxy: feePoolProxy,
					target: feePool,
					fncName: 'closeCurrentFeePeriod',
					user: owner,
					args: [],
				});

				const logs = await getDecodedLogs({ hash, contracts: [feePool] });

				decodedEventEqual({
					log: logs[0],
					event: 'FeePeriodClosed',
					emittedFrom: feePoolProxy.address,
					args: ['1'],
				});

				// Assert that our first period is new.
				assert.deepEqual(await feePool.recentFeePeriods(0), {
					feePeriodId: 2,
					startingDebtIndex: 0,
					feesToDistribute: 0,
					feesClaimed: 0,
				});

				// And that the second was the old one
				assert.deepEqual(await feePool.recentFeePeriods(1), {
					feePeriodId: 1,
					startingDebtIndex: 0,
					feesToDistribute: 0,
					feesClaimed: 0,
				});
			});
			it('should correctly roll over unclaimed fees when closing fee periods', async () => {
				// Issue 10,000 pUSD.
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });

				// Users are only entitled to fees when they've participated in a fee period in its
				// entirety. Roll over the fee period so fees generated below count for owner.

				await closeFeePeriod(false, account1);

				// Do a single transfer of all our pynths to generate a fee.
				await pUSDContract.transfer(account1, toUnit('10000'), {
					from: owner,
				});

				// Assert that the correct fee is in the fee pool.
				const fee = await pUSDContract.balanceOf(FEE_ADDRESS);
				const pendingFees = await feePool.feesByPeriod(owner);
				assert.bnEqual(web3.utils.toBN(pendingFees[0][0]), fee);
			});

			it('should correctly close the current fee period when there are more than FEE_PERIOD_LENGTH periods', async () => {
				const length = await feePool.FEE_PERIOD_LENGTH();

				// Issue 10,000 pUSD.
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });

				// Users have to have minted before the close of period. Close that fee period
				// so that there won't be any fees in period. future fees are available.
				await closeFeePeriod(false, account1);

				// Do a single transfer of all our pynths to generate a fee.
				await pUSDContract.transfer(account1, toUnit('10000'), {
					from: owner,
				});

				// Assert that the correct fee is in the fee pool.
				const fee = await pUSDContract.balanceOf(FEE_ADDRESS);
				const pendingFees = await feePool.feesByPeriod(owner);

				assert.bnEqual(pendingFees[0][0], fee);

				// Now close FEE_PERIOD_LENGTH * 2 fee periods and assert that it is still in the last one.
				for (let i = 0; i < length * 2; i++) {
					await closeFeePeriod(false, account1);
				}

				const feesByPeriod = await feePool.feesByPeriod(owner);

				// Should be no fees for any period
				for (const zeroFees of feesByPeriod.slice(0, length - 1)) {
					assert.bnEqual(zeroFees[0], 0);
				}

				// Except the last one
				assert.bnEqual(feesByPeriod[length - 1][0], fee);
			});

			it('should correctly close the current fee period when there is only one fee period open', async () => {
				// Assert all the IDs and values are 0.
				const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

				for (let i = 0; i < length; i++) {
					const period = await feePool.recentFeePeriods(i);

					assert.bnEqual(period.feePeriodId, i === 0 ? 1 : 0);
					assert.bnEqual(period.startingDebtIndex, 0);
					assert.bnEqual(period.feesToDistribute, 0);
					assert.bnEqual(period.feesClaimed, 0);
				}

				// Now create the first fee
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });
				await pUSDContract.transfer(account1, toUnit('10000'), {
					from: owner,
				});
				const fee = await pUSDContract.balanceOf(FEE_ADDRESS);

				await closeFeePeriod(false, account1);

				// Assert that we have the correct state

				// First period
				const firstPeriod = await feePool.recentFeePeriods(0);

				assert.bnEqual(firstPeriod.feePeriodId, 2);
				assert.bnEqual(firstPeriod.startingDebtIndex, 1);
				assert.bnEqual(firstPeriod.feesToDistribute, 0);
				assert.bnEqual(firstPeriod.feesClaimed, 0);

				// Second period
				const secondPeriod = await feePool.recentFeePeriods(1);

				assert.bnEqual(secondPeriod.feePeriodId, 1);
				assert.bnEqual(secondPeriod.startingDebtIndex, 0);
				assert.bnEqual(secondPeriod.feesToDistribute, fee);
				assert.bnEqual(secondPeriod.feesClaimed, 0);

				// Everything else should be zero
				for (let i = 2; i < length; i++) {
					const period = await feePool.recentFeePeriods(i);

					assert.bnEqual(period.feePeriodId, 0);
					assert.bnEqual(period.startingDebtIndex, 0);
					assert.bnEqual(period.feesToDistribute, 0);
					assert.bnEqual(period.feesClaimed, 0);
				}
			});

			it('should disallow closing the current fee period too early', async () => {
				const feePeriodDuration = await feePool.feePeriodDuration();

				// Close the current one so we know exactly what we're dealing with
				await closeFeePeriod(false, account1);

				// Try to close the new fee period 5 seconds early
				await fastForward(feePeriodDuration.sub(web3.utils.toBN('5')));
				await assert.revert(
					feePool.closeCurrentFeePeriod({ from: account1 }),
					'Too early to close fee period'
				);
			});

			it('should allow closing the current fee period very late', async () => {
				// Close it 500 times later than prescribed by feePeriodDuration
				// which should still succeed.
				const feePeriodDuration = await feePool.feePeriodDuration();
				await fastForward(feePeriodDuration.mul(web3.utils.toBN('500')));
				await updateRatesWithDefaults();
				// await feePool.distributeFeeRewards({ from: debtManager });
				await feePool.closeCurrentFeePeriod({ from: account1 });
			});
		});

		describe('claimFees()', () => {
			describe('potential blocking conditions', () => {
				beforeEach(async () => {
					// ensure claimFees() can succeed by default (generate fees and close period)
					await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });
					await periFinance.exchange(pUSD, toUnit('10'), pBTC, { from: owner });
					await closeFeePeriod(false, account1);
				});
				['System', 'Issuance'].forEach(section => {
					describe(`when ${section} is suspended`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: true });
						});
						it('then calling claimFees() reverts', async () => {
							await assert.revert(feePool.claimFees({ from: owner }), 'Operation prohibited');
						});
						describe(`when ${section} is resumed`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: false });
							});
							it('then calling claimFees() succeeds', async () => {
								await feePool.claimFees({ from: owner });
							});
						});
					});
				});
				['PERI', 'pBTC', ['PERI', 'pBTC'], 'none'].forEach(type => {
					describe(`when ${type} is stale`, () => {
						beforeEach(async () => {
							await fastForward(
								(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300'))
							);

							// set all rates minus those to ignore
							const ratesToUpdate = ['PERI', 'USDC']
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

						if (type === 'none') {
							it('allows claimFees', async () => {
								await feePool.claimFees({ from: owner });
							});
						} else {
							it('reverts on claimFees', async () => {
								await assert.revert(
									feePool.claimFees({ from: owner }),
									'A pynth or PERI rate is invalid'
								);
							});
						}
					});
				});
			});

			it('should allow a user to claim their fees in pUSD @gasprofile', async () => {
				const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

				// Issue 10,000 pUSD for two different accounts.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

				// For each fee period (with one extra to test rollover), do two exchange transfers, then close it off.
				for (let i = 0; i <= length; i++) {
					const exchange1 = toUnit(((i + 1) * 10).toString());
					const exchange2 = toUnit(((i + 1) * 15).toString());

					await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });
					await periFinance.exchange(pUSD, exchange2, pBTC, { from: account1 });

					await closeFeePeriod(false, account1);
				}

				// Assert that we have correct values in the fee pool
				const feesAvailableUSD = await feePool.feesAvailable(owner);
				const oldpUSDBalance = await pUSDContract.balanceOf(owner);

				// Now we should be able to claim them.
				const claimFeesTx = await feePool.claimFees({ from: owner });

				assert.eventEqual(claimFeesTx, 'FeesClaimed', {
					pUSDAmount: feesAvailableUSD[0],
					periRewards: feesAvailableUSD[1],
				});

				const newUSDBalance = await pUSDContract.balanceOf(owner);
				// We should have our fees
				assert.bnEqual(newUSDBalance, oldpUSDBalance.add(feesAvailableUSD[0]));
			});

			it('should allow a user to claim their fees if they minted debt during period', async () => {
				// Issue 10,000 pUSD for two different accounts.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });

				// For first fee period, do two transfers, then close it off.
				let totalFees = web3.utils.toBN('0');

				const exchange1 = toUnit((10).toString());

				await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });

				totalFees = totalFees.add(exchange1.sub(amountReceivedFromExchange(exchange1)));

				await closeFeePeriod(false, account1);

				// Assert that we have correct values in the fee pool
				// Owner should have all fees as only minted during period
				const feesAvailable = await feePool.feesAvailable(owner);
				assert.bnClose(feesAvailable[0], totalFees, '8');

				const oldPynthBalance = await pUSDContract.balanceOf(owner);

				// Now we should be able to claim them.
				await feePool.claimFees({ from: owner });

				// We should have our fees
				assert.bnEqual(await pUSDContract.balanceOf(owner), oldPynthBalance.add(feesAvailable[0]));

				// FeePeriod 2 - account 1 joins and mints 50% of the debt
				totalFees = web3.utils.toBN('0');
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

				// Generate fees
				await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });
				totalFees = totalFees.add(exchange1.sub(amountReceivedFromExchange(exchange1)));

				await closeFeePeriod(false, account1);

				const issuanceDataOwner = await feePoolState.getAccountsDebtEntry(owner, 0);

				assert.bnEqual(issuanceDataOwner.debtPercentage, toPreciseUnit('1'));
				assert.bnEqual(issuanceDataOwner.debtEntryIndex, '0');

				const feesAvailableOwner = await feePool.feesAvailable(owner);
				const feesAvailableAcc1 = await feePool.feesAvailable(account1);

				await feePool.claimFees({ from: account1 });

				assert.bnClose(feesAvailableOwner[0], totalFees.div(web3.utils.toBN('2')), '8');
				assert.bnClose(feesAvailableAcc1[0], totalFees.div(web3.utils.toBN('2')), '8');
			});

			it('should allow a user to claim their fees in pUSD (as half of total) after some exchanging', async () => {
				const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

				// Issue 10,000 pUSD for two different accounts.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

				// For each fee period (with one extra to test rollover), do two transfers, then close it off.
				let totalFees = web3.utils.toBN('0');

				for (let i = 0; i <= length; i++) {
					const exchange1 = toUnit(((i + 1) * 10).toString());
					const exchange2 = toUnit(((i + 1) * 15).toString());

					await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });
					await periFinance.exchange(pUSD, exchange2, pBTC, { from: account1 });

					totalFees = totalFees.add(exchange1.sub(amountReceivedFromExchange(exchange1)));
					totalFees = totalFees.add(exchange2.sub(amountReceivedFromExchange(exchange2)));

					await closeFeePeriod(false, account1);
				}

				// issuanceData for Owner and Account1 should hold order of minting
				const issuanceDataOwner = await feePoolState.getAccountsDebtEntry(owner, 0);
				assert.bnEqual(issuanceDataOwner.debtPercentage, toPreciseUnit('1'));
				assert.bnEqual(issuanceDataOwner.debtEntryIndex, '0');

				const issuanceDataAccount1 = await feePoolState.getAccountsDebtEntry(account1, 0);
				assert.bnEqual(issuanceDataAccount1.debtPercentage, toPreciseUnit('0.5'));
				assert.bnEqual(issuanceDataAccount1.debtEntryIndex, '1');

				// Period One checks
				const ownerDebtRatioForPeriod = await feePool.effectiveDebtRatioForPeriod(owner, 1);
				const account1DebtRatioForPeriod = await feePool.effectiveDebtRatioForPeriod(account1, 1);

				assert.bnEqual(ownerDebtRatioForPeriod, toPreciseUnit('0.5'));
				assert.bnEqual(account1DebtRatioForPeriod, toPreciseUnit('0.5'));

				// Assert that we have correct values in the fee pool
				const feesAvailable = await feePool.feesAvailable(owner);

				const half = amount => amount.div(web3.utils.toBN('2'));

				// owner has half the debt so entitled to half the fees
				assert.bnClose(feesAvailable[0], half(totalFees), '19');

				const oldPynthBalance = await pUSDContract.balanceOf(owner);

				// Now we should be able to claim them.
				await feePool.claimFees({ from: owner });

				// We should have our fees
				assert.bnEqual(await pUSDContract.balanceOf(owner), oldPynthBalance.add(feesAvailable[0]));
			});

			it('should revert when a user tries to double claim their fees', async () => {
				// Issue 10,000 pUSD.
				await periFinance.issuePynths(PERI, toUnit('10000'), { from: owner });

				// Users are only allowed to claim fees in periods they had an issued balance
				// for the entire period.
				await closeFeePeriod(false, account1);

				// Do a single exchange of all our pynths to generate a fee.
				const exchange1 = toUnit(100);
				await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });

				// Assert that the correct fee is in the fee pool.
				const fee = await pUSDContract.balanceOf(FEE_ADDRESS);
				const pendingFees = await feePool.feesByPeriod(owner);

				assert.bnEqual(pendingFees[0][0], fee);

				// Claiming should revert because the fee period is still open
				await assert.revert(
					feePool.claimFees({ from: owner }),
					'No fees or rewards available for period, or fees already claimed'
				);

				await closeFeePeriod(false, account1);

				// Then claim them
				await feePool.claimFees({ from: owner });

				// But claiming again should revert
				const feesAvailable = await feePool.feesAvailable(owner);
				assert.bnEqual(feesAvailable[0], '0');

				await assert.revert(
					feePool.claimFees({ from: owner }),
					'No fees or rewards available for period, or fees already claimed'
				);
			});

			it('should revert when a user has no fees to claim but tries to claim them', async () => {
				await assert.revert(
					feePool.claimFees({ from: owner }),
					'No fees or rewards available for period, or fees already claimed'
				);
			});
		});

		describe('FeeClaimablePenaltyThreshold', async () => {
			it('should set the targetThreshold and getPenaltyThresholdRatio returns the c-ratio user is blocked at', async () => {
				const thresholdPercent = 10;

				await systemSettings.setTargetThreshold(thresholdPercent, { from: owner });

				const issuanceRatio = await feePool.issuanceRatio();
				const penaltyThreshold = await feePool.targetThreshold();

				assert.bnEqual(penaltyThreshold, toUnit(thresholdPercent / 100));

				// add the 10% buffer to the issuanceRatio to calculate penalty threshold would be at
				const expectedPenaltyThreshold = issuanceRatio.mul(toUnit('1').add(penaltyThreshold));

				assert.bnEqual(
					fromUnit(expectedPenaltyThreshold),
					await feePool.getPenaltyThresholdRatio()
				);
			});

			it('should set the targetThreshold buffer to 5%, at issuanceRatio 0.25 getPenaltyThresholdRatio returns 0.21', async () => {
				const thresholdPercent = 5;

				await systemSettings.setTargetThreshold(thresholdPercent, { from: owner });

				const issuanceRatio = await feePool.issuanceRatio();

				assert.bnEqual(issuanceRatio, toUnit('0.25'));

				const penaltyThreshold = await feePool.targetThreshold();

				assert.bnEqual(penaltyThreshold, toUnit(thresholdPercent / 100));

				// add the 5% buffer to the issuanceRatio to calculate penalty threshold would be at
				const expectedPenaltyThreshold = toUnit('0.2625');

				assert.bnEqual(expectedPenaltyThreshold, await feePool.getPenaltyThresholdRatio());
			});

			it('should be no penalty if issuance ratio is less than target ratio', async () => {
				await periFinance.issueMaxPynths({ from: owner });

				// Increase the price so we start well and truly within our 20% ratio.
				const newRate = (await exchangeRates.rateForCurrency(PERI)).add(web3.utils.toBN('1'));
				const timestamp = await currentTime();
				await exchangeRates.updateRates([PERI], [newRate], timestamp, {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();

				assert.equal(await feePool.isFeesClaimable(owner), true);
			});

			it('should correctly calculate the 10% buffer for penalties at specific issuance ratios', async () => {
				const step = toUnit('0.25');
				await periFinance.issueMaxPynths({ from: owner });

				// Increase the price so we start well and truly within our 20% ratio.
				const newRate = (await exchangeRates.rateForCurrency(PERI)).add(
					step.mul(web3.utils.toBN('1'))
				);
				const timestamp = await currentTime();
				await exchangeRates.updateRates([PERI], [newRate], timestamp, {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();

				const issuanceRatio = fromUnit(await feePool.issuanceRatio());
				const penaltyThreshold = fromUnit(await feePool.targetThreshold());

				const threshold = Number(issuanceRatio) * (1 + Number(penaltyThreshold));
				// Start from the current price of periFinance and slowly decrease the price until
				// we hit almost zero. Assert the correct penalty at each point.
				while ((await exchangeRates.rateForCurrency(PERI)).gt(step.mul(web3.utils.toBN('2')))) {
					const ratio = await periFinance.collateralisationRatio(owner);

					if (ratio.lte(toUnit(threshold))) {
						// Should be claimable
						assert.equal(await feePool.isFeesClaimable(owner), true);
					} else {
						// Should be not claimable penalty
						assert.equal(await feePool.isFeesClaimable(owner), false);
					}

					// Bump the rate down.
					const newRate = (await exchangeRates.rateForCurrency(PERI)).sub(step);
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI], [newRate], timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();
				}
			});

			it('should revert when users try to claim fees with > 10% of threshold', async () => {
				// Issue 10,000 pUSD for two different accounts.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issueMaxPynths({ from: account1 });
				const amount = await pUSDContract.balanceOf(account1);
				await periFinance.issuePynths(PERI, amount, { from: owner });
				await closeFeePeriod(false, account1);

				// Do a transfer to generate fees
				await periFinance.exchange(pUSD, amount, pBTC, { from: owner });
				const fee = amount.sub(amountReceivedFromExchange(amount));

				// We should have zero fees available because the period is still open.
				assert.bnEqual(await getFeesAvailable(account1), 0);

				// Once the fee period is closed we should have half the fee available because we have
				// half the collateral backing up the system.
				await closeFeePeriod(false, account1);
				assert.bnClose(await getFeesAvailable(account1), fee.div(web3.utils.toBN('2')));

				// But if the price of PERI decreases by 15%, we will lose all the fees.
				const currentRate = await exchangeRates.rateForCurrency(PERI);
				const newRate = currentRate.sub(multiplyDecimal(currentRate, toUnit('0.15')));

				const timestamp = await currentTime();
				await exchangeRates.updateRates([PERI], [newRate], timestamp, {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();

				// fees available is unaffected but not claimable
				assert.bnClose(await getFeesAvailable(account1), fee.div(web3.utils.toBN('2')));

				// And revert if we claim them
				await assert.revert(
					feePool.claimFees({ from: account1 }),
					'C-Ratio below penalty threshold'
				);
			});

			it('should be able to set the Target threshold to 15% and claim fees', async () => {
				// Issue 10,000 pUSD for two different accounts.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issueMaxPynths({ from: account1 });
				const amount = await pUSDContract.balanceOf(account1);
				await periFinance.issuePynths(PERI, amount, { from: owner });
				await closeFeePeriod(false, account1);

				// Do a transfer to generate fees
				await periFinance.exchange(pUSD, amount, pBTC, { from: owner });
				const fee = amount.sub(amountReceivedFromExchange(amount));

				// We should have zero fees available because the period is still open.
				assert.bnEqual(await getFeesAvailable(account1), 0);

				// Once the fee period is closed we should have half the fee available because we have
				// half the collateral backing up the system.
				await closeFeePeriod(false, account1);
				assert.bnClose(await getFeesAvailable(account1), fee.div(web3.utils.toBN('2')));

				// But if the price of PERI decreases by 15%, we will lose all the fees.
				const currentRate = await exchangeRates.rateForCurrency(PERI);
				const newRate = currentRate.sub(multiplyDecimal(currentRate, toUnit('0.15')));

				const timestamp = await currentTime();
				await exchangeRates.updateRates([PERI], [newRate], timestamp, {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();

				// fees available is unaffected but not claimable
				assert.bnClose(await getFeesAvailable(account1), fee.div(web3.utils.toBN('2')));

				// And revert if we claim them
				await assert.revert(
					feePool.claimFees({ from: account1 }),
					'C-Ratio below penalty threshold'
				);

				// Should be able to set the Target threshold to 16% and now claim
				const newPercentage = 16;
				await systemSettings.setTargetThreshold(newPercentage, { from: owner });
				assert.bnEqual(await feePool.targetThreshold(), toUnit(newPercentage / 100));

				assert.equal(await feePool.isFeesClaimable(owner), true);
			});
		});

		describe('effectiveDebtRatioForPeriod', async () => {
			it('should revert if period is > than FEE_PERIOD_LENGTH', async () => {
				// returns length of periods
				const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

				// adding an extra period should revert as not available (period rollsover at last one)
				await assert.revert(
					feePool.effectiveDebtRatioForPeriod(owner, length + 1),
					'Exceeds the FEE_PERIOD_LENGTH'
				);
			});

			it('should revert if checking current unclosed period ', async () => {
				await assert.revert(
					feePool.effectiveDebtRatioForPeriod(owner, 0),
					'Current period is not closed yet'
				);
			});
		});

		describe('claimOnBehalf', async () => {
			async function generateFees() {
				// Issue 10,000 pUSD.
				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				await periFinance.issuePynths(PERI, toUnit('10000'), { from: account1 });

				// For first fee period, do one exchange.
				const exchange1 = toUnit((10).toString());

				// generate fee
				await periFinance.exchange(pUSD, exchange1, pBTC, { from: account1 });

				await closeFeePeriod(false, account1);
			}

			describe('potential blocking conditions', () => {
				const authoriser = account1;
				const delegate = account2;
				beforeEach(async () => {
					// approve account2 to claim on behalf of account1
					await delegateApprovals.approveClaimOnBehalf(delegate, { from: authoriser });
					// ensure claimFees() can succeed by default (generate fees and close period)
					await generateFees();
				});
				['System', 'Issuance'].forEach(section => {
					describe(`when ${section} is suspended`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: true });
						});
						it('then calling claimOnBehalf() reverts', async () => {
							await assert.revert(
								feePool.claimOnBehalf(authoriser, { from: delegate }),
								'Operation prohibited'
							);
						});
						describe(`when ${section} is resumed`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: false });
							});
							it('then calling claimOnBehalf() succeeds', async () => {
								await feePool.claimOnBehalf(authoriser, { from: delegate });
							});
						});
					});
				});
				['PERI', 'pBTC', ['PERI', 'pBTC'], 'none'].forEach(type => {
					describe(`when ${type} is stale`, () => {
						beforeEach(async () => {
							await fastForward(
								(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300'))
							);

							// set all rates minus those to ignore
							const ratesToUpdate = ['PERI', 'USDC']
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

						if (type === 'none') {
							it('allows claimFees', async () => {
								await feePool.claimOnBehalf(authoriser, { from: delegate });
							});
						} else {
							it('reverts on claimFees', async () => {
								await assert.revert(
									feePool.claimOnBehalf(authoriser, { from: delegate }),
									'A pynth or PERI rate is invalid'
								);
							});
						}
					});
				});
			});

			it('should approve a claim on behalf for account1 by account2 and have fees in wallet', async () => {
				const authoriser = account1;
				const delegate = account2;

				// approve account2 to claim on behalf of account1
				await delegateApprovals.approveClaimOnBehalf(delegate, { from: authoriser });
				const result = await delegateApprovals.canClaimFor(authoriser, delegate);

				assert.isTrue(result);

				// Assert that we have correct values in the fee pool
				// account1 should have all fees as only minted during period
				await generateFees();

				const feesAvailable = await feePool.feesAvailable(account1);

				// old balance of account1 (authoriser)
				const oldPynthBalance = await pUSDContract.balanceOf(account1);

				// Now we should be able to claim them on behalf of account1.
				await feePool.claimOnBehalf(account1, { from: account2 });

				// We should have our fees for account1
				assert.bnEqual(
					await pUSDContract.balanceOf(account1),
					oldPynthBalance.add(feesAvailable[0])
				);
			});
			it('should revert if account2 tries to claimOnBehalf without approval', async () => {
				const authoriser = account1;
				const delegate = account2;

				// account2 doesn't have approval to claim on behalf of account1
				const result = await delegateApprovals.canClaimFor(authoriser, delegate);

				assert.isNotTrue(result);

				// Assert that we have correct values in the fee pool
				// account1 should have all fees as only minted during period
				await generateFees();

				await assert.revert(
					feePool.claimOnBehalf(account1, { from: account2 }),
					'Not approved to claim on behalf'
				);
			});
		});

		describe('reducing FEE_PERIOD_LENGTHS', async () => {
			it('should be able to get fees available when feePoolState issuanceData is 6 blocks', async () => {
				const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

				await periFinance.transfer(account1, toUnit('1000000'), {
					from: owner,
				});

				// For each fee period (with one extra to test rollover), do two transfers, then close it off.
				let totalFees = web3.utils.toBN('0');

				// Iterate over the period lengths * 2 to fill up issuanceData in feePoolState
				// feePoolState can hold up to 6 periods of minting issuanceData
				// fee Periods can be less than the 6 periods
				for (let i = 0; i <= length * 2; i++) {
					const exchange1 = toUnit(((i + 1) * 10).toString());

					// Mint debt each period to fill up feelPoolState issuanceData to [6]
					await periFinance.issuePynths(PERI, toUnit('1000'), { from: owner });
					await periFinance.issuePynths(PERI, toUnit('1000'), {
						from: account1,
					});

					await periFinance.exchange(pUSD, exchange1, pBTC, { from: owner });

					totalFees = totalFees.add(exchange1.sub(amountReceivedFromExchange(exchange1)));

					await closeFeePeriod(false, account1);
				}

				// Assert that we have correct values in the fee pool
				// Account1 should have all the fees as only account minted
				const feesAvailable = await feePool.feesAvailable(account1);
				assert.bnClose(feesAvailable[0], totalFees.div(web3.utils.toBN('2')), '8');

				const oldPynthBalance = await pUSDContract.balanceOf(account1);

				// Now we should be able to claim them.
				await feePool.claimFees({ from: account1 });

				// We should have our fees
				assert.bnEqual(
					await pUSDContract.balanceOf(account1),
					oldPynthBalance.add(feesAvailable[0])
				);
			});
		});
	});
	describe('when cross chain syncing', () => {
		beforeEach(async () => {
			const tChainIds = ['1287', '97', '5'].map(toUnit);

			// await crossChainManager.addNetworkIds(tChainIds, { from: owner });

			const tIssuedDebt = [
				'3000000000000000000000',
				'3000000000000000000000',
				'2000000000000000000000',
			];
			const tActiveDebt = [
				'3000000000000000000000',
				'3000000000000000000000',
				'2000000000000000000000',
			];
			const tInOut = toUnit('0');

			// set initial issued/active debt for other chains
			await crossChainManager.setCrossNetworkDebtsAll(tChainIds, tIssuedDebt, tActiveDebt, tInOut, {
				from: debtManager,
			});

			await periFinance.transfer(account1, toUnit('1000000'), {
				from: owner,
			});

			await periFinance.issuePynths(PERI, toUnit('100000'), { from: owner });
			await periFinance.issuePynths(PERI, toUnit('100000'), {
				from: account1,
			});

			await periFinance.exchange(pUSD, toUnit(50000), pBTC, { from: owner });
			await periFinance.exchange(pUSD, toUnit(50000), pBTC, { from: account1 });
		});
		it('should burn over-issued fees', async () => {
			const { feesToDistribute } = await feePool.recentFeePeriods(0);
			const feeBalance = await pUSDContract.balanceOf(FEE_ADDRESS);

			await closeFeePeriod(false, account1);

			const feeBalanceAfter = await pUSDContract.balanceOf(FEE_ADDRESS);

			// Assert that we have correct values in the fee pool
			// Account1 should have all the fees as only account minted
			const feesAvailable = await feePool.feesAvailable(account1);

			const selfRate = await crossChainManager.currentNetworkDebtPercentage();
			logger.info('selfRate', selfRate.toString());
			const expectedFee = divideDecimalRoundPrecise(
				multiplyDecimalRoundPrecise(feesToDistribute, selfRate),
				toPreciseUnit('2')
			);
			logger.info('expectedFee', expectedFee.toString());
			logger.info('feesAvailable[0]', feesAvailable[0].toString());

			assert.bnEqual(feesAvailable[0], expectedFee);
			assert.bnLt(feeBalanceAfter, feeBalance);
			assert.bnEqual(feeBalanceAfter, multiplyDecimalRoundPrecise(feeBalance, selfRate));
		});

		it('should issue extra fees from other network', async () => {
			const feeBalance = await pUSDContract.balanceOf(FEE_ADDRESS);

			await closeFeePeriod(false, account1, ['5000', '8000', '10000'].map(toUnit));

			const feeBalanceAfter = await pUSDContract.balanceOf(FEE_ADDRESS);
			const feeRewardsToBeAllocated = await feePool.feeRewardsToBeAllocated();

			const feesAvailable = await feePool.feesAvailable(account1);

			const selfRate = await crossChainManager.currentNetworkDebtPercentage();
			logger.info('selfRate', selfRate.toString());
			// 5000+8000+10000 = 23000
			const expectedFee = divideDecimalRoundPrecise(
				multiplyDecimalRoundPrecise(feeRewardsToBeAllocated.add(toUnit('23000')), selfRate),
				toPreciseUnit('2')
			);
			logger.info('feeRewardsToBeAllocated', feeRewardsToBeAllocated.toString());
			logger.info('expectedFee', expectedFee.toString());
			logger.info('feesAvailable[0]', feesAvailable[0].toString());
			logger.info('feeBalanceAfter', feeBalanceAfter.toString());
			logger.info('feeBalance', feeBalance.toString());

			assert.bnEqual(feesAvailable[0], expectedFee);
			assert.bnGt(feeBalanceAfter, feeBalance);
			assert.bnEqual(
				feeBalanceAfter,
				multiplyDecimalRoundPrecise(feeBalance.add(toUnit('23000')), selfRate)
			);
		});
	});
});
