'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const {
	currentTime,
	fastForward,
	multiplyDecimal,
	divideDecimal,
	toUnit,
	fromUnit,
} = require('../utils')();

const { setupAllContracts } = require('./setup');

const {
	setExchangeFeeRateForPynths,
	getDecodedLogs,
	decodedEventEqual,
	timeIsClose,
	onlyGivenAddressCanInvoke,
	setStatus,
	convertToAggregatorPrice,
	updateRatesWithDefaults,
} = require('./helpers');

const {
	toBytes32,
	defaults: { WAITING_PERIOD_SECS, PRICE_DEVIATION_THRESHOLD_FACTOR },
} = require('../..');

const BN = require('bn.js');

const bnCloseVariance = '30';

const MockAggregator = artifacts.require('MockAggregatorV2V3');

contract('Exchanger (spec tests)', async accounts => {
	const [pUSD, pAUD, pEUR, PERI, pBTC, iBTC, pETH, iETH] = [
		'pUSD',
		'pAUD',
		'pEUR',
		'PERI',
		'pBTC',
		'iBTC',
		'pETH',
		'iETH',
	].map(toBytes32);

	const trackingCode = toBytes32('1INCH');

	const pynthKeys = [pUSD, pAUD, pEUR, pBTC, iBTC, pETH, iETH];

	const [, owner, account1, account2, /* debtManager, */ account3] = accounts;

	let periFinance,
		exchangeRates,
		feePool,
		delegateApprovals,
		pUSDContract,
		pAUDContract,
		pEURContract,
		pBTCContract,
		iBTCContract,
		pETHContract,
		oracle,
		timestamp,
		exchanger,
		exchangeState,
		exchangeFeeRate,
		amountIssued,
		systemSettings,
		systemStatus,
		resolver,
		debtCache,
		issuer,
		flexibleStorage;

	let aggregator;

	const itReadsTheWaitingPeriod = () => {
		describe('waitingPeriodSecs', () => {
			it('the default is configured correctly', async () => {
				// Note: this only tests the effectiveness of the setup script, not the deploy script,
				assert.equal(await exchanger.waitingPeriodSecs(), WAITING_PERIOD_SECS);
			});
			describe('given it is configured to 90', () => {
				beforeEach(async () => {
					await systemSettings.setWaitingPeriodSecs('90', { from: owner });
				});
				describe('and there is an exchange', () => {
					beforeEach(async () => {
						await periFinance.exchange(pUSD, toUnit('100'), pEUR, { from: account1 });
					});
					it('then the maxSecsLeftInWaitingPeriod is close to 90', async () => {
						const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
						timeIsClose({ actual: maxSecs, expected: 90, variance: 2 });
					});
					describe('and 87 seconds elapses', () => {
						// Note: timestamp accurancy can't be guaranteed, so provide a few seconds of buffer either way
						beforeEach(async () => {
							await fastForward(87);
						});
						describe('when settle() is called', () => {
							it('then it reverts', async () => {
								await assert.revert(
									periFinance.settle(pEUR, { from: account1 }),
									'Cannot settle during waiting period'
								);
							});
							it('and the maxSecsLeftInWaitingPeriod is close to 1', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
								timeIsClose({ actual: maxSecs, expected: 1, variance: 2 });
							});
						});
						describe('when a further 5 seconds elapse', () => {
							beforeEach(async () => {
								await fastForward(5);
							});
							describe('when settle() is called', () => {
								it('it successed', async () => {
									await periFinance.settle(pEUR, { from: account1 });
								});
							});
						});
					});
				});
			});
		});
	};

	const itWhenTheWaitingPeriodIsZero = () => {
		describe('When the waiting period is set to 0', () => {
			let initialWaitingPeriod;

			beforeEach(async () => {
				initialWaitingPeriod = await systemSettings.waitingPeriodSecs();
				await systemSettings.setWaitingPeriodSecs('0', { from: owner });
			});

			it('is set correctly', async () => {
				assert.bnEqual(await systemSettings.waitingPeriodSecs(), '0');
			});

			describe('When exchanging', () => {
				const amountOfSrcExchanged = toUnit('10');

				beforeEach(async () => {
					await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });
					await pUSDContract.issue(owner, toUnit('100'));
					await periFinance.exchange(pUSD, toUnit('10'), pETH, { from: owner });
				});

				it('creates no new entries', async () => {
					let { numEntries } = await exchanger.settlementOwing(owner, pETH);
					assert.bnEqual(numEntries, '0');
					numEntries = await exchangeState.getLengthOfEntries(owner, pETH);
					assert.bnEqual(numEntries, '0');
				});

				it('can exchange back without waiting', async () => {
					const { amountReceived } = await exchanger.getAmountsForExchange(
						amountOfSrcExchanged,
						pUSD,
						pETH
					);
					await periFinance.exchange(pETH, amountReceived, pUSD, { from: owner });
					assert.bnEqual(await pETHContract.balanceOf(owner), '0');
				});

				describe('When the waiting period is switched on again', () => {
					beforeEach(async () => {
						await systemSettings.setWaitingPeriodSecs(initialWaitingPeriod, { from: owner });
					});

					it('is set correctly', async () => {
						assert.bnEqual(await systemSettings.waitingPeriodSecs(), initialWaitingPeriod);
					});

					describe('a new exchange takes place', () => {
						let exchangeTransaction;

						beforeEach(async () => {
							await fastForward(await systemSettings.waitingPeriodSecs());
							exchangeTransaction = await periFinance.exchange(pUSD, amountOfSrcExchanged, pETH, {
								from: owner,
							});
						});

						it('creates a new entry', async () => {
							const { numEntries } = await exchanger.settlementOwing(owner, pETH);
							assert.bnEqual(numEntries, '1');
						});

						it('then it emits an ExchangeEntryAppended', async () => {
							const { amountReceived, exchangeFeeRate } = await exchanger.getAmountsForExchange(
								amountOfSrcExchanged,
								pUSD,
								pETH
							);
							const logs = await getDecodedLogs({
								hash: exchangeTransaction.tx,
								contracts: [
									periFinance,
									exchanger,
									pUSDContract,
									issuer,
									flexibleStorage,
									debtCache,
								],
							});
							decodedEventEqual({
								log: logs.find(({ name }) => name === 'ExchangeEntryAppended'),
								event: 'ExchangeEntryAppended',
								emittedFrom: exchanger.address,
								args: [
									owner,
									pUSD,
									amountOfSrcExchanged,
									pETH,
									amountReceived,
									exchangeFeeRate,
									new web3.utils.BN(1),
									new web3.utils.BN(2),
								],
							});
						});

						it('reverts if the user tries to settle before the waiting period has expired', async () => {
							await assert.revert(
								periFinance.settle(pETH, {
									from: owner,
								}),
								'Cannot settle during waiting period'
							);
						});

						describe('When the waiting period is set back to 0', () => {
							beforeEach(async () => {
								await systemSettings.setWaitingPeriodSecs('0', { from: owner });
							});

							it('there should be only one pETH entry', async () => {
								let numEntries = await exchangeState.getLengthOfEntries(owner, pETH);
								assert.bnEqual(numEntries, '1');
								numEntries = await exchangeState.getLengthOfEntries(owner, pEUR);
								assert.bnEqual(numEntries, '0');
							});

							describe('new trades take place', () => {
								beforeEach(async () => {
									// await fastForward(await systemSettings.waitingPeriodSecs());
									const sEthBalance = await pETHContract.balanceOf(owner);
									await periFinance.exchange(pETH, sEthBalance, pUSD, { from: owner });
									await periFinance.exchange(pUSD, toUnit('10'), pEUR, { from: owner });
								});

								it('should settle the pending exchanges and remove all entries', async () => {
									assert.bnEqual(await pETHContract.balanceOf(owner), '0');
									const { numEntries } = await exchanger.settlementOwing(owner, pETH);
									assert.bnEqual(numEntries, '0');
								});

								it('should not create any new entries', async () => {
									const { numEntries } = await exchanger.settlementOwing(owner, pEUR);
									assert.bnEqual(numEntries, '0');
								});
							});
						});
					});
				});
			});
		});
	};

	const itDeviatesCorrectly = () => {
		describe('priceDeviationThresholdFactor()', () => {
			it('the default is configured correctly', async () => {
				// Note: this only tests the effectiveness of the setup script, not the deploy script,
				assert.equal(
					await exchanger.priceDeviationThresholdFactor(),
					PRICE_DEVIATION_THRESHOLD_FACTOR
				);
			});
			describe('when a user exchanges into pETH over the default threshold factor', () => {
				beforeEach(async () => {
					await fastForward(10);
					// base rate of pETH is 100 from shared setup above
					await exchangeRates.updateRates([pETH], [toUnit('300')], await currentTime(), {
						from: oracle,
					});
					await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
				});
				it('then the pynth is suspended', async () => {
					const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
					assert.ok(suspended);
					assert.equal(reason, '65');
				});
			});
			describe('when a user exchanges into pETH under the default threshold factor', () => {
				beforeEach(async () => {
					await fastForward(10);
					// base rate of pETH is 100 from shared setup above
					await exchangeRates.updateRates([pETH], [toUnit('33')], await currentTime(), {
						from: oracle,
					});
					await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
				});
				it('then the pynth is suspended', async () => {
					const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
					assert.ok(suspended);
					assert.equal(reason, '65');
				});
			});
			describe('changing the factor works', () => {
				describe('when the factor is set to 3.1', () => {
					beforeEach(async () => {
						await systemSettings.setPriceDeviationThresholdFactor(toUnit('3.1'), { from: owner });
					});
					describe('when a user exchanges into pETH over the default threshold factor, but under the new one', () => {
						beforeEach(async () => {
							await fastForward(10);
							// base rate of pETH is 100 from shared setup above
							await exchangeRates.updateRates([pETH], [toUnit('300')], await currentTime(), {
								from: oracle,
							});
							await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
						});
						it('then the pynth is not suspended', async () => {
							const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
							assert.ok(!suspended);
							assert.equal(reason, '0');
						});
					});
					describe('when a user exchanges into pETH under the default threshold factor, but under the new one', () => {
						beforeEach(async () => {
							await fastForward(10);
							// base rate of pETH is 100 from shared setup above
							await exchangeRates.updateRates([pETH], [toUnit('33')], await currentTime(), {
								from: oracle,
							});
							await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
						});
						it('then the pynth is not suspended', async () => {
							const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
							assert.ok(!suspended);
							assert.equal(reason, '0');
						});
					});
				});
			});
		});
	};

	const itCalculatesMaxSecsLeft = () => {
		describe('maxSecsLeftInWaitingPeriod()', () => {
			describe('when the waiting period is configured to 60', () => {
				let waitingPeriodSecs;
				beforeEach(async () => {
					waitingPeriodSecs = '60';
					await systemSettings.setWaitingPeriodSecs(waitingPeriodSecs, { from: owner });
				});
				describe('when there are no exchanges', () => {
					it('then it returns 0', async () => {
						const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
						assert.equal(maxSecs, '0', 'No seconds remaining for exchange');
					});
				});
				describe('when a user with pUSD has performed an exchange into pEUR', () => {
					beforeEach(async () => {
						await periFinance.exchange(pUSD, toUnit('100'), pEUR, { from: account1 });
					});
					it('reports hasWaitingPeriodOrSettlementOwing', async () => {
						assert.isTrue(await exchanger.hasWaitingPeriodOrSettlementOwing(account1, pEUR));
					});
					it('then fetching maxSecs for that user into pEUR returns 60', async () => {
						const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
						timeIsClose({ actual: maxSecs, expected: 60, variance: 2 });
					});
					it('and fetching maxSecs for that user into the source pynth returns 0', async () => {
						const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pUSD);
						assert.equal(maxSecs, '0', 'No waiting period for src pynth');
					});
					it('and fetching maxSecs for that user into other pynths returns 0', async () => {
						let maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pBTC);
						assert.equal(maxSecs, '0', 'No waiting period for other pynth pBTC');
						maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, iBTC);
						assert.equal(maxSecs, '0', 'No waiting period for other pynth iBTC');
					});
					it('and fetching maxSec for other users into that pynth are unaffected', async () => {
						let maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, pEUR);
						assert.equal(
							maxSecs,
							'0',
							'Other user: account2 has no waiting period on dest pynth of account 1'
						);
						maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, pUSD);
						assert.equal(
							maxSecs,
							'0',
							'Other user: account2 has no waiting period on src pynth of account 1'
						);
						maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account3, pEUR);
						assert.equal(
							maxSecs,
							'0',
							'Other user: account3 has no waiting period on dest pynth of acccount 1'
						);
					});

					describe('when 55 seconds has elapsed', () => {
						beforeEach(async () => {
							await fastForward(55);
						});
						it('then it returns 5', async () => {
							const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
							timeIsClose({ actual: maxSecs, expected: 5, variance: 2 });
						});
						describe('when another user does the same exchange', () => {
							beforeEach(async () => {
								await periFinance.exchange(pUSD, toUnit('100'), pEUR, { from: account2 });
							});
							it('then it still returns 5 for the original user', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
								timeIsClose({ actual: maxSecs, expected: 5, variance: 3 });
							});
							it('and yet the new user has 60 secs', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account2, pEUR);
								timeIsClose({ actual: maxSecs, expected: 60, variance: 3 });
							});
						});
						describe('when another 5 seconds elapses', () => {
							beforeEach(async () => {
								await fastForward(5);
							});
							it('then it returns 0', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
								assert.equal(maxSecs, '0', 'No time left in waiting period');
							});
							describe('when another 10 seconds elapses', () => {
								beforeEach(async () => {
									await fastForward(10);
								});
								it('then it still returns 0', async () => {
									const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
									assert.equal(maxSecs, '0', 'No time left in waiting period');
								});
							});
						});
						describe('when the same user exchanges into the new pynth', () => {
							beforeEach(async () => {
								await periFinance.exchange(pUSD, toUnit('100'), pEUR, { from: account1 });
							});
							it('then the secs remaining returns 60 again', async () => {
								const maxSecs = await exchanger.maxSecsLeftInWaitingPeriod(account1, pEUR);
								timeIsClose({ actual: maxSecs, expected: 60, variance: 2 });
							});
						});
					});
				});
			});
		});
	};

	const itCalculatesFeeRateForExchange = () => {
		describe('Given exchangeFeeRates are configured and when calling feeRateForExchange()', () => {
			it('for two long pynths, returns the regular exchange fee', async () => {
				const actualFeeRate = await exchanger.feeRateForExchange(pEUR, pBTC);
				assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
			});
			it('for two inverse pynths, returns the regular exchange fee', async () => {
				const actualFeeRate = await exchanger.feeRateForExchange(iBTC, iETH);
				assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
			});
			it('for an inverse pynth and pUSD, returns the regular exchange fee', async () => {
				let actualFeeRate = await exchanger.feeRateForExchange(iBTC, pUSD);
				assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');

				actualFeeRate = await exchanger.feeRateForExchange(pUSD, iBTC);
				assert.bnEqual(actualFeeRate, exchangeFeeRate, 'Rate must be the exchange fee rate');
			});
			it('for an inverse pynth and a long pynth, returns double the regular exchange fee', async () => {
				let actualFeeRate = await exchanger.feeRateForExchange(iBTC, pEUR);
				assert.bnEqual(
					actualFeeRate,
					exchangeFeeRate.mul(new BN(2)),
					'Rate must be the exchange fee rate'
				);
				actualFeeRate = await exchanger.feeRateForExchange(pEUR, iBTC);
				assert.bnEqual(
					actualFeeRate,
					exchangeFeeRate.mul(new BN(2)),
					'Rate must be the exchange fee rate'
				);
				actualFeeRate = await exchanger.feeRateForExchange(pBTC, iBTC);
				assert.bnEqual(
					actualFeeRate,
					exchangeFeeRate.mul(new BN(2)),
					'Rate must be the exchange fee rate'
				);
				actualFeeRate = await exchanger.feeRateForExchange(iBTC, pBTC);
				assert.bnEqual(
					actualFeeRate,
					exchangeFeeRate.mul(new BN(2)),
					'Rate must be the exchange fee rate'
				);
			});
		});
	};

	const itCalculatesFeeRateForExchange2 = () => {
		describe('given exchange fee rates are configured into categories', () => {
			const bipsFX = toUnit('0.01');
			const bipsCrypto = toUnit('0.02');
			const bipsInverse = toUnit('0.03');
			beforeEach(async () => {
				await systemSettings.setExchangeFeeRateForPynths(
					[pAUD, pEUR, pETH, pBTC, iBTC],
					[bipsFX, bipsFX, bipsCrypto, bipsCrypto, bipsInverse],
					{
						from: owner,
					}
				);
			});
			describe('when calling getAmountsForExchange', () => {
				describe('and the destination is a crypto pynth', () => {
					let received;
					let destinationFee;
					let feeRate;
					beforeEach(async () => {
						await periFinance.exchange(pUSD, amountIssued, pBTC, { from: account1 });
						const { amountReceived, fee, exchangeFeeRate } = await exchanger.getAmountsForExchange(
							amountIssued,
							pUSD,
							pBTC
						);
						received = amountReceived;
						destinationFee = fee;
						feeRate = exchangeFeeRate;
					});
					it('then return the amountReceived', async () => {
						const pBTCBalance = await pBTCContract.balanceOf(account1);
						assert.bnEqual(received, pBTCBalance);
					});
					it('then return the fee', async () => {
						const effectiveValue = await exchangeRates.effectiveValue(pUSD, amountIssued, pBTC);
						assert.bnEqual(destinationFee, exchangeFeeIncurred(effectiveValue, bipsCrypto));
					});
					it('then return the feeRate', async () => {
						const exchangeFeeRate = await exchanger.feeRateForExchange(pUSD, pBTC);
						assert.bnEqual(feeRate, exchangeFeeRate);
					});
				});

				describe('and the destination is a fiat pynth', () => {
					let received;
					let destinationFee;
					let feeRate;
					beforeEach(async () => {
						await periFinance.exchange(pUSD, amountIssued, pEUR, { from: account1 });
						const { amountReceived, fee, exchangeFeeRate } = await exchanger.getAmountsForExchange(
							amountIssued,
							pUSD,
							pEUR
						);
						received = amountReceived;
						destinationFee = fee;
						feeRate = exchangeFeeRate;
					});
					it('then return the amountReceived', async () => {
						const pEURBalance = await pEURContract.balanceOf(account1);
						assert.bnEqual(received, pEURBalance);
					});
					it('then return the fee', async () => {
						const effectiveValue = await exchangeRates.effectiveValue(pUSD, amountIssued, pEUR);
						assert.bnEqual(destinationFee, exchangeFeeIncurred(effectiveValue, bipsFX));
					});
					it('then return the feeRate', async () => {
						const exchangeFeeRate = await exchanger.feeRateForExchange(pUSD, pEUR);
						assert.bnEqual(feeRate, exchangeFeeRate);
					});
				});

				describe('and the destination is an inverse pynth', () => {
					let received;
					let destinationFee;
					let feeRate;
					beforeEach(async () => {
						await periFinance.exchange(pUSD, amountIssued, iBTC, { from: account1 });
						const { amountReceived, fee, exchangeFeeRate } = await exchanger.getAmountsForExchange(
							amountIssued,
							pUSD,
							iBTC
						);
						received = amountReceived;
						destinationFee = fee;
						feeRate = exchangeFeeRate;
					});
					it('then return the amountReceived', async () => {
						const iBTCBalance = await iBTCContract.balanceOf(account1);
						assert.bnEqual(received, iBTCBalance);
					});
					it('then return the fee', async () => {
						const effectiveValue = await exchangeRates.effectiveValue(pUSD, amountIssued, iBTC);
						assert.bnEqual(destinationFee, exchangeFeeIncurred(effectiveValue, bipsInverse));
					});
					it('then return the feeRate', async () => {
						const exchangeFeeRate = await exchanger.feeRateForExchange(pUSD, iBTC);
						assert.bnEqual(feeRate, exchangeFeeRate);
					});
				});

				describe('when tripling an exchange rate', () => {
					const amount = toUnit('1000');
					const factor = toUnit('3');

					let orgininalFee;
					let orginalFeeRate;
					beforeEach(async () => {
						const { fee, exchangeFeeRate } = await exchanger.getAmountsForExchange(
							amount,
							pUSD,
							pAUD
						);
						orgininalFee = fee;
						orginalFeeRate = exchangeFeeRate;

						await systemSettings.setExchangeFeeRateForPynths(
							[pAUD],
							[multiplyDecimal(bipsFX, factor)],
							{
								from: owner,
							}
						);
					});
					it('then return the fee tripled', async () => {
						const { fee } = await exchanger.getAmountsForExchange(amount, pUSD, pAUD);
						assert.bnEqual(fee, multiplyDecimal(orgininalFee, factor));
					});
					it('then return the feeRate tripled', async () => {
						const { exchangeFeeRate } = await exchanger.getAmountsForExchange(amount, pUSD, pAUD);
						assert.bnEqual(exchangeFeeRate, multiplyDecimal(orginalFeeRate, factor));
					});
					it('then return the amountReceived less triple the fee', async () => {
						const { amountReceived } = await exchanger.getAmountsForExchange(amount, pUSD, pAUD);
						const tripleFee = multiplyDecimal(orgininalFee, factor);
						const effectiveValue = await exchangeRates.effectiveValue(pUSD, amount, pAUD);
						assert.bnEqual(amountReceived, effectiveValue.sub(tripleFee));
					});
				});
			});
		});
	};

	const exchangeFeeIncurred = (amountToExchange, exchangeFeeRate) => {
		return multiplyDecimal(amountToExchange, exchangeFeeRate);
	};

	const amountAfterExchangeFee = ({ amount }) => {
		return multiplyDecimal(amount, toUnit('1').sub(exchangeFeeRate));
	};

	const calculateExpectedSettlementAmount = ({ amount, oldRate, newRate }) => {
		// Note: exchangeFeeRate is in a parent scope. Tests may mutate it in beforeEach and
		// be assured that this function, when called in a test, will use that mutated value
		const result = multiplyDecimal(amountAfterExchangeFee({ amount }), oldRate.sub(newRate));
		return {
			reclaimAmount: result.isNeg() ? new web3.utils.BN(0) : result,
			rebateAmount: result.isNeg() ? result.abs() : new web3.utils.BN(0),
		};
	};

	/**
	 * Ensure a settle() transaction emits the expected events
	 */
	const ensureTxnEmitsSettlementEvents = async ({ hash, pynth, expected }) => {
		// Get receipt to collect all transaction events
		const logs = await getDecodedLogs({ hash, contracts: [periFinance, exchanger, pUSDContract] });

		const currencyKey = await pynth.currencyKey();
		// Can only either be reclaim or rebate - not both
		const isReclaim = !expected.reclaimAmount.isZero();
		const expectedAmount = isReclaim ? expected.reclaimAmount : expected.rebateAmount;

		const eventName = `Exchange${isReclaim ? 'Reclaim' : 'Rebate'}`;
		decodedEventEqual({
			log: logs.find(({ name }) => name === eventName), // logs[0] is individual reclaim/rebate events, logs[1] is either an Issued or Burned event
			event: eventName,
			emittedFrom: await periFinance.proxy(),
			args: [account1, currencyKey, expectedAmount],
			bnCloseVariance,
		});

		// return all logs for any other usage
		return logs;
	};

	const itSettles = () => {
		describe('settlement', () => {
			describe('suspension conditions', () => {
				const pynth = pETH;
				['System', 'Pynth'].forEach(section => {
					describe(`when ${section} is suspended`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: true, pynth });
						});
						it('then calling settle() reverts', async () => {
							await assert.revert(
								periFinance.settle(pETH, { from: account1 }),
								'Operation prohibited'
							);
						});
						describe(`when ${section} is resumed`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: false, pynth });
							});
							it('then calling exchange() succeeds', async () => {
								await periFinance.settle(pETH, { from: account1 });
							});
						});
					});
				});
				describe('when Pynth(pBTC) is suspended', () => {
					beforeEach(async () => {
						await setStatus({ owner, systemStatus, section: 'Pynth', suspend: true, pynth: pBTC });
					});
					it('then settling other pynths still works', async () => {
						await periFinance.settle(pETH, { from: account1 });
						await periFinance.settle(pAUD, { from: account2 });
					});
				});
				describe('when Pynth(pBTC) is suspended for exchanging', () => {
					beforeEach(async () => {
						await setStatus({
							owner,
							systemStatus,
							section: 'PynthExchange',
							suspend: true,
							pynth: pBTC,
						});
					});
					it('then settling it still works', async () => {
						await periFinance.settle(pBTC, { from: account1 });
					});
				});
			});
			describe('given the pEUR rate is 2, and pETH is 100, pBTC is 9000', () => {
				beforeEach(async () => {
					// set pUSD:pEUR as 2:1, pUSD:pETH at 100:1, pUSD:pBTC at 9000:1
					await exchangeRates.updateRates(
						[pEUR, pETH, pBTC],
						['2', '100', '9000'].map(toUnit),
						timestamp,
						{
							from: oracle,
						}
					);
				});
				describe('and the exchange fee rate is 1% for easier human consumption', () => {
					beforeEach(async () => {
						// Warning: this is mutating the global exchangeFeeRate for this test block and will be reset when out of scope
						exchangeFeeRate = toUnit('0.01');
						await setExchangeFeeRateForPynths({
							owner,
							systemSettings,
							pynthKeys,
							exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
						});
					});
					describe('and the waitingPeriodSecs is set to 60', () => {
						beforeEach(async () => {
							await systemSettings.setWaitingPeriodSecs('60', { from: owner });
						});
						describe('various rebate & reclaim scenarios', () => {
							describe('and the priceDeviationThresholdFactor is set to a factor of 2.5', () => {
								beforeEach(async () => {
									// prevent circuit breaker from firing for doubling or halving rates by upping the threshold difference to 2.5
									await systemSettings.setPriceDeviationThresholdFactor(toUnit('2.5'), {
										from: owner,
									});
								});
								describe('when the first user exchanges 100 pUSD into pUSD:pEUR at 2:1', () => {
									let amountOfSrcExchanged;
									let exchangeTime;
									let exchangeTransaction;
									beforeEach(async () => {
										amountOfSrcExchanged = toUnit('100');
										exchangeTime = await currentTime();
										exchangeTransaction = await periFinance.exchange(
											pUSD,
											amountOfSrcExchanged,
											pEUR,
											{
												from: account1,
											}
										);

										const {
											amountReceived,
											exchangeFeeRate,
										} = await exchanger.getAmountsForExchange(amountOfSrcExchanged, pUSD, pEUR);

										const logs = await getDecodedLogs({
											hash: exchangeTransaction.tx,
											contracts: [
												periFinance,
												exchanger,
												pUSDContract,
												issuer,
												flexibleStorage,
												debtCache,
											],
										});

										// ExchangeEntryAppended is emitted for exchange
										decodedEventEqual({
											log: logs.find(({ name }) => name === 'ExchangeEntryAppended'),
											event: 'ExchangeEntryAppended',
											emittedFrom: exchanger.address,
											args: [
												account1,
												pUSD,
												amountOfSrcExchanged,
												pEUR,
												amountReceived,
												exchangeFeeRate,
												new web3.utils.BN(1),
												new web3.utils.BN(2),
											],
											bnCloseVariance,
										});
									});
									it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
										const settlement = await exchanger.settlementOwing(account1, pEUR);
										assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
										assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
										assert.equal(
											settlement.numEntries,
											'1',
											'Must be one entry in the settlement queue'
										);
									});
									describe('when settle() is invoked on pEUR', () => {
										it('then it reverts as the waiting period has not ended', async () => {
											await assert.revert(
												periFinance.settle(pEUR, { from: account1 }),
												'Cannot settle during waiting period'
											);
										});
									});
									it('when pEUR is attempted to be exchanged away by the user, it reverts', async () => {
										await assert.revert(
											periFinance.exchange(pEUR, toUnit('1'), pBTC, { from: account1 }),
											'Cannot settle during waiting period'
										);
									});

									describe('when settle() is invoked on the src pynth - pUSD', () => {
										it('then it completes with no reclaim or rebate', async () => {
											const txn = await periFinance.settle(pUSD, {
												from: account1,
											});
											assert.equal(
												txn.logs.length,
												0,
												'Must not emit any events as no settlement required'
											);
										});
									});
									describe('when settle() is invoked on pEUR by another user', () => {
										it('then it completes with no reclaim or rebate', async () => {
											const txn = await periFinance.settle(pEUR, {
												from: account2,
											});
											assert.equal(
												txn.logs.length,
												0,
												'Must not emit any events as no settlement required'
											);
										});
									});
									describe('when the price doubles for pUSD:pEUR to 4:1', () => {
										beforeEach(async () => {
											await fastForward(5);
											timestamp = await currentTime();

											await exchangeRates.updateRates([pEUR], ['4'].map(toUnit), timestamp, {
												from: oracle,
											});
										});
										it('then settlement reclaimAmount shows a reclaim of half the entire balance of pEUR', async () => {
											const expected = calculateExpectedSettlementAmount({
												amount: amountOfSrcExchanged,
												oldRate: divideDecimal(1, 2),
												newRate: divideDecimal(1, 4),
											});

											const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
												account1,
												pEUR
											);

											assert.bnEqual(rebateAmount, expected.rebateAmount);
											assert.bnEqual(reclaimAmount, expected.reclaimAmount);
										});
										describe('when settle() is invoked', () => {
											it('then it reverts as the waiting period has not ended', async () => {
												await assert.revert(
													periFinance.settle(pEUR, { from: account1 }),
													'Cannot settle during waiting period'
												);
											});
										});
										describe('when another minute passes', () => {
											let expectedSettlement;
											let srcBalanceBeforeExchange;

											beforeEach(async () => {
												await fastForward(60);
												srcBalanceBeforeExchange = await pEURContract.balanceOf(account1);

												expectedSettlement = calculateExpectedSettlementAmount({
													amount: amountOfSrcExchanged,
													oldRate: divideDecimal(1, 2),
													newRate: divideDecimal(1, 4),
												});
											});
											describe('when settle() is invoked', () => {
												let transaction;
												beforeEach(async () => {
													transaction = await periFinance.settle(pEUR, {
														from: account1,
													});
												});
												it('then it settles with a reclaim', async () => {
													await ensureTxnEmitsSettlementEvents({
														hash: transaction.tx,
														pynth: pEURContract,
														expected: expectedSettlement,
													});
												});
												it('then it settles with a ExchangeEntrySettled event with reclaim', async () => {
													const logs = await getDecodedLogs({
														hash: transaction.tx,
														contracts: [periFinance, exchanger, pUSDContract],
													});

													decodedEventEqual({
														log: logs.find(({ name }) => name === 'ExchangeEntrySettled'),
														event: 'ExchangeEntrySettled',
														emittedFrom: exchanger.address,
														args: [
															account1,
															pUSD,
															amountOfSrcExchanged,
															pEUR,
															expectedSettlement.reclaimAmount,
															new web3.utils.BN(0),
															new web3.utils.BN(1),
															new web3.utils.BN(3),
															exchangeTime + 1,
														],
														bnCloseVariance,
													});
												});
											});
											describe('when settle() is invoked and the exchange fee rate has changed', () => {
												beforeEach(async () => {
													systemSettings.setExchangeFeeRateForPynths([pBTC], [toUnit('0.1')], {
														from: owner,
													});
												});
												it('then it settles with a reclaim', async () => {
													const { tx: hash } = await periFinance.settle(pEUR, {
														from: account1,
													});
													await ensureTxnEmitsSettlementEvents({
														hash,
														pynth: pEURContract,
														expected: expectedSettlement,
													});
												});
											});

											// The user has ~49.5 pEUR and has a reclaim of ~24.75 - so 24.75 after settlement
											describe(
												'when an exchange out of pEUR for more than the balance after settlement,' +
													'but less than the total initially',
												() => {
													let txn;
													beforeEach(async () => {
														txn = await periFinance.exchange(pEUR, toUnit('30'), pBTC, {
															from: account1,
														});
													});
													it('then it succeeds, exchanging the entire amount after settlement', async () => {
														const srcBalanceAfterExchange = await pEURContract.balanceOf(account1);
														assert.equal(srcBalanceAfterExchange, '0');

														const decodedLogs = await ensureTxnEmitsSettlementEvents({
															hash: txn.tx,
															pynth: pEURContract,
															expected: expectedSettlement,
														});

														decodedEventEqual({
															log: decodedLogs.find(({ name }) => name === 'PynthExchange'),
															event: 'PynthExchange',
															emittedFrom: await periFinance.proxy(),
															args: [
																account1,
																pEUR,
																srcBalanceBeforeExchange.sub(expectedSettlement.reclaimAmount),
																pBTC,
															],
														});
													});
												}
											);

											describe(
												'when an exchange out of pEUR for more than the balance after settlement,' +
													'and more than the total initially and the exchangefee rate changed',
												() => {
													let txn;
													beforeEach(async () => {
														txn = await periFinance.exchange(pEUR, toUnit('50'), pBTC, {
															from: account1,
														});
														systemSettings.setExchangeFeeRateForPynths([pBTC], [toUnit('0.1')], {
															from: owner,
														});
													});
													it('then it succeeds, exchanging the entire amount after settlement', async () => {
														const srcBalanceAfterExchange = await pEURContract.balanceOf(account1);
														assert.equal(srcBalanceAfterExchange, '0');

														const decodedLogs = await ensureTxnEmitsSettlementEvents({
															hash: txn.tx,
															pynth: pEURContract,
															expected: expectedSettlement,
														});

														decodedEventEqual({
															log: decodedLogs.find(({ name }) => name === 'PynthExchange'),
															event: 'PynthExchange',
															emittedFrom: await periFinance.proxy(),
															args: [
																account1,
																pEUR,
																srcBalanceBeforeExchange.sub(expectedSettlement.reclaimAmount),
																pBTC,
															],
														});
													});
												}
											);

											describe('when an exchange out of pEUR for less than the balance after settlement', () => {
												let newAmountToExchange;
												let txn;
												beforeEach(async () => {
													newAmountToExchange = toUnit('10');
													txn = await periFinance.exchange(pEUR, newAmountToExchange, pBTC, {
														from: account1,
													});
												});
												it('then it succeeds, exchanging the amount given', async () => {
													const srcBalanceAfterExchange = await pEURContract.balanceOf(account1);

													assert.bnClose(
														srcBalanceAfterExchange,
														srcBalanceBeforeExchange
															.sub(expectedSettlement.reclaimAmount)
															.sub(newAmountToExchange)
													);

													const decodedLogs = await ensureTxnEmitsSettlementEvents({
														hash: txn.tx,
														pynth: pEURContract,
														expected: expectedSettlement,
													});

													decodedEventEqual({
														log: decodedLogs.find(({ name }) => name === 'PynthExchange'),
														event: 'PynthExchange',
														emittedFrom: await periFinance.proxy(),
														args: [account1, pEUR, newAmountToExchange, pBTC], // amount to exchange must be the reclaim amount
													});
												});
											});
										});
									});
									describe('when the price halves for pUSD:pEUR to 1:1', () => {
										beforeEach(async () => {
											await fastForward(5);

											timestamp = await currentTime();

											await exchangeRates.updateRates([pEUR], ['1'].map(toUnit), timestamp, {
												from: oracle,
											});
										});
										it('then settlement rebateAmount shows a rebate of half the entire balance of pEUR', async () => {
											const expected = calculateExpectedSettlementAmount({
												amount: amountOfSrcExchanged,
												oldRate: divideDecimal(1, 2),
												newRate: divideDecimal(1, 1),
											});

											const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
												account1,
												pEUR
											);

											assert.bnEqual(rebateAmount, expected.rebateAmount);
											assert.bnEqual(reclaimAmount, expected.reclaimAmount);
										});
										describe('when the user makes a 2nd exchange of 100 pUSD into pUSD:pEUR at 1:1', () => {
											beforeEach(async () => {
												// fast forward 60 seconds so 1st exchange is using first rate
												await fastForward(60);

												await periFinance.exchange(pUSD, amountOfSrcExchanged, pEUR, {
													from: account1,
												});
											});
											describe('and then the price increases for pUSD:pEUR to 2:1', () => {
												beforeEach(async () => {
													await fastForward(5);

													timestamp = await currentTime();

													await exchangeRates.updateRates([pEUR], ['2'].map(toUnit), timestamp, {
														from: oracle,
													});
												});
												describe('when settlement is invoked', () => {
													describe('when another minute passes', () => {
														let expectedSettlementReclaim;
														let expectedSettlementRebate;
														beforeEach(async () => {
															await fastForward(60);

															expectedSettlementRebate = calculateExpectedSettlementAmount({
																amount: amountOfSrcExchanged,
																oldRate: divideDecimal(1, 2),
																newRate: divideDecimal(1, 1),
															});

															expectedSettlementReclaim = calculateExpectedSettlementAmount({
																amount: amountOfSrcExchanged,
																oldRate: divideDecimal(1, 1),
																newRate: divideDecimal(1, 2),
															});
														});

														describe('when settle() is invoked', () => {
															let transaction;
															beforeEach(async () => {
																transaction = await periFinance.settle(pEUR, {
																	from: account1,
																});
															});
															it('then it settles with two ExchangeEntrySettled events one for reclaim and one for rebate', async () => {
																const logs = await getDecodedLogs({
																	hash: transaction.tx,
																	contracts: [periFinance, exchanger, pUSDContract],
																});

																// check the rebate event first
																decodedEventEqual({
																	log: logs.filter(
																		({ name }) => name === 'ExchangeEntrySettled'
																	)[0],
																	event: 'ExchangeEntrySettled',
																	emittedFrom: exchanger.address,
																	args: [
																		account1,
																		pUSD,
																		amountOfSrcExchanged,
																		pEUR,
																		new web3.utils.BN(0),
																		expectedSettlementRebate.rebateAmount,
																		new web3.utils.BN(1),
																		new web3.utils.BN(2),
																		exchangeTime + 1,
																	],
																	bnCloseVariance,
																});

																// check the reclaim event
																decodedEventEqual({
																	log: logs.filter(
																		({ name }) => name === 'ExchangeEntrySettled'
																	)[1],
																	event: 'ExchangeEntrySettled',
																	emittedFrom: exchanger.address,
																	args: [
																		account1,
																		pUSD,
																		amountOfSrcExchanged,
																		pEUR,
																		expectedSettlementReclaim.reclaimAmount,
																		new web3.utils.BN(0),
																		new web3.utils.BN(1),
																		new web3.utils.BN(2),
																	],
																	bnCloseVariance,
																});
															});
														});
													});
												});
											});
										});
										describe('when settlement is invoked', () => {
											it('then it reverts as the waiting period has not ended', async () => {
												await assert.revert(
													periFinance.settle(pEUR, { from: account1 }),
													'Cannot settle during waiting period'
												);
											});
											describe('when another minute passes', () => {
												let expectedSettlement;
												let srcBalanceBeforeExchange;

												beforeEach(async () => {
													await fastForward(60);
													srcBalanceBeforeExchange = await pEURContract.balanceOf(account1);

													expectedSettlement = calculateExpectedSettlementAmount({
														amount: amountOfSrcExchanged,
														oldRate: divideDecimal(1, 2),
														newRate: divideDecimal(1, 1),
													});
												});

												describe('when settle() is invoked', () => {
													let transaction;
													beforeEach(async () => {
														transaction = await periFinance.settle(pEUR, {
															from: account1,
														});
													});
													it('then it settles with a rebate', async () => {
														await ensureTxnEmitsSettlementEvents({
															hash: transaction.tx,
															pynth: pEURContract,
															expected: expectedSettlement,
														});
													});
													it('then it settles with a ExchangeEntrySettled event with rebate', async () => {
														const logs = await getDecodedLogs({
															hash: transaction.tx,
															contracts: [periFinance, exchanger, pUSDContract],
														});

														decodedEventEqual({
															log: logs.find(({ name }) => name === 'ExchangeEntrySettled'),
															event: 'ExchangeEntrySettled',
															emittedFrom: exchanger.address,
															args: [
																account1,
																pUSD,
																amountOfSrcExchanged,
																pEUR,
																new web3.utils.BN(0),
																expectedSettlement.rebateAmount,
																new web3.utils.BN(1),
																new web3.utils.BN(2),
																exchangeTime + 1,
															],
															bnCloseVariance,
														});
													});
												});

												// The user has 49.5 pEUR and has a rebate of 49.5 - so 99 after settlement
												describe('when an exchange out of pEUR for their expected balance before exchange', () => {
													let txn;
													beforeEach(async () => {
														txn = await periFinance.exchange(pEUR, toUnit('49.5'), pBTC, {
															from: account1,
														});
													});
													it('then it succeeds, exchanging the entire amount plus the rebate', async () => {
														const srcBalanceAfterExchange = await pEURContract.balanceOf(account1);
														assert.equal(srcBalanceAfterExchange, '0');

														const decodedLogs = await ensureTxnEmitsSettlementEvents({
															hash: txn.tx,
															pynth: pEURContract,
															expected: expectedSettlement,
														});

														decodedEventEqual({
															log: decodedLogs.find(({ name }) => name === 'PynthExchange'),
															event: 'PynthExchange',
															emittedFrom: await periFinance.proxy(),
															args: [
																account1,
																pEUR,
																srcBalanceBeforeExchange.add(expectedSettlement.rebateAmount),
																pBTC,
															],
														});
													});
												});

												describe('when an exchange out of pEUR for some amount less than their balance before exchange', () => {
													let txn;
													beforeEach(async () => {
														txn = await periFinance.exchange(pEUR, toUnit('10'), pBTC, {
															from: account1,
														});
													});
													it('then it succeeds, exchanging the amount plus the rebate', async () => {
														const decodedLogs = await ensureTxnEmitsSettlementEvents({
															hash: txn.tx,
															pynth: pEURContract,
															expected: expectedSettlement,
														});

														decodedEventEqual({
															log: decodedLogs.find(({ name }) => name === 'PynthExchange'),
															event: 'PynthExchange',
															emittedFrom: await periFinance.proxy(),
															args: [
																account1,
																pEUR,
																toUnit('10').add(expectedSettlement.rebateAmount),
																pBTC,
															],
														});
													});
												});
											});
										});
										describe('when the price returns to pUSD:pEUR to 2:1', () => {
											beforeEach(async () => {
												await fastForward(12);

												timestamp = await currentTime();

												await exchangeRates.updateRates([pEUR], ['2'].map(toUnit), timestamp, {
													from: oracle,
												});
											});
											it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
												const settlement = await exchanger.settlementOwing(account1, pEUR);
												assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
												assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
											});
											describe('when another minute elapses and the pETH price changes', () => {
												beforeEach(async () => {
													await fastForward(60);
													timestamp = await currentTime();

													await exchangeRates.updateRates([pEUR], ['3'].map(toUnit), timestamp, {
														from: oracle,
													});
												});
												it('then settlement reclaimAmount still shows 0 reclaim and 0 refund as the timeout period ended', async () => {
													const settlement = await exchanger.settlementOwing(account1, pEUR);
													assert.equal(
														settlement.reclaimAmount,
														'0',
														'Nothing can be reclaimAmount'
													);
													assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
												});
												describe('when settle() is invoked', () => {
													it('then it settles with no reclaim or rebate', async () => {
														const txn = await periFinance.settle(pEUR, {
															from: account1,
														});
														assert.equal(
															txn.logs.length,
															0,
															'Must not emit any events as no settlement required'
														);
													});
												});
											});
										});
									});
								});
								describe('given the first user has 1000 pEUR', () => {
									beforeEach(async () => {
										await pEURContract.issue(account1, toUnit('1000'));
									});
									describe('when the first user exchanges 100 pEUR into pEUR:pBTC at 9000:2', () => {
										let amountOfSrcExchanged;
										beforeEach(async () => {
											amountOfSrcExchanged = toUnit('100');
											await periFinance.exchange(pEUR, amountOfSrcExchanged, pBTC, {
												from: account1,
											});
										});
										it('then settlement reclaimAmount shows 0 reclaim and 0 refund', async () => {
											const settlement = await exchanger.settlementOwing(account1, pBTC);
											assert.equal(settlement.reclaimAmount, '0', 'Nothing can be reclaimAmount');
											assert.equal(settlement.rebateAmount, '0', 'Nothing can be rebateAmount');
											assert.equal(
												settlement.numEntries,
												'1',
												'Must be one entry in the settlement queue'
											);
										});
										describe('when the price doubles for pUSD:pEUR to 4:1', () => {
											beforeEach(async () => {
												await fastForward(5);
												timestamp = await currentTime();

												await exchangeRates.updateRates([pEUR], ['4'].map(toUnit), timestamp, {
													from: oracle,
												});
											});
											it('then settlement shows a rebate rebateAmount', async () => {
												const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
													account1,
													pBTC
												);

												const expected = calculateExpectedSettlementAmount({
													amount: amountOfSrcExchanged,
													oldRate: divideDecimal(2, 9000),
													newRate: divideDecimal(4, 9000),
												});

												assert.bnClose(rebateAmount, expected.rebateAmount, bnCloseVariance);
												assert.bnEqual(reclaimAmount, expected.reclaimAmount);
											});
											describe('when settlement is invoked', () => {
												it('then it reverts as the waiting period has not ended', async () => {
													await assert.revert(
														periFinance.settle(pBTC, { from: account1 }),
														'Cannot settle during waiting period'
													);
												});
											});
											describe('when the price gains for pBTC more than the loss of the pEUR change', () => {
												beforeEach(async () => {
													await fastForward(5);
													timestamp = await currentTime();
													await exchangeRates.updateRates(
														[pBTC],
														['20000'].map(toUnit),
														timestamp,
														{
															from: oracle,
														}
													);
												});
												it('then the reclaimAmount is whats left when subtracting the rebate', async () => {
													const { reclaimAmount, rebateAmount } = await exchanger.settlementOwing(
														account1,
														pBTC
													);

													const expected = calculateExpectedSettlementAmount({
														amount: amountOfSrcExchanged,
														oldRate: divideDecimal(2, 9000),
														newRate: divideDecimal(4, 20000),
													});

													assert.bnEqual(rebateAmount, expected.rebateAmount);
													assert.bnClose(reclaimAmount, expected.reclaimAmount, bnCloseVariance);
												});
												describe('when the same user exchanges some pUSD into pBTC - the same destination', () => {
													let amountOfSrcExchangedSecondary;
													beforeEach(async () => {
														amountOfSrcExchangedSecondary = toUnit('10');
														await periFinance.exchange(pUSD, amountOfSrcExchangedSecondary, pBTC, {
															from: account1,
														});
													});
													it('then the reclaimAmount is unchanged', async () => {
														const {
															reclaimAmount,
															rebateAmount,
															numEntries,
														} = await exchanger.settlementOwing(account1, pBTC);

														const expected = calculateExpectedSettlementAmount({
															amount: amountOfSrcExchanged,
															oldRate: divideDecimal(2, 9000),
															newRate: divideDecimal(4, 20000),
														});

														assert.bnEqual(rebateAmount, expected.rebateAmount);
														assert.bnClose(reclaimAmount, expected.reclaimAmount, bnCloseVariance);
														assert.equal(
															numEntries,
															'2',
															'Must be two entries in the settlement queue'
														);
													});
													describe('when the price of pBTC lowers, turning the profit to a loss', () => {
														let expectedFromFirst;
														let expectedFromSecond;
														beforeEach(async () => {
															await fastForward(5);
															timestamp = await currentTime();

															await exchangeRates.updateRates(
																[pBTC],
																['10000'].map(toUnit),
																timestamp,
																{
																	from: oracle,
																}
															);

															expectedFromFirst = calculateExpectedSettlementAmount({
																amount: amountOfSrcExchanged,
																oldRate: divideDecimal(2, 9000),
																newRate: divideDecimal(4, 10000),
															});
															expectedFromSecond = calculateExpectedSettlementAmount({
																amount: amountOfSrcExchangedSecondary,
																oldRate: divideDecimal(1, 20000),
																newRate: divideDecimal(1, 10000),
															});
														});
														it('then the rebateAmount calculation of settlementOwing on pBTC includes both exchanges', async () => {
															const {
																reclaimAmount,
																rebateAmount,
															} = await exchanger.settlementOwing(account1, pBTC);

															assert.equal(reclaimAmount, '0');

															assert.bnClose(
																rebateAmount,
																expectedFromFirst.rebateAmount.add(expectedFromSecond.rebateAmount),
																bnCloseVariance
															);
														});
														describe('when another minute passes', () => {
															beforeEach(async () => {
																await fastForward(60);
															});
															describe('when settle() is invoked for pBTC', () => {
																it('then it settles with a rebate @gasprofile', async () => {
																	const txn = await periFinance.settle(pBTC, {
																		from: account1,
																	});

																	await ensureTxnEmitsSettlementEvents({
																		hash: txn.tx,
																		pynth: pBTCContract,
																		expected: {
																			reclaimAmount: new web3.utils.BN(0),
																			rebateAmount: expectedFromFirst.rebateAmount.add(
																				expectedFromSecond.rebateAmount
																			),
																		},
																	});
																});
															});
														});
														describe('when another minute passes and the exchange fee rate has increased', () => {
															beforeEach(async () => {
																await fastForward(60);
																systemSettings.setExchangeFeeRateForPynths(
																	[pBTC],
																	[toUnit('0.1')],
																	{
																		from: owner,
																	}
																);
															});
															describe('when settle() is invoked for pBTC', () => {
																it('then it settles with a rebate using the exchange fee rate at time of trade', async () => {
																	const { tx: hash } = await periFinance.settle(pBTC, {
																		from: account1,
																	});

																	await ensureTxnEmitsSettlementEvents({
																		hash,
																		pynth: pBTCContract,
																		expected: {
																			reclaimAmount: new web3.utils.BN(0),
																			rebateAmount: expectedFromFirst.rebateAmount.add(
																				expectedFromSecond.rebateAmount
																			),
																		},
																	});
																});
															});
														});
													});
												});
											});
										});
									});

									describe('and the max number of exchange entries is 5', () => {
										beforeEach(async () => {
											await exchangeState.setMaxEntriesInQueue('5', { from: owner });
										});
										describe('when a user tries to exchange 100 pEUR into pBTC 5 times', () => {
											beforeEach(async () => {
												const txns = [];
												for (let i = 0; i < 5; i++) {
													txns.push(
														await periFinance.exchange(pEUR, toUnit('100'), pBTC, {
															from: account1,
														})
													);
												}
											});
											it('then all succeed', () => {});
											it('when one more is tried, then if fails', async () => {
												await assert.revert(
													periFinance.exchange(pEUR, toUnit('100'), pBTC, { from: account1 }),
													'Max queue length reached'
												);
											});
											describe('when more than 60s elapses', () => {
												beforeEach(async () => {
													await fastForward(70);
												});
												describe('and the user invokes settle() on the dest pynth', () => {
													beforeEach(async () => {
														await periFinance.settle(pBTC, { from: account1 });
													});
													it('then when the user performs 5 more exchanges into the same pynth, it succeeds', async () => {
														for (let i = 0; i < 5; i++) {
															await periFinance.exchange(pEUR, toUnit('100'), pBTC, {
																from: account1,
															});
														}
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
			});
		});
	};

	const itCalculatesAmountAfterSettlement = () => {
		describe('calculateAmountAfterSettlement()', () => {
			describe('given a user has 1000 pEUR', () => {
				beforeEach(async () => {
					await pEURContract.issue(account1, toUnit('1000'));
				});
				describe('when calculatAmountAfterSettlement is invoked with and amount < 1000 and no refund', () => {
					let response;
					beforeEach(async () => {
						response = await exchanger.calculateAmountAfterSettlement(
							account1,
							pEUR,
							toUnit('500'),
							'0'
						);
					});
					it('then the response is the given amount of 500', () => {
						assert.bnEqual(response, toUnit('500'));
					});
				});
				describe('when calculatAmountAfterSettlement is invoked with and amount < 1000 and a refund', () => {
					let response;
					beforeEach(async () => {
						response = await exchanger.calculateAmountAfterSettlement(
							account1,
							pEUR,
							toUnit('500'),
							toUnit('25')
						);
					});
					it('then the response is the given amount of 500 plus the refund', () => {
						assert.bnEqual(response, toUnit('525'));
					});
				});
				describe('when calculatAmountAfterSettlement is invoked with and amount > 1000 and no refund', () => {
					let response;
					beforeEach(async () => {
						response = await exchanger.calculateAmountAfterSettlement(
							account1,
							pEUR,
							toUnit('1200'),
							'0'
						);
					});
					it('then the response is the balance of 1000', () => {
						assert.bnEqual(response, toUnit('1000'));
					});
				});
				describe('when calculatAmountAfterSettlement is invoked with and amount > 1000 and a refund', () => {
					let response;
					beforeEach(async () => {
						response = await exchanger.calculateAmountAfterSettlement(
							account1,
							pEUR,
							toUnit('1200'),
							toUnit('50')
						);
					});
					it('then the response is the given amount of 1000 plus the refund', () => {
						assert.bnEqual(response, toUnit('1050'));
					});
				});
			});
		});
	};

	const itExchanges = () => {
		describe('exchange()', () => {
			it('exchange() cannot be invoked directly by any account', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: exchanger.exchange,
					accounts,
					args: [account1, pUSD, toUnit('100'), pAUD, account1],
					reason: 'Only periFinance or a pynth contract can perform this action',
				});
			});

			describe('suspension conditions on PeriFinance.exchange()', () => {
				const pynth = pETH;
				['System', 'Exchange', 'PynthExchange', 'Pynth'].forEach(section => {
					describe(`when ${section} is suspended`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: true, pynth });
						});
						it('then calling exchange() reverts', async () => {
							await assert.revert(
								periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 }),
								'Operation prohibited'
							);
						});
						describe(`when ${section} is resumed`, () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section, suspend: false, pynth });
							});
							it('then calling exchange() succeeds', async () => {
								await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
							});
						});
					});
				});
				describe('when Pynth(pBTC) is suspended', () => {
					beforeEach(async () => {
						// issue pAUD to test non-pUSD exchanges
						await pAUDContract.issue(account2, toUnit('100'));

						await setStatus({ owner, systemStatus, section: 'Pynth', suspend: true, pynth: pBTC });
					});
					it('then exchanging other pynths still works', async () => {
						await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
						await periFinance.exchange(pAUD, toUnit('1'), pETH, { from: account2 });
					});
				});
			});

			it('exchangeWithTracking() cannot be invoked directly by any account via Exchanger', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: exchanger.exchangeWithTracking,
					accounts,
					args: [account1, pUSD, toUnit('100'), pAUD, account2, account3, trackingCode],
					reason: 'Only periFinance or a pynth contract can perform this action',
				});
			});

			describe('various exchange scenarios', () => {
				describe('when a user has 1000 pUSD', () => {
					// already issued in the top-level beforeEach

					it('should allow a user to exchange the pynths they hold in one flavour for another', async () => {
						// Exchange pUSD to pAUD
						await periFinance.exchange(pUSD, amountIssued, pAUD, { from: account1 });

						// Get the exchange amounts
						const {
							amountReceived,
							fee,
							exchangeFeeRate: feeRate,
						} = await exchanger.getAmountsForExchange(amountIssued, pUSD, pAUD);

						// Assert we have the correct AUD value - exchange fee
						const pAUDBalance = await pAUDContract.balanceOf(account1);
						assert.bnEqual(amountReceived, pAUDBalance);

						// Assert we have the exchange fee to distribute
						const feePeriodZero = await feePool.recentFeePeriods(0);
						const usdFeeAmount = await exchangeRates.effectiveValue(pAUD, fee, pUSD);
						assert.bnEqual(usdFeeAmount, feePeriodZero.feesToDistribute);

						assert.bnEqual(feeRate, exchangeFeeRate);
					});

					it('should emit a PynthExchange event @gasprofile', async () => {
						// Exchange pUSD to pAUD
						const txn = await periFinance.exchange(pUSD, amountIssued, pAUD, {
							from: account1,
						});

						const pAUDBalance = await pAUDContract.balanceOf(account1);

						const pynthExchangeEvent = txn.logs.find(log => log.event === 'PynthExchange');
						assert.eventEqual(pynthExchangeEvent, 'PynthExchange', {
							account: account1,
							fromCurrencyKey: toBytes32('pUSD'),
							fromAmount: amountIssued,
							toCurrencyKey: toBytes32('pAUD'),
							toAmount: pAUDBalance,
							toAddress: account1,
						});
					});

					it('should emit an ExchangeTracking event @gasprofile', async () => {
						// Exchange pUSD to pAUD
						const txn = await periFinance.exchangeWithTracking(
							pUSD,
							amountIssued,
							pAUD,
							account1,
							trackingCode,
							{
								from: account1,
							}
						);

						const pAUDBalance = await pAUDContract.balanceOf(account1);

						const pynthExchangeEvent = txn.logs.find(log => log.event === 'PynthExchange');
						assert.eventEqual(pynthExchangeEvent, 'PynthExchange', {
							account: account1,
							fromCurrencyKey: toBytes32('pUSD'),
							fromAmount: amountIssued,
							toCurrencyKey: toBytes32('pAUD'),
							toAmount: pAUDBalance,
							toAddress: account1,
						});

						const trackingEvent = txn.logs.find(log => log.event === 'ExchangeTracking');
						assert.eventEqual(trackingEvent, 'ExchangeTracking', {
							trackingCode,
							toCurrencyKey: toBytes32('pAUD'),
							toAmount: pAUDBalance,
						});
					});

					it('when a user tries to exchange more than they have, then it fails', async () => {
						await assert.revert(
							periFinance.exchange(pAUD, toUnit('1'), pUSD, {
								from: account1,
							}),
							'SafeMath: subtraction overflow'
						);
					});

					it('when a user tries to exchange more than they have, then it fails', async () => {
						await assert.revert(
							periFinance.exchange(pUSD, toUnit('1001'), pAUD, {
								from: account1,
							}),
							'SafeMath: subtraction overflow'
						);
					});

					[
						'exchange',
						'exchangeOnBehalf',
						'exchangeWithTracking',
						'exchangeOnBehalfWithTracking',
					].forEach(type => {
						describe(`rate stale scenarios for ${type}`, () => {
							const exchange = ({ from, to, amount }) => {
								if (type === 'exchange')
									return periFinance.exchange(from, amount, to, { from: account1 });
								else if (type === 'exchangeOnBehalf')
									return periFinance.exchangeOnBehalf(account1, from, amount, to, {
										from: account2,
									});
								if (type === 'exchangeWithTracking')
									return periFinance.exchangeWithTracking(
										from,
										amount,
										to,
										account1,
										trackingCode,
										{
											from: account1,
										}
									);
								else if (type === 'exchangeOnBehalfWithTracking')
									return periFinance.exchangeOnBehalfWithTracking(
										account1,
										from,
										amount,
										to,
										account2,
										trackingCode,
										{ from: account2 }
									);
							};

							beforeEach(async () => {
								await delegateApprovals.approveExchangeOnBehalf(account2, { from: account1 });
							});
							describe('when rates have gone stale for all pynths', () => {
								beforeEach(async () => {
									await fastForward(
										(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300'))
									);
								});
								it(`attempting to ${type} from pUSD into pAUD reverts with dest stale`, async () => {
									await assert.revert(
										exchange({ from: pUSD, amount: amountIssued, to: pAUD }),
										'Src/dest rate invalid or not found'
									);
								});
								it('settling still works ', async () => {
									await periFinance.settle(pAUD, { from: account1 });
								});
								describe('when that pynth has a fresh rate', () => {
									beforeEach(async () => {
										const timestamp = await currentTime();

										await exchangeRates.updateRates([pAUD], ['0.75'].map(toUnit), timestamp, {
											from: oracle,
										});
									});
									describe(`when the user ${type} into that pynth`, () => {
										beforeEach(async () => {
											await exchange({ from: pUSD, amount: amountIssued, to: pAUD });
										});
										describe('after the waiting period expires and the pynth has gone stale', () => {
											beforeEach(async () => {
												await fastForward(
													(await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300'))
												);
											});
											it(`${type} back to pUSD fails as the source has no rate`, async () => {
												await assert.revert(
													exchange({ from: pAUD, amount: amountIssued, to: pUSD }),
													'Src/dest rate invalid or not found'
												);
											});
										});
									});
								});
							});
						});
					});

					describe('exchanging on behalf', async () => {
						const authoriser = account1;
						const delegate = account2;

						it('exchangeOnBehalf() cannot be invoked directly by any account via Exchanger', async () => {
							await onlyGivenAddressCanInvoke({
								fnc: exchanger.exchangeOnBehalf,
								accounts,
								args: [authoriser, delegate, pUSD, toUnit('100'), pAUD],
								reason: 'Only periFinance or a pynth contract can perform this action',
							});
						});

						describe('when not approved it should revert on', async () => {
							it('exchangeOnBehalf', async () => {
								await assert.revert(
									periFinance.exchangeOnBehalf(authoriser, pAUD, toUnit('1'), pUSD, {
										from: delegate,
									}),
									'Not approved to act on behalf'
								);
							});
						});
						describe('when delegate address approved to exchangeOnBehalf', async () => {
							// (pUSD amount issued earlier in top-level beforeEach)
							beforeEach(async () => {
								await delegateApprovals.approveExchangeOnBehalf(delegate, { from: authoriser });
							});
							describe('suspension conditions on PeriFinance.exchangeOnBehalf()', () => {
								const pynth = pAUD;
								['System', 'Exchange', 'PynthExchange', 'Pynth'].forEach(section => {
									describe(`when ${section} is suspended`, () => {
										beforeEach(async () => {
											await setStatus({ owner, systemStatus, section, suspend: true, pynth });
										});
										it('then calling exchange() reverts', async () => {
											await assert.revert(
												periFinance.exchangeOnBehalf(authoriser, pUSD, amountIssued, pAUD, {
													from: delegate,
												}),
												'Operation prohibited'
											);
										});
										describe(`when ${section} is resumed`, () => {
											beforeEach(async () => {
												await setStatus({ owner, systemStatus, section, suspend: false, pynth });
											});
											it('then calling exchange() succeeds', async () => {
												await periFinance.exchangeOnBehalf(authoriser, pUSD, amountIssued, pAUD, {
													from: delegate,
												});
											});
										});
									});
								});
								describe('when Pynth(pBTC) is suspended', () => {
									beforeEach(async () => {
										await setStatus({
											owner,
											systemStatus,
											section: 'Pynth',
											suspend: true,
											pynth: pBTC,
										});
									});
									it('then exchanging other pynths on behalf still works', async () => {
										await periFinance.exchangeOnBehalf(authoriser, pUSD, amountIssued, pAUD, {
											from: delegate,
										});
									});
								});
							});

							it('should revert if non-delegate invokes exchangeOnBehalf', async () => {
								await onlyGivenAddressCanInvoke({
									fnc: periFinance.exchangeOnBehalf,
									args: [authoriser, pUSD, amountIssued, pAUD],
									accounts,
									address: delegate,
									reason: 'Not approved to act on behalf',
								});
							});
							it('should exchangeOnBehalf and authoriser recieves the destPynth', async () => {
								// Exchange pUSD to pAUD
								await periFinance.exchangeOnBehalf(authoriser, pUSD, amountIssued, pAUD, {
									from: delegate,
								});

								const { amountReceived, fee } = await exchanger.getAmountsForExchange(
									amountIssued,
									pUSD,
									pAUD
								);

								// Assert we have the correct AUD value - exchange fee
								const pAUDBalance = await pAUDContract.balanceOf(authoriser);
								assert.bnEqual(amountReceived, pAUDBalance);

								// Assert we have the exchange fee to distribute
								const feePeriodZero = await feePool.recentFeePeriods(0);
								const usdFeeAmount = await exchangeRates.effectiveValue(pAUD, fee, pUSD);
								assert.bnEqual(usdFeeAmount, feePeriodZero.feesToDistribute);
							});
						});
					});

					describe('exchanging on behalf with tracking', async () => {
						const authoriser = account1;
						const delegate = account2;

						it('exchangeOnBehalfWithTracking() cannot be invoked directly by any account via Exchanger', async () => {
							await onlyGivenAddressCanInvoke({
								fnc: exchanger.exchangeOnBehalfWithTracking,
								accounts,
								args: [authoriser, delegate, pUSD, toUnit('100'), pAUD, authoriser, trackingCode],
								reason: 'Only periFinance or a pynth contract can perform this action',
							});
						});

						describe('when not approved it should revert on', async () => {
							it('exchangeOnBehalfWithTracking', async () => {
								await assert.revert(
									periFinance.exchangeOnBehalfWithTracking(
										authoriser,
										pAUD,
										toUnit('1'),
										pUSD,
										authoriser,
										trackingCode,
										{ from: delegate }
									),
									'Not approved to act on behalf'
								);
							});
						});
						describe('when delegate address approved to exchangeOnBehalf', async () => {
							// (pUSD amount issued earlier in top-level beforeEach)
							beforeEach(async () => {
								await delegateApprovals.approveExchangeOnBehalf(delegate, { from: authoriser });
							});
							describe('suspension conditions on PeriFinance.exchangeOnBehalfWithTracking()', () => {
								const pynth = pAUD;
								['System', 'Exchange', 'PynthExchange', 'Pynth'].forEach(section => {
									describe(`when ${section} is suspended`, () => {
										beforeEach(async () => {
											await setStatus({ owner, systemStatus, section, suspend: true, pynth });
										});
										it('then calling exchange() reverts', async () => {
											await assert.revert(
												periFinance.exchangeOnBehalfWithTracking(
													authoriser,
													pUSD,
													amountIssued,
													pAUD,
													authoriser,
													trackingCode,
													{
														from: delegate,
													}
												),
												'Operation prohibited'
											);
										});
										describe(`when ${section} is resumed`, () => {
											beforeEach(async () => {
												await setStatus({ owner, systemStatus, section, suspend: false, pynth });
											});
											it('then calling exchange() succeeds', async () => {
												await periFinance.exchangeOnBehalfWithTracking(
													authoriser,
													pUSD,
													amountIssued,
													pAUD,
													authoriser,
													trackingCode,
													{
														from: delegate,
													}
												);
											});
										});
									});
								});
								describe('when Pynth(pBTC) is suspended', () => {
									beforeEach(async () => {
										await setStatus({
											owner,
											systemStatus,
											section: 'Pynth',
											suspend: true,
											pynth: pBTC,
										});
									});
									it('then exchanging other pynths on behalf still works', async () => {
										await periFinance.exchangeOnBehalfWithTracking(
											authoriser,
											pUSD,
											amountIssued,
											pAUD,
											authoriser,
											trackingCode,
											{
												from: delegate,
											}
										);
									});
								});
							});

							it('should revert if non-delegate invokes exchangeOnBehalf', async () => {
								await onlyGivenAddressCanInvoke({
									fnc: periFinance.exchangeOnBehalfWithTracking,
									args: [authoriser, pUSD, amountIssued, pAUD, authoriser, trackingCode],
									accounts,
									address: delegate,
									reason: 'Not approved to act on behalf',
								});
							});
							it('should exchangeOnBehalf and authoriser recieves the destPynth', async () => {
								// Exchange pUSD to pAUD
								const txn = await periFinance.exchangeOnBehalfWithTracking(
									authoriser,
									pUSD,
									amountIssued,
									pAUD,
									authoriser,
									trackingCode,
									{
										from: delegate,
									}
								);

								const { amountReceived, fee } = await exchanger.getAmountsForExchange(
									amountIssued,
									pUSD,
									pAUD
								);

								// Assert we have the correct AUD value - exchange fee
								const pAUDBalance = await pAUDContract.balanceOf(authoriser);
								assert.bnEqual(amountReceived, pAUDBalance);

								// Assert we have the exchange fee to distribute
								const feePeriodZero = await feePool.recentFeePeriods(0);
								const usdFeeAmount = await exchangeRates.effectiveValue(pAUD, fee, pUSD);
								assert.bnEqual(usdFeeAmount, feePeriodZero.feesToDistribute);

								// Assert the tracking event is fired.
								const trackingEvent = txn.logs.find(log => log.event === 'ExchangeTracking');
								assert.eventEqual(trackingEvent, 'ExchangeTracking', {
									trackingCode,
									toCurrencyKey: toBytes32('pAUD'),
									toAmount: pAUDBalance,
								});
							});
						});
					});
				});
			});

			describe('when dealing with inverted pynths', () => {
				describe('when price spike deviation is set to a factor of 2.5', () => {
					beforeEach(async () => {
						await systemSettings.setPriceDeviationThresholdFactor(toUnit('2.5'), { from: owner });
					});
					describe('when the iBTC pynth is set with inverse pricing', () => {
						const iBTCEntryPoint = toUnit(4000);
						beforeEach(async () => {
							await exchangeRates.setInversePricing(
								iBTC,
								iBTCEntryPoint,
								toUnit(6500),
								toUnit(1000),
								false,
								false,
								{
									from: owner,
								}
							);
						});
						describe('when a user holds holds 100,000 PERI', () => {
							beforeEach(async () => {
								await periFinance.transfer(account1, toUnit(1e5), {
									from: owner,
								});
							});

							describe('when a price within bounds for iBTC is received', () => {
								const iBTCPrice = toUnit(6000);
								beforeEach(async () => {
									await exchangeRates.updateRates([iBTC], [iBTCPrice], timestamp, {
										from: oracle,
									});
								});
								describe('when the user tries to mint 1% of their PERI value', () => {
									const amountIssued = toUnit(1e3);
									beforeEach(async () => {
										// Issue
										await pUSDContract.issue(account1, amountIssued);
									});
									describe('when the user tries to exchange some pUSD into iBTC', () => {
										const assertExchangeSucceeded = async ({
											amountExchanged,
											txn,
											from = pUSD,
											to = iBTC,
											toContract = iBTCContract,
											prevBalance,
										}) => {
											// Note: this presumes balance was empty before the exchange - won't work when
											// exchanging into pUSD as there is an existing pUSD balance from minting
											const actualExchangeFee = await exchanger.feeRateForExchange(from, to);
											const balance = await toContract.balanceOf(account1);
											const effectiveValue = await exchangeRates.effectiveValue(
												from,
												amountExchanged,
												to
											);
											const effectiveValueMinusFees = effectiveValue.sub(
												multiplyDecimal(effectiveValue, actualExchangeFee)
											);

											const balanceFromExchange = prevBalance ? balance.sub(prevBalance) : balance;

											assert.bnEqual(balanceFromExchange, effectiveValueMinusFees);

											// check logs
											const pynthExchangeEvent = txn.logs.find(
												log => log.event === 'PynthExchange'
											);

											assert.eventEqual(pynthExchangeEvent, 'PynthExchange', {
												fromCurrencyKey: from,
												fromAmount: amountExchanged,
												toCurrencyKey: to,
												toAmount: effectiveValueMinusFees,
												toAddress: account1,
											});
										};
										let exchangeTxns;
										const amountExchanged = toUnit(1e2);
										beforeEach(async () => {
											exchangeTxns = [];
											exchangeTxns.push(
												await periFinance.exchange(pUSD, amountExchanged, iBTC, {
													from: account1,
												})
											);
										});
										it('then it exchanges correctly into iBTC', async () => {
											await assertExchangeSucceeded({
												amountExchanged,
												txn: exchangeTxns[0],
												from: pUSD,
												to: iBTC,
												toContract: iBTCContract,
											});
										});
										describe('when the user tries to exchange some iBTC into another pynth', () => {
											const newAmountExchanged = toUnit(0.003); // current iBTC balance is a bit under 0.05

											beforeEach(async () => {
												const waitingPeriod = await systemSettings.waitingPeriodSecs();
												await fastForward(waitingPeriod); // fast forward through waiting period
												exchangeTxns.push(
													await periFinance.exchange(iBTC, newAmountExchanged, pAUD, {
														from: account1,
													})
												);
											});
											it('then it exchanges correctly out of iBTC', async () => {
												await assertExchangeSucceeded({
													amountExchanged: newAmountExchanged,
													txn: exchangeTxns[1],
													from: iBTC,
													to: pAUD,
													toContract: pAUDContract,
													exchangeFeeRateMultiplier: 1,
												});
											});

											describe('when a price outside of bounds for iBTC is received', () => {
												const newiBTCPrice = toUnit(7500);
												beforeEach(async () => {
													// prevent price spike from being hit
													const newTimestamp = await currentTime();
													await exchangeRates.updateRates([iBTC], [newiBTCPrice], newTimestamp, {
														from: oracle,
													});
												});
												describe('when the user tries to exchange some iBTC again', () => {
													beforeEach(async () => {
														await fastForward(500); // fast forward through waiting period

														exchangeTxns.push(
															await periFinance.exchange(iBTC, toUnit(0.001), pEUR, {
																from: account1,
															})
														);
													});
													it('then it still exchanges correctly into iBTC even when frozen', async () => {
														await assertExchangeSucceeded({
															amountExchanged: toUnit(0.001),
															txn: exchangeTxns[2],
															from: iBTC,
															to: pEUR,
															toContract: pEURContract,
															exchangeFeeRateMultiplier: 1,
														});
													});
												});
												describe('when the user tries to exchange iBTC into another pynth', () => {
													beforeEach(async () => {
														await fastForward(500); // fast forward through waiting period

														exchangeTxns.push(
															await periFinance.exchange(iBTC, newAmountExchanged, pEUR, {
																from: account1,
															})
														);
													});
													it('then it exchanges correctly out of iBTC, even while frozen', async () => {
														await assertExchangeSucceeded({
															amountExchanged: newAmountExchanged,
															txn: exchangeTxns[2],
															from: iBTC,
															to: pEUR,
															toContract: pEURContract,
															exchangeFeeRateMultiplier: 1,
														});
													});
												});
											});
										});
										describe('doubling of fees for swing trades', () => {
											const iBTCexchangeAmount = toUnit(0.002); // current iBTC balance is a bit under 0.05
											let txn;
											describe('when the user tries to exchange some short iBTC into long pBTC', () => {
												beforeEach(async () => {
													const waitingPeriod = await systemSettings.waitingPeriodSecs();
													await fastForward(waitingPeriod); // fast forward through waiting period

													txn = await periFinance.exchange(iBTC, iBTCexchangeAmount, pBTC, {
														from: account1,
													});
												});
												it('then it exchanges correctly from iBTC to pBTC, doubling the fee based on the destination Pynth', async () => {
													// get exchange fee for pUSD to pBTC (Base rate for destination pynth)
													const baseExchangeRate = await exchanger.feeRateForExchange(pUSD, pBTC);
													const expectedExchangeRate = await exchanger.feeRateForExchange(
														iBTC,
														pBTC
													);

													// swing trade should be double the base exchange fee
													assert.bnEqual(expectedExchangeRate, baseExchangeRate.mul(new BN(2)));

													await assertExchangeSucceeded({
														amountExchanged: iBTCexchangeAmount,
														txn,
														from: iBTC,
														to: pBTC,
														toContract: pBTCContract,
													});
												});
												describe('when the user tries to exchange some short iBTC into pEUR', () => {
													beforeEach(async () => {
														await fastForward(500); // fast forward through waiting period

														txn = await periFinance.exchange(iBTC, iBTCexchangeAmount, pEUR, {
															from: account1,
														});
													});
													it('then it exchanges correctly from iBTC to pEUR, doubling the fee', async () => {
														// get exchange fee for pUSD to pEUR (Base rate for destination pynth)
														const baseExchangeRate = await exchanger.feeRateForExchange(pUSD, pEUR);
														const expectedExchangeRate = await exchanger.feeRateForExchange(
															iBTC,
															pEUR
														);

														// swing trade should be double the base exchange fee
														assert.bnEqual(expectedExchangeRate, baseExchangeRate.mul(new BN(2)));

														await assertExchangeSucceeded({
															amountExchanged: iBTCexchangeAmount,
															txn,
															from: iBTC,
															to: pEUR,
															toContract: pEURContract,
														});
													});
													describe('when the user tries to exchange some pEUR for iBTC', () => {
														const pEURExchangeAmount = toUnit(0.001);
														let prevBalance;
														beforeEach(async () => {
															await fastForward(await systemSettings.waitingPeriodSecs()); // fast forward through waiting period

															prevBalance = await iBTCContract.balanceOf(account1);
															txn = await periFinance.exchange(pEUR, pEURExchangeAmount, iBTC, {
																from: account1,
															});
														});
														it('then it exchanges correctly from pEUR to iBTC, doubling the fee', async () => {
															// get exchange fee for pUSD to iBTC (Base rate for destination pynth)
															const baseExchangeRate = await exchanger.feeRateForExchange(
																pUSD,
																iBTC
															);
															const expectedExchangeRate = await exchanger.feeRateForExchange(
																pEUR,
																iBTC
															);

															// swing trade should be double the base exchange fee
															assert.bnEqual(expectedExchangeRate, baseExchangeRate.mul(new BN(2)));

															await assertExchangeSucceeded({
																amountExchanged: pEURExchangeAmount,
																txn,
																from: pEUR,
																to: iBTC,
																toContract: iBTCContract,
																prevBalance,
															});
														});
													});
												});
											});
											describe('when the user tries to exchange some short iBTC for pUSD', () => {
												let prevBalance;

												beforeEach(async () => {
													// fast forward through waiting period
													const waitingPeriod = await systemSettings.waitingPeriodSecs();
													await fastForward(waitingPeriod);

													prevBalance = await pUSDContract.balanceOf(account1);
													txn = await periFinance.exchange(iBTC, iBTCexchangeAmount, pUSD, {
														from: account1,
													});
												});
												it('then it exchanges correctly out of iBTC, with the regular fee', async () => {
													// get exchange fee for pETH to pUSD (Base rate for destination pynth into pUSD)
													const baseExchangeRate = await exchanger.feeRateForExchange(pETH, pUSD);
													const expectedExchangeRate = await exchanger.feeRateForExchange(
														iBTC,
														pUSD
													);

													// exchange fee should be the same base exchange fee
													assert.bnEqual(expectedExchangeRate, baseExchangeRate);

													await assertExchangeSucceeded({
														amountExchanged: iBTCexchangeAmount,
														txn,
														from: iBTC,
														to: pUSD,
														toContract: pUSDContract,
														prevBalance,
													});
												});
											});
										});
										describe('edge case: frozen rate does not apply to old settlement', () => {
											describe('when a price outside the bounds arrives for iBTC', () => {
												beforeEach(async () => {
													const newTimestamp = await currentTime();
													await exchangeRates.updateRates([iBTC], [toUnit('8000')], newTimestamp, {
														from: oracle,
													});
												});
												it('then settlement owing shows some rebate', async () => {
													const {
														reclaimAmount,
														rebateAmount,
														numEntries,
													} = await exchanger.settlementOwing(account1, iBTC);

													assert.equal(reclaimAmount, '0');
													assert.notEqual(rebateAmount, '0');
													assert.equal(numEntries, '1');
												});
												describe('when a user freezes iBTC', () => {
													beforeEach(async () => {
														await exchangeRates.freezeRate(iBTC, { from: account1 });
													});
													it('then settlement owing still shows some rebate', async () => {
														const {
															reclaimAmount,
															rebateAmount,
															numEntries,
														} = await exchanger.settlementOwing(account1, iBTC);

														assert.equal(reclaimAmount, '0');
														assert.notEqual(rebateAmount, '0');
														assert.equal(numEntries, '1');
													});
												});
											});
											describe('when the waiting period expires', () => {
												beforeEach(async () => {
													await fastForward(500); // fast forward through waiting period
												});
												it('then settlement owing shows 0', async () => {
													const {
														reclaimAmount,
														rebateAmount,
														numEntries,
													} = await exchanger.settlementOwing(account1, iBTC);

													assert.equal(reclaimAmount, '0');
													assert.equal(rebateAmount, '0');
													assert.equal(numEntries, '1');
												});
												describe('when a price outside the bounds arrives for iBTC', () => {
													beforeEach(async () => {
														const newTimestamp = await currentTime();
														await exchangeRates.updateRates(
															[iBTC],
															[toUnit('12000')],
															newTimestamp,
															{
																from: oracle,
															}
														);
													});
													describe('when a user freezes iBTC', () => {
														beforeEach(async () => {
															await exchangeRates.freezeRate(iBTC, { from: account1 });
														});
														// FreezdRate will be allowed when iPynths is listed.
														it.skip('then settlement owing still shows 0', async () => {
															const {
																reclaimAmount,
																rebateAmount,
																numEntries,
															} = await exchanger.settlementOwing(account1, iBTC);

															console.log(fromUnit(rebateAmount));
															assert.equal(reclaimAmount, '0');
															assert.equal(rebateAmount, '0');
															assert.equal(numEntries, '1');
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
				});
			});

			describe('edge case: when an aggregator has a 0 rate', () => {
				describe('when an aggregator is added to the exchangeRates', () => {
					// let aggregator;

					beforeEach(async () => {
						// aggregator = await MockAggregator.new({ from: owner });
						await exchangeRates.addAggregator(pETH, aggregator.address, { from: owner });
						// set a 0 rate to prevent invalid rate from causing a revert on exchange
						await aggregator.setLatestAnswer('0', await currentTime());
					});

					describe('when exchanging into that pynth', () => {
						it('then it causes a suspension from price deviation as the price is 9', async () => {
							const { tx: hash } = await periFinance.exchange(pUSD, toUnit('1'), pETH, {
								from: account1,
							});

							const logs = await getDecodedLogs({
								hash,
								contracts: [periFinance, exchanger, systemStatus],
							});

							// assert no exchange
							assert.ok(!logs.some(({ name } = {}) => name === 'PynthExchange'));

							// assert suspension
							const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
							assert.ok(suspended);
							assert.equal(reason, '65');
						});
					});
					describe('when exchanging out of that pynth', () => {
						beforeEach(async () => {
							// give the user some pETH
							await pETHContract.issue(account1, toUnit('1'));
						});
						it('then it causes a suspension from price deviation', async () => {
							// await assert.revert(
							const { tx: hash } = await periFinance.exchange(pETH, toUnit('1'), pUSD, {
								from: account1,
							});

							const logs = await getDecodedLogs({
								hash,
								contracts: [periFinance, exchanger, systemStatus],
							});

							// assert no exchange
							assert.ok(!logs.some(({ name } = {}) => name === 'PynthExchange'));

							// assert suspension
							const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
							assert.ok(suspended);
							assert.equal(reason, '65');
						});
					});
				});
			});
		});
	};

	const itExchangesWithVirtual = () => {
		describe.skip('exchangeWithVirtual()', () => {
			describe('when a user has 1000 pUSD', () => {
				describe('when the waiting period is set to 60s', () => {
					beforeEach(async () => {
						await systemSettings.setWaitingPeriodSecs('60', { from: owner });
					});
					describe('when a user exchanges into pAUD using virtual pynths with a tracking code', () => {
						let logs;
						let amountReceived;
						let exchangeFeeRate;
						let findNamedEventValue;
						let vPynthAddress;

						beforeEach(async () => {
							const txn = await periFinance.exchangeWithVirtual(
								pUSD,
								amountIssued,
								pAUD,
								toBytes32('AGGREGATOR'),
								{
									from: account1,
								}
							);

							({ amountReceived, exchangeFeeRate } = await exchanger.getAmountsForExchange(
								amountIssued,
								pUSD,
								pAUD
							));

							logs = await getDecodedLogs({
								hash: txn.tx,
								contracts: [
									periFinance,
									exchanger,
									pUSDContract,
									issuer,
									flexibleStorage,
									debtCache,
								],
							});
							const vPynthCreatedEvent = logs.find(({ name }) => name === 'VirtualPynthCreated');
							assert.ok(vPynthCreatedEvent, 'Found VirtualPynthCreated event');
							findNamedEventValue = param =>
								vPynthCreatedEvent.events.find(({ name }) => name === param);
							vPynthAddress = findNamedEventValue('vPynth').value;
						});

						it('then it emits an ExchangeEntryAppended for the new Virtual Pynth', async () => {
							decodedEventEqual({
								log: logs.find(({ name }) => name === 'ExchangeEntryAppended'),
								event: 'ExchangeEntryAppended',
								emittedFrom: exchanger.address,
								args: [
									vPynthAddress,
									pUSD,
									amountIssued,
									pAUD,
									amountReceived,
									exchangeFeeRate,
									new web3.utils.BN(1),
									new web3.utils.BN(2),
								],
								bnCloseVariance,
							});
						});

						it('then it emits an PynthExchange into the new Virtual Pynth', async () => {
							decodedEventEqual({
								log: logs.find(({ name }) => name === 'PynthExchange'),
								event: 'PynthExchange',
								emittedFrom: await periFinance.proxy(),
								args: [account1, pUSD, amountIssued, pAUD, amountReceived, vPynthAddress],
								bnCloseVariance: '0',
							});
						});

						it('then an ExchangeTracking is emitted with the correct code', async () => {
							const evt = logs.find(({ name }) => name === 'ExchangeTracking');
							assert.equal(
								evt.events.find(({ name }) => name === 'trackingCode').value,
								toBytes32('AGGREGATOR')
							);
						});

						it('and it emits the VirtualPynthCreated event', async () => {
							assert.equal(
								findNamedEventValue('pynth').value,
								(await pAUDContract.proxy()).toLowerCase()
							);
							assert.equal(findNamedEventValue('currencyKey').value, pAUD);
							assert.equal(findNamedEventValue('amount').value, amountReceived);
							assert.equal(findNamedEventValue('recipient').value, account1.toLowerCase());
						});
						it('and the balance of the user is nothing', async () => {
							assert.bnEqual(await pAUDContract.balanceOf(account1), '0');
						});
						it('and the user has no fee reclamation entries', async () => {
							const { reclaimAmount, rebateAmount, numEntries } = await exchanger.settlementOwing(
								account1,
								pAUD
							);
							assert.equal(reclaimAmount, '0');
							assert.equal(rebateAmount, '0');
							assert.equal(numEntries, '0');
						});

						describe('with the new virtual pynth', () => {
							let vPynth;
							beforeEach(async () => {
								vPynth = await artifacts.require('VirtualPynth').at(vPynthAddress);
							});
							it('and the balance of the vPynth is the whole amount', async () => {
								assert.bnEqual(await pAUDContract.balanceOf(vPynth.address), amountReceived);
							});
							it('then it is created with the correct parameters', async () => {
								assert.equal(await vPynth.resolver(), resolver.address);
								assert.equal(await vPynth.pynth(), await pAUDContract.proxy());
								assert.equal(await vPynth.currencyKey(), pAUD);
								assert.bnEqual(await vPynth.totalSupply(), amountReceived);
								assert.bnEqual(await vPynth.balanceOf(account1), amountReceived);
								assert.notOk(await vPynth.settled());
							});
							it('and the vPynth has 1 fee reclamation entries', async () => {
								const { reclaimAmount, rebateAmount, numEntries } = await exchanger.settlementOwing(
									vPynth.address,
									pAUD
								);
								assert.equal(reclaimAmount, '0');
								assert.equal(rebateAmount, '0');
								assert.equal(numEntries, '1');
							});
							it('and the secsLeftInWaitingPeriod() returns the waitingPeriodSecs', async () => {
								const maxSecs = await vPynth.secsLeftInWaitingPeriod();
								timeIsClose({ actual: maxSecs, expected: 60, variance: 2 });
							});

							describe('when the waiting period expires', () => {
								beforeEach(async () => {
									// end waiting period
									await fastForward(await systemSettings.waitingPeriodSecs());
								});

								it('and the secsLeftInWaitingPeriod() returns 0', async () => {
									assert.equal(await vPynth.secsLeftInWaitingPeriod(), '0');
								});

								it('and readyToSettle() is true', async () => {
									assert.equal(await vPynth.readyToSettle(), true);
								});

								describe('when the vPynth is settled for the holder', () => {
									let txn;
									let logs;
									beforeEach(async () => {
										txn = await vPynth.settle(account1);

										logs = await getDecodedLogs({
											hash: txn.tx,
											contracts: [
												periFinance,
												exchanger,
												pUSDContract,
												issuer,
												flexibleStorage,
												debtCache,
											],
										});
									});

									it('then the user has all the pynths', async () => {
										assert.bnEqual(await pAUDContract.balanceOf(account1), amountReceived);
									});

									it('and the vPynth is settled', async () => {
										assert.equal(await vPynth.settled(), true);
									});

									it('and ExchangeEntrySettled is emitted', async () => {
										const evt = logs.find(({ name }) => name === 'ExchangeEntrySettled');

										const findEvt = param => evt.events.find(({ name }) => name === param);

										assert.equal(findEvt('from').value, vPynth.address.toLowerCase());
									});

									it('and the entry is settled for the vPynth', async () => {
										const {
											reclaimAmount,
											rebateAmount,
											numEntries,
										} = await exchanger.settlementOwing(vPynth.address, pAUD);
										assert.equal(reclaimAmount, '0');
										assert.equal(rebateAmount, '0');
										assert.equal(numEntries, '0');
									});

									it('and the user still has no fee reclamation entries', async () => {
										const {
											reclaimAmount,
											rebateAmount,
											numEntries,
										} = await exchanger.settlementOwing(account1, pAUD);
										assert.equal(reclaimAmount, '0');
										assert.equal(rebateAmount, '0');
										assert.equal(numEntries, '0');
									});

									it('and no more supply exists in the vPynth', async () => {
										assert.equal(await vPynth.totalSupply(), '0');
									});
								});
							});
						});
					});

					describe.skip('when a user exchanges without a tracking code', () => {
						let logs;
						beforeEach(async () => {
							const txn = await periFinance.exchangeWithVirtual(
								pUSD,
								amountIssued,
								pAUD,
								toBytes32(),
								{
									from: account1,
								}
							);

							logs = await getDecodedLogs({
								hash: txn.tx,
								contracts: [
									periFinance,
									exchanger,
									pUSDContract,
									issuer,
									flexibleStorage,
									debtCache,
								],
							});
						});
						it('then no ExchangeTracking is emitted (as no tracking code supplied)', async () => {
							assert.notOk(logs.find(({ name }) => name === 'ExchangeTracking'));
						});
					});
				});
			});
		});
	};

	const itSetsLastExchangeRateForPynth = () => {
		describe('setLastExchangeRateForPynth() SIP-78', () => {
			it('cannot be invoked by any user', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: exchanger.setLastExchangeRateForPynth,
					args: [pEUR, toUnit('100')],
					accounts,
					reason: 'Restricted to ExchangeRates',
				});
			});

			describe('when ExchangeRates is spoofed using an account', () => {
				beforeEach(async () => {
					await resolver.importAddresses([toBytes32('ExchangeRates')], [account1], {
						from: owner,
					});
					await exchanger.rebuildCache();
				});
				it('reverts when invoked by ExchangeRates with a 0 rate', async () => {
					await assert.revert(
						exchanger.setLastExchangeRateForPynth(pEUR, '0', { from: account1 }),
						'Rate must be above 0'
					);
				});
				describe('when invoked with a real rate by ExchangeRates', () => {
					beforeEach(async () => {
						await exchanger.setLastExchangeRateForPynth(pEUR, toUnit('1.9'), { from: account1 });
					});
					it('then lastExchangeRate is set for the pynth', async () => {
						assert.bnEqual(await exchanger.lastExchangeRate(pEUR), toUnit('1.9'));
					});
				});
			});
		});
	};

	const itPricesSpikeDeviation = () => {
		describe('priceSpikeDeviation', () => {
			const baseRate = 100;

			const updateRate = ({ target, rate }) => {
				beforeEach(async () => {
					await fastForward(10);
					await exchangeRates.updateRates(
						[target],
						[toUnit(rate.toString())],
						await currentTime(),
						{
							from: oracle,
						}
					);
				});
			};

			describe(`when the price of pETH is ${baseRate}`, () => {
				updateRate({ target: pETH, rate: baseRate });

				describe('when price spike deviation is set to a factor of 2', () => {
					const baseFactor = 2;
					beforeEach(async () => {
						await systemSettings.setPriceDeviationThresholdFactor(toUnit(baseFactor.toString()), {
							from: owner,
						});
					});

					// lastExchangeRate, used for price deviations (SIP-65)
					describe('lastExchangeRate is persisted during exchanges', () => {
						it('initially has no entries', async () => {
							assert.equal(await exchanger.lastExchangeRate(pUSD), '0');
							assert.equal(await exchanger.lastExchangeRate(pETH), '0');
							assert.equal(await exchanger.lastExchangeRate(pEUR), '0');
						});
						describe('when a user exchanges into pETH from pUSD', () => {
							beforeEach(async () => {
								await periFinance.exchange(pUSD, toUnit('100'), pETH, { from: account1 });
							});
							it('then the source side has a rate persisted', async () => {
								assert.bnEqual(await exchanger.lastExchangeRate(pUSD), toUnit('1'));
							});
							it('and the dest side has a rate persisted', async () => {
								assert.bnEqual(await exchanger.lastExchangeRate(pETH), toUnit(baseRate.toString()));
							});
						});
						describe('when a user exchanges from pETH into another pynth', () => {
							beforeEach(async () => {
								await pETHContract.issue(account1, toUnit('1'));
								await periFinance.exchange(pETH, toUnit('1'), pEUR, { from: account1 });
							});
							it('then the source side has a rate persisted', async () => {
								assert.bnEqual(await exchanger.lastExchangeRate(pETH), toUnit(baseRate.toString()));
							});
							it('and the dest side has a rate persisted', async () => {
								// Rate of 2 from shared setup code above
								assert.bnEqual(await exchanger.lastExchangeRate(pEUR), toUnit('2'));
							});
							describe('when the price of pETH changes slightly', () => {
								updateRate({ target: pETH, rate: baseRate * 1.1 });
								describe('and another user exchanges pETH to pUSD', () => {
									beforeEach(async () => {
										await pETHContract.issue(account2, toUnit('1'));
										await periFinance.exchange(pETH, toUnit('1'), pUSD, { from: account2 });
									});
									it('then the source side has a new rate persisted', async () => {
										assert.bnEqual(
											await exchanger.lastExchangeRate(pETH),
											toUnit((baseRate * 1.1).toString())
										);
									});
									it('and the dest side has a rate persisted', async () => {
										assert.bnEqual(await exchanger.lastExchangeRate(pUSD), toUnit('1'));
									});
								});
							});
							describe('when the price of pETH is over a deviation', () => {
								beforeEach(async () => {
									// pETH over deviation and pEUR slight change
									await fastForward(10);
									await exchangeRates.updateRates(
										[pETH, pEUR],
										[toUnit(baseRate * 3).toString(), toUnit('1.9')],
										await currentTime(),
										{
											from: oracle,
										}
									);
								});
								describe('and another user exchanges pETH to pEUR', () => {
									beforeEach(async () => {
										await pETHContract.issue(account2, toUnit('1'));
										await periFinance.exchange(pETH, toUnit('1'), pEUR, { from: account2 });
									});
									it('then the source side has not persisted the rate', async () => {
										assert.bnEqual(
											await exchanger.lastExchangeRate(pETH),
											toUnit(baseRate.toString())
										);
									});
									it('then the dest side has not persisted the rate', async () => {
										assert.bnEqual(await exchanger.lastExchangeRate(pEUR), toUnit('2'));
									});
								});
							});
							describe('when the price of pEUR is over a deviation', () => {
								beforeEach(async () => {
									// pEUR over deviation and pETH slight change
									await fastForward(10);
									await exchangeRates.updateRates(
										[pETH, pEUR],
										[toUnit(baseRate * 1.1).toString(), toUnit('10')],
										await currentTime(),
										{
											from: oracle,
										}
									);
								});
								describe('and another user exchanges pEUR to pETH', () => {
									beforeEach(async () => {
										await pETHContract.issue(account2, toUnit('1'));
										await periFinance.exchange(pETH, toUnit('1'), pEUR, { from: account2 });
									});
									it('then the source side has persisted the rate', async () => {
										assert.bnEqual(
											await exchanger.lastExchangeRate(pETH),
											toUnit((baseRate * 1.1).toString())
										);
									});
									it('and the dest side has not persisted the rate', async () => {
										assert.bnEqual(await exchanger.lastExchangeRate(pEUR), toUnit('2'));
									});
								});
							});
						});
					});

					describe('the isPynthRateInvalid() view correctly returns status', () => {
						it('when called with a pynth with only a single rate, returns false', async () => {
							assert.equal(await exchanger.isPynthRateInvalid(pETH), false);
						});
						it('when called with a pynth with no rate (i.e. 0), returns true', async () => {
							assert.equal(await exchanger.isPynthRateInvalid(toBytes32('XYZ')), true);
						});
						describe('when a pynth rate changes outside of the range', () => {
							updateRate({ target: pETH, rate: baseRate * 2 });

							it('when called with that pynth, returns true', async () => {
								assert.equal(await exchanger.isPynthRateInvalid(pETH), true);
							});

							describe('when the pynth rate changes back into the range', () => {
								updateRate({ target: pETH, rate: baseRate });

								it('then when called with the target, still returns true', async () => {
									assert.equal(await exchanger.isPynthRateInvalid(pETH), true);
								});
							});
						});
						describe('when there is a last rate into pETH via an exchange', () => {
							beforeEach(async () => {
								await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account2 });
							});

							describe('when a pynth rate changes outside of the range and then returns to the range', () => {
								updateRate({ target: pETH, rate: baseRate * 2 });
								updateRate({ target: pETH, rate: baseRate * 1.2 });

								it('then when called with the target, returns false', async () => {
									assert.equal(await exchanger.isPynthRateInvalid(pETH), false);
								});
							});
						});

						describe('when there is a last price out of pETH via an exchange', () => {
							beforeEach(async () => {
								await pETHContract.issue(account2, toUnit('1'));
								await periFinance.exchange(pETH, toUnit('0.001'), pUSD, { from: account2 });
							});

							describe('when a pynth price changes outside of the range and then returns to the range', () => {
								updateRate({ target: pETH, rate: baseRate * 2 });
								updateRate({ target: pETH, rate: baseRate * 1.2 });

								it('then when called with the target, returns false', async () => {
									assert.equal(await exchanger.isPynthRateInvalid(pETH), false);
								});
							});
						});
					});

					describe('suspension is triggered via exchanging', () => {
						describe('given the user has some pETH', () => {
							beforeEach(async () => {
								await pETHContract.issue(account1, toUnit('1'));
							});

							const assertSpike = ({ from, to, target, factor, spikeExpected }) => {
								const rate = Math.abs(
									(factor > 0 ? baseRate * factor : baseRate / factor).toFixed(2)
								);
								describe(`when the rate of ${web3.utils.hexToAscii(
									target
								)} is ${rate} (factor: ${factor})`, () => {
									updateRate({ target, rate });

									describe(`when a user exchanges`, () => {
										let logs;

										beforeEach(async () => {
											const { tx: hash } = await periFinance.exchange(from, toUnit('0.01'), to, {
												from: account1,
											});
											logs = await getDecodedLogs({
												hash,
												contracts: [periFinance, exchanger, systemStatus],
											});
										});
										if (Math.abs(factor) >= baseFactor || spikeExpected) {
											it('then the pynth is suspended', async () => {
												const { suspended, reason } = await systemStatus.pynthSuspension(target);
												assert.ok(suspended);
												assert.equal(reason, '65');
											});
											it('and no exchange took place', async () => {
												assert.ok(!logs.some(({ name } = {}) => name === 'PynthExchange'));
											});
										} else {
											it('then neither pynth is suspended', async () => {
												const suspensions = await Promise.all([
													systemStatus.pynthSuspension(from),
													systemStatus.pynthSuspension(to),
												]);
												assert.ok(!suspensions[0].suspended);
												assert.ok(!suspensions[1].suspended);
											});
											it('and an exchange took place', async () => {
												assert.ok(logs.some(({ name } = {}) => name === 'PynthExchange'));
											});
										}
									});
								});
							};

							const assertRange = ({ from, to, target }) => {
								[1, -1].forEach(multiplier => {
									describe(`${multiplier > 0 ? 'upwards' : 'downwards'} movement`, () => {
										// below threshold
										assertSpike({
											from,
											to,
											target,
											factor: 1.99 * multiplier,
										});

										// on threshold
										assertSpike({
											from,
											to,
											target,
											factor: 2 * multiplier,
										});

										// over threshold
										assertSpike({
											from,
											to,
											target,
											factor: 3 * multiplier,
										});
									});
								});
							};

							const assertBothSidesOfTheExchange = () => {
								describe('on the dest side', () => {
									assertRange({ from: pUSD, to: pETH, target: pETH });
								});

								describe('on the src side', () => {
									assertRange({ from: pETH, to: pAUD, target: pETH });
								});
							};

							describe('with no prior exchange history', () => {
								assertBothSidesOfTheExchange();

								describe('when a recent price rate is set way outside of the threshold', () => {
									beforeEach(async () => {
										await fastForward(10);
										await exchangeRates.updateRates([pETH], [toUnit('1000')], await currentTime(), {
											from: oracle,
										});
									});
									describe('and then put back to normal', () => {
										beforeEach(async () => {
											await fastForward(10);
											await exchangeRates.updateRates(
												[pETH],
												[baseRate.toString()],
												await currentTime(),
												{
													from: oracle,
												}
											);
										});
										assertSpike({
											from: pUSD,
											to: pETH,
											target: pETH,
											factor: 1,
											spikeExpected: true,
										});
									});
								});
							});

							describe('with a prior exchange from another user into the source', () => {
								beforeEach(async () => {
									await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account2 });
								});

								assertBothSidesOfTheExchange();
							});

							describe('with a prior exchange from another user out of the source', () => {
								beforeEach(async () => {
									await pETHContract.issue(account2, toUnit('1'));
									await periFinance.exchange(pETH, toUnit('1'), pAUD, { from: account2 });
								});

								assertBothSidesOfTheExchange();
							});
						});
					});

					describe('suspension invoked by anyone via suspendPynthWithInvalidRate()', () => {
						// pTRX relies on the fact that pTRX is a valid pynth but never given a rate in the setup code
						// above
						const pynthWithNoRate = toBytes32('pTRX');
						it('when called with invalid pynth, then reverts', async () => {
							await assert.revert(
								exchanger.suspendPynthWithInvalidRate(toBytes32('XYZ')),
								'No such pynth'
							);
						});
						describe('when called with a pynth with no price', () => {
							let logs;
							beforeEach(async () => {
								const { tx: hash } = await exchanger.suspendPynthWithInvalidRate(pynthWithNoRate);
								logs = await getDecodedLogs({
									hash,
									contracts: [periFinance, exchanger, systemStatus],
								});
							});
							it('then suspension works as expected', async () => {
								const { suspended, reason } = await systemStatus.pynthSuspension(pynthWithNoRate);
								assert.ok(suspended);
								assert.equal(reason, '65');
								assert.ok(logs.some(({ name }) => name === 'PynthSuspended'));
							});
						});

						describe('when the system is suspended', () => {
							beforeEach(async () => {
								await setStatus({ owner, systemStatus, section: 'System', suspend: true });
							});
							it('then suspended a pynth fails', async () => {
								await assert.revert(
									exchanger.suspendPynthWithInvalidRate(pynthWithNoRate),
									'Operation prohibited'
								);
							});
							describe(`when system is resumed`, () => {
								beforeEach(async () => {
									await setStatus({ owner, systemStatus, section: 'System', suspend: false });
								});
								it('then suspension works as expected', async () => {
									await exchanger.suspendPynthWithInvalidRate(pynthWithNoRate);
									const { suspended, reason } = await systemStatus.pynthSuspension(pynthWithNoRate);
									assert.ok(suspended);
									assert.equal(reason, '65');
								});
							});
						});
					});

					describe('edge case: resetting an iPynth resets the lastExchangeRate (SIP-78)', () => {
						describe('when setInversePricing is invoked with no underlying rate', () => {
							it('it does not revert', async () => {
								await exchangeRates.setInversePricing(
									iETH,
									toUnit(4000),
									toUnit(6500),
									toUnit(1000),
									false,
									false,
									{
										from: owner,
									}
								);
							});
						});
						describe('when an iPynth is set with inverse pricing and has a price in bounds', () => {
							beforeEach(async () => {
								await exchangeRates.setInversePricing(
									iBTC,
									toUnit(4000),
									toUnit(6500),
									toUnit(1000),
									false,
									false,
									{
										from: owner,
									}
								);
							});
							// in-bounds update
							updateRate({ target: iBTC, rate: 4100 });

							describe('when a user exchanges into the iPynth', () => {
								beforeEach(async () => {
									await periFinance.exchange(pUSD, toUnit('100'), iBTC, { from: account1 });
								});
								it('then last exchange rate is correct', async () => {
									assert.bnEqual(await exchanger.lastExchangeRate(iBTC), toUnit(3900));
								});
								describe('when the inverse is reset with different limits, yielding a rate above the deviation factor', () => {
									beforeEach(async () => {
										await exchangeRates.setInversePricing(
											iBTC,
											toUnit(8000),
											toUnit(10500),
											toUnit(5000),
											false,
											false,
											{
												from: owner,
											}
										);
									});
									describe('when a user exchanges into the iPynth', () => {
										beforeEach(async () => {
											await periFinance.exchange(pUSD, toUnit('100'), iBTC, {
												from: account1,
											});
										});
										it('then the pynth is not suspended', async () => {
											const { suspended } = await systemStatus.pynthSuspension(iBTC);
											assert.ok(!suspended);
										});
										it('and the last exchange rate is the new rate (locked at lower limit)', async () => {
											assert.bnEqual(await exchanger.lastExchangeRate(iBTC), toUnit(10500));
										});
									});
								});
							});
						});
					});

					describe('settlement ignores deviations', () => {
						describe('when a user exchange 100 pUSD into pETH', () => {
							beforeEach(async () => {
								await periFinance.exchange(pUSD, toUnit('100'), pETH, { from: account1 });
							});
							describe('and the pETH rate moves up by a factor of 2 to 200', () => {
								updateRate({ target: pETH, rate: baseRate * 2 });

								it('then settlementOwing is 0 for rebate and reclaim, with 1 entry', async () => {
									const {
										reclaimAmount,
										rebateAmount,
										numEntries,
									} = await exchanger.settlementOwing(account1, pETH);
									assert.equal(reclaimAmount, '0');
									assert.equal(rebateAmount, '0');
									assert.equal(numEntries, '1');
								});
							});

							describe('multiple entries to settle', () => {
								describe('when the pETH rate moves down by 20%', () => {
									updateRate({ target: pETH, rate: baseRate * 0.8 });

									describe('and the waiting period expires', () => {
										beforeEach(async () => {
											// end waiting period
											await fastForward(await systemSettings.waitingPeriodSecs());
										});

										it('then settlementOwing is existing rebate with 0 reclaim, with 1 entries', async () => {
											const {
												reclaimAmount,
												rebateAmount,
												numEntries,
											} = await exchanger.settlementOwing(account1, pETH);
											assert.equal(reclaimAmount, '0');
											// some amount close to the 0.25 rebate (after fees)
											assert.bnClose(rebateAmount, toUnit('0.25'), (1e16).toString());
											assert.equal(numEntries, '1');
										});

										describe('and the user makes another exchange into pETH', () => {
											beforeEach(async () => {
												await periFinance.exchange(pUSD, toUnit('100'), pETH, { from: account1 });
											});
											describe('and the pETH rate moves up by a factor of 2 to 200, causing the second entry to be skipped', () => {
												updateRate({ target: pETH, rate: baseRate * 2 });

												it('then settlementOwing is existing rebate with 0 reclaim, with 2 entries', async () => {
													const {
														reclaimAmount,
														rebateAmount,
														numEntries,
													} = await exchanger.settlementOwing(account1, pETH);
													assert.equal(reclaimAmount, '0');
													assert.bnClose(rebateAmount, toUnit('0.25'), (1e16).toString());
													assert.equal(numEntries, '2');
												});
											});

											describe('and the pETH rate goes back up 25% (from 80 to 100)', () => {
												updateRate({ target: pETH, rate: baseRate });
												describe('and the waiting period expires', () => {
													beforeEach(async () => {
														// end waiting period
														await fastForward(await systemSettings.waitingPeriodSecs());
													});
													it('then settlementOwing is existing rebate, existing reclaim, and 2 entries', async () => {
														const {
															reclaimAmount,
															rebateAmount,
															numEntries,
														} = await exchanger.settlementOwing(account1, pETH);
														assert.bnClose(reclaimAmount, toUnit('0.25'), (1e16).toString());
														assert.bnClose(rebateAmount, toUnit('0.25'), (1e16).toString());
														assert.equal(numEntries, '2');
													});
													describe('and the user makes another exchange into pETH', () => {
														beforeEach(async () => {
															await periFinance.exchange(pUSD, toUnit('100'), pETH, {
																from: account1,
															});
														});
														describe('and the pETH rate moves down by a factor of 2 to 50, causing the third entry to be skipped', () => {
															updateRate({ target: pETH, rate: baseRate * 0.5 });

															it('then settlementOwing is existing rebate and reclaim, with 3 entries', async () => {
																const {
																	reclaimAmount,
																	rebateAmount,
																	numEntries,
																} = await exchanger.settlementOwing(account1, pETH);
																assert.bnClose(reclaimAmount, toUnit('0.25'), (1e16).toString());
																assert.bnClose(rebateAmount, toUnit('0.25'), (1e16).toString());
																assert.equal(numEntries, '3');
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

						describe('edge case: aggregator returns 0 for settlement price', () => {
							describe('when an aggregator is added to the exchangeRates', () => {
								// let aggregator;

								beforeEach(async () => {
									// aggregator = await MockAggregator.new({ from: owner });
									await exchangeRates.addAggregator(pETH, aggregator.address, { from: owner });
								});

								describe('and the aggregator has a rate (so the exchange succeeds)', () => {
									beforeEach(async () => {
										await aggregator.setLatestAnswer(
											convertToAggregatorPrice(100),
											await currentTime()
										);
									});
									describe('when a user exchanges out of the aggregated rate into pUSD', () => {
										beforeEach(async () => {
											// give the user some pETH
											await pETHContract.issue(account1, toUnit('1'));
											await periFinance.exchange(pETH, toUnit('1'), pUSD, { from: account1 });
										});
										describe('and the aggregated rate becomes 0', () => {
											beforeEach(async () => {
												await aggregator.setLatestAnswer('0', await currentTime());
											});

											it('then settlementOwing is 0 for rebate and reclaim, with 1 entry', async () => {
												const {
													reclaimAmount,
													rebateAmount,
													numEntries,
												} = await exchanger.settlementOwing(account1, pUSD);
												assert.equal(reclaimAmount, '0');
												assert.equal(rebateAmount, '0');
												assert.equal(numEntries, '1');
											});
											describe('and the waiting period expires', () => {
												beforeEach(async () => {
													// end waiting period
													await fastForward(await systemSettings.waitingPeriodSecs());
												});
												it('then the user can settle with no impact', async () => {
													const txn = await exchanger.settle(account1, pUSD, { from: account1 });
													// Note: no need to decode the logs as they are emitted off the target contract Exchanger
													assert.equal(txn.logs.length, 1); // one settlement entry
													assert.eventEqual(txn, 'ExchangeEntrySettled', {
														reclaim: '0',
														rebate: '0',
													}); // with no reclaim or rebate
												});
											});
										});
										describe('and the aggregated rate is received but for a much higher roundId, leaving a large gap in roundIds', () => {
											beforeEach(async () => {
												await aggregator.setLatestAnswerWithRound(
													convertToAggregatorPrice(110),
													await currentTime(),
													'9999'
												);
											});

											it('then settlementOwing is 0 for rebate and reclaim, with 1 entry', async () => {
												const {
													reclaimAmount,
													rebateAmount,
													numEntries,
												} = await exchanger.settlementOwing(account1, pUSD);
												assert.equal(reclaimAmount, '0');
												assert.equal(rebateAmount, '0');
												assert.equal(numEntries, '1');
											});

											describe('and the waiting period expires', () => {
												beforeEach(async () => {
													// end waiting period
													await fastForward(await systemSettings.waitingPeriodSecs());
												});
												it('then the user can settle with no impact', async () => {
													const txn = await exchanger.settle(account1, pUSD, { from: account1 });
													// Note: no need to decode the logs as they are emitted off the target contract Exchanger
													assert.equal(txn.logs.length, 1); // one settlement entry
													assert.eventEqual(txn, 'ExchangeEntrySettled', {
														reclaim: '0',
														rebate: '0',
													}); // with no reclaim or rebate
												});
											});
										});
									});
									describe('when a user exchanges into the aggregated rate from pUSD', () => {
										beforeEach(async () => {
											await periFinance.exchange(pUSD, toUnit('1'), pETH, { from: account1 });
										});
										describe('and the aggregated rate becomes 0', () => {
											beforeEach(async () => {
												await aggregator.setLatestAnswer('0', await currentTime());
											});

											it('then settlementOwing is 0 for rebate and reclaim, with 1 entry', async () => {
												const {
													reclaimAmount,
													rebateAmount,
													numEntries,
												} = await exchanger.settlementOwing(account1, pETH);
												assert.equal(reclaimAmount, '0');
												assert.equal(rebateAmount, '0');
												assert.equal(numEntries, '1');
											});
											describe('and the waiting period expires', () => {
												beforeEach(async () => {
													// end waiting period
													await fastForward(await systemSettings.waitingPeriodSecs());
												});
												it('then the user can settle with no impact', async () => {
													const txn = await exchanger.settle(account1, pETH, { from: account1 });
													// Note: no need to decode the logs as they are emitted off the target contract Exchanger
													assert.equal(txn.logs.length, 1); // one settlement entry
													assert.eventEqual(txn, 'ExchangeEntrySettled', {
														reclaim: '0',
														rebate: '0',
													}); // with no reclaim or rebate
												});
											});
										});
										describe('and the aggregated rate is received but for a much higher roundId, leaving a large gap in roundIds', () => {
											beforeEach(async () => {
												await aggregator.setLatestAnswerWithRound(
													convertToAggregatorPrice(110),
													await currentTime(),
													'9999'
												);
											});

											it('then settlementOwing is 0 for rebate and reclaim, with 1 entry', async () => {
												const {
													reclaimAmount,
													rebateAmount,
													numEntries,
												} = await exchanger.settlementOwing(account1, pETH);
												assert.equal(reclaimAmount, '0');
												assert.equal(rebateAmount, '0');
												assert.equal(numEntries, '1');
											});

											describe('and the waiting period expires', () => {
												beforeEach(async () => {
													// end waiting period
													await fastForward(await systemSettings.waitingPeriodSecs());
												});
												it('then the user can settle with no impact', async () => {
													const txn = await exchanger.settle(account1, pETH, { from: account1 });
													// Note: no need to decode the logs as they are emitted off the target contract Exchanger
													assert.equal(txn.logs.length, 1); // one settlement entry
													assert.eventEqual(txn, 'ExchangeEntrySettled', {
														reclaim: '0',
														rebate: '0',
													}); // with no reclaim or rebate
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
		});
	};

	const itSetsExchangeFeeRateForPynths = () => {
		describe('Given pynth exchange fee rates to set', async () => {
			const fxBIPS = toUnit('0.01');
			const cryptoBIPS = toUnit('0.03');
			const empty = toBytes32('');

			describe('Given pynth exchange fee rates to update', async () => {
				const newFxBIPS = toUnit('0.02');
				const newCryptoBIPS = toUnit('0.04');

				beforeEach(async () => {
					// Store multiple rates
					await systemSettings.setExchangeFeeRateForPynths(
						[pUSD, pAUD, pBTC, pETH],
						[fxBIPS, fxBIPS, cryptoBIPS, cryptoBIPS],
						{
							from: owner,
						}
					);
				});

				it('when 1 exchange rate to update then overwrite existing rate', async () => {
					await systemSettings.setExchangeFeeRateForPynths([pUSD], [newFxBIPS], {
						from: owner,
					});
					const pUSDRate = await exchanger.feeRateForExchange(empty, pUSD);
					assert.bnEqual(pUSDRate, newFxBIPS);
				});

				it('when multiple exchange rates then store them to be readable', async () => {
					// Update multiple rates
					await systemSettings.setExchangeFeeRateForPynths(
						[pUSD, pAUD, pBTC, pETH],
						[newFxBIPS, newFxBIPS, newCryptoBIPS, newCryptoBIPS],
						{
							from: owner,
						}
					);
					// Read all rates
					const pAUDRate = await exchanger.feeRateForExchange(empty, pAUD);
					assert.bnEqual(pAUDRate, newFxBIPS);
					const pUSDRate = await exchanger.feeRateForExchange(empty, pUSD);
					assert.bnEqual(pUSDRate, newFxBIPS);
					const pBTCRate = await exchanger.feeRateForExchange(empty, pBTC);
					assert.bnEqual(pBTCRate, newCryptoBIPS);
					const pETHRate = await exchanger.feeRateForExchange(empty, pETH);
					assert.bnEqual(pETHRate, newCryptoBIPS);
				});
			});
		});
	};

	describe('When using PeriFinance', () => {
		before(async () => {
			({
				Exchanger: exchanger,
				PeriFinance: periFinance,
				ExchangeRates: exchangeRates,
				ExchangeState: exchangeState,
				FeePool: feePool,
				SystemStatus: systemStatus,
				PynthpUSD: pUSDContract,
				PynthpBTC: pBTCContract,
				PynthpEUR: pEURContract,
				PynthpAUD: pAUDContract,
				PynthiBTC: iBTCContract,
				PynthpETH: pETHContract,
				SystemSettings: systemSettings,
				DelegateApprovals: delegateApprovals,
				AddressResolver: resolver,
				DebtCache: debtCache,
				Issuer: issuer,
				FlexibleStorage: flexibleStorage,
				/* CrossChainManager: crossChainManager, */
			} = await setupAllContracts({
				accounts,
				pynths: ['pUSD', 'pETH', 'pEUR', 'pAUD', 'pBTC', 'iBTC', 'pTRX'],
				contracts: [
					'Exchanger',
					'ExchangeState',
					'ExchangeRates',
					'DebtCache',
					'Issuer', // necessary for periFinance transfers to succeed
					'FeePool',
					'FeePoolEternalStorage',
					'PeriFinance',
					'SystemStatus',
					'SystemSettings',
					'DelegateApprovals',
					'FlexibleStorage',
					'CollateralManager',
					'StakingStateUSDC',
					// 'CrossChainManager',
				],
			}));

			// Send a price update to guarantee we're not stale.
			oracle = account1;

			amountIssued = toUnit('1000');

			// give the first two accounts 1000 pUSD each
			await pUSDContract.issue(account1, amountIssued);
			await pUSDContract.issue(account2, amountIssued);

			aggregator = await MockAggregator.new({ from: owner });

			// await crossChainManager.appendTotalNetworkDebt(amountIssued.add(amountIssued), {
			// 	from: debtManager,
			// });
		});

		addSnapshotBeforeRestoreAfterEach();

		beforeEach(async () => {
			timestamp = await currentTime();
			await exchangeRates.updateRates(
				[pAUD, pEUR, PERI, pETH, pBTC, iBTC],
				['0.5', '2', '1', '100', '5000', '5000'].map(toUnit),
				timestamp,
				{
					from: oracle,
				}
			);

			// set a 0.5% exchange fee rate (1/200)
			exchangeFeeRate = toUnit('0.005');
			await setExchangeFeeRateForPynths({
				owner,
				systemSettings,
				pynthKeys,
				exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
			});
		});

		itReadsTheWaitingPeriod();

		itWhenTheWaitingPeriodIsZero();

		itDeviatesCorrectly();

		itCalculatesMaxSecsLeft();

		itCalculatesFeeRateForExchange();

		itCalculatesFeeRateForExchange2();

		itSettles();

		itCalculatesAmountAfterSettlement();

		itExchanges();

		itExchangesWithVirtual();

		itSetsLastExchangeRateForPynth();

		itPricesSpikeDeviation();

		itSetsExchangeFeeRateForPynths();
	}).timeout(90e3);

	describe.skip('When using MintablePeriFinance', () => {
		before(async () => {
			({
				Exchanger: exchanger,
				PeriFinance: periFinance,
				ExchangeRates: exchangeRates,
				ExchangeState: exchangeState,
				FeePool: feePool,
				SystemStatus: systemStatus,
				PynthpUSD: pUSDContract,
				PynthpBTC: pBTCContract,
				PynthpEUR: pEURContract,
				PynthpAUD: pAUDContract,
				PynthiBTC: iBTCContract,
				PynthpETH: pETHContract,
				SystemSettings: systemSettings,
				DelegateApprovals: delegateApprovals,
				AddressResolver: resolver,
				DebtCache: debtCache,
				Issuer: issuer,
				FlexibleStorage: flexibleStorage,
			} = await setupAllContracts({
				accounts,
				pynths: ['pUSD', 'pETH', 'pEUR', 'pAUD', 'pBTC', 'iBTC', 'pTRX'],
				contracts: [
					'Exchanger',
					'ExchangeState',
					'ExchangeRates',
					'DebtCache',
					'Issuer', // necessary for periFinance transfers to succeed
					'FeePool',
					'FeePoolEternalStorage',
					'MintablePeriFinance',
					'SystemStatus',
					'SystemSettings',
					'DelegateApprovals',
					'FlexibleStorage',
					'CollateralManager',
					'StakingState',
					'CrossChainManager',
				],
			}));

			// Send a price update to guarantee we're not stale.
			oracle = account1;

			amountIssued = toUnit('1000');

			// give the first two accounts 1000 pUSD each
			await pUSDContract.issue(account1, amountIssued);
			await pUSDContract.issue(account2, amountIssued);

			// await crossChainManager.appendTotalNetworkDebt(amountIssued * 2, {
			// 	from: debtManager,
			// });
		});

		addSnapshotBeforeRestoreAfterEach();

		beforeEach(async () => {
			timestamp = await currentTime();
			await exchangeRates.updateRates(
				[pAUD, pEUR, PERI, pETH, pBTC, iBTC],
				['0.5', '2', '1', '100', '5000', '5000'].map(toUnit),
				timestamp,
				{
					from: oracle,
				}
			);

			// set a 0.5% exchange fee rate (1/200)
			exchangeFeeRate = toUnit('0.005');
			await setExchangeFeeRateForPynths({
				owner,
				systemSettings,
				pynthKeys,
				exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
			});
		});

		itReadsTheWaitingPeriod();

		itWhenTheWaitingPeriodIsZero();

		itDeviatesCorrectly();

		itCalculatesMaxSecsLeft();

		itCalculatesFeeRateForExchange();

		itCalculatesFeeRateForExchange2();

		itSettles();

		itCalculatesAmountAfterSettlement();

		itExchanges();

		itSetsLastExchangeRateForPynth();

		itPricesSpikeDeviation();

		itSetsExchangeFeeRateForPynths();
	});
});
