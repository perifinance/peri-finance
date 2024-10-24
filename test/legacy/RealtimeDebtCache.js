'use strict';

const { contract, artifacts } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, setupContract } = require('./setup');

const { currentTime, toUnit, fastForward } = require('../utils')();
const { toBN } = require('web3-utils');
const { convertToDecimals } = require('./helpers');

const { setExchangeFeeRateForPynths, getDecodedLogs } = require('./helpers');

const {
	toBytes32,
	defaults: { DEBT_SNAPSHOT_STALE_TIME },
} = require('../..');

contract('RealtimeDebtCache', async accounts => {
	const [pUSD, pAUD, pEUR, PERI, pETH] = ['pUSD', 'pAUD', 'pEUR', 'PERI', 'pETH'].map(toBytes32);
	const pynthKeys = [pUSD, pAUD, pEUR, pETH, PERI];

	const [, owner, oracle, account1] = accounts;

	let periFinance,
		systemSettings,
		exchangeRates,
		pUSDContract,
		pETHContract,
		pEURContract,
		pAUDContract,
		timestamp,
		debtCache,
		issuer,
		pynths,
		addressResolver,
		exchanger,
		crossChainManager;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		pynths = ['pUSD', 'pAUD', 'pEUR', 'pETH'];
		({
			PeriFinance: periFinance,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			PynthpUSD: pUSDContract,
			PynthpETH: pETHContract,
			PynthpAUD: pAUDContract,
			PynthpEUR: pEURContract,
			DebtCache: debtCache,
			Issuer: issuer,
			AddressResolver: addressResolver,
			Exchanger: exchanger,
			CrossChainManager: crossChainManager,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'AddressResolver',
				'PeriFinanceEscrow',
				'DebtCache',
				'Exchanger',
				'CollateralManager',
				'RewardEscrowV2',
				'StakingState',
				'CrossChainManager',
			],
			stables: [],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timestamp = await currentTime();

		await exchangeRates.updateRates(
			[pAUD, pEUR, PERI, pETH],
			['0.5', '1.25', '0.1', '200'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// set a 0.3% default exchange fee rate
		const exchangeFeeRate = toUnit('0.003');
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});
		await debtCache.takeDebtSnapshot();
	});

	it('debt snapshot stale time is correctly configured as a default', async () => {
		assert.bnEqual(await debtCache.debtSnapshotStaleTime(), DEBT_SNAPSHOT_STALE_TIME);
	});

	describe('After issuing pynths', () => {
		beforeEach(async () => {
			// set minimumStakeTime on issue and burning to 0
			await systemSettings.setMinimumStakeTime(0, { from: owner });
			// set default issuance ratio of 0.2
			await systemSettings.setIssuanceRatio(toUnit('0.2'), { from: owner });
			// set up initial prices
			await exchangeRates.updateRates(
				[pAUD, pEUR, pETH],
				['0.5', '2', '100'].map(toUnit),
				await currentTime(),
				{ from: oracle }
			);
			await debtCache.takeDebtSnapshot();

			// Issue 1000 pUSD worth of tokens to a user
			await pUSDContract.issue(account1, toUnit(100));
			await pAUDContract.issue(account1, toUnit(100));
			await pEURContract.issue(account1, toUnit(100));
			await pETHContract.issue(account1, toUnit(2));
		});

		describe('Current issued debt', () => {
			it('Live debt is reported accurately', async () => {
				// The pynth debt has not yet been cached.
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(0));

				const result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(550));
				assert.isFalse(result[1]);
			});

			it('Live debt is reported accurately for individual currencies', async () => {
				const result = await debtCache.currentPynthDebts([pUSD, pEUR, pAUD, pETH]);
				const debts = result[0];

				assert.bnEqual(debts[0], toUnit(100));
				assert.bnEqual(debts[1], toUnit(200));
				assert.bnEqual(debts[2], toUnit(50));
				assert.bnEqual(debts[3], toUnit(200));

				assert.isFalse(result[1]);
			});
		});

		describe('Realtime debt cache', () => {
			let realtimeDebtCache;

			beforeEach(async () => {
				// replace the debt cache with its real-time version
				realtimeDebtCache = await setupContract({
					contract: 'RealtimeDebtCache',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});

				await addressResolver.importAddresses(
					[toBytes32('DebtCache')],
					[realtimeDebtCache.address],
					{
						from: owner,
					}
				);

				// rebuild the caches of those addresses not just added to the adress resolver
				await Promise.all([
					issuer.rebuildCache(),
					exchanger.rebuildCache(),
					realtimeDebtCache.rebuildCache(),
					crossChainManager.rebuildCache(),
				]);
			});

			it('Cached values report current numbers without cache resynchronisation', async () => {
				let debts = await realtimeDebtCache.currentPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0][0], toUnit(100));
				assert.bnEqual(debts[0][1], toUnit(200));
				assert.bnEqual(debts[0][2], toUnit(50));
				assert.bnEqual(debts[0][3], toUnit(200));

				debts = await realtimeDebtCache.cachedPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0], toUnit(100));
				assert.bnEqual(debts[1], toUnit(200));
				assert.bnEqual(debts[2], toUnit(50));
				assert.bnEqual(debts[3], toUnit(200));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pUSD), toUnit(100));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pEUR), toUnit(200));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pAUD), toUnit(50));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pETH), toUnit(200));

				assert.bnEqual((await realtimeDebtCache.cacheInfo()).debt, toUnit(550));
				assert.bnEqual((await realtimeDebtCache.currentDebt())[0], toUnit(550));
				assert.bnEqual(await realtimeDebtCache.cachedDebt(), toUnit(550));

				await exchangeRates.updateRates(
					[pAUD, pEUR, pETH],
					['1', '3', '200'].map(toUnit),
					await currentTime(),
					{
						from: oracle,
					}
				);

				debts = await realtimeDebtCache.currentPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0][0], toUnit(100));
				assert.bnEqual(debts[0][1], toUnit(300));
				assert.bnEqual(debts[0][2], toUnit(100));
				assert.bnEqual(debts[0][3], toUnit(400));

				debts = await realtimeDebtCache.cachedPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0], toUnit(100));
				assert.bnEqual(debts[1], toUnit(300));
				assert.bnEqual(debts[2], toUnit(100));
				assert.bnEqual(debts[3], toUnit(400));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pUSD), toUnit(100));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pEUR), toUnit(300));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pAUD), toUnit(100));
				assert.bnEqual(await realtimeDebtCache.cachedPynthDebt(pETH), toUnit(400));

				assert.bnEqual((await realtimeDebtCache.cacheInfo()).debt, toUnit(900));
				assert.bnEqual((await realtimeDebtCache.currentDebt())[0], toUnit(900));
				assert.bnEqual(await realtimeDebtCache.cachedDebt(), toUnit(900));
			});

			it('Cache timestamps update in real time and are never stale', async () => {
				const now = toBN(await currentTime());
				let timestamp = toBN(await realtimeDebtCache.cacheTimestamp());
				let stale = await realtimeDebtCache.cacheStale();
				let info = await realtimeDebtCache.cacheInfo();

				assert.bnLte(now, timestamp);
				assert.bnLte(timestamp, toBN(info.timestamp));
				assert.isFalse(stale);
				assert.isFalse(info.isStale);

				const staleTime = await systemSettings.debtSnapshotStaleTime();
				await fastForward(staleTime * 2);

				const later = toBN(await currentTime());
				timestamp = toBN(await realtimeDebtCache.cacheTimestamp());
				stale = await realtimeDebtCache.cacheStale();
				info = await realtimeDebtCache.cacheInfo();

				assert.bnLt(now, later);
				assert.bnLte(later, timestamp);
				assert.bnLte(timestamp, toBN(info.timestamp));
				assert.isFalse(stale);
				assert.isFalse(info.isStale);

				assert.bnEqual(
					toBN(await realtimeDebtCache.debtSnapshotStaleTime()),
					toBN(2)
						.pow(toBN(256))
						.sub(toBN(1))
				);
			});

			it('Cache invalidity changes in real time if a rate is flagged', async () => {
				const mockFlagsInterface = await artifacts.require('MockFlagsInterface').new();
				await systemSettings.setAggregatorWarningFlags(mockFlagsInterface.address, {
					from: owner,
				});
				const aggregatorEUR = await artifacts.require('MockAggregatorV2V3').new({ from: owner });
				aggregatorEUR.setDecimals('8');
				await exchangeRates.addAggregator(pEUR, aggregatorEUR.address, {
					from: owner,
				});
				await mockFlagsInterface.unflagAggregator(aggregatorEUR.address);

				await exchangeRates.updateRates(
					[pAUD, pETH],
					['1', '200'].map(toUnit),
					await currentTime(),
					{
						from: oracle,
					}
				);
				await aggregatorEUR.setLatestAnswer(convertToDecimals(3, 8), await currentTime());
				assert.isFalse(await realtimeDebtCache.cacheInvalid());
				assert.isFalse((await realtimeDebtCache.cacheInfo()).isInvalid);

				await mockFlagsInterface.flagAggregator(aggregatorEUR.address);
				assert.isTrue(await realtimeDebtCache.cacheInvalid());
				assert.isTrue((await realtimeDebtCache.cacheInfo()).isInvalid);

				await mockFlagsInterface.unflagAggregator(aggregatorEUR.address);
				assert.isFalse(await realtimeDebtCache.cacheInvalid());
				assert.isFalse((await realtimeDebtCache.cacheInfo()).isInvalid);
			});

			it('Cache functions still operate, but are no-ops', async () => {
				const noOpGasLimit = 23500;

				const txs = await Promise.all([
					realtimeDebtCache.updateCachedPynthDebts([pEUR]),
					realtimeDebtCache.updateCachedPynthDebtWithRate(pEUR, toUnit('1')),
					realtimeDebtCache.updateCachedPynthDebtsWithRates(
						[pEUR, pAUD],
						[toUnit('1'), toUnit('2')]
					),
					realtimeDebtCache.updateDebtCacheValidity(true),
				]);

				txs.forEach(tx => assert.isTrue(tx.receipt.gasUsed < noOpGasLimit));
			});

			describe('Exchanging, issuing, burning, settlement still operate properly', async () => {
				it('issuing pUSD updates the debt total', async () => {
					const issued = (await realtimeDebtCache.cacheInfo())[0];

					const pynthsToIssue = toUnit('10');
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });
					const tx = await periFinance.issuePynths(PERI, pynthsToIssue, {
						from: account1,
					});
					assert.bnEqual((await realtimeDebtCache.cacheInfo())[0], issued.add(pynthsToIssue));

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});
					assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheUpdated'));
				});

				it('burning pUSD updates the debt total', async () => {
					const pynthsToIssue = toUnit('20');
					await periFinance.transfer(account1, toUnit('1000'), { from: owner });
					await periFinance.issuePynths(PERI, pynthsToIssue, { from: account1 });
					const issued = (await realtimeDebtCache.cacheInfo())[0];

					const pynthsToBurn = toUnit('5');

					const tx = await periFinance.burnPynths(PERI, pynthsToBurn, { from: account1 });
					assert.bnEqual((await realtimeDebtCache.cacheInfo())[0], issued.sub(pynthsToBurn));

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheUpdated'));
				});

				it('exchanging between pynths updates the debt totals for those pynths', async () => {
					// Zero exchange fees so that we can neglect them.
					await systemSettings.setExchangeFeeRateForPynths([pAUD, pUSD], [toUnit(0), toUnit(0)], {
						from: owner,
					});

					await periFinance.transfer(account1, toUnit('1000'), { from: owner });
					await periFinance.issuePynths(PERI, toUnit('10'), { from: account1 });
					const issued = (await realtimeDebtCache.cacheInfo())[0];
					const debts = await realtimeDebtCache.cachedPynthDebts([pUSD, pAUD]);
					const tx = await periFinance.exchange(pUSD, toUnit('5'), pAUD, { from: account1 });
					const postDebts = await realtimeDebtCache.cachedPynthDebts([pUSD, pAUD]);
					assert.bnEqual((await realtimeDebtCache.cacheInfo())[0], issued);
					assert.bnEqual(postDebts[0], debts[0].sub(toUnit(5)));
					assert.bnEqual(postDebts[1], debts[1].add(toUnit(5)));

					// As the total debt did not change, no DebtCacheUpdated event was emitted.
					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheUpdated'));
				});

				it('exchanging between pynths updates pUSD debt total due to fees', async () => {
					await systemSettings.setExchangeFeeRateForPynths(
						[pAUD, pUSD, pEUR],
						[toUnit(0.1), toUnit(0.1), toUnit(0.1)],
						{ from: owner }
					);

					await pEURContract.issue(account1, toUnit(20));
					const issued = (await realtimeDebtCache.cacheInfo())[0];

					const debts = await realtimeDebtCache.cachedPynthDebts([pUSD, pAUD, pEUR]);

					await periFinance.exchange(pEUR, toUnit(10), pAUD, { from: account1 });
					const postDebts = await realtimeDebtCache.cachedPynthDebts([pUSD, pAUD, pEUR]);

					assert.bnEqual((await realtimeDebtCache.cacheInfo())[0], issued);
					assert.bnEqual(postDebts[0], debts[0].add(toUnit(2)));
					assert.bnEqual(postDebts[1], debts[1].add(toUnit(18)));
					assert.bnEqual(postDebts[2], debts[2].sub(toUnit(20)));
				});

				it('exchanging between pynths updates debt properly when prices have changed', async () => {
					await systemSettings.setExchangeFeeRateForPynths([pAUD, pUSD], [toUnit(0), toUnit(0)], {
						from: owner,
					});

					await pEURContract.issue(account1, toUnit(20));
					const issued = (await realtimeDebtCache.cacheInfo())[0];

					const debts = await realtimeDebtCache.cachedPynthDebts([pAUD, pEUR]);

					await exchangeRates.updateRates(
						[pAUD, pEUR],
						['1', '1'].map(toUnit),
						await currentTime(),
						{
							from: oracle,
						}
					);

					await periFinance.exchange(pEUR, toUnit(10), pAUD, { from: account1 });
					const postDebts = await realtimeDebtCache.cachedPynthDebts([pAUD, pEUR]);

					// 120 eur @ $2 = $240 and 100 aud @ $0.50 = $50 becomes:
					// 110 eur @ $1 = $110 (-$130) and 110 aud @ $1 = $110 (+$60)
					// Total debt is reduced by $130 - $60 = $70
					assert.bnEqual((await realtimeDebtCache.cacheInfo())[0], issued.sub(toUnit(70)));
					assert.bnEqual(postDebts[0], debts[0].add(toUnit(60)));
					assert.bnEqual(postDebts[1], debts[1].sub(toUnit(130)));
				});

				it('settlement updates debt totals', async () => {
					await systemSettings.setExchangeFeeRateForPynths([pAUD, pEUR], [toUnit(0), toUnit(0)], {
						from: owner,
					});
					await pAUDContract.issue(account1, toUnit(100));

					await periFinance.exchange(pAUD, toUnit(50), pEUR, { from: account1 });

					await exchangeRates.updateRates(
						[pAUD, pEUR],
						['2', '1'].map(toUnit),
						await currentTime(),
						{
							from: oracle,
						}
					);

					const tx = await exchanger.settle(account1, pAUD);
					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});
					assert.equal(logs.filter(log => log !== undefined).length, 0);

					// AU$150 worth $75 became worth $300
					// The EUR debt does not change due to settlement,
					// But its price did halve, so it becomes
					// ($200 + $25) / 2 from the exchange and price update

					const results = await realtimeDebtCache.cachedPynthDebts([pAUD, pEUR]);
					assert.bnEqual(results[0], toUnit(300));
					assert.bnEqual(results[1], toUnit(112.5));
				});
			});
		});
	});
});
