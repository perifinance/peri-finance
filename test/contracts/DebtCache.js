'use strict';

const { contract, artifacts } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts, setupContract, mockToken } = require('./setup');

const { currentTime, toUnit, fastForward, multiplyDecimalRound } = require('../utils')();

const {
	setExchangeFeeRateForPynths,
	getDecodedLogs,
	decodedEventEqual,
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setStatus,
	setupPriceAggregators,
	updateAggregatorRates,
} = require('./helpers');

const {
	toBytes32,
	defaults: { DEBT_SNAPSHOT_STALE_TIME },
	constants: { ZERO_ADDRESS },
} = require('../..');

contract('DebtCache', async accounts => {
	const [pUSD, pAUD, pEUR, USDC, PERI, pETH, ETH] = [
		'pUSD',
		'pAUD',
		'pEUR',
		'USDC',
		'PERI',
		'pETH',
		'ETH',
	].map(toBytes32);
	const pynthKeys = [pUSD, pEUR, USDC, pETH];

	const [deployerAccount, owner, , account1] = accounts;

	const oneETH = toUnit('1.0');
	const twoETH = toUnit('2.0');

	let periFinance,
		periFinanceProxy,
		systemStatus,
		systemSettings,
		exchangeRates,
		circuitBreaker,
		feePool,
		pUSDContract,
		pEURContract,
		pAUDContract,
		pETHContract,
		debtCache,
		issuer,
		pynths,
		addressResolver,
		exchanger,
		dynamicPynthRedeemer,
		// Futures market
		futuresMarketManager,
		wrapperFactory,
		weth,
		// MultiCollateral tests.
		ceth,
		// Short tests.
		short,
		// aggregators
		aggregatorDebtRatio,
		aggregatorIssuedPynths;

	const deployCollateral = async ({state,  owner, manager, resolver, collatKey, minColat, minSize }) => {
		return setupContract({
			accounts,
			contract: 'CollateralEth',
			args: [state, owner, manager, resolver, collatKey, minColat, minSize],
		});
	};

	const setupMultiCollateral = async () => {
		const CollateralState = artifacts.require('CollateralState');
		const CollateralManager = artifacts.require(`CollateralManager`);
		const CollateralManagerState = artifacts.require('CollateralManagerState');

		pynths = ['pUSD', 'pETH', 'pAUD', 'pEUR'];

		// Deploy CollateralManagerState.
		const managerState = await CollateralManagerState.new(owner, ZERO_ADDRESS, {
			from: deployerAccount,
		});

		const state = await CollateralState.new(owner, ZERO_ADDRESS, { from: deployerAccount });

		const maxDebt = toUnit(10000000);

		// Deploy CollateralManager.
		const manager = await CollateralManager.new(
			managerState.address,
			owner,
			addressResolver.address,
			maxDebt,
			0,
			0,
			0,
			{
				from: deployerAccount,
			}
		);

		await managerState.setAssociatedContract(manager.address, { from: owner });

		// Deploy ETH Collateral.
		ceth = await deployCollateral({
			state: state.address,
			owner: owner,
			manager: manager.address,
			resolver: addressResolver.address,
			collatKey: pETH,
			minColat: toUnit('1.3'),
			minSize: toUnit('2'),
		});
		await state.setAssociatedContract(ceth.address, { from : owner});

		await addressResolver.importAddresses(
			[toBytes32('CollateralEth'), toBytes32('CollateralManager')],
			[ceth.address, manager.address],
			{
				from: owner,
			}
		);

		await ceth.rebuildCache();
		await manager.rebuildCache();
		await debtCache.rebuildCache();
		await feePool.rebuildCache();
		await issuer.rebuildCache();
		await wrapperFactory.rebuildCache();

		await manager.addCollaterals([ceth.address], { from: owner });

		await ceth.addPynths(
			['PynthpUSD', 'PynthpETH', 'PynthpEUR', 'PynthpAUD'].map(toBytes32),
			['pUSD', 'pETH', 'pEUR', 'pAUD'].map(toBytes32),
			{ from: owner }
		);

		await manager.addPynths(
			['PynthpUSD', 'PynthpETH', 'PynthpEUR', 'PynthpAUD'].map(toBytes32),
			['pUSD', 'pETH', 'pEUR', 'pAUD'].map(toBytes32),
			{ from: owner }
		);
		// rebuild the cache to add the pynths we need.
		await manager.rebuildCache();

		// Set fees to 0.
		await ceth.setIssueFeeRate(toUnit('0'), { from: owner });
		await systemSettings.setExchangeFeeRateForPynths(
			pynths.map(toBytes32),
			pynths.map(s => toUnit('0')),
			{ from: owner }
		);
	};

	const deployShort = async ({ state, owner, manager, resolver, collatKey, minColat, minSize }) => {
		return setupContract({
			accounts,
			contract: 'CollateralShort',
			args: [state, owner, manager, resolver, collatKey, minColat, minSize],
		});
	};

	const setupShort = async () => {
		const CollateralState = artifacts.require('CollateralState');
		const CollateralManager = artifacts.require(`CollateralManager`);
		const CollateralManagerState = artifacts.require('CollateralManagerState');

		const managerState = await CollateralManagerState.new(owner, ZERO_ADDRESS, {
			from: deployerAccount,
		});

		const state = await CollateralState.new(owner, ZERO_ADDRESS, { from: deployerAccount });

		const maxDebt = toUnit(10000000);

		const manager = await CollateralManager.new(
			managerState.address,
			owner,
			addressResolver.address,
			maxDebt,
			0,
			// 5% / 31536000 (seconds in common year)
			1585489599,
			0,
			{
				from: deployerAccount,
			}
		);

		await managerState.setAssociatedContract(manager.address, { from: owner });

		short = await deployShort({
			state: state.address,
			owner: owner,
			manager: manager.address,
			resolver: addressResolver.address,
			collatKey: pUSD,
			minColat: toUnit(1.2),
			minSize: toUnit(0.1),
		});

		await state.setAssociatedContract(short.address, { from: owner });

		await addressResolver.importAddresses(
			[toBytes32('CollateralShort'), toBytes32('CollateralManager')],
			[short.address, manager.address],
			{
				from: owner,
			}
		);

		await feePool.rebuildCache();
		await manager.rebuildCache();
		await issuer.rebuildCache();
		await debtCache.rebuildCache();

		await manager.addCollaterals([short.address], { from: owner });

		await short.addPynths(['PynthpETH'].map(toBytes32), ['pETH'].map(toBytes32), { from: owner });

		await manager.addShortablePynths(['PynthpETH'].map(toBytes32), [pETH], {
			from: owner,
		});

		await pUSDContract.approve(short.address, toUnit(100000), { from: account1 });
	};

	const setupDebtIssuer = async () => {
		const etherWrapperCreateTx = await wrapperFactory.createWrapper(
			weth.address,
			pETH,
			toBytes32('PynthpETH'),
			{ from: owner }
		);

		// extract address from events
		const etherWrapperAddress = etherWrapperCreateTx.logs.find(l => l.event === 'WrapperCreated')
			.args.wrapperAddress;

		await systemSettings.setWrapperMaxTokenAmount(etherWrapperAddress, toUnit('1000000'), {
			from: owner,
		});

		return artifacts.require('Wrapper').at(etherWrapperAddress);
	};

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		pynths = ['pUSD', 'pAUD', 'pEUR', 'pETH'];
		({
			PeriFinance: periFinance,
			ProxyERC20PeriFinance: periFinanceProxy,
			SystemStatus: systemStatus,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			CircuitBreaker: circuitBreaker,
			PynthpUSD: pUSDContract,
			PynthpEUR: pEURContract,
			PynthpETH: pETHContract,
			PynthpAUD: pAUDContract,

			FeePool: feePool,
			DebtCache: debtCache,
			DynamicPynthRedeemer: dynamicPynthRedeemer,
			Issuer: issuer,
			AddressResolver: addressResolver,
			Exchanger: exchanger,
			FuturesMarketManager: futuresMarketManager,
			WrapperFactory: wrapperFactory,
			WETH: weth,
			'ext:AggregatorDebtRatio': aggregatorDebtRatio,
			'ext:AggregatorIssuedPynths': aggregatorIssuedPynths,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'ExchangeRates',
				'CircuitBreaker',
				'FeePool',
				'FeePoolEternalStorage',
				'AddressResolver',
				'RewardEscrow',
				'PeriFinanceEscrow',
				'SystemSettings',
				'Issuer',
				// 'LiquidatorRewards',
				'DebtCache',
				'DynamicPynthRedeemer', // necessary for checking discountRate changes
				'Exchanger', // necessary for burnPynths to check settlement of pUSD
				'DelegateApprovals', // necessary for *OnBehalf functions
				'FlexibleStorage',
				'CollateralManager',
				'RewardEscrowV2', // necessary for issuer._collateral()
				'CollateralUtil',
				'FuturesMarketManager',
				'WrapperFactory',
				'CrossChainManager',
				'WETH',
			],
		}));

		// use implementation ABI on the proxy address to simplify calling
		//periFinance = await artifacts.require('PeriFinance').at(periFinance.address);

		//await setupPriceAggregators(exchangeRates, owner, [pAUD, pEUR, PERI, pETH, ETH]);
		await setupPriceAggregators(exchangeRates, owner, [pAUD, pEUR, pETH]);
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		await updateAggregatorRates(
			exchangeRates,
			circuitBreaker,
			[pAUD, pEUR, pETH, PERI],
			['0.5', '1.25', '200', '10'].map(toUnit)
		);
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
				'recordExcludedDebtChange',
				'purgeCachedPynthDebt',
				'updateCachedPynthDebts',
				'updateCachedPynthDebtWithRate',
				'updateCachedPynthDebtsWithRates',
				'updateDebtCacheValidity',
				'updateCachedpUSDDebt',
				'importExcludedIssuedDebts',
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
				args: [pAUD, toUnit('1')],
				accounts,
				reason: 'Sender is not Issuer',
			});
		});

		it('updateCachedPynthDebtsWithRates() can only be invoked by the issuer or exchanger', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.updateCachedPynthDebtsWithRates,
				args: [
					[pAUD, pEUR],
					[toUnit('1'), toUnit('2')],
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
				args: [pAUD],
				address: owner,
				skipPassCheck: true,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('importExcludedIssuedDebts() can only be invoked by the owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.importExcludedIssuedDebts,
				accounts,
				args: [ZERO_ADDRESS, ZERO_ADDRESS],
				address: owner,
				skipPassCheck: true,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('recordExcludedDebtChange() can only be invoked by the owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.recordExcludedDebtChange,
				accounts,
				args: [pAUD, toUnit('1')],
				address: owner,
				skipPassCheck: true,
				reason: 'Only debt issuers may call this',
			});
		});

		it('updateCachedpUSDDebt() can only be invoked by the issuer', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: debtCache.updateCachedpUSDDebt,
				args: [toUnit('1')],
				accounts,
				reason: 'Sender is not Issuer',
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
			await updateAggregatorRates(
				exchangeRates,
				circuitBreaker,
				[pAUD, pEUR, pETH],
				['0.5', '2', '100'].map(toUnit)
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

			describe('when discountRate is updated', () => {
				const discountRate = toUnit('0.5');

				beforeEach(async () => {
					await dynamicPynthRedeemer.setDiscountRate(discountRate, { from: owner });
				});

				it('Live debt is reported accurately', async () => {
					// The pynth debt has not yet been cached.
					assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(0));

					// Current pynth debts:
					// 100 pUSD + ((2 pETH * $100) + (100 pAUD * $0.50) + (100 pEUR * $2) * discountRate)
					// $100 + (($200 + $50 + $200) * discountRate)
					// $100 + ($450 * discountRate) = $325 total issued pynths
					const result = await debtCache.currentDebt();
					assert.bnEqual(result[0], toUnit(325));
					assert.isFalse(result[1]);
				});

				it('Live debt is reported accurately for individual currencies', async () => {
					const result = await debtCache.currentPynthDebts([pUSD, pEUR, pAUD, pETH]);
					const debts = result[0];

					assert.bnEqual(debts[0], toUnit(100)); // pUSD is not affected by discountRate
					assert.bnEqual(debts[1], multiplyDecimalRound(toUnit(200), discountRate));
					assert.bnEqual(debts[2], multiplyDecimalRound(toUnit(50), discountRate));
					assert.bnEqual(debts[3], multiplyDecimalRound(toUnit(200), discountRate));

					assert.isFalse(result[1]);
				});
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

			it('accurately resynchronises the debt after prices have changed', async () => {
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(550));
				let result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(550));
				assert.isFalse(result[1]);

				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR],
					['1', '3'].map(toUnit)
				);
				await debtCache.takeDebtSnapshot();
				assert.bnEqual((await debtCache.cacheInfo()).debt, toUnit(700));
				result = await debtCache.currentDebt();
				assert.bnEqual(result[0], toUnit(700));
				assert.isFalse(result[1]);
			});

			it('updates the debt snapshot timestamp', async () => {
				const timestamp = (await debtCache.cacheInfo()).timestamp;
				assert.bnNotEqual(timestamp, preTimestamp);
				assert.isTrue(time - timestamp < 15);
			});

			it('properly emits debt cache updated and synchronised events', async () => {
				assert.eventEqual(tx.logs[0], 'DebtCacheUpdated', [toUnit(550)]);
				assert.eventEqual(tx.logs[1], 'DebtCacheSnapshotTaken', [
					(await debtCache.cacheInfo()).timestamp,
				]);
			});

			it('updates the cached values for all individual pynths', async () => {
				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR, pETH],
					['1', '3', '200'].map(toUnit)
				);
				await debtCache.takeDebtSnapshot();
				let debts = await debtCache.currentPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0][0], toUnit(100));
				assert.bnEqual(debts[0][1], toUnit(300));
				assert.bnEqual(debts[0][2], toUnit(100));
				assert.bnEqual(debts[0][3], toUnit(400));

				debts = await debtCache.cachedPynthDebts([pUSD, pEUR, pAUD, pETH]);
				assert.bnEqual(debts[0], toUnit(100));
				assert.bnEqual(debts[1], toUnit(300));
				assert.bnEqual(debts[2], toUnit(100));
				assert.bnEqual(debts[3], toUnit(400));
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
				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR, pETH],
					['0.5', '2', '200'].map(toUnit)
				);
				const tx2 = await debtCache.takeDebtSnapshot();
				assert.isFalse((await debtCache.cacheInfo()).isInvalid);

				assert.eventEqual(tx1.logs[2], 'DebtCacheValidityChanged', [true]);
				assert.eventEqual(tx2.logs[2], 'DebtCacheValidityChanged', [false]);
			});

			it('will not operate if the system is paused except by the owner', async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				await assert.revert(
					debtCache.takeDebtSnapshot({ from: account1 }),
					'PeriFinance is suspended'
				);
				await debtCache.takeDebtSnapshot({ from: owner });
			});

			describe('properly incorporates futures market debt', () => {
				it('when no market exist', async () => {
					await debtCache.takeDebtSnapshot();
					const initialDebt = (await debtCache.cacheInfo()).debt;

					// issue some debt to sanity check it's being updated
					pUSDContract.issue(account1, toUnit(100), { from: owner });
					await debtCache.takeDebtSnapshot();
					await debtCache.updateCachedPynthDebts([pUSD]);

					// debt calc works
					assert.bnEqual((await debtCache.currentDebt())[0], initialDebt.add(toUnit(100)));
					assert.bnEqual((await debtCache.cacheInfo()).debt, initialDebt.add(toUnit(100)));

					// no debt from futures
					assert.bnEqual((await debtCache.currentPynthDebts([])).futuresDebt, toUnit(0));
				});

				it('when a market exists', async () => {
					const market = await setupContract({
						accounts,
						contract: 'MockFuturesMarket',
						args: [
							futuresMarketManager.address,
							toBytes32('sLINK'),
							toBytes32('sLINK'),
							toUnit('1000'),
							false,
						],
						skipPostDeploy: true,
					});
					await futuresMarketManager.addMarkets([market.address], { from: owner });

					await debtCache.takeDebtSnapshot();
					const initialDebt = (await debtCache.cacheInfo()).debt;
					await market.setMarketDebt(toUnit('2000'));
					await debtCache.takeDebtSnapshot();

					assert.bnEqual((await debtCache.cacheInfo()).debt, initialDebt.add(toUnit('1000')));
					assert.bnEqual((await debtCache.currentPynthDebts([])).futuresDebt, toUnit('2000'));
				});
			});

			describe('when debts are excluded', async () => {
				let beforeExcludedDebts;

				beforeEach(async () => {
					beforeExcludedDebts = await debtCache.currentDebt();

					// cause debt CollateralManager
					await setupMultiCollateral();
					await ceth.open(oneETH, pETH, {
						value: toUnit('10'),
						from: account1,
					});

					// cause debt from WrapperFactory
					const etherWrapper = await setupDebtIssuer();
					const wrapperAmount = toUnit('1');

					await weth.deposit({ from: account1, value: wrapperAmount });
					await weth.approve(etherWrapper.address, wrapperAmount, { from: account1 });
					await etherWrapper.mint(wrapperAmount, { from: account1 });

					// test function
					await debtCache.takeDebtSnapshot({ from: owner });
				});

				it('current debt is correct', async () => {
					// debt shouldn't have changed since PERI holders have not issued any more debt
					assert.bnEqual(await debtCache.currentDebt(), beforeExcludedDebts);
				});
			});
		});

		describe('cache functions', () => {
			let originalTimestamp;

			it('values are correct', async () => {
				originalTimestamp = await debtCache.cacheTimestamp();
				assert.bnNotEqual(originalTimestamp, 0);
				assert.equal(await debtCache.cacheInvalid(), false);
				assert.equal(await debtCache.cacheStale(), false);
			});

			describe('after going forward in time', () => {
				beforeEach(async () => {
					await fastForward(1000000);
				});

				it('is now stale', async () => {
					assert.equal(await debtCache.cacheInvalid(), false);
					assert.equal(await debtCache.cacheStale(), true);
				});

				describe('debt snapshot is taken', () => {
					beforeEach(async () => {
						await debtCache.takeDebtSnapshot();
					});

					it('is now invalid (upstream rates are ood)', async () => {
						assert.bnNotEqual(await debtCache.cacheTimestamp(), originalTimestamp);
						assert.equal(await debtCache.cacheInvalid(), true);
						assert.equal(await debtCache.cacheStale(), false);
					});
				});
			});
		});

		describe('updateCachedPynthDebts()', () => {
			it('allows resynchronisation of subsets of pynths', async () => {
				await debtCache.takeDebtSnapshot();

				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR, pETH],
					['1', '3', '200'].map(toUnit)
				);

				// First try a single currency, ensuring that the others have not been altered.
				const expectedDebts = (await debtCache.currentPynthDebts([pAUD, pEUR, pETH]))[0];

				await debtCache.updateCachedPynthDebts([pAUD]);
				assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(600));
				let debts = await debtCache.cachedPynthDebts([pAUD, pEUR, pETH]);

				assert.bnEqual(debts[0], expectedDebts[0]);
				assert.bnEqual(debts[1], toUnit(200));
				assert.bnEqual(debts[2], toUnit(200));

				// Then a subset
				await debtCache.updateCachedPynthDebts([pEUR, pETH]);
				assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(900));
				debts = await debtCache.cachedPynthDebts([pEUR, pETH]);
				assert.bnEqual(debts[0], expectedDebts[1]);
				assert.bnEqual(debts[1], expectedDebts[2]);
			});

			it('can invalidate the debt cache for individual currencies with invalid rates', async () => {
				// Wait until the exchange rates are stale in order to invalidate the cache.
				const rateStalePeriod = await systemSettings.rateStalePeriod();
				await fastForward(rateStalePeriod + 1000);

				assert.isFalse((await debtCache.cacheInfo()).isInvalid);

				// individual stale rates invalidate the cache
				const tx1 = await debtCache.updateCachedPynthDebts([pAUD]);
				assert.isTrue((await debtCache.cacheInfo()).isInvalid);

				// But even if we update all rates, we can't revalidate the cache using the partial update function
				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR, pETH],
					['0.5', '2', '100'].map(toUnit)
				);
				const tx2 = await debtCache.updateCachedPynthDebts([pAUD, pEUR, pETH]);
				assert.isTrue((await debtCache.cacheInfo()).isInvalid);
				assert.eventEqual(tx1.logs[1], 'DebtCacheValidityChanged', [true]);
				assert.isTrue(tx2.logs.find(log => log.event === 'DebtCacheValidityChanged') === undefined);
			});

			it('properly emits events', async () => {
				await debtCache.takeDebtSnapshot();

				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR, pETH],
					['1', '3', '200'].map(toUnit)
				);

				const tx = await debtCache.updateCachedPynthDebts([pAUD]);
				assert.eventEqual(tx.logs[0], 'DebtCacheUpdated', [toUnit(600)]);
			});

			it('reverts when attempting to synchronise non-existent pynths or PERI', async () => {
				await assert.revert(debtCache.updateCachedPynthDebts([PERI]));
				const fakePynth = toBytes32('FAKE');
				await assert.revert(debtCache.updateCachedPynthDebts([fakePynth]));
				await assert.revert(debtCache.updateCachedPynthDebts([pUSD, fakePynth]));
			});

			it('will not operate if the system is paused except for the owner', async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				await assert.revert(
					debtCache.updateCachedPynthDebts([pAUD, pEUR], { from: account1 }),
					'PeriFinance is suspended'
				);
				await debtCache.updateCachedPynthDebts([pAUD, pEUR], { from: owner });
			});

			describe('when discountRate is updated', async () => {
				const discountRate = toUnit('0.5');

				beforeEach(async () => {
					await dynamicPynthRedeemer.setDiscountRate(discountRate, { from: owner });
				});

				it('allows resynchronisation of subsets of pynths', async () => {
					await debtCache.takeDebtSnapshot();

					await updateAggregatorRates(
						exchangeRates,
						circuitBreaker,
						[pAUD, pEUR, pETH],
						['1', '3', '200'].map(toUnit)
					);

					const expectedDebts = (await debtCache.currentPynthDebts([pAUD, pEUR, pETH]))[0];

					// First try a single currency, ensuring that the others have not been altered.
					await debtCache.updateCachedPynthDebts([pAUD]);
					// Updated pynth debts:
					// 100 pUSD + ((2 pETH * $100) + (100 pAUD * $1) + (100 pEUR * $2) * discountRate)
					// $100 + (($200 + $100 + $200) * discountRate)
					// $100 + ($500 * discountRate) = $350 total issued pynths
					assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(350));
					let debts = await debtCache.cachedPynthDebts([pAUD, pEUR, pETH]);

					assert.bnEqual(debts[0], expectedDebts[0]);
					assert.bnEqual(debts[1], multiplyDecimalRound(toUnit(200), discountRate));
					assert.bnEqual(debts[2], multiplyDecimalRound(toUnit(200), discountRate));

					// Then a subset
					await debtCache.updateCachedPynthDebts([pEUR, pETH]);
					// Updated pynth debts:
					// 100 pUSD + ((2 pETH * $200) + (100 pAUD * $1) + (100 pEUR * $3) * discountRate)
					// $100 + (($400 + $100 + $300) * discountRate)
					// $100 + ($800 * discountRate) = $500 total issued pynths
					assert.bnEqual(await issuer.totalIssuedPynths(pUSD, true), toUnit(500));
					debts = await debtCache.cachedPynthDebts([pEUR, pETH]);
					assert.bnEqual(debts[0], expectedDebts[1]);
					assert.bnEqual(debts[1], expectedDebts[2]);
				});

				it('properly emits events', async () => {
					await debtCache.takeDebtSnapshot();

					await updateAggregatorRates(
						exchangeRates,
						circuitBreaker,
						[pAUD, pEUR, pETH],
						['1', '3', '200'].map(toUnit)
					);

					const tx = await debtCache.updateCachedPynthDebts([pAUD]);
					assert.eventEqual(tx.logs[0], 'DebtCacheUpdated', [toUnit(350)]);
				});
			});
		});

		describe('recordExcludedDebtChange()', () => {
			it('does not work if delta causes excludedDebt goes negative', async () => {
				await assert.revert(
					debtCache.recordExcludedDebtChange(pETH, toUnit('-1'), { from: owner }),
					'Excluded debt cannot become negative'
				);
			});

			it('executed successfully', async () => {
				await debtCache.recordExcludedDebtChange(pETH, toUnit('1'), { from: owner });
				assert.bnEqual(await debtCache.excludedIssuedDebts([pETH]), toUnit('1'));

				await debtCache.recordExcludedDebtChange(pETH, toUnit('-0.2'), { from: owner });
				assert.bnEqual(await debtCache.excludedIssuedDebts([pETH]), toUnit('0.8'));
			});
		});

		describe('importExcludedIssuedDebts()', () => {
			beforeEach(async () => {
				await debtCache.recordExcludedDebtChange(pETH, toUnit('1'), { from: owner });
				await debtCache.recordExcludedDebtChange(pAUD, toUnit('2'), { from: owner });
			});

			it('reverts for non debt cache address', async () => {
				await assert.revert(
					debtCache.importExcludedIssuedDebts(issuer.address, issuer.address, { from: owner })
				);
			});

			it('reverts for non issuer address', async () => {
				await assert.revert(
					debtCache.importExcludedIssuedDebts(debtCache.address, debtCache.address, { from: owner })
				);
			});

			it('reverts for empty issuer', async () => {
				const newIssuer = await setupContract({
					contract: 'Issuer',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});

				await assert.revert(
					debtCache.importExcludedIssuedDebts(debtCache.address, newIssuer.address, {
						from: owner,
					}),
					'previous Issuer has no pynths'
				);
			});

			it('imports previous entries and can run only once', async () => {
				const newIssuer = await setupContract({
					contract: 'Issuer',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});
				const newDebtCache = await setupContract({
					contract: 'DebtCache',
					accounts,
					skipPostDeploy: true,
					args: [owner, addressResolver.address],
				});

				// update the address resolver and the contract address caches
				await addressResolver.importAddresses(
					[toBytes32('Issuer'), toBytes32('DebtCache')],
					[newIssuer.address, newDebtCache.address],
					{ from: owner }
				);
				await newIssuer.rebuildCache();
				await newDebtCache.rebuildCache();

				// add only one of the pynths
				await newIssuer.addPynth(pETHContract.address, { from: owner });

				// check uninitialised
				assert.equal(await newDebtCache.isInitialized(), false);

				// import entries
				await newDebtCache.importExcludedIssuedDebts(debtCache.address, issuer.address, {
					from: owner,
				});

				// check initialised
				assert.equal(await newDebtCache.isInitialized(), true);

				// check both entries are updated
				// pAUD is not in new Issuer, but should be imported
				assert.bnEqual(await debtCache.excludedIssuedDebts([pETH, pAUD]), [
					toUnit('1'),
					toUnit('2'),
				]);

				// check can't run twice
				await assert.revert(
					newDebtCache.importExcludedIssuedDebts(debtCache.address, issuer.address, {
						from: owner,
					}),
					'already initialized'
				);
			});
		});

		describe('updateCachedpUSDDebt()', () => {
			beforeEach(async () => {
				await addressResolver.importAddresses([toBytes32('Issuer')], [owner], {
					from: owner,
				});
				await debtCache.rebuildCache();
			});
			it('when pUSD is increased by minting', async () => {
				const cachedPynthDebt = (await debtCache.cachedPynthDebts([pUSD]))[0];
				const amount = toUnit('1000');
				const tx = await debtCache.updateCachedpUSDDebt(amount, { from: owner });

				assert.bnEqual((await debtCache.cacheInfo())[0], cachedPynthDebt.add(amount));
				assert.bnEqual(await debtCache.cachedPynthDebts([pUSD]), cachedPynthDebt.add(amount));

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [cachedPynthDebt.add(amount)],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
			it('when pUSD cache is decreased by minting', async () => {
				const amount = toUnit('1000');
				await debtCache.updateCachedpUSDDebt(amount, { from: owner });

				// cached Pynth after increase
				const cachedPynthDebt = (await debtCache.cachedPynthDebts([pUSD]))[0];
				assert.bnEqual((await debtCache.cacheInfo())[0], amount);
				assert.bnEqual(await debtCache.cachedPynthDebts([pUSD]), amount);

				// decrease the cached pUSD amount
				const amountToReduce = toUnit('500');
				const tx = await debtCache.updateCachedpUSDDebt(amountToReduce.neg(), { from: owner });

				assert.bnEqual(
					await debtCache.cachedPynthDebts([pUSD]),
					cachedPynthDebt.sub(amountToReduce)
				);

				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [cachedPynthDebt.sub(amountToReduce)],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
		});

		describe('Issuance, burning, exchange, settlement', () => {
			it('issuing pUSD updates the debt total', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const pynthsToIssue = toUnit('10');
				await periFinanceProxy.transfer(account1, toUnit('1000'), { from: owner });
				const tx = await periFinance.issuePynths(pynthsToIssue, { from: account1 });
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
				await periFinanceProxy.transfer(account1, toUnit('1000'), { from: owner });
				await periFinance.issuePynths(pynthsToIssue, { from: account1 });

				await circuitBreaker.resetLastValue(
					[aggregatorIssuedPynths.address, aggregatorDebtRatio.address],
					[
						(await aggregatorIssuedPynths.latestRoundData())[1],
						(await aggregatorDebtRatio.latestRoundData())[1],
					],
					{ from: owner }
				);

				const issued = (await debtCache.cacheInfo())[0];

				const pynthsToBurn = toUnit('5');

				const tx = await periFinance.burnPynths(pynthsToBurn, { from: account1 });
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

			it('issuing pUSD updates the total debt cached and pUSD cache', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const pynthsToIssue = toUnit('1000');
				const cachedPynths = (await debtCache.cachedPynthDebts([pUSD]))[0];

				await periFinanceProxy.transfer(account1, toUnit('10000'), { from: owner });

				const tx = await periFinance.issuePynths(pynthsToIssue, { from: account1 });

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

				// cached pUSD increased by pynth issued
				assert.bnEqual(await debtCache.cachedPynthDebts([pUSD]), cachedPynths.add(pynthsToIssue));
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.add(pynthsToIssue));
			});

			it('burning pUSD reduces the total debt and pUSD cache', async () => {
				await debtCache.takeDebtSnapshot();

				const pynthsToIssue = toUnit('1000');
				await periFinanceProxy.transfer(account1, toUnit('10000'), { from: owner });
				await periFinance.issuePynths(pynthsToIssue, { from: account1 });

				const cachedPynths = (await debtCache.cachedPynthDebts([pUSD]))[0];
				const issued = (await debtCache.cacheInfo())[0];
				const pynthsToBurn = toUnit('500');

				const tx = await periFinance.burnPynths(pynthsToBurn, { from: account1 });

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

				// cached pUSD decreased by pynth burned
				assert.bnEqual(await debtCache.cachedPynthDebts([pUSD]), cachedPynths.sub(pynthsToBurn));
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.sub(pynthsToBurn));
			});

			it('exchanging between pynths updates the debt totals for those pynths', async () => {
				// Zero exchange fees so that we can neglect them.
				await systemSettings.setExchangeFeeRateForPynths([pAUD, pUSD], [toUnit(0), toUnit(0)], {
					from: owner,
				});

				await debtCache.takeDebtSnapshot();
				await periFinanceProxy.transfer(account1, toUnit('1000'), { from: owner });
				await periFinance.issuePynths(toUnit('10'), { from: account1 });
				const issued = (await debtCache.cacheInfo())[0];
				const debts = await debtCache.cachedPynthDebts([pUSD, pAUD]);
				const tx = await periFinance.exchange(pUSD, toUnit('5'), pAUD, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pUSD, pAUD]);
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

			it('exchanging between pynths updates pUSD debt total due to fees', async () => {
				// Disable Dynamic fee so that we can neglect it.
				await systemSettings.setExchangeDynamicFeeRounds('0', { from: owner });

				await systemSettings.setExchangeFeeRateForPynths(
					[pAUD, pUSD, pEUR],
					[toUnit(0.05), toUnit(0.05), toUnit(0.05)],
					{ from: owner }
				);

				await pEURContract.issue(account1, toUnit(20));
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const debts = await debtCache.cachedPynthDebts([pUSD, pAUD, pEUR]);

				await periFinance.exchange(pEUR, toUnit(10), pAUD, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pUSD, pAUD, pEUR]);

				assert.bnEqual((await debtCache.cacheInfo())[0], issued);
				assert.bnEqual(postDebts[0], debts[0].add(toUnit(2)));
				assert.bnEqual(postDebts[1], debts[1].add(toUnit(18)));
				assert.bnEqual(postDebts[2], debts[2].sub(toUnit(20)));
			});

			it('exchanging between pynths updates debt properly when prices have changed', async () => {
				// Zero exchange fees so that we can neglect them.
				await systemSettings.setExchangeFeeRateForPynths(
					[pAUD, pUSD, pEUR],
					[toUnit(0), toUnit(0), toUnit(0)],
					{
						from: owner,
					}
				);
				// Disable Dynamic fee so that we can neglect it.
				await systemSettings.setExchangeDynamicFeeRounds('0', { from: owner });

				await pEURContract.issue(account1, toUnit(20));
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];

				const debts = await debtCache.cachedPynthDebts([pAUD, pEUR]);

				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR],
					['1', '1'].map(toUnit)
				);

				await periFinance.exchange(pEUR, toUnit(10), pAUD, { from: account1 });
				const postDebts = await debtCache.cachedPynthDebts([pAUD, pEUR]);

				// 120 eur @ $2 = $240 and 100 aud @ $0.50 = $50 becomes:
				// 110 eur @ $1 = $110 (-$130) and 110 aud @ $1 = $110 (+$60)
				// Total debt is reduced by $130 - $60 = $70
				assert.bnEqual((await debtCache.cacheInfo())[0], issued.sub(toUnit(70)));
				assert.bnEqual(postDebts[0], debts[0].add(toUnit(60)));
				assert.bnEqual(postDebts[1], debts[1].sub(toUnit(130)));
			});

			it('settlement updates debt totals', async () => {
				// Zero exchange fees so that we can neglect them.
				await systemSettings.setExchangeFeeRateForPynths([pAUD, pEUR], [toUnit(0), toUnit(0)], {
					from: owner,
				});
				// Disable Dynamic fee so that we can neglect it.
				await systemSettings.setExchangeDynamicFeeRounds('0', { from: owner });

				await pAUDContract.issue(account1, toUnit(100));

				await debtCache.takeDebtSnapshot();

				const cachedDebt = await debtCache.cachedDebt();

				await periFinance.exchange(pAUD, toUnit(50), pEUR, { from: account1 });
				// so there's now 100 - 25 pUSD left (25 of it was exchanged)
				// and now there's 100 + (25 / 2 ) of pEUR = 112.5

				await systemSettings.setWaitingPeriodSecs(60, { from: owner });
				// set a high price deviation threshold factor to be sure it doesn't trigger here
				await systemSettings.setPriceDeviationThresholdFactor(toUnit('99'), { from: owner });

				await updateAggregatorRates(
					exchangeRates,
					circuitBreaker,
					[pAUD, pEUR],
					['2', '1'].map(toUnit)
				);

				await fastForward(100);

				const tx = await exchanger.settle(account1, pEUR);
				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				// The A$75 does not change as we settled pEUR
				// But the EUR changes from 112.5 + 87.5 rebate = 200
				const results = await debtCache.cachedPynthDebts([pAUD, pEUR]);
				assert.bnEqual(results[0], toUnit(75));
				assert.bnEqual(results[1], toUnit(200));

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [cachedDebt.sub(toUnit('25'))], // deduct the 25 units of pAUD
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
		});

		describe('Pynth removal and addition', () => {
			it('Removing pynths zeroes out the debt snapshot for that currency', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];
				const pEURValue = (await debtCache.cachedPynthDebts([pEUR]))[0];
				await pEURContract.setTotalSupply(toUnit(0));
				const tx = await issuer.removePynth(pEUR, { from: owner });
				const result = (await debtCache.cachedPynthDebts([pEUR]))[0];
				const newIssued = (await debtCache.cacheInfo())[0];
				assert.bnEqual(newIssued, issued.sub(pEURValue));
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

			it('Pynth snapshots cannot be purged while the pynth exists', async () => {
				await assert.revert(debtCache.purgeCachedPynthDebt(pAUD, { from: owner }), 'Pynth exists');
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

			it('Removing a pynth invalidates the debt cache', async () => {
				await pEURContract.setTotalSupply(toUnit('0'));
				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.removePynth(pEUR, { from: owner });
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

			it('Removing multiple pynths invalidates the debt cache', async () => {
				await pAUDContract.setTotalSupply(toUnit('0'));
				await pEURContract.setTotalSupply(toUnit('0'));

				assert.isFalse((await debtCache.cacheInfo())[2]);
				const tx = await issuer.removePynths([pEUR, pAUD], { from: owner });
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

			it('Removing multiple pynths zeroes the debt cache for those currencies', async () => {
				await debtCache.takeDebtSnapshot();
				const issued = (await debtCache.cacheInfo())[0];
				const pEURValue = (await debtCache.cachedPynthDebts([pEUR]))[0];
				const pAUDValue = (await debtCache.cachedPynthDebts([pAUD]))[0];
				await pEURContract.setTotalSupply(toUnit(0));
				await pAUDContract.setTotalSupply(toUnit(0));
				const tx = await issuer.removePynths([pEUR, pAUD], { from: owner });
				const result = await debtCache.cachedPynthDebts([pEUR, pAUD]);
				const newIssued = (await debtCache.cacheInfo())[0];
				assert.bnEqual(newIssued, issued.sub(pEURValue.add(pAUDValue)));
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

	describe('totalNonPeriBackedDebt', async () => {
		let totalNonPeriBackedDebt;
		let currentDebt;

		const getTotalNonPeriBackedDebt = async () => {
			const { excludedDebt } = await debtCache.totalNonPeriBackedDebt();
			return excludedDebt;
		};

		beforeEach(async () => {
			// Issue some debt to avoid a division-by-zero in `getBorrowRate` where
			// we compute the utilisation.
			await periFinanceProxy.transfer(account1, toUnit('1000'), { from: owner });
			await periFinance.issuePynths(toUnit('10'), { from: account1 });

			totalNonPeriBackedDebt = await getTotalNonPeriBackedDebt();
			currentDebt = await debtCache.currentDebt();
		});

		describe('when MultiCollateral loans are opened', async () => {
			let rate;

			beforeEach(async () => {
				await setupMultiCollateral();

				({ rate } = await exchangeRates.rateAndInvalid(pETH));

				await ceth.open(oneETH, pETH, {
					value: twoETH,
					from: account1,
				});
			});

			it('increases non-PERI debt', async () => {
				assert.bnEqual(
					totalNonPeriBackedDebt.add(multiplyDecimalRound(oneETH, rate)),
					await getTotalNonPeriBackedDebt()
				);
			});
			it('is excluded from currentDebt', async () => {
				assert.bnEqual(currentDebt, await debtCache.currentDebt());
			});

			describe('after the pynths are exchanged into other pynths', async () => {
				let tx;
				beforeEach(async () => {
					// Swap some pETH into pynthetic dollarydoos.
					tx = await periFinance.exchange(pETH, '5', pAUD, { from: account1 });
				});

				it('non-PERI debt is unchanged', async () => {
					assert.bnEqual(
						totalNonPeriBackedDebt.add(multiplyDecimalRound(oneETH, rate)),
						await getTotalNonPeriBackedDebt()
					);
				});
				it('currentDebt is unchanged', async () => {
					assert.bnEqual(currentDebt, await debtCache.currentDebt());
				});

				it('cached debt is properly updated', async () => {
					const logs = await getDecodedLogs({
						hash: tx.tx,
						contracts: [debtCache],
					});

					const cachedDebt = (await debtCache.cacheInfo())[0];
					decodedEventEqual({
						event: 'DebtCacheUpdated',
						emittedFrom: debtCache.address,
						args: [cachedDebt],
						log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
					});
				});
			});

			it('is properly reflected in a snapshot', async () => {
				const currentDebt = (await debtCache.currentDebt())[0];
				const cachedDebt = (await debtCache.cacheInfo())[0];
				assert.bnEqual(currentDebt, cachedDebt);
				const tx = await debtCache.takeDebtSnapshot();
				const logs = await getDecodedLogs({
					hash: tx.tx,
					contracts: [debtCache],
				});

				decodedEventEqual({
					event: 'DebtCacheUpdated',
					emittedFrom: debtCache.address,
					args: [cachedDebt],
					log: logs.find(({ name } = {}) => name === 'DebtCacheUpdated'),
				});
			});
		});

		describe('when shorts are opened', async () => {
			let rate;
			let amount;

			beforeEach(async () => {
				({ rate } = await exchangeRates.rateAndInvalid(pETH));

				// Take out a short position on pETH.
				// pUSD collateral = 1.5 * rate_eth
				amount = multiplyDecimalRound(rate, toUnit('1.5'));
				await pUSDContract.issue(account1, amount, { from: owner });
				// Again, avoid a divide-by-zero in computing the short rate,
				// by ensuring pETH.totalSupply() > 0.
				await pETHContract.issue(account1, amount, { from: owner });

				await setupShort();
				await short.setIssueFeeRate(toUnit('0'), { from: owner });
				await short.open(amount, oneETH, pETH, { from: account1 });
			});

			it('increases non-PERI debt', async () => {
				assert.bnEqual(totalNonPeriBackedDebt.add(rate), await getTotalNonPeriBackedDebt());
			});
			it('is excluded from currentDebt', async () => {
				assert.bnEqual(currentDebt, await debtCache.currentDebt());
			});
		});
	});
});