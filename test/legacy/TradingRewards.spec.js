const { contract, web3 } = require('hardhat');
const { toBN } = web3.utils;
const { assert, addSnapshotBeforeRestoreAfter } = require('./common');
const { setupAllContracts } = require('./setup');
const { currentTime, toUnit, multiplyDecimal } = require('../utils')();
const { setExchangeFeeRateForPynths, getDecodedLogs, decodedEventEqual } = require('./helpers');
const { toBytes32 } = require('../..');

/*
 * This tests the TradingRewards contract's integration
 * with the rest of the PeriFinance system.
 *
 * Inner workings of the contract are tested in TradingRewards.unit.js.
 **/
contract('TradingRewards', accounts => {
	const [, owner, account1] = accounts;

	const pynths = ['pUSD', 'pETH', 'pBTC'];
	const pynthKeys = pynths.map(toBytes32);
	const [pUSD, pETH, pBTC] = pynthKeys;

	let periFinance, exchanger, exchangeRates, rewards, resolver, systemSettings;
	let pUSDContract, pETHContract, pBTCContract;

	let exchangeLogs;

	const zeroAddress = '0x0000000000000000000000000000000000000000';

	const amountIssued = toUnit('1000');
	const allExchangeFeeRates = toUnit('0.001');
	const rates = {
		[pETH]: toUnit('100'),
		[pBTC]: toUnit('12000'),
	};

	let feesPaidUSD;

	async function getExchangeLogs({ exchangeTx }) {
		const logs = await getDecodedLogs({
			hash: exchangeTx.tx,
			contracts: [periFinance, rewards],
		});

		return logs.filter(log => log !== undefined);
	}

	async function executeTrade({ account, fromCurrencyKey, fromCurrencyAmount, toCurrencyKey }) {
		const exchangeTx = await periFinance.exchange(
			fromCurrencyKey,
			fromCurrencyAmount,
			toCurrencyKey,
			{
				from: account,
			}
		);

		const { fee } = await exchanger.getAmountsForExchange(
			fromCurrencyAmount,
			fromCurrencyKey,
			toCurrencyKey
		);

		const rate = rates[toCurrencyKey];
		feesPaidUSD = multiplyDecimal(fee, rate);

		exchangeLogs = await getExchangeLogs({ exchangeTx });
	}

	describe('when deploying the system', () => {
		before('deploy all contracts', async () => {
			({
				PeriFinance: periFinance,
				TradingRewards: rewards,
				AddressResolver: resolver,
				Exchanger: exchanger,
				ExchangeRates: exchangeRates,
				PynthpUSD: pUSDContract,
				PynthpETH: pETHContract,
				PynthpBTC: pBTCContract,
				SystemSettings: systemSettings,
			} = await setupAllContracts({
				accounts,
				pynths,
				contracts: [
					'PeriFinance',
					'TradingRewards',
					'Exchanger',
					'AddressResolver',
					'ExchangeRates',
					'SystemSettings',
					'StakingState',
					'CrossChainManager',
				],
			}));
		});

		before('BRRRRRR', async () => {
			await pUSDContract.issue(account1, amountIssued);
			await pETHContract.issue(account1, amountIssued);
			await pBTCContract.issue(account1, amountIssued);
		});

		before('set exchange rates', async () => {
			const oracle = account1;
			const timestamp = await currentTime();

			await exchangeRates.updateRates([pETH, pBTC], Object.values(rates), timestamp, {
				from: oracle,
			});

			await setExchangeFeeRateForPynths({
				owner,
				systemSettings,
				pynthKeys,
				exchangeFeeRates: pynthKeys.map(() => allExchangeFeeRates),
			});
		});

		it('has expected balances for accounts', async () => {
			assert.bnEqual(amountIssued, await pUSDContract.balanceOf(account1));
			assert.bnEqual(amountIssued, await pETHContract.balanceOf(account1));
			assert.bnEqual(amountIssued, await pBTCContract.balanceOf(account1));
		});

		it('has expected parameters', async () => {
			assert.equal(owner, await rewards.getPeriodController());
			assert.equal(owner, await rewards.owner());
			assert.equal(periFinance.address, await rewards.getRewardsToken());
			assert.equal(resolver.address, await rewards.resolver());
		});

		describe('when SystemSettings tradingRewardsEnabled is false', () => {
			it('tradingRewardsEnabled is false', async () => {
				assert.isFalse(await systemSettings.tradingRewardsEnabled());
				assert.isFalse(await exchanger.tradingRewardsEnabled());
			});

			describe('when performing an exchange', () => {
				addSnapshotBeforeRestoreAfter();

				before('perform an exchange and get tx logs', async () => {
					await executeTrade({
						account: account1,
						fromCurrencyKey: pUSD,
						fromCurrencyAmount: toUnit('100'),
						toCurrencyKey: pETH,
					});
				});

				it('emitted a PynthExchange event', async () => {
					assert.isTrue(exchangeLogs.some(log => log.name === 'PynthExchange'));
				});

				it('did not emit an ExchangeFeeRecorded event', async () => {
					assert.isFalse(exchangeLogs.some(log => log.name === 'ExchangeFeeRecorded'));
				});

				it('did not record a fee in TradingRewards', async () => {
					assert.bnEqual(await rewards.getUnaccountedFeesForAccountForPeriod(account1, 0), toBN(0));
				});
			});
		});

		describe('when SystemSettings tradingRewardsEnabled is set to true', () => {
			before('set tradingRewardsEnabled to true', async () => {
				await systemSettings.setTradingRewardsEnabled(true, { from: owner });
			});

			it('tradingRewardsEnabled is true', async () => {
				assert.isTrue(await systemSettings.tradingRewardsEnabled());
				assert.isTrue(await exchanger.tradingRewardsEnabled());
			});

			const itCorrectlyPerformsAnExchange = ({
				account,
				fromCurrencyKey,
				fromCurrencyAmount,
				toCurrencyKey,
			}) => {
				describe('when performing a regular exchange', () => {
					addSnapshotBeforeRestoreAfter();

					before('perform an exchange and get tx logs', async () => {
						await executeTrade({
							account,
							fromCurrencyKey,
							fromCurrencyAmount,
							toCurrencyKey,
						});
					});

					it('emitted a PynthExchange event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'PynthExchange'));
					});

					it('emitted an ExchangeFeeRecorded event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'ExchangeFeeRecorded'));

						const feeRecordLog = exchangeLogs.find(log => log.name === 'ExchangeFeeRecorded');
						decodedEventEqual({
							event: 'ExchangeFeeRecorded',
							log: feeRecordLog,
							emittedFrom: rewards.address,
							args: [account, feesPaidUSD, 0],
						});
					});

					it('recorded a fee in TradingRewards', async () => {
						assert.bnEqual(
							await rewards.getUnaccountedFeesForAccountForPeriod(account1, 0),
							feesPaidUSD
						);
					});
				});
			};

			itCorrectlyPerformsAnExchange({
				account: account1,
				fromCurrencyKey: pUSD,
				fromCurrencyAmount: toUnit('100'),
				toCurrencyKey: pETH,
			});

			itCorrectlyPerformsAnExchange({
				account: account1,
				fromCurrencyKey: pUSD,
				fromCurrencyAmount: toUnit('100'),
				toCurrencyKey: pBTC,
			});

			itCorrectlyPerformsAnExchange({
				account: account1,
				fromCurrencyKey: pETH,
				fromCurrencyAmount: toUnit('10'),
				toCurrencyKey: pBTC,
			});

			itCorrectlyPerformsAnExchange({
				account: account1,
				fromCurrencyKey: pBTC,
				fromCurrencyAmount: toUnit('1'),
				toCurrencyKey: pETH,
			});

			describe('when exchangeFeeRate is set to 0', () => {
				addSnapshotBeforeRestoreAfter();

				before('set fee rate', async () => {
					const zeroRate = toBN(0);

					await setExchangeFeeRateForPynths({
						owner,
						systemSettings,
						pynthKeys,
						exchangeFeeRates: pynthKeys.map(() => zeroRate),
					});
				});

				describe('when performing an exchange', () => {
					before('perform an exchange and get tx logs', async () => {
						await executeTrade({
							account: account1,
							fromCurrencyKey: pUSD,
							fromCurrencyAmount: toUnit('100'),
							toCurrencyKey: pETH,
						});
					});

					it('emitted a PynthExchange event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'PynthExchange'));
					});

					it('did not emit an ExchangeFeeRecorded event', async () => {
						assert.isFalse(exchangeLogs.some(log => log.name === 'ExchangeFeeRecorded'));
					});
				});
			});

			describe('when executing an exchange with tracking', () => {
				addSnapshotBeforeRestoreAfter();

				describe('when a valid originator address is passed', () => {
					before('execute exchange with tracking', async () => {
						const exchangeTx = await periFinance.exchangeWithTracking(
							pUSD,
							toUnit('100'),
							pETH,
							account1,
							toBytes32('1INCH'),
							{
								from: account1,
							}
						);

						exchangeLogs = await getExchangeLogs({ exchangeTx });
					});

					it('emitted a PynthExchange event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'PynthExchange'));
					});

					it('emitted an ExchangeFeeRecorded event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'ExchangeFeeRecorded'));
					});
				});

				describe('when no valid originator address is passed', () => {
					before('execute exchange with tracking', async () => {
						const exchangeTx = await periFinance.exchangeWithTracking(
							pUSD,
							toUnit('100'),
							pETH,
							zeroAddress, // No originator = 0x0
							toBytes32('1INCH'),
							{
								from: account1,
							}
						);

						exchangeLogs = await getExchangeLogs({ exchangeTx });
					});

					it('emitted a PynthExchange event', async () => {
						assert.isTrue(exchangeLogs.some(log => log.name === 'PynthExchange'));
					});

					it('did not emit an ExchangeFeeRecorded event', async () => {
						assert.isFalse(exchangeLogs.some(log => log.name === 'ExchangeFeeRecorded'));
					});
				});
			});
		});
	});
});
