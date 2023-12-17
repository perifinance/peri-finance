'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const {
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setExchangeFeeRateForPynths,
} = require('./helpers');

const { toBytes32 } = require('../..');

const {
	currentTime,
	multiplyDecimal,
	toUnit,
	multiplyDecimalRound,
	multiplyDecimalRoundPrecise,
	divideDecimalRoundPrecise,
	fastForward,
} = require('../utils')();

contract('CrossChainManager', async accounts => {
	const [, owner, oracle, , debtManager, account1, account2, account3, , minterRole] = accounts;

	const [pUSD, pETH, pBTC, PERI] = ['pUSD', 'pETH', 'pBTC', 'PERI'].map(toBytes32);
	const pynthKeys = [pUSD, pETH, pBTC];

	let crossChainManager,
		crossChainState,
		debtCache,
		periFinance,
		/* periFinanceState, */
		bridgeStatepUSD,
		supplySchedule,
		exchangeRates,
		pUSDPynth,
		pBTCPynth,
		pETHPynth,
		systemSettings;

	// Updates rates with defaults so they're not stale.
	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[pBTC, pETH, PERI],
			['40000', '2000', '0.4'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);
		await debtCache.takeDebtSnapshot();
	};

	const syncNetworks = async gActive => {
		const tChainIds = ['1287', '97', '5'].map(toUnit);
		const tIssuedDebt = gActive
			? ['318188756587078819985', '44237489062075291253980', '14610962425925120949412']
			: ['318229466389837023940', '44239611786885227745055', '14611661299363036761253'];
		const tActiveDebt = gActive
			? ['318229466389837023940', '44239611786885227745055', '14611661299363036761253']
			: ['318188756587078819985', '44237489062075291253980', '14610962425925120949412'];
		const tInOut = toUnit('0');

		// set initial issued/active debt for other chains
		await crossChainManager.setCrossNetworkDebtsAll(tChainIds, tIssuedDebt, tActiveDebt, tInOut, {
			from: debtManager,
		});
	};

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			CrossChainManager: crossChainManager,
			CrossChainState: crossChainState,
			DebtCache: debtCache,
			PeriFinance: periFinance,
			/* PeriFinanceState: periFinanceState, */
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
			BridgeStatepUSD: bridgeStatepUSD,
			PynthpUSD: pUSDPynth,
			PynthpBTC: pBTCPynth,
			PynthpETH: pETHPynth,
			SupplySchedule: supplySchedule,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pBTC', 'pETH'],
			isPUSDMock: false,
			contracts: [
				'AddressResolver',
				'CrossChainManager',
				'CrossChainState',
				'StakingState',
				'Issuer',
				'Exchanger', // necessary for burnPynths to check settlement of pUSD
				'PeriFinance',
				'ExchangeRates',
				'SystemSettings',
				'SupplySchedule',
				/* 'EtherCollateral',
				'EtherCollateralsUSD', */
				'CollateralManager',
				'RewardEscrowV2', // necessary for issuer._collateral()
				'ExternalTokenStakeManager',
			],
		}));
		await systemSettings.setIssuanceRatio(toUnit('0.25'), { from: owner });
	});

	before(async () => {
		// default set up for cross chain
		const tChainIds = ['1287', '97', '5'].map(toUnit);

		// await crossChainManager.addNetworkIds(tChainIds, { from: owner });

		const tIssuedDebt = [
			'318229466389837023940',
			'44239611786885227745055',
			'14611661299363036761253',
		];
		const tActiveDebt = [
			'318188756587078819985',
			'44237489062075291253980',
			'14610962425925120949412',
		];
		const tInOut = toUnit('0');

		// set initial issued/active debt for other chains
		await crossChainManager.setCrossNetworkDebtsAll(tChainIds, tIssuedDebt, tActiveDebt, tInOut, {
			from: debtManager,
		});
		await updateRatesWithDefaults();
	});

	beforeEach(async () => {
		const exchangeFeeRate = toUnit('0.003');
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});

		await updateRatesWithDefaults();
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: crossChainManager.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'setCrossChainState',
				'setDebtManager',
				'addCurrentNetworkIssuedDebt',
				'subtractCurrentNetworkIssuedDebt',
				'setCrossNetworkIssuedDebtAll',
				'setCrossNetworkActiveDebtAll',
				'setCrossNetworkDebtsAll',
				'setOutboundSumToCurrentNetwork',
				'setInitialCurrentIssuedDebt',
				'clearCrossNetworkUserDebt',
				'setCrossNetworkUserDebt',
				'subtractTotalNetworkDebt',
				'addTotalNetworkDebt',
			],
		});
	});

	describe('only owner can call', () => {
		it('setCrossChainState() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: crossChainManager.setCrossChainState,
				accounts,
				args: [crossChainState.address],
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('setDebtManager() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: crossChainManager.setDebtManager,
				accounts,
				args: [debtManager],
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});
	});

	describe('Increasing or decreasing debt of self Network should effect to self network debt status', () => {
		const accounts = [account1, account2, account3];
		// const netwworkIdx = { moonriver: 0, polygon: 1, bsc: 2, ethereum: 3 };
		const stakingAmount = toUnit('1000');
		beforeEach(async () => {
			await bridgeStatepUSD.setNetworkStatus(toUnit('1287'), true, { from: owner });

			for (let index = 0; index < accounts.length; index++) {
				const account = accounts[index];
				await periFinance.transfer(account, stakingAmount, { from: owner });
			}
			// set initial issued debt for self chain
			// await crossChainManager.setInitialCurrentIssuedDebt({ from: owner });
		});

		describe('when pynths are issued by staking', async () => {
			it('ISSUED and ACTIVE DEBT should be INCREASED as SAME AMOUNT as THE STAKED AMOUNT', async () => {
				const issuedDebt = await crossChainManager.currentNetworkIssuedDebt();
				const activeDebt = await crossChainManager.currentNetworkActiveDebt();

				const rate = await exchangeRates.rateForCurrency(toBytes32('PERI'));
				const issuedPeriFinances = toUnit('1000');
				await periFinance.transfer(account1, issuedPeriFinances, {
					from: owner,
				});
				const issuanceRatio = await systemSettings.issuanceRatio();

				const expectedIssuablePynths = multiplyDecimal(
					issuedPeriFinances.add(multiplyDecimal(toUnit('2'), stakingAmount)),
					multiplyDecimal(rate, issuanceRatio)
				);

				await periFinance.issueMaxPynths({ from: account1 });
				await periFinance.issueMaxPynths({ from: account2 });

				const issuedDebtL = await crossChainManager.currentNetworkIssuedDebt();
				const activeDebtL = await crossChainManager.currentNetworkActiveDebt();
				const crossIssuedDebt = await crossChainManager.crossNetworkIssuedDebtAll();
				const curNetDebtRateL = await crossChainManager.currentNetworkDebtPercentage();
				const curNetDebtRate = await divideDecimalRoundPrecise(
					issuedDebtL,
					crossIssuedDebt.add(issuedDebtL)
				);
				const crossActiveDebts = await crossChainManager.crossNetworkActiveDebtAll();
				const expectedActiveDebt = await multiplyDecimalRoundPrecise(
					activeDebt.add(expectedIssuablePynths).add(crossActiveDebts),
					curNetDebtRate
				);

				assert.bnEqual(issuedDebt, issuedDebtL.sub(expectedIssuablePynths));
				assert.bnEqual(curNetDebtRateL, curNetDebtRate);
				assert.bnEqual(activeDebtL, expectedActiveDebt);
			});

			it('ISSUED should be DECREASED as SAME AMOUNT as the CLAIMED AMOUNT but ACTIVE DEBT is different', async () => {
				await periFinance.issueMaxPynths({ from: account1 });

				const minStakingPeriod = await systemSettings.minimumStakeTime();
				await fastForward(minStakingPeriod + 10);

				syncNetworks(true);

				const timestamp = await currentTime();

				await exchangeRates.updateRates(
					[pBTC, pETH, PERI],
					['4100', '2010', '0.5'].map(toUnit),
					timestamp,
					{
						from: oracle,
					}
				);

				await debtCache.takeDebtSnapshot();

				const issuedDebt = await crossChainManager.currentNetworkIssuedDebt();
				// const activeDebt = await crossChainManager.currentNetworkActiveDebt();

				await periFinance.burnPynths(PERI, toUnit('50'), { from: account1 });

				const issuedDebtL = await crossChainManager.currentNetworkIssuedDebt();
				const activeDebtL = await crossChainManager.currentNetworkActiveDebt();
				const crossIssuedDebt = await crossChainManager.crossNetworkIssuedDebtAll();
				const curNetDebtRateL = await crossChainManager.currentNetworkDebtPercentage();
				const expectedIssuedDebt = issuedDebt.sub(toUnit('50'));
				const curNetDebtRate = await divideDecimalRoundPrecise(
					expectedIssuedDebt,
					expectedIssuedDebt.add(crossIssuedDebt)
				);
				const crossActiveDebts = await crossChainManager.crossNetworkActiveDebtAll();
				const totalIssuedPynths = await periFinance.totalIssuedPynthsExcludeEtherCollateral(
					toBytes32('pUSD')
				);

				const expectedTotalDebts = totalIssuedPynths.add(crossActiveDebts);
				const expectedActiveDebt = await multiplyDecimalRoundPrecise(
					expectedTotalDebts,
					curNetDebtRate
				);

				assert.bnEqual(issuedDebtL, expectedIssuedDebt);
				assert.bnEqual(curNetDebtRateL, curNetDebtRate);
				assert.bnEqual(activeDebtL, expectedActiveDebt);
			});

			it('DEBT RATE against total network debt should be INCREASED by STAKING', async () => {
				const curNetDebtRate = await crossChainManager.currentNetworkDebtPercentage();

				await periFinance.issueMaxPynths({ from: account1 });

				const curNetDebtRateL = await crossChainManager.currentNetworkDebtPercentage();

				assert.bnGt(curNetDebtRateL, curNetDebtRate);
			});

			it('DEBT RATE against total network debt should be DECREASED by CLAIM', async () => {
				await periFinance.issueMaxPynths({ from: account1 });

				const curNetDebtRate = await crossChainManager.currentNetworkDebtPercentage();

				const minStakingPeriod = await systemSettings.minimumStakeTime();

				await fastForward(minStakingPeriod);
				await debtCache.takeDebtSnapshot();
				syncNetworks(false);

				await periFinance.exit({ from: account1 });

				const curNetDebtRateL = await crossChainManager.currentNetworkDebtPercentage();

				assert.bnLt(curNetDebtRateL, curNetDebtRate);
			});

			it('ADAPTED DEBTs should NOT be affected by pUSD BRIDGED AMOUNT', async () => {
				await periFinance.issueMaxPynths({ from: account1 });
				await periFinance.issueMaxPynths({ from: account2 });

				const adaptedDebt = await crossChainManager.currentNetworkAdaptedActiveDebtValue(
					toBytes32('pUSD')
				);
				const adaptedIssuedDebt = await crossChainManager.currentNetworkAdaptedIssuedDebtValue(
					toBytes32('pUSD')
				);

				await pUSDPynth.overchainTransfer(
					toUnit('100'),
					toUnit('1287'),
					[toBytes32('00000'), toBytes32('00000'), toUnit('0')],
					{ from: account1 }
				);

				const adaptedDebtBridged = await crossChainManager.currentNetworkAdaptedActiveDebtValue(
					toBytes32('pUSD')
				);
				const adaptedIssuedDebtBridged = await crossChainManager.currentNetworkAdaptedIssuedDebtValue(
					toBytes32('pUSD')
				);

				assert.bnEqual(adaptedDebt.totalSystemValue, adaptedDebtBridged.totalSystemValue);
				assert.bnEqual(
					adaptedIssuedDebt.totalSystemValue,
					adaptedIssuedDebtBridged.totalSystemValue
				);
			});
		});

		describe('when price of pynths changed', async () => {
			const accounts = [account1, account2, account3];
			// const netwworkIdx = { moonriver: 0, polygon: 1, bsc: 2, ethereum: 3 };
			beforeEach(async () => {
				const stakingAmount = toUnit('50000');

				for (let index = 0; index < accounts.length; index++) {
					const account = accounts[index];
					await periFinance.transfer(account, stakingAmount, { from: owner });
				}
				// set initial issued debt for self chain
				// await crossChainManager.setInitialCurrentIssuedDebt({ from: owner });
			});

			it('ISSUED DEBTs should not be affected by price change', async () => {
				await exchangeRates.updateRates([toBytes32('PERI')], [toUnit('4')], await currentTime(), {
					from: oracle,
				});

				debtCache.takeDebtSnapshot();

				await periFinance.issueMaxPynths({ from: account1 });
				await periFinance.issueMaxPynths({ from: account2 });

				const issuedDebt = await crossChainManager.currentNetworkIssuedDebt();
				const adaptedIssuedDebt = await crossChainManager.currentNetworkAdaptedIssuedDebtValue(
					toBytes32('pUSD')
				);

				await periFinance.exchange(pUSD, toUnit('10000'), pETH, { from: account1 });
				await periFinance.exchange(pUSD, toUnit('10000'), pBTC, { from: account2 });

				await exchangeRates.updateRates(
					['pBTC', 'pETH'].map(toBytes32),
					['50000', '2500'].map(toUnit),
					await currentTime(),
					{
						from: oracle,
					}
				);

				debtCache.takeDebtSnapshot();

				const issuedDebtBridged = await crossChainManager.currentNetworkIssuedDebt();
				const adaptedIssuedDebtBridged = await crossChainManager.currentNetworkAdaptedIssuedDebtValue(
					toBytes32('pUSD')
				);

				assert.bnEqual(issuedDebt, issuedDebtBridged);
				assert.bnEqual(
					adaptedIssuedDebt.totalSystemValue,
					adaptedIssuedDebtBridged.totalSystemValue
				);
			});

			it('ACTIVE DEBTs should be affected by price change', async () => {
				await exchangeRates.updateRates([toBytes32('PERI')], [toUnit('4')], await currentTime(), {
					from: oracle,
				});

				debtCache.takeDebtSnapshot();

				await periFinance.issueMaxPynths({ from: account1 });
				await periFinance.issueMaxPynths({ from: account2 });

				await periFinance.exchange(pUSD, toUnit('10000'), pETH, { from: account1 });
				await periFinance.exchange(pUSD, toUnit('10000'), pBTC, { from: account2 });

				const eTHPrice = 2100;
				const bTCPrice = 43000;
				await exchangeRates.updateRates(
					['pBTC', 'pETH'].map(toBytes32),
					[bTCPrice, eTHPrice].map(toUnit),
					await currentTime(),
					{
						from: oracle,
					}
				);

				debtCache.takeDebtSnapshot();

				const pUSDBalanceOfAcc1 = await pUSDPynth.balanceOf(account1);
				const pETHBalanceOfAcc1 = await pETHPynth.balanceOf(account1);
				const pUSDBalanceOfAcc2 = await pUSDPynth.balanceOf(account2);
				const pBTCBalanceOfAcc2 = await pBTCPynth.balanceOf(account2);

				const fee = toUnit(20000 * 0.003);
				const pUSDBalance = pUSDBalanceOfAcc1.add(pUSDBalanceOfAcc2);
				const pETHTopUSDTValue = multiplyDecimal(pETHBalanceOfAcc1, toUnit(eTHPrice));
				const pBTCTopUSDTValue = multiplyDecimal(pBTCBalanceOfAcc2, toUnit(bTCPrice));

				const adaptedDebtBridged = await crossChainManager.currentNetworkAdaptedActiveDebtValue(
					toBytes32('pUSD')
				);

				const crossActiveDebt = await crossChainManager.crossNetworkActiveDebtAll();
				const curNetDebtRate = await crossChainManager.currentNetworkDebtPercentage();
				const totalActiveDebt = multiplyDecimalRoundPrecise(
					crossActiveDebt
						.add(fee)
						.add(pUSDBalance)
						.add(pETHTopUSDTValue)
						.add(pBTCTopUSDTValue),
					curNetDebtRate
				);

				assert.bnEqual(adaptedDebtBridged.totalSystemValue, totalActiveDebt);
			});
		});

		describe('when self debts are stale', async () => {
			const accounts = [account1, account2, account3];
			// const netwworkIdx = { moonriver: 0, polygon: 1, bsc: 2, ethereum: 3 };
			beforeEach(async () => {
				const stakingAmount = toUnit('50000');

				for (let index = 0; index < accounts.length; index++) {
					const account = accounts[index];
					await periFinance.transfer(account, stakingAmount, { from: owner });
				}
				// set initial issued debt for self chain
				// await crossChainManager.setInitialCurrentIssuedDebt({ from: owner });
			});

			describe('when self debts are changed over 5% by issuing', async () => {
				beforeEach(async () => {
					await periFinance.issueMaxPynths({ from: account1 });
					const minStakingPeriod = await systemSettings.minimumStakeTime();
					await fastForward(minStakingPeriod);

					const timestamp = await currentTime();

					await exchangeRates.updateRates(
						[pBTC, pETH, PERI],
						['4100', '2010', '0.5'].map(toUnit),
						timestamp,
						{
							from: oracle,
						}
					);

					await debtCache.takeDebtSnapshot();
					syncNetworks(true);

					const { debt } = await debtCache.currentDebt();
					const fivePecent = toUnit((0.05 / 0.95).toString());
					const fiveAmount = multiplyDecimalRound(debt, fivePecent);
					// increase self network's issued debt over 5%
					await periFinance.issuePynths(PERI, fiveAmount, {
						from: account3,
					});
				});

				it('should not be able to claim', async () => {
					await assert.revert(
						periFinance.burnPynths(PERI, toUnit('10'), { from: account1 }),
						'Cross chain debt is stale'
					);
				});

				it('should be able to stake', async () => {
					await periFinance.issueMaxPynths({ from: account2 });
				});

				it('should be able to exchange', async () => {
					await periFinance.exchange(pUSD, toUnit('1000'), pETH, { from: account1 });
				});

				it('should be able to transfer', async () => {
					await pUSDPynth.transfer(account2, toUnit('100'), { from: account1 });
				});

				it('should be able to bridge', async () => {
					await pUSDPynth.overchainTransfer(
						toUnit('100'),
						toUnit('1287'),
						[toBytes32('00000'), toBytes32('00000'), toUnit('0')],
						{ from: account1 }
					);
				});

				describe('then synchronized with other networks which have BIGGER active debt than issued debt', async () => {
					beforeEach(async () => {
						syncNetworks(true);
					});

					it('the claiming is now working', async () => {
						await periFinance.burnPynths(PERI, toUnit('10'), { from: account1 });
					});

					it('active debt is LARGER than issued debt', async () => {
						const issuedDebt = await crossChainManager.currentNetworkIssuedDebt();
						const activeDebt = await crossChainManager.currentNetworkActiveDebt();

						assert.bnGt(activeDebt, issuedDebt);
					});

					it('that causes active debt is increased, which blocks from exitting', async () => {
						await assert.revert(
							periFinance.exit({ from: account1 }),
							'Trying to burn more than you have'
						);
					});
				});

				describe('then synchronized with other networks which have SMALLER active debt than issued debt', async () => {
					beforeEach(async () => {
						syncNetworks(false);
					});

					it('the claiming is now working', async () => {
						await periFinance.burnPynths(PERI, toUnit('10'), { from: account1 });
					});

					it('active debt is SMALLER than issued debt', async () => {
						const issuedDebt = await crossChainManager.currentNetworkIssuedDebt();
						const activeDebt = await crossChainManager.currentNetworkActiveDebt();

						assert.bnLt(activeDebt, issuedDebt);
					});

					it('that causes active debt is decreased, the exit works fine', async () => {
						await periFinance.exit({ from: account1 });
					});
				});
			});

			describe('when the In&Out is in the red', async () => {
				beforeEach(async () => {
					await periFinance.issueMaxPynths({ from: account1 });
					await periFinance.issueMaxPynths({ from: account2 });

					syncNetworks(false);
				});

				it('Self Active debt should be calculated correctly', async () => {
					await pUSDPynth.overchainTransfer(
						toUnit('1000'),
						toUnit('1287'),
						[toBytes32('00000'), toBytes32('00000'), toUnit('0')],
						{ from: account1 }
					);

					const crossActiveDebt = await crossChainManager.crossNetworkActiveDebtAll();
					const issuedPynths = await periFinance.totalIssuedPynthsExcludeEtherCollateral(
						toBytes32('pUSD')
					);
					const inFromCrossedChain = await crossChainManager.outboundSumToCurrentNetwork();
					let inBound = await bridgeStatepUSD.getTotalInboundAmount();
					inBound = inFromCrossedChain > inBound ? inFromCrossedChain : inBound;
					const outBound = await bridgeStatepUSD.getTotalOutboundAmount();
					let selfActiveDebt = issuedPynths.add(outBound).sub(inBound);
					const totalActiveDebt = selfActiveDebt.add(crossActiveDebt);

					const curNetDebtRate = await crossChainManager.currentNetworkDebtPercentage();
					selfActiveDebt = multiplyDecimalRoundPrecise(totalActiveDebt, curNetDebtRate);

					const activeDebt = await crossChainManager.currentNetworkActiveDebt();
					assert.bnEqual(activeDebt, selfActiveDebt);
				});

				it('Self Active debt should be calculated correctly even if total active debt is lower than total issued debt', async () => {
					await exchangeRates.updateRates(
						['pBTC', 'pETH'].map(toBytes32),
						['39000', '1900'].map(toUnit),
						await currentTime(),
						{
							from: oracle,
						}
					);

					debtCache.takeDebtSnapshot();

					const crossActiveDebt = await crossChainManager.crossNetworkActiveDebtAll();
					const issuedPynths = await periFinance.totalIssuedPynthsExcludeEtherCollateral(
						toBytes32('pUSD')
					);
					const inFromCrossedChain = await crossChainManager.outboundSumToCurrentNetwork();
					let inBound = await bridgeStatepUSD.getTotalInboundAmount();
					inBound = inFromCrossedChain > inBound ? inFromCrossedChain : inBound;
					const outBound = await bridgeStatepUSD.getTotalOutboundAmount();
					let selfActiveDebt = issuedPynths.add(outBound).sub(inBound);
					const totalActiveDebt = selfActiveDebt.add(crossActiveDebt);
					const curNetDebtRate = await crossChainManager.currentNetworkDebtPercentage();
					selfActiveDebt = multiplyDecimalRoundPrecise(totalActiveDebt, curNetDebtRate);

					const activeDebt = await crossChainManager.currentNetworkActiveDebt();
					assert.bnEqual(activeDebt, selfActiveDebt);
				});
			});
		});
		describe('when inflational mint', async () => {
			beforeEach(async () => {
				await periFinance.issueMaxPynths({ from: account1 });
				await periFinance.issueMaxPynths({ from: account2 });

				syncNetworks(true);
			});
			it('inflation should be failed if crosschain synchronization is stale', async () => {
				const syncStaleThreshold = await systemSettings.debtSnapshotStaleTime();
				await fastForward(syncStaleThreshold + 1);
				await assert.revert(
					periFinance.inflationalMint({ from: minterRole }),
					'Cross chain debt is stale'
				);
			});
			it('inflation should be success if crosschain synchronization is not stale', async () => {
				await periFinance.inflationalMint({ from: minterRole });
			});
			it('minterable supply should be proportional to the debt rate', async () => {
				const totalSupply = await periFinance.totalSupply();
				const weeklyMintableSupply = await supplySchedule.mintableSupply();
				const debtRate = await crossChainManager.currentNetworkDebtPercentage();
				const expectedMintableSupply = multiplyDecimalRoundPrecise(weeklyMintableSupply, debtRate);
				const mintableSupply = await crossChainManager.mintableSupply();

				await periFinance.inflationalMint({ from: minterRole });

				const totalSupplyL = await periFinance.totalSupply();

				assert.bnEqual(mintableSupply, expectedMintableSupply);
				assert.bnEqual(totalSupplyL, totalSupply.add(expectedMintableSupply));
			});
		});
	});
});
