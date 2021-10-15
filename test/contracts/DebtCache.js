'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, setupContract, mockToken } = require('./setup');

const { currentTime, toUnit, fastForward } = require('../utils')();

const {
	setExchangeFeeRateForPynths,
	getDecodedLogs,
	decodedEventEqual,
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setStatus,
} = require('./helpers');

const {
	toBytes32,
	defaults: { DEBT_SNAPSHOT_STALE_TIME },
} = require('../..');

contract('DebtCache', async accounts => {
	const [pUSD, PERI, USDC] = ['pUSD', 'PERI', 'USDC'].map(toBytes32);
	const pynthKeys = [pUSD, PERI, USDC];

	const [, owner, oracle, account1, account2] = accounts;

	let periFinance,
		systemStatus,
		systemSettings,
		exchangeRates,
		feePool,
		pUSDContract,
		USDCContract,
		timestamp,
		debtCache,
		issuer,
		pynths,
		addressResolver,
		exchanger;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		pynths = ['pUSD', 'PERI', 'USDC'];
		({
			PeriFinance: periFinance,
			SystemStatus: systemStatus,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			PynthpUSD: pUSDContract,
			USDC: USDCContract,
			FeePool: feePool,
			DebtCache: debtCache,
			Issuer: issuer,
			AddressResolver: addressResolver,
			Exchanger: exchanger,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'ExchangeRates',
				'FeePool',
				'FeePoolEternalStorage',
				'AddressResolver',
				'RewardEscrow',
				'PeriFinanceEscrow',
				'SystemSettings',
				'Issuer',
				'DebtCache',
				'Exchanger', // necessary for burnPynths to check settlement of pUSD
				'DelegateApprovals', // necessary for *OnBehalf functions
				'FlexibleStorage',
				'CollateralManager',
				'RewardEscrowV2', // necessary for issuer._collateral()
				'StakingState',
				'ExternalTokenStakeManager',
				'MultiChainDebtShareManager',
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
		await debtCache.takeDebtSnapshot();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: debtCache.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'takeDebtSnapshot',
				'purgeCachedPynthDebt',
				'updateCachedPynthDebts',
				'updateCachedPynthDebtWithRate',
				'updateCachedPynthDebtsWithRates',
				'updateDebtCacheValidity',
			],
		});
	});

	it('debt snapshot stale time is correctly configured as a default', async () => {
		assert.bnEqual(await debtCache.debtSnapshotStaleTime(), DEBT_SNAPSHOT_STALE_TIME);
	});

	describe('protected methods', () => {
		it('updateCachedPynthDebtWithRate() can only be invoked by the issuer', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.updateCachedPynthDebtWithRate,
				args: [USDC, toUnit('1')],
				accounts,
				reason: 'Sender is not Issuer',
			});
		});

		it('updateCachedPynthDebtsWithRates() can only be invoked by the issuer or exchanger', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.updateCachedPynthDebtsWithRates,
				args: [
					[PERI, USDC],
					[toUnit('0.98'), toUnit('0.2')],
				],
				accounts,
				reason: 'Sender is not Issuer or Exchanger',
			});
		});

		it('updateDebtCacheValidity() can only be invoked by the issuer', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.updateDebtCacheValidity,
				args: [true],
				accounts,
				reason: 'Sender is not Issuer',
			});
		});

		it('purgeCachedPynthDebt() can only be invoked by the owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.purgeCachedPynthDebt,
				accounts,
				args: [PERI],
				address: owner,
				skipPassCheck: true,
				reason: 'Only the contract owner may perform this action',
			});
		});
	});

	describe('After issuing pynths', () => {
		beforeEach(async () => {
			// set minimumStakeTime on issue and burning to 0
			await systemSettings.setMinimumStakeTime(0, { from: owner });
			// set default issuance ratio of 0.2
			await systemSettings.setIssuanceRatio(toUnit('0.2'), { from: owner });
			// set up initial prices
			await exchangeRates.updateRates(
				[PERI, USDC],
				['0.2', '0.98'].map(toUnit),
				await currentTime(),
				{ from: oracle }
			);
			await debtCache.takeDebtSnapshot();

			// Issue 1000 pUSD worth of tokens to a user
			await pUSDContract.issue(account1, toUnit(100)); // arbitrary issued pynth doesnt calculate exchange rates
			await periFinance.transfer(account1, toUnit(100), { from: owner });
			await USDCContract.transfer(account1, '1000000', { from: owner });
			await USDCContract.approve(issuer.address, '1000000000000', { from: account1 });
		});

		describe('Current issued debt', () => {
			it('Live debt is reported accurately', async () => {
				// The pynth debt has not yet been cached.
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(0));

				const result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(100));
				assert.isFalse(result[1]);
			});

			it('Live debt is reported accurately for individual currencies', async () => {
				const result = await debtCache.currentPynthDebts([pUSD]);
				const debts = result[0];

				assert.bnEqual(debts[0], toUnit(100));

				assert.isFalse(result[1]);
			});
		});

		describe('takeDebtSnapshot()', () => {
			let preTimestamp;
			let tx;
			let time;

			beforeEach(async () => {
				preTimestamp = (await debtCache.cacheInfo()).timestamp;
				await fastForward(5);
				tx = await debtCache.takeDebtSnapshot();
				time = await currentTime();
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('accurately resynchronises the debt after prices have changed', async () => {
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(100));
				let result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(100));
				assert.isFalse(result[1]);

				await exchangeRates.updateRates([pBTC, pETH], ['1', '3'].map(toUnit), await currentTime(), {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(100));
				result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(100));
				assert.isFalse(result[1]);
			});

			it('updates the debt snapshot timestamp', async () => {
				const timestamp = (await debtCache.cacheInfo()).timestamp;
				assert.bnNotEqual(timestamp, preTimestamp);
				assert.isTrue(time - timestamp < 15);
			});

			it('properly emits debt cache updated and synchronised events', async () => {
				assert.eventEqual(tx.logs[0], 'DebtCacheUpdated', [toUnit(100)]);
				assert.eventEqual(tx.logs[1], 'DebtCacheSnapshotTaken', [
					(await debtCache.cacheInfo()).timestamp,
				]);
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('updates the cached values for all individual pynths', async () => {
				await exchangeRates.updateRates([PERI, USDC], ['1', '3'].map(toUnit), await currentTime(), {
					from: oracle,
				});
				await debtCache.takeDebtSnapshot();
				let debts = await debtCache.currentPynthDebts([pUSD]);
				assert.bnEqual(debts[0][0], toUnit(100));

				debts = await debtCache.cachedPynthDebts([pUSD]);
				assert.bnEqual(debts[0], toUnit(100));
			});

			it('is able to invalidate and revalidate the debt cache when required.', async () => {
				// Wait until the exchange rates are stale in order to invalidate the cache.
				const rateStalePeriod = await systemSettings.rateStalePeriod();
				await fastForward(rateStalePeriod + 1000);

				assert.isFalse((await debtCache.cacheInfo()).isInvalid);

				// stale rates invalidate the cache
				const tx1 = await debtCache.takeDebtSnapshot();
				assert.isTrue((await debtCache.cacheInfo()).isInvalid);

				// Revalidate the cache once rates are no longer stale
				await exchangeRates.updateRates(
					[PERI, USDC],
					['0.2', '0.98'].map(toUnit),
					await currentTime(),
					{ from: oracle }
				);
				const tx2 = await debtCache.takeDebtSnapshot();
				assert.isFalse((await debtCache.cacheInfo()).isInvalid);

				assert.eventEqual(tx1.logs[2], 'DebtCacheValidityChanged', [true]);
				assert.eventEqual(tx2.logs[2], 'DebtCacheValidityChanged', [false]);
			});

			it('Rates are reported as invalid when snapshot is stale.', async () => {
				assert.isFalse((await debtCache.cacheInfo()).isStale);
				assert.isFalse(await debtCache.cacheStale());
				assert.isFalse((await issuer.collateralisationRatioAndAnyRatesInvalid(account1))[1]);
				const snapshotStaleTime = await systemSettings.debtSnapshotStaleTime();
				await fastForward(snapshotStaleTime + 10);

				// ensure no actual rates are stale.
				await exchangeRates.updateRates(
					[PERI, USDC],
					['0.2', '0.98'].map(toUnit),
					await currentTime(),
					{ from: oracle }
				);

				const info = await debtCache.cacheInfo();
				assert.isFalse(info.isInvalid);
				assert.isTrue(info.isStale);
				assert.isTrue(await debtCache.cacheStale());
				assert.isTrue((await issuer.collateralisationRatioAndAnyRatesInvalid(account1))[1]);

				await systemSettings.setDebtSnapshotStaleTime(snapshotStaleTime + 10000, {
					from: owner,
				});

				assert.isFalse(await debtCache.cacheStale());
				assert.isFalse((await debtCache.cacheInfo()).isStale);
				assert.isFalse((await issuer.collateralisationRatioAndAnyRatesInvalid(account1))[1]);
			});

			it('Rates are reported as invalid when the debt snapshot is uninitisalised', async () => {
				const debtCacheName = toBytes32('DebtCache');

				// Set the stale time to a huge value so that the snapshot will not be stale.
				await systemSettings.setDebtSnapshotStaleTime(toUnit('100'), {
					from: owner,
				});

				const newDebtCache = await setupContract({
					contract: 'DebtCache',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});

				await addressResolver.importAddresses([debtCacheName], [newDebtCache.address], {
					from: owner,
				});
				await newDebtCache.rebuildCache();

				assert.bnEqual(await newDebtCache.cachedDebt(), toUnit('0'));
				assert.bnEqual(await newDebtCache.cachedPynthDebt(pUSD), toUnit('0'));
				assert.bnEqual(await newDebtCache.cacheTimestamp(), toUnit('0'));
				assert.isTrue(await newDebtCache.cacheInvalid());

				const info = await newDebtCache.cacheInfo();
				assert.bnEqual(info.debt, toUnit('0'));
				assert.bnEqual(info.timestamp, toUnit('0'));
				assert.isTrue(info.isInvalid);
				assert.isTrue(info.isStale);
				assert.isTrue(await newDebtCache.cacheStale());

				await issuer.rebuildCache();
				assert.isTrue((await issuer.collateralisationRatioAndAnyRatesInvalid(account1))[1]);
			});

			it('When the debt snapshot is invalid, cannot issue, burn, exchange, claim, or transfer when holding debt.', async () => {
				// Ensure the account has some pynths to attempt to burn later.
				await periFinance.transfer(account1, toUnit('1000'), { from: owner });
				await periFinance.transfer(account2, toUnit('1000'), { from: owner });
				await periFinance.issuePynths(PERI, toUnit('10'), {
					from: account1,
				});

				// Stale the debt snapshot
				const snapshotStaleTime = await systemSettings.debtSnapshotStaleTime();
				await fastForward(snapshotStaleTime + 10);
				// ensure no actual rates are stale.
				await exchangeRates.updateRates(
					[PERI, USDC],
					['0.5', '0.5'].map(toUnit),
					await currentTime(),
					{ from: oracle }
				);

				await assert.revert(
					periFinance.issuePynths(PERI, toUnit('10'), { from: account1 }),
					'A pynth or PERI rate is invalid'
				);

				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('1'), { from: account1 }),
					'A pynth or PERI rate is invalid'
				);

				await assert.revert(feePool.claimFees(), 'A pynth or PERI rate is invalid');

				// Can't transfer PERI if issued debt
				await assert.revert(
					periFinance.transfer(owner, toUnit('1'), { from: account1 }),
					'A pynth or PERI rate is invalid'
				);

				// But can transfer if not
				await periFinance.transfer(owner, toUnit('1'), { from: account2 });
			});

			it('will not operate if the system is paused except by the owner', async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				await assert.revert(
					debtCache.takeDebtSnapshot({ from: account1 }),
					'PeriFinance is suspended'
				);
				await debtCache.takeDebtSnapshot({ from: owner });
			});
		});

		describe('updateCachedPynthDebts()', () => {
			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('allows resynchronisation of subsets of pynths', async () => {
				await debtCache.takeDebtSnapshot();

				await exchangeRates.updateRates([pUSD, pETH], ['2', '5'].map(toUnit), await currentTime(), {
					from: oracle,
				});

				// First try a single currency, ensuring that the others have not been altered.
				const expectedDebts = (await debtCache.currentPynthDebts([pUSD]))[0];

				await debtCache.updateCachedPynthDebts([pUSD]);
				assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(100));
				let debts = await debtCache.cachedPynthDebts([pUSD]);

				assert.bnEqual(debts[0], expectedDebts[0]);

				// Then a subset
				await debtCache.updateCachedPynthDebts([pUSD]);
				assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(100));
				debts = await debtCache.cachedPynthDebts([pUSD]);
				assert.bnEqual(debts[0], expectedDebts[1]);
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('can invalidate the debt cache for individual currencies with invalid rates', async () => {
				// Wait until the exchange rates are stale in order to invalidate the cache.
				const rateStalePeriod = await systemSettings.rateStalePeriod();
				await fastForward(rateStalePeriod + 10);

				assert.isFalse((await debtCache.cacheInfo()).isInvalid);

				// individual stale rates invalidate the cache
				const tx1 = await debtCache.updateCachedPynthDebts([pUSD]);
				assert.isTrue((await debtCache.cacheInfo()).isInvalid);

				// But even if we update all rates, we can't revalidate the cache using the partial update function
				await exchangeRates.updateRates([pBTC, pETH], ['2', '5'].map(toUnit), await currentTime(), {
					from: oracle,
				});
				const tx2 = await debtCache.updateCachedPynthDebts([pUSD]);
				assert.isTrue((await debtCache.cacheInfo()).isInvalid);
				assert.eventEqual(tx1.logs[1], 'DebtCacheValidityChanged', [true]);
				assert.isTrue(tx2.logs.find(log => log.event === 'DebtCacheValidityChanged') === undefined);
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('properly emits events', async () => {
				await debtCache.takeDebtSnapshot();

				await exchangeRates.updateRates([pBTC, pETH], ['2', '5'].map(toUnit), await currentTime(), {
					from: oracle,
				});

				const tx = await debtCache.updateCachedPynthDebts([pUSD]);
				assert.eventEqual(tx.logs[0], 'DebtCacheUpdated', [toUnit(600)]);
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('reverts when attempting to synchronise non-existent pynths or PERI', async () => {
				await assert.revert(debtCache.updateCachedPynthDebts([PERI]));
				const fakePynth = toBytes32('FAKE');
				await assert.revert(debtCache.updateCachedPynthDebts([fakePynth]));
				await assert.revert(debtCache.updateCachedPynthDebts([pUSD, fakePynth]));
			});

			it('will not operate if the system is paused except for the owner', async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				await assert.revert(
					debtCache.updateCachedPynthDebts([PERI, USDC], { from: account1 }),
					'PeriFinance is suspended'
				);
				await debtCache.updateCachedPynthDebts([PERI, USDC], { from: owner });
			});
		});

		describe('Issuance, burning, exchange, settlement', () => {
			it('issuing pUSD updates the debt total', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const pynthsToIssue = toUnit('10');
				await periFinance.transfer(account1, toUnit('1000'), { from: owner });
				const tx = await periFinance.issuePynths(PERI, pynthsToIssue, {
					from: account1,
				});
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.add(pynthsToIssue));

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [issued.add(pynthsToIssue)],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});

			it('burning pUSD updates the debt total', async () => {
				await debtCache.takeDebtSnapshot();
				const pynthsToIssue = toUnit('10');
				await periFinance.transfer(account1, toUnit('1000'), { from: owner });
				await periFinance.issuePynths(PERI, pynthsToIssue, { from: account1 });
				const issued = (await debtCache.cacheInfo())[0];

				const pynthsToBurn = toUnit('5');

				const tx = await periFinance.burnPynths(PERI, pynthsToBurn, { from: account1 });
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.sub(pynthsToBurn));

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [issued.sub(pynthsToBurn)],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});

			// exchange doesnt work at this time
			it.skip('exchanging between pynths updates the debt totals for those pynths', async () => {
				// Zero exchange fees so that we can neglect them.
				await systemSettings.setExchangeFeeRateForPynths([pUSD], [toUnit(0), toUnit(0)], {
					from: owner,
				});

				await debtCache.takeDebtSnapshot();
				await periFinance.transfer(account1, toUnit('1000'), { from: owner });
				await periFinance.issuePynthsAndStakeUSDC(toUnit('10'), toUnit('0'), { from: account1 });
				const issued = (await debtCache.cacheInfo())[0];
				const debts = await debtCache.cachedPynthDebts([pUSD]);
				const tx = await periFinance.exchange(pUSD, toUnit('5'), pBTC, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pUSD, pBTC]);
				assert.bnEqual((await debtCache.cacheInfo())[0], issued);
				assert.bnEqual(postDebts[0], debts[0].sub(toUnit(5)));
				assert.bnEqual(postDebts[1], debts[1].add(toUnit(5)));

				// As the total debt did not change, no DebtCacheUpdated event was emitted.
				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheUpdated'));
			});

			// exchange doesnt work at this time
			it.skip('exchanging between pynths updates pUSD debt total due to fees', async () => {
				await systemSettings.setExchangeFeeRateForPynths(
					[pBTC, pUSD, pETH],
					[toUnit(0.1), toUnit(0.1), toUnit(0.1)],
					{ from: owner }
				);

				await pETHContract.issue(account1, toUnit(20));
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const debts = await debtCache.cachedPynthDebts([pUSD, pBTC, pETH]);

				await periFinance.exchange(pETH, toUnit(10), pBTC, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pUSD, pBTC, pETH]);

				assert.bnEqual((await debtCache.cacheInfo())[0], issued);
				assert.bnEqual(postDebts[0], debts[0].add(toUnit(2)));
				assert.bnEqual(postDebts[1], debts[1].add(toUnit(18)));
				assert.bnEqual(postDebts[2], debts[2].sub(toUnit(20)));
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('exchanging between pynths updates debt properly when prices have changed', async () => {
				await systemSettings.setExchangeFeeRateForPynths([pBTC, pETH], [toUnit(0), toUnit(0)], {
					from: owner,
				});

				await pBTCContract.issue(account1, toUnit(20));
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const debts = await debtCache.cachedPynthDebts([pBTC, pETH]);

				await exchangeRates.updateRates([pBTC, pETH], ['1', '1'].map(toUnit), await currentTime(), {
					from: oracle,
				});

				await periFinance.exchange(pBTC, toUnit(10), pETH, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pBTC, pETH]);

				// 120 eur @ $2 = $240 and 100 aud @ $0.50 = $50 becomes:
				// 110 eur @ $1 = $110 (-$130) and 110 aud @ $1 = $110 (+$60)
				// Total debt is reduced by $130 - $60 = $70
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.sub(toUnit(70)));
				assert.bnEqual(postDebts[0], debts[0].add(toUnit(60)));
				assert.bnEqual(postDebts[1], debts[1].sub(toUnit(130)));
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('settlement updates debt totals', async () => {
				await systemSettings.setExchangeFeeRateForPynths([pBTC, pETH], [toUnit(0), toUnit(0)], {
					from: owner,
				});
				await pBTCContract.issue(account1, toUnit(100));
				await debtCache.takeDebtSnapshot();

				await periFinance.exchange(pBTC, toUnit(50), pETH, { from: account1 });

				await exchangeRates.updateRates([pBTC, pETH], ['2', '1'].map(toUnit), await currentTime(), {
					from: oracle,
				});

				const tx = await exchanger.settle(account1, pBTC);
				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				// AU$150 worth $75 became worth $300
				// But the EUR debt does not change due to settlement,
				// and remains at $200 + $25 from the exchange

				const results = await debtCache.cachedPynthDebts([pBTC, pETH]);
				assert.bnEqual(results[0], toUnit(300));
				assert.bnEqual(results[1], toUnit(225));

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [toUnit(825)],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
		});

		describe('Pynth removal and addition', () => {
			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('Removing pynths zeroes out the debt snapshot for that currency', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];
				const pETHValue = (await debtCache.cachedPynthDebts([pETH]))[0];
				await pETHContract.setTotalSupply(toUnit(0));
				const tx = await issuer.removePynth(pETH, { from: owner });
				const result = (await debtCache.cachedPynthDebts([pETH]))[0];
				const newIssued = (await debtCache.cacheInfo())[0];
				assert.bnEqual(newIssued, issued.sub(pETHValue));
				assert.bnEqual(result, toUnit(0));

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [newIssued],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('Pynth snapshots cannot be purged while the pynth exists', async () => {
				await assert.revert(debtCache.purgeCachedPynthDebt(pBTC, { from: owner }), 'Pynth exists');
			});

			it('Pynth snapshots can be purged without updating the snapshot', async () => {
				const debtCacheName = toBytes32('DebtCache');
				const newDebtCache = await setupContract({
					contract: 'TestableDebtCache',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});
				await addressResolver.importAddresses([debtCacheName], [newDebtCache.address], {
					from: owner,
				});
				await newDebtCache.rebuildCache();
				await newDebtCache.takeDebtSnapshot();
				const issued = (await newDebtCache.cacheInfo())[0];

				const fakeTokenKey = toBytes32('FAKE');

				// Set a cached snapshot value
				await newDebtCache.setCachedPynthDebt(fakeTokenKey, toUnit('1'));

				// Purging deletes the value
				assert.bnEqual(await newDebtCache.cachedPynthDebt(fakeTokenKey), toUnit(1));
				await newDebtCache.purgeCachedPynthDebt(fakeTokenKey, { from: owner });
				assert.bnEqual(await newDebtCache.cachedPynthDebt(fakeTokenKey), toUnit(0));

				// Without affecting the snapshot.
				assert.bnEqual((await newDebtCache.cacheInfo())[0], issued);
			});

			// TODO : currently we only have pUSD, we need to test again after adding more pynths in the future
			it.skip('Removing a pynth invalidates the debt cache', async () => {
				await pETHContract.setTotalSupply(toUnit('0'));
				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.removePynth(pETH, { from: owner });
				assert.isTrue((await debtCache.cacheInfo())[2]);

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheValidityChanged',
					emittedFrom: debtCache.address,
					args: [true],
					log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
				});
			});

			it('Adding a pynth invalidates the debt cache', async () => {
				const { token: pynth } = await mockToken({
					accounts,
					pynth: 'sXYZ',
					skipInitialAllocation: true,
					supply: 0,
					name: 'XYZ',
					symbol: 'XYZ',
				});

				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.addPynth(pynth.address, { from: owner });
				assert.isTrue((await debtCache.cacheInfo())[2]);

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheValidityChanged',
					emittedFrom: debtCache.address,
					args: [true],
					log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
				});
			});

			it('Adding multiple pynths invalidates the debt cache', async () => {
				const { token: pynth1 } = await mockToken({
					accounts,
					pynth: 'pXYZ',
					skipInitialAllocation: true,
					supply: 0,
					name: 'XYZ',
					symbol: 'XYZ',
				});
				const { token: pynth2 } = await mockToken({
					accounts,
					pynth: 'pABC',
					skipInitialAllocation: true,
					supply: 0,
					name: 'ABC',
					symbol: 'ABC',
				});

				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.addPynths([pynth1.address, pynth2.address], { from: owner });
				assert.isTrue((await debtCache.cacheInfo())[2]);

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheValidityChanged',
					emittedFrom: debtCache.address,
					args: [true],
					log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
				});
			});

			// we dont have other pynths except for pUSD at this time,
			it.skip('Removing multiple pynths invalidates the debt cache', async () => {
				await pBTCContract.setTotalSupply(toUnit('0'));
				await pETHContract.setTotalSupply(toUnit('0'));

				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.removePynths([pETH, pBTC], { from: owner });
				assert.isTrue((await debtCache.cacheInfo())[2]);

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheValidityChanged',
					emittedFrom: debtCache.address,
					args: [true],
					log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
				});
			});

			// we dont have other pynths except for pUSD at this time,
			it.skip('Removing multiple pynths zeroes the debt cache for those currencies', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];
				const pETHValue = (await debtCache.cachedPynthDebts([pETH]))[0];
				const pBTCValue = (await debtCache.cachedPynthDebts([pBTC]))[0];
				await pETHContract.setTotalSupply(toUnit(0));
				await pBTCContract.setTotalSupply(toUnit(0));
				const tx = await issuer.removePynths([pETH, pBTC], { from: owner });
				const result = await debtCache.cachedPynthDebts([pETH, pBTC]);
				const newIssued = (await debtCache.cacheInfo())[0];
				assert.bnEqual(newIssued, issued.sub(pETHValue.add(pBTCValue)));
				assert.bnEqual(result[0], toUnit(0));
				assert.bnEqual(result[1], toUnit(0));

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [newIssued],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
		});

		describe('updateDebtCacheValidity()', () => {
			beforeEach(async () => {
				// Ensure the cache is valid.
				await debtCache.takeDebtSnapshot();

				// Change the calling address in the addressResolver so that the calls don't fail.
				const issuerName = toBytes32('Issuer');
				await addressResolver.importAddresses([issuerName], [account1], {
					from: owner,
				});
				await debtCache.rebuildCache();
			});

			describe('when the debt cache is valid', () => {
				it('invalidates the cache', async () => {
					assert.isFalse((await debtCache.cacheInfo()).isInvalid);
					const tx = await debtCache.updateDebtCacheValidity(true, { from: account1 });
					assert.isTrue((await debtCache.cacheInfo()).isInvalid);

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					decodedEventEqual({
						event: 'DebtCacheValidityChanged',
						emittedFrom: debtCache.address,
						args: [true],
						log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
					});
				});

				it('does nothing if attempting to re-validate the cache', async () => {
					assert.isFalse((await debtCache.cacheInfo()).isInvalid);
					const tx = await debtCache.updateDebtCacheValidity(false, { from: account1 });
					assert.isFalse((await debtCache.cacheInfo()).isInvalid);

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'));
				});
			});

			describe('when the debt cache is invalid', () => {
				beforeEach(async () => {
					// Invalidate the cache first.
					await debtCache.updateDebtCacheValidity(true, { from: account1 });
				});

				it('re-validates the cache', async () => {
					assert.isTrue((await debtCache.cacheInfo()).isInvalid);
					const tx = await debtCache.updateDebtCacheValidity(false, { from: account1 });
					assert.isFalse((await debtCache.cacheInfo()).isInvalid);

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					decodedEventEqual({
						event: 'DebtCacheValidityChanged',
						emittedFrom: debtCache.address,
						args: [false],
						log: logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'),
					});
				});

				it('does nothing if attempting to invalidate the cache', async () => {
					assert.isTrue((await debtCache.cacheInfo()).isInvalid);
					const tx = await debtCache.updateDebtCacheValidity(true, { from: account1 });
					assert.isTrue((await debtCache.cacheInfo()).isInvalid);

					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					assert.isUndefined(logs.find(({ name } = {}) => name === 'DebtCacheValidityChanged'));
				});
			});
		});
	});
});
