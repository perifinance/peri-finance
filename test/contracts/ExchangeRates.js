'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { currentTime, fastForward, toUnit, bytesToString } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
	// convertToDecimals,
} = require('./helpers');

const { setupContract, setupAllContracts } = require('./setup');

const {
	toBytes32,
	// constants: { ZERO_ADDRESS },
	defaults: { RATE_STALE_PERIOD },
} = require('../..');

// const { toBN } = require('web3-utils');

const MockAggregator = artifacts.require('MockAggregatorV2V3');

const getRandomCurrencyKey = () =>
	Math.random()
		.toString(36)
		.substring(2, 6)
		.toUpperCase();

const createRandomKeysAndRates = quantity => {
	const uniqueCurrencyKeys = {};
	for (let i = 0; i < quantity; i++) {
		const rate = Math.random() * 100;
		const key = toBytes32(getRandomCurrencyKey());
		uniqueCurrencyKeys[key] = web3.utils.toWei(rate.toFixed(18), 'ether');
	}

	const rates = [];
	const currencyKeys = [];
	Object.entries(uniqueCurrencyKeys).forEach(([key, rate]) => {
		currencyKeys.push(key);
		rates.push(rate);
	});

	return { currencyKeys, rates };
};

contract('Exchange Rates', async accounts => {
	const [deployerAccount, owner, oracle, accountOne, accountTwo] = accounts;
	const [PERI, pUSD, pEUR, pAUD] = ['PERI', 'pUSD', 'pEUR', 'pAUD', 'fastGasPrice'].map(toBytes32);
	let instance;
	let systemSettings;
	let aggregatorJPY;
	let aggregatorXTZ;
	let aggregatorFastGasPrice;
	let initialTime;
	let timeSent;
	let resolver;
	let mockFlagsInterface;

	before(async () => {
		initialTime = await currentTime();
		({
			ExchangeRates: instance,
			SystemSettings: systemSettings,
			AddressResolver: resolver,
		} = await setupAllContracts({
			accounts,
			contracts: ['ExchangeRates', 'SystemSettings', 'AddressResolver', 'StakingStateUSDC'],
		}));

		aggregatorJPY = await MockAggregator.new({ from: owner });
		aggregatorXTZ = await MockAggregator.new({ from: owner });
		aggregatorFastGasPrice = await MockAggregator.new({ from: owner });

		aggregatorJPY.setDecimals('8');
		aggregatorXTZ.setDecimals('8');
		aggregatorFastGasPrice.setDecimals('0');

		// create but don't connect up the mock flags interface yet
		mockFlagsInterface = await artifacts.require('MockFlagsInterface').new();
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timeSent = await currentTime();
	});

	it('only expected functions should be mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: instance.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'addAggregator',
				'deleteRate',
				'freezeRate',
				'removeAggregator',
				'removeInversePricing',
				'setInversePricing',
				'setOracle',
				'updateRates',
				'setCurrencyToExternalAggregator',
			],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.oracle(), oracle);

			assert.etherEqual(await instance.rateForCurrency(pUSD), '1');
			assert.etherEqual(await instance.rateForCurrency(PERI), '0.2');

			// Ensure that when the rate isn't found, 0 is returned as the exchange rate.
			assert.etherEqual(await instance.rateForCurrency(toBytes32('OTHER')), '0');

			const lastUpdatedTimeSUSD = await instance.lastRateUpdateTimes.call(pUSD);
			assert.isAtLeast(lastUpdatedTimeSUSD.toNumber(), initialTime);

			const lastUpdatedTimeOTHER = await instance.lastRateUpdateTimes.call(toBytes32('OTHER'));
			assert.equal(lastUpdatedTimeOTHER.toNumber(), 0);

			const lastUpdatedTimePERI = await instance.lastRateUpdateTimes.call(PERI);
			assert.isAtLeast(lastUpdatedTimePERI.toNumber(), initialTime);

			const pUSDRate = await instance.rateForCurrency(pUSD);
			assert.bnEqual(pUSDRate, toUnit('1'));
		});

		it('two different currencies in same array should mean that the second one overrides', async () => {
			const creationTime = await currentTime();
			const firstAmount = '4.33';
			const secondAmount = firstAmount + 10;
			const instance = await setupContract({
				accounts,
				contract: 'ExchangeRates',
				args: [
					owner,
					oracle,
					resolver.address,
					[toBytes32('CARTER'), toBytes32('CARTOON')],
					[web3.utils.toWei(firstAmount, 'ether'), web3.utils.toWei(secondAmount, 'ether')],
				],
			});

			assert.etherEqual(await instance.rateForCurrency(toBytes32('CARTER')), firstAmount);
			assert.etherEqual(await instance.rateForCurrency(toBytes32('CARTOON')), secondAmount);

			const lastUpdatedTime = await instance.lastRateUpdateTimes.call(toBytes32('CARTER'));
			assert.isAtLeast(lastUpdatedTime.toNumber(), creationTime);
		});

		it('should revert when number of currency keys > new rates length on create', async () => {
			await assert.revert(
				setupContract({
					accounts,
					contract: 'ExchangeRates',
					args: [
						owner,
						oracle,
						resolver.address,
						[PERI, toBytes32('GOLD')],
						[web3.utils.toWei('0.2', 'ether')],
					],
				}),
				'Currency key length and rate length must match'
			);
		});

		it('should limit to 32 bytes if currency key > 32 bytes on create', async () => {
			const creationTime = await currentTime();
			const amount = '4.33';
			const instance = await setupContract({
				accounts,
				contract: 'ExchangeRates',
				args: [
					owner,
					oracle,
					resolver.address,
					[toBytes32('ABCDEFGHIJKLMNOPQRSTUVXYZ1234567')],
					[web3.utils.toWei(amount, 'ether')],
				],
			});

			assert.etherEqual(
				await instance.rateForCurrency(toBytes32('ABCDEFGHIJKLMNOPQRSTUVXYZ1234567')),
				amount
			);
			assert.etherNotEqual(
				await instance.rateForCurrency(toBytes32('ABCDEFGHIJKLMNOPQRSTUVXYZ123456')),
				amount
			);

			const lastUpdatedTime = await instance.lastRateUpdateTimes.call(
				toBytes32('ABCDEFGHIJKLMNOPQRSTUVXYZ1234567')
			);
			assert.isAtLeast(lastUpdatedTime.toNumber(), creationTime);
		});

		it("shouldn't be able to set exchange rate to 0 on create", async () => {
			await assert.revert(
				setupContract({
					accounts,
					contract: 'ExchangeRates',
					args: [owner, oracle, resolver.address, [PERI], ['0']],
				}),
				'Zero is not a valid rate, please call deleteRate instead'
			);
		});

		it('should be able to handle lots of currencies on creation', async () => {
			const creationTime = await currentTime();
			const numberOfCurrencies = 100;
			const { currencyKeys, rates } = createRandomKeysAndRates(numberOfCurrencies);

			const instance = await setupContract({
				accounts,
				contract: 'ExchangeRates',
				args: [owner, oracle, resolver.address, currencyKeys, rates],
			});

			for (let i = 0; i < currencyKeys.length; i++) {
				assert.bnEqual(await instance.rateForCurrency(currencyKeys[i]), rates[i]);
				const lastUpdatedTime = await instance.lastRateUpdateTimes.call(currencyKeys[i]);
				assert.isAtLeast(lastUpdatedTime.toNumber(), creationTime);
			}
		});
	});

	describe('updateRates()', () => {
		it('should be able to update rates of only one currency without affecting other rates', async () => {
			await fastForward(1);

			await instance.updateRates(
				[toBytes32('lABC'), toBytes32('lDEF'), toBytes32('lGHI')],
				[
					web3.utils.toWei('1.3', 'ether'),
					web3.utils.toWei('2.4', 'ether'),
					web3.utils.toWei('3.5', 'ether'),
				],
				timeSent,
				{ from: oracle }
			);

			await fastForward(10);
			const updatedTime = timeSent + 10;

			const updatedRate = '64.33';
			await instance.updateRates(
				[toBytes32('lABC')],
				[web3.utils.toWei(updatedRate, 'ether')],
				updatedTime,
				{ from: oracle }
			);

			const updatedTimelDEF = await instance.lastRateUpdateTimes.call(toBytes32('lDEF'));
			const updatedTimelGHI = await instance.lastRateUpdateTimes.call(toBytes32('lGHI'));

			assert.etherEqual(await instance.rateForCurrency(toBytes32('lABC')), updatedRate);
			assert.etherEqual(await instance.rateForCurrency(toBytes32('lDEF')), '2.4');
			assert.etherEqual(await instance.rateForCurrency(toBytes32('lGHI')), '3.5');

			const lastUpdatedTimeLABC = await instance.lastRateUpdateTimes.call(toBytes32('lABC'));
			assert.equal(lastUpdatedTimeLABC.toNumber(), updatedTime);
			const lastUpdatedTimeLDEF = await instance.lastRateUpdateTimes.call(toBytes32('lDEF'));
			assert.equal(lastUpdatedTimeLDEF.toNumber(), updatedTimelDEF.toNumber());
			const lastUpdatedTimeLGHI = await instance.lastRateUpdateTimes.call(toBytes32('lGHI'));
			assert.equal(lastUpdatedTimeLGHI.toNumber(), updatedTimelGHI.toNumber());
		});

		it('should be able to update rates of all currencies', async () => {
			await fastForward(1);

			await instance.updateRates(
				[toBytes32('lABC'), toBytes32('lDEF'), toBytes32('lGHI')],
				[
					web3.utils.toWei('1.3', 'ether'),
					web3.utils.toWei('2.4', 'ether'),
					web3.utils.toWei('3.5', 'ether'),
				],
				timeSent,
				{ from: oracle }
			);

			await fastForward(5);
			const updatedTime = timeSent + 5;

			const updatedRate1 = '64.33';
			const updatedRate2 = '2.54';
			const updatedRate3 = '10.99';
			await instance.updateRates(
				[toBytes32('lABC'), toBytes32('lDEF'), toBytes32('lGHI')],
				[
					web3.utils.toWei(updatedRate1, 'ether'),
					web3.utils.toWei(updatedRate2, 'ether'),
					web3.utils.toWei(updatedRate3, 'ether'),
				],
				updatedTime,
				{ from: oracle }
			);

			assert.etherEqual(await instance.rateForCurrency(toBytes32('lABC')), updatedRate1);
			assert.etherEqual(await instance.rateForCurrency(toBytes32('lDEF')), updatedRate2);
			assert.etherEqual(await instance.rateForCurrency(toBytes32('lGHI')), updatedRate3);

			const lastUpdatedTimeLABC = await instance.lastRateUpdateTimes.call(toBytes32('lABC'));
			assert.equal(lastUpdatedTimeLABC.toNumber(), updatedTime);
			const lastUpdatedTimeLDEF = await instance.lastRateUpdateTimes.call(toBytes32('lDEF'));
			assert.equal(lastUpdatedTimeLDEF.toNumber(), updatedTime);
			const lastUpdatedTimeLGHI = await instance.lastRateUpdateTimes.call(toBytes32('lGHI'));
			assert.equal(lastUpdatedTimeLGHI.toNumber(), updatedTime);
		});

		it('should revert when trying to set pUSD price', async () => {
			await fastForward(1);

			await assert.revert(
				instance.updateRates([pUSD], [web3.utils.toWei('1.0', 'ether')], timeSent, {
					from: oracle,
				}),
				"Rate of pUSD cannot be updated, it's always UNIT"
			);
		});

		it('should emit RatesUpdated event when rate updated', async () => {
			const rates = [
				web3.utils.toWei('1.3', 'ether'),
				web3.utils.toWei('2.4', 'ether'),
				web3.utils.toWei('3.5', 'ether'),
			];

			const keys = ['lABC', 'lDEF', 'lGHI'];
			const currencyKeys = keys.map(toBytes32);
			const txn = await instance.updateRates(currencyKeys, rates, await currentTime(), {
				from: oracle,
			});

			assert.eventEqual(txn, 'RatesUpdated', {
				currencyKeys,
				newRates: rates,
			});
		});

		it('should be able to handle lots of currency updates', async () => {
			const numberOfCurrencies = 150;
			const { currencyKeys, rates } = createRandomKeysAndRates(numberOfCurrencies);

			const updatedTime = await currentTime();
			await instance.updateRates(currencyKeys, rates, updatedTime, { from: oracle });

			for (let i = 0; i < currencyKeys.length; i++) {
				assert.equal(await instance.rateForCurrency(currencyKeys[i]), rates[i]);
				const lastUpdatedTime = await instance.lastRateUpdateTimes.call(currencyKeys[i]);
				assert.equal(lastUpdatedTime.toNumber(), updatedTime);
			}
		});

		it('should revert when currency keys length != new rates length on update', async () => {
			await assert.revert(
				instance.updateRates(
					[pUSD, PERI, toBytes32('GOLD')],
					[web3.utils.toWei('1', 'ether'), web3.utils.toWei('0.2', 'ether')],
					await currentTime(),
					{ from: oracle }
				),
				'Currency key array length must match rates array length'
			);
		});

		it('should not be able to set exchange rate to 0 on update', async () => {
			await assert.revert(
				instance.updateRates(
					[toBytes32('ZERO')],
					[web3.utils.toWei('0', 'ether')],
					await currentTime(),
					{ from: oracle }
				),
				'Zero is not a valid rate, please call deleteRate instead'
			);
		});

		it('only oracle can update exchange rates', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: instance.updateRates,
				args: [
					[toBytes32('GOLD'), toBytes32('FOOL')],
					[web3.utils.toWei('10', 'ether'), web3.utils.toWei('0.9', 'ether')],
					timeSent,
				],
				address: oracle,
				accounts,
				skipPassCheck: true,
				reason: 'Only the oracle can perform this action',
			});

			assert.etherNotEqual(await instance.rateForCurrency(toBytes32('GOLD')), '10');
			assert.etherNotEqual(await instance.rateForCurrency(toBytes32('FOOL')), '0.9');

			const updatedTime = await currentTime();

			await instance.updateRates(
				[toBytes32('GOLD'), toBytes32('FOOL')],
				[web3.utils.toWei('10', 'ether'), web3.utils.toWei('0.9', 'ether')],
				updatedTime,
				{ from: oracle }
			);
			assert.etherEqual(await instance.rateForCurrency(toBytes32('GOLD')), '10');
			assert.etherEqual(await instance.rateForCurrency(toBytes32('FOOL')), '0.9');

			const lastUpdatedTimeGOLD = await instance.lastRateUpdateTimes.call(toBytes32('GOLD'));
			assert.equal(lastUpdatedTimeGOLD.toNumber(), updatedTime);
			const lastUpdatedTimeFOOL = await instance.lastRateUpdateTimes.call(toBytes32('FOOL'));
			assert.equal(lastUpdatedTimeFOOL.toNumber(), updatedTime);
		});

		it('should not be able to update rates if they are too far in the future', async () => {
			const timeTooFarInFuture = (await currentTime()) + 10 * 61;
			await assert.revert(
				instance.updateRates(
					[toBytes32('GOLD')],
					[web3.utils.toWei('1', 'ether')],
					timeTooFarInFuture,
					{ from: oracle }
				),
				'Time is too far into the future'
			);
		});
	});

	describe('setOracle()', () => {
		it("only the owner should be able to change the oracle's address", async () => {
			await onlyGivenAddressCanInvoke({
				fnc: instance.setOracle,
				args: [oracle],
				address: owner,
				accounts,
				skipPassCheck: true,
			});

			await instance.setOracle(accountOne, { from: owner });

			assert.equal(await instance.oracle.call(), accountOne);
			assert.notEqual(await instance.oracle.call(), oracle);
		});

		it('should emit event on successful oracle address update', async () => {
			// Ensure oracle is set to oracle address originally
			await instance.setOracle(oracle, { from: owner });
			assert.equal(await instance.oracle.call(), oracle);

			const txn = await instance.setOracle(accountOne, { from: owner });
			assert.eventEqual(txn, 'OracleUpdated', {
				newOracle: accountOne,
			});
		});
	});

	describe('setCurrencyToExternalAggregator()', () => {
		it('only the owner should be able to currency external status', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: instance.setCurrencyToExternalAggregator,
				args: [toBytes32('USDC'), true],
				address: owner,
				accounts,
				skipPassCheck: true,
			});

			await instance.setCurrencyToExternalAggregator(toBytes32('USDC'), true, { from: owner });

			assert.equal(await instance.currencyByExternal(toBytes32('USDC')), true);
		});
	});

	describe('deleteRate()', () => {
		it('should be able to remove specific rate', async () => {
			const foolsRate = '0.002';
			const encodedRateGOLD = toBytes32('GOLD');

			await instance.updateRates(
				[encodedRateGOLD, toBytes32('FOOL')],
				[web3.utils.toWei('10.123', 'ether'), web3.utils.toWei(foolsRate, 'ether')],
				timeSent,
				{ from: oracle }
			);

			const beforeRate = await instance.rateForCurrency(encodedRateGOLD);
			const beforeRateUpdatedTime = await instance.lastRateUpdateTimes.call(encodedRateGOLD);

			await instance.deleteRate(encodedRateGOLD, { from: oracle });

			const afterRate = await instance.rateForCurrency(encodedRateGOLD);
			const afterRateUpdatedTime = await instance.lastRateUpdateTimes.call(encodedRateGOLD);
			assert.notEqual(afterRate, beforeRate);
			assert.equal(afterRate, '0');
			assert.notEqual(afterRateUpdatedTime, beforeRateUpdatedTime);
			assert.equal(afterRateUpdatedTime, '0');

			// Other rates are unaffected
			assert.etherEqual(await instance.rateForCurrency(toBytes32('FOOL')), foolsRate);
		});

		it.skip('only oracle can delete a rate', async () => {
			// Assume that the contract is already set up with a valid oracle account called 'oracle'

			const encodedRateName = toBytes32('COOL');
			await instance.updateRates(
				[encodedRateName],
				[web3.utils.toWei('10.123', 'ether')],
				await currentTime(),
				{ from: oracle }
			);

			await onlyGivenAddressCanInvoke({
				fnc: instance.deleteRate,
				args: [encodedRateName],
				accounts,
				address: oracle,
				reason: 'Only the oracle can perform this action',
			});
		});

		it.skip("deleting rate that doesn't exist causes revert", async () => {
			// This key shouldn't exist but let's do the best we can to ensure that it doesn't
			const encodedCurrencyKey = toBytes32('7NEQ');
			const currentRate = await instance.rateForCurrency(encodedCurrencyKey);
			if (currentRate > 0) {
				await instance.deleteRate(encodedCurrencyKey, { from: oracle });
			}

			// Ensure rate deletion attempt results in revert
			await assert.revert(
				instance.deleteRate(encodedCurrencyKey, { from: oracle }),
				'Rate is zero'
			);
			assert.etherEqual(await instance.rateForCurrency(encodedCurrencyKey), '0');
		});

		it('should emit RateDeleted event when rate deleted', async () => {
			const updatedTime = await currentTime();
			const rate = 'EUR';
			const encodedRate = toBytes32(rate);
			await instance.updateRates(
				[encodedRate],
				[web3.utils.toWei('1.0916', 'ether')],
				updatedTime,
				{
					from: oracle,
				}
			);

			const txn = await instance.deleteRate(encodedRate, { from: oracle });
			assert.eventEqual(txn, 'RateDeleted', { currencyKey: encodedRate });
		});
	});

	describe('getting rates', () => {
		it('should be able to get exchange rate with key', async () => {
			const updatedTime = await currentTime();
			const encodedRate = toBytes32('GOLD');
			const rateValueEncodedStr = web3.utils.toWei('10.123', 'ether');
			await instance.updateRates([encodedRate], [rateValueEncodedStr], updatedTime, {
				from: oracle,
			});

			const rate = await instance.rateForCurrency(encodedRate);
			assert.equal(rate, rateValueEncodedStr);
		});

		it('all users should be able to get exchange rate with key', async () => {
			const updatedTime = await currentTime();
			const encodedRate = toBytes32('FETC');
			const rateValueEncodedStr = web3.utils.toWei('910.6661293879', 'ether');
			await instance.updateRates([encodedRate], [rateValueEncodedStr], updatedTime, {
				from: oracle,
			});

			await instance.rateForCurrency(encodedRate, { from: accountOne });
			await instance.rateForCurrency(encodedRate, { from: accountTwo });
			await instance.rateForCurrency(encodedRate, { from: oracle });
			await instance.rateForCurrency(encodedRate, { from: owner });
			await instance.rateForCurrency(encodedRate, { from: deployerAccount });
		});

		it('Fetching non-existent rate returns 0', async () => {
			const encodedRateKey = toBytes32('GOLD');
			const currentRate = await instance.rateForCurrency(encodedRateKey);
			if (currentRate > 0) {
				await instance.deleteRate(encodedRateKey, { from: oracle });
			}

			const rate = await instance.rateForCurrency(encodedRateKey);
			assert.equal(rate.toString(), '0');
		});

		it('should be able to get the latest exchange rate and updated time', async () => {
			const updatedTime = await currentTime();
			const encodedRate = toBytes32('GOLD');
			const rateValueEncodedStr = web3.utils.toWei('10.123', 'ether');
			await instance.updateRates([encodedRate], [rateValueEncodedStr], updatedTime, {
				from: oracle,
			});

			const rateAndTime = await instance.rateAndUpdatedTime(encodedRate);
			assert.equal(rateAndTime.rate, rateValueEncodedStr);
			assert.bnEqual(rateAndTime.time, updatedTime);
		});
	});

	// describe('getting rates by external aggregator', () => {
	// 	const encodedRate = toBytes32('GOLD');
	// 	const rateValueEncodedStr = web3.utils.toWei('10.123', 'ether');
	// 	beforeEach(async () => {
	// 		const updatedTime = await currentTime();

	// 		await instance.updateRates([encodedRate], [rateValueEncodedStr], updatedTime, {
	// 			from: oracle,
	// 		});

	// 		const rate = await instance.rateForCurrency(encodedRate);
	// 		assert.equal(rate, rateValueEncodedStr);

	// 		await instance.setExternalRateAggregator(externalRateAggregator.address, { from: owner });
	// 	});

	// 	it('should get rate from external aggregator', async () => {
	// 		await instance.setCurrencyToExternalAggregator(encodedRate, true, { from: owner });

	// 		const rate = await instance.rateForCurrency(encodedRate);
	// 		assert.equal(rate.toString(), '0');

	// 		const newRate = toUnit('1010');
	// 		const updatedTime = await currentTime();
	// 		await externalRateAggregator.updateRates([encodedRate], [newRate], updatedTime, {
	// 			from: oracle,
	// 		});

	// 		const rate2 = await instance.rateForCurrency(encodedRate);
	// 		assert.bnEqual(rate2.toString(), toUnit('1010'));

	// 		await instance.setCurrencyToExternalAggregator(encodedRate, false, { from: owner });

	// 		const rate3 = await instance.rateForCurrency(encodedRate);
	// 		assert.bnEqual(rate3.toString(), rateValueEncodedStr);
	// 	});
	// });

	describe('rateStalePeriod', () => {
		it('rateStalePeriod default is set correctly', async () => {
			assert.bnEqual(await instance.rateStalePeriod(), RATE_STALE_PERIOD);
		});
		describe('when rate stale is changed in the system settings', () => {
			const newRateStalePeriod = '3601';
			beforeEach(async () => {
				await systemSettings.setRateStalePeriod(newRateStalePeriod, { from: owner });
			});
			it('then rateStalePeriod is correctly updated', async () => {
				assert.bnEqual(await instance.rateStalePeriod(), newRateStalePeriod);
			});
		});
	});

	describe('rateIsStale()', () => {
		it('should never allow pUSD to go stale via rateIsStale', async () => {
			await fastForward(await instance.rateStalePeriod());
			const rateIsStale = await instance.rateIsStale(pUSD);
			assert.equal(rateIsStale, false);
		});

		it('check if a single rate is stale', async () => {
			// Set up rates for test
			await systemSettings.setRateStalePeriod(30, { from: owner });
			const updatedTime = await currentTime();
			await instance.updateRates(
				[toBytes32('ABC')],
				[web3.utils.toWei('2', 'ether')],
				updatedTime,
				{
					from: oracle,
				}
			);
			await fastForward(31);

			const rateIsStale = await instance.rateIsStale(toBytes32('ABC'));
			assert.equal(rateIsStale, true);
		});

		it('check if a single rate is not stale', async () => {
			// Set up rates for test
			await systemSettings.setRateStalePeriod(30, { from: owner });
			const updatedTime = await currentTime();
			await instance.updateRates(
				[toBytes32('ABC')],
				[web3.utils.toWei('2', 'ether')],
				updatedTime,
				{
					from: oracle,
				}
			);
			await fastForward(28);

			const rateIsStale = await instance.rateIsStale(toBytes32('ABC'));
			assert.equal(rateIsStale, false);
		});

		it('ensure rate is considered stale if not set', async () => {
			// Set up rates for test
			await systemSettings.setRateStalePeriod(30, { from: owner });
			const encodedRateKey = toBytes32('GOLD');
			const currentRate = await instance.rateForCurrency(encodedRateKey);
			if (currentRate > 0) {
				await instance.deleteRate(encodedRateKey, { from: oracle });
			}

			const rateIsStale = await instance.rateIsStale(encodedRateKey);
			assert.equal(rateIsStale, true);
		});

		it('make sure anyone can check if rate is stale', async () => {
			const rateKey = toBytes32('ABC');
			await instance.rateIsStale(rateKey, { from: oracle });
			await instance.rateIsStale(rateKey, { from: owner });
			await instance.rateIsStale(rateKey, { from: deployerAccount });
			await instance.rateIsStale(rateKey, { from: accountOne });
			await instance.rateIsStale(rateKey, { from: accountTwo });
		});
	});

	describe('anyRateIsInvalid()', () => {
		describe('stale scenarios', () => {
			it('should never allow pUSD to go stale via anyRateIsInvalid', async () => {
				const keysArray = [PERI, toBytes32('GOLD')];

				await instance.updateRates(
					keysArray,
					[web3.utils.toWei('0.1', 'ether'), web3.utils.toWei('0.2', 'ether')],
					await currentTime(),
					{ from: oracle }
				);
				assert.equal(await instance.anyRateIsInvalid(keysArray), false);

				await fastForward(await instance.rateStalePeriod());

				await instance.updateRates(
					[PERI, toBytes32('GOLD')],
					[web3.utils.toWei('0.1', 'ether'), web3.utils.toWei('0.2', 'ether')],
					await currentTime(),
					{ from: oracle }
				);

				// Even though pUSD hasn't been updated since the stale rate period has expired,
				// we expect that pUSD remains "not stale"
				assert.equal(await instance.anyRateIsInvalid(keysArray), false);
			});

			it('should be able to confirm no rates are stale from a subset', async () => {
				// Set up rates for test
				await systemSettings.setRateStalePeriod(25, { from: owner });
				const encodedRateKeys1 = [
					toBytes32('ABC'),
					toBytes32('DEF'),
					toBytes32('GHI'),
					toBytes32('LMN'),
				];
				const encodedRateKeys2 = [
					toBytes32('OPQ'),
					toBytes32('RST'),
					toBytes32('UVW'),
					toBytes32('XYZ'),
				];
				const encodedRateKeys3 = [toBytes32('123'), toBytes32('456'), toBytes32('789')];
				const encodedRateValues1 = [
					web3.utils.toWei('1', 'ether'),
					web3.utils.toWei('2', 'ether'),
					web3.utils.toWei('3', 'ether'),
					web3.utils.toWei('4', 'ether'),
				];
				const encodedRateValues2 = [
					web3.utils.toWei('5', 'ether'),
					web3.utils.toWei('6', 'ether'),
					web3.utils.toWei('7', 'ether'),
					web3.utils.toWei('8', 'ether'),
				];
				const encodedRateValues3 = [
					web3.utils.toWei('9', 'ether'),
					web3.utils.toWei('10', 'ether'),
					web3.utils.toWei('11', 'ether'),
				];
				const updatedTime1 = await currentTime();
				await instance.updateRates(encodedRateKeys1, encodedRateValues1, updatedTime1, {
					from: oracle,
				});
				await fastForward(5);
				const updatedTime2 = await currentTime();
				await instance.updateRates(encodedRateKeys2, encodedRateValues2, updatedTime2, {
					from: oracle,
				});
				await fastForward(5);
				const updatedTime3 = await currentTime();
				await instance.updateRates(encodedRateKeys3, encodedRateValues3, updatedTime3, {
					from: oracle,
				});

				await fastForward(12);
				const rateIsInvalid = await instance.anyRateIsInvalid([
					...encodedRateKeys2,
					...encodedRateKeys3,
				]);
				assert.equal(rateIsInvalid, false);
			});

			it('should be able to confirm a single rate is stale from a set of rates', async () => {
				// Set up rates for test
				await systemSettings.setRateStalePeriod(40, { from: owner });
				const encodedRateKeys1 = [
					toBytes32('ABC'),
					toBytes32('DEF'),
					toBytes32('GHI'),
					toBytes32('LMN'),
				];
				const encodedRateKeys2 = [toBytes32('OPQ')];
				const encodedRateKeys3 = [toBytes32('RST'), toBytes32('UVW'), toBytes32('XYZ')];
				const encodedRateValues1 = [
					web3.utils.toWei('1', 'ether'),
					web3.utils.toWei('2', 'ether'),
					web3.utils.toWei('3', 'ether'),
					web3.utils.toWei('4', 'ether'),
				];
				const encodedRateValues2 = [web3.utils.toWei('5', 'ether')];
				const encodedRateValues3 = [
					web3.utils.toWei('6', 'ether'),
					web3.utils.toWei('7', 'ether'),
					web3.utils.toWei('8', 'ether'),
				];

				const updatedTime2 = await currentTime();
				await instance.updateRates(encodedRateKeys2, encodedRateValues2, updatedTime2, {
					from: oracle,
				});
				await fastForward(20);

				const updatedTime1 = await currentTime();
				await instance.updateRates(encodedRateKeys1, encodedRateValues1, updatedTime1, {
					from: oracle,
				});
				await fastForward(15);
				const updatedTime3 = await currentTime();
				await instance.updateRates(encodedRateKeys3, encodedRateValues3, updatedTime3, {
					from: oracle,
				});

				await fastForward(6);
				const rateIsInvalid = await instance.anyRateIsInvalid([
					...encodedRateKeys2,
					...encodedRateKeys3,
				]);
				assert.equal(rateIsInvalid, true);
			});

			it('should be able to confirm a single rate (from a set of 1) is stale', async () => {
				// Set up rates for test
				await systemSettings.setRateStalePeriod(40, { from: owner });
				const updatedTime = await currentTime();
				await instance.updateRates(
					[toBytes32('ABC')],
					[web3.utils.toWei('2', 'ether')],
					updatedTime,
					{
						from: oracle,
					}
				);
				await fastForward(41);

				const rateIsInvalid = await instance.anyRateIsInvalid([toBytes32('ABC')]);
				assert.equal(rateIsInvalid, true);
			});

			it('make sure anyone can check if any rates are stale', async () => {
				const rateKey = toBytes32('ABC');
				await instance.anyRateIsInvalid([rateKey], { from: oracle });
				await instance.anyRateIsInvalid([rateKey], { from: owner });
				await instance.anyRateIsInvalid([rateKey], { from: deployerAccount });
				await instance.anyRateIsInvalid([rateKey], { from: accountOne });
				await instance.anyRateIsInvalid([rateKey], { from: accountTwo });
			});

			it('ensure rates are considered stale if not set', async () => {
				// Set up rates for test
				await systemSettings.setRateStalePeriod(40, { from: owner });
				const encodedRateKeys1 = [
					toBytes32('ABC'),
					toBytes32('DEF'),
					toBytes32('GHI'),
					toBytes32('LMN'),
				];
				const encodedRateValues1 = [
					web3.utils.toWei('1', 'ether'),
					web3.utils.toWei('2', 'ether'),
					web3.utils.toWei('3', 'ether'),
					web3.utils.toWei('4', 'ether'),
				];

				const updatedTime1 = await currentTime();
				await instance.updateRates(encodedRateKeys1, encodedRateValues1, updatedTime1, {
					from: oracle,
				});
				const rateIsInvalid = await instance.anyRateIsInvalid([
					...encodedRateKeys1,
					toBytes32('RST'),
				]);
				assert.equal(rateIsInvalid, true);
			});
		});
	});

	describe('lastRateUpdateTimesForCurrencies()', () => {
		it('should return correct last rate update times for specific currencies', async () => {
			const abc = toBytes32('lABC');
			const timeSent = await currentTime();
			const listOfKeys = [abc, toBytes32('lDEF'), toBytes32('lGHI')];
			await instance.updateRates(
				listOfKeys.slice(0, 2),
				[web3.utils.toWei('1.3', 'ether'), web3.utils.toWei('2.4', 'ether')],
				timeSent,
				{ from: oracle }
			);

			await fastForward(100);
			const newTimeSent = await currentTime();
			await instance.updateRates(
				listOfKeys.slice(2),
				[web3.utils.toWei('3.5', 'ether')],
				newTimeSent,
				{ from: oracle }
			);

			const lastUpdateTimes = await instance.lastRateUpdateTimesForCurrencies(listOfKeys);
			assert.notEqual(timeSent, newTimeSent);
			assert.equal(lastUpdateTimes.length, listOfKeys.length);
			assert.equal(lastUpdateTimes[0], timeSent);
			assert.equal(lastUpdateTimes[1], timeSent);
			assert.equal(lastUpdateTimes[2], newTimeSent);
		});

		it('should return correct last rate update time for a specific currency', async () => {
			const abc = toBytes32('lABC');
			const def = toBytes32('lDEF');
			const ghi = toBytes32('lGHI');
			const timeSent = await currentTime();
			await instance.updateRates(
				[abc, def],
				[web3.utils.toWei('1.3', 'ether'), web3.utils.toWei('2.4', 'ether')],
				timeSent,
				{ from: oracle }
			);
			await fastForward(10000);
			const timeSent2 = await currentTime();
			await instance.updateRates([ghi], [web3.utils.toWei('2.4', 'ether')], timeSent2, {
				from: oracle,
			});

			const [firstTS, secondTS] = await Promise.all([
				instance.lastRateUpdateTimes(abc),
				instance.lastRateUpdateTimes(ghi),
			]);
			assert.equal(firstTS, timeSent);
			assert.equal(secondTS, timeSent2);
		});
	});

	describe('effectiveValue() and effectiveValueAndRates()', () => {
		let timestamp;
		beforeEach(async () => {
			timestamp = await currentTime();
		});

		describe('when a price is sent to the oracle', () => {
			beforeEach(async () => {
				// Send a price update to guarantee we're not depending on values from outside this test.
				await instance.updateRates(
					['pAUD', 'pEUR', 'PERI'].map(toBytes32),
					['0.5', '1.25', '0.1'].map(toUnit),
					timestamp,
					{ from: oracle }
				);
			});
			it('should correctly calculate an exchange rate in effectiveValue()', async () => {
				// 1 pUSD should be worth 2 pAUD.
				assert.bnEqual(await instance.effectiveValue(pUSD, toUnit('1'), pAUD), toUnit('2'));

				// 10 PERI should be worth 1 pUSD.
				assert.bnEqual(await instance.effectiveValue(PERI, toUnit('10'), pUSD), toUnit('1'));

				// 2 pEUR should be worth 2.50 pUSD
				assert.bnEqual(await instance.effectiveValue(pEUR, toUnit('2'), pUSD), toUnit('2.5'));
			});

			it('should calculate updated rates in effectiveValue()', async () => {
				// Add stale period to the time to ensure we go stale.
				await fastForward((await instance.rateStalePeriod()) + 1);

				timestamp = await currentTime();

				// Update all rates except pUSD.
				await instance.updateRates([pEUR, PERI], ['1.25', '0.1'].map(toUnit), timestamp, {
					from: oracle,
				});

				const amountOfPeriFinances = toUnit('10');
				const amountOfEur = toUnit('0.8');

				// Should now be able to convert from PERI to pEUR since they are both not stale.
				assert.bnEqual(
					await instance.effectiveValue(PERI, amountOfPeriFinances, pEUR),
					amountOfEur
				);
			});

			it('should return 0 when relying on a non-existant dest exchange rate in effectiveValue()', async () => {
				assert.equal(await instance.effectiveValue(PERI, toUnit('10'), toBytes32('XYZ')), '0');
			});

			it('should return 0 when relying on a non-existing src rate in effectiveValue', async () => {
				assert.equal(await instance.effectiveValue(toBytes32('XYZ'), toUnit('10'), PERI), '0');
			});

			it('effectiveValueAndRates() should return rates as well with pUSD on one side', async () => {
				const { value, sourceRate, destinationRate } = await instance.effectiveValueAndRates(
					pUSD,
					toUnit('1'),
					pAUD
				);

				assert.bnEqual(value, toUnit('2'));
				assert.bnEqual(sourceRate, toUnit('1'));
				assert.bnEqual(destinationRate, toUnit('0.5'));
			});

			it('effectiveValueAndRates() should return rates as well with pUSD on the other side', async () => {
				const { value, sourceRate, destinationRate } = await instance.effectiveValueAndRates(
					pAUD,
					toUnit('1'),
					pUSD
				);

				assert.bnEqual(value, toUnit('0.5'));
				assert.bnEqual(sourceRate, toUnit('0.5'));
				assert.bnEqual(destinationRate, toUnit('1'));
			});

			it('effectiveValueAndRates() should return rates as well with two live rates', async () => {
				const { value, sourceRate, destinationRate } = await instance.effectiveValueAndRates(
					pAUD,
					toUnit('1'),
					pEUR
				);

				assert.bnEqual(value, toUnit('0.4')); // 0.5/1.25 = 0.4
				assert.bnEqual(sourceRate, toUnit('0.5'));
				assert.bnEqual(destinationRate, toUnit('1.25'));
			});
		});
	});

	describe('inverted prices', () => {
		const inverseRates = ['iBTC', 'iETH', 'pEUR'];
		const [iBTC, iETH, pEUR] = inverseRates.map(toBytes32);
		it('rateIsFrozen for a regular pynth returns false', async () => {
			assert.equal(false, await instance.rateIsFrozen(pEUR));
		});
		it('and list of invertedKeys is empty', async () => {
			await assert.invalidOpcode(instance.invertedKeys(0));
		});
		describe('when attempting to add inverse pynths', () => {
			it('ensure only the owner can invoke', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: instance.setInversePricing,
					args: [iBTC, toUnit('1'), toUnit('1.5'), toUnit('0.5'), false, false],
					accounts,
					address: owner,
					reason: 'Only the contract owner may perform this action',
				});
			});
			it('ensure entryPoint be greater than 0', async () => {
				await assert.revert(
					instance.setInversePricing(iBTC, toUnit('0'), toUnit('150'), toUnit('10'), false, false, {
						from: owner,
					}),
					'upperLimit must be less than double entryPoint'
				);
			});
			it('ensure lowerLimit be greater than 0', async () => {
				await assert.revert(
					instance.setInversePricing(
						iBTC,
						toUnit('100'),
						toUnit('150'),
						toUnit('0'),
						false,
						false,
						{
							from: owner,
						}
					),
					'lowerLimit must be above 0'
				);
			});
			it('ensure upperLimit be greater than the entryPoint', async () => {
				await assert.revert(
					instance.setInversePricing(
						iBTC,
						toUnit('100'),
						toUnit('100'),
						toUnit('10'),
						false,
						false,
						{
							from: owner,
						}
					),
					'upperLimit must be above the entryPoint'
				);
			});
			it('ensure upperLimit be less than double the entryPoint', async () => {
				await assert.revert(
					instance.setInversePricing(
						iBTC,
						toUnit('100'),
						toUnit('200'),
						toUnit('10'),
						false,
						false,
						{
							from: owner,
						}
					),
					'upperLimit must be less than double entryPoint'
				);
			});
			it('ensure lowerLimit be less than the entryPoint', async () => {
				await assert.revert(
					instance.setInversePricing(
						iBTC,
						toUnit('100'),
						toUnit('150'),
						toUnit('100'),
						false,
						false,
						{
							from: owner,
						}
					),
					'lowerLimit must be below the entryPoint'
				);
			});
			it('ensure both freeze at upper and freeze at lower cannot both be true', async () => {
				await assert.revert(
					instance.setInversePricing(iBTC, toUnit('100'), toUnit('150'), toUnit('50'), true, true, {
						from: owner,
					}),
					'Cannot freeze at both limits'
				);
			});
		});

		describe('freezeRate()', () => {
			it('reverts when the currency key is not an inverse', async () => {
				await assert.revert(instance.freezeRate(pEUR), 'Cannot freeze non-inverse rate');
			});
			describe('when an inverse is added for iBTC already frozen at the upper limit', () => {
				beforeEach(async () => {
					await instance.setInversePricing(
						iBTC,
						toUnit(4000),
						toUnit(6500),
						toUnit(2300),
						true,
						false,
						{
							from: owner,
						}
					);
				});
				it('freezeRate reverts as its already frozen', async () => {
					await assert.revert(instance.freezeRate(iBTC), 'The rate is already frozen');
				});
			});
			describe('when an inverse is added for iBTC already frozen at the lower limit', () => {
				beforeEach(async () => {
					await instance.setInversePricing(
						iBTC,
						toUnit(4000),
						toUnit(6500),
						toUnit(2300),
						false,
						true,
						{
							from: owner,
						}
					);
				});
				it('freezeRate reverts as its already frozen', async () => {
					await assert.revert(instance.freezeRate(iBTC), 'The rate is already frozen');
				});
			});
			describe('when an inverse is added for iBTC yet not frozen', () => {
				beforeEach(async () => {
					await instance.setInversePricing(
						iBTC,
						toUnit(4000),
						toUnit(6500),
						toUnit(2300),
						false,
						false,
						{
							from: owner,
						}
					);
				});
				it('edge-case: freezeRate reverts as even though there is no price, it is not on bounds', async () => {
					await assert.revert(instance.freezeRate(iBTC), 'Rate within bounds');
				});
				it('roundFrozen() returns 0 for iBTC', async () => {
					assert.equal(await instance.roundFrozen(iBTC), '0');
				});
				describe('when an in-bounds rate arrives for iBTC', () => {
					beforeEach(async () => {
						await instance.updateRates([iBTC], [toUnit('5000')], await currentTime(), {
							from: oracle,
						});
					});
					it('freezeRate reverts as the price is within bounds', async () => {
						await assert.revert(instance.freezeRate(iBTC), 'Rate within bounds');
					});
					it('roundFrozen() returns 0 for iBTC', async () => {
						assert.equal(await instance.roundFrozen(iBTC), '0');
					});
				});
				describe('when an upper out-of-bounds rate arrives for iBTC', () => {
					let roundId;

					beforeEach(async () => {
						await instance.updateRates([iBTC], [toUnit('6000')], await currentTime(), {
							from: oracle,
						});
						roundId = await instance.getCurrentRoundId(iBTC);
					});
					describe('when freezeRate is invoked', () => {
						let txn;
						beforeEach(async () => {
							txn = await instance.freezeRate(iBTC, { from: accounts[2] });
						});
						it('and emits an InversePriceFrozen at the lower limit', async () => {
							assert.eventEqual(txn, 'InversePriceFrozen', {
								currencyKey: iBTC,
								rate: toUnit(2300),
								roundId,
								initiator: accounts[2],
							});
						});
						it('and the inverse pricing shows the frozen flag at lower', async () => {
							const { frozenAtUpperLimit, frozenAtLowerLimit } = await instance.inversePricing(
								iBTC
							);

							assert.notOk(frozenAtUpperLimit);
							assert.ok(frozenAtLowerLimit);
						});
						it('and roundFrozen() returns the current round ID for iBTC', async () => {
							assert.bnEqual(await instance.roundFrozen(iBTC), roundId);
						});
					});
				});
				describe('when a lower out-of-bounds rate arrives for iBTC', () => {
					let roundId;
					beforeEach(async () => {
						await instance.updateRates([iBTC], [toUnit('1000')], await currentTime(), {
							from: oracle,
						});
						roundId = await instance.getCurrentRoundId(iBTC);
					});
					describe('when freezeRate is invoked', () => {
						let txn;
						beforeEach(async () => {
							txn = await instance.freezeRate(iBTC, { from: accounts[2] });
						});
						it('and emits an InversePriceFrozen at the upper limit', async () => {
							assert.eventEqual(txn, 'InversePriceFrozen', {
								currencyKey: iBTC,
								rate: toUnit(6500),
								roundId,
								initiator: accounts[2],
							});
						});
						it('and the inverse pricing shows the frozen flag at upper', async () => {
							const { frozenAtUpperLimit, frozenAtLowerLimit } = await instance.inversePricing(
								iBTC
							);

							assert.ok(frozenAtUpperLimit);
							assert.notOk(frozenAtLowerLimit);
						});
						it('and roundFrozen() returns the current round ID for iBTC', async () => {
							assert.bnEqual(await instance.roundFrozen(iBTC), roundId);
						});
					});
				});
			});
		});

		describe('when two inverted pynths are added', () => {
			// helper function to check rates are correct
			const assertRatesAreCorrect = async ({
				currencyKeys,
				expectedRates,
				txn,
				outOfBounds = [],
			}) => {
				// ensure all rates returned from contract are as expected
				const rates = await instance.ratesForCurrencies(currencyKeys);
				expectedRates.forEach((rate, i) => assert.bnEqual(rates[i], rate));

				const ratesUpdatedEvent = [
					'RatesUpdated',
					{
						currencyKeys,
					},
				];

				assert.eventEqual(txn, ...ratesUpdatedEvent);

				if (outOfBounds.length) {
					for (const currencyKey of outOfBounds) {
						assert.ok(await instance.canFreezeRate(currencyKey));
					}
					// now for all other currency keys, make sure canFreeze is false
					const keysInBounds = currencyKeys.filter(ccy => outOfBounds.indexOf(ccy) < 0);
					for (const currencyKey of keysInBounds) {
						assert.notOk(await instance.canFreezeRate(currencyKey));
					}
				}
			};

			const setTxns = [];
			beforeEach(async () => {
				setTxns.push(
					await instance.setInversePricing(
						iBTC,
						toUnit(4000),
						toUnit(6500),
						toUnit(2300),
						false,
						false,
						{
							from: owner,
						}
					)
				);
				setTxns.push(
					await instance.setInversePricing(
						iETH,
						toUnit(200),
						toUnit(350),
						toUnit(75),
						false,
						false,
						{
							from: owner,
						}
					)
				);
			});
			it('both emit InversePriceConfigured events', async () => {
				assert.eventEqual(setTxns[0], 'InversePriceConfigured', {
					currencyKey: iBTC,
					entryPoint: toUnit(4000),
					upperLimit: toUnit(6500),
					lowerLimit: toUnit(2300),
				});
				assert.eventEqual(setTxns[1], 'InversePriceConfigured', {
					currencyKey: iETH,
					entryPoint: toUnit(200),
					upperLimit: toUnit(350),
					lowerLimit: toUnit(75),
				});
			});
			it('and the list of invertedKeys lists them both', async () => {
				assert.equal('iBTC', bytesToString(await instance.invertedKeys(0)));
				assert.equal('iETH', bytesToString(await instance.invertedKeys(1)));
				await assert.invalidOpcode(instance.invertedKeys(2));
			});
			it('rateIsFrozen must be false for both', async () => {
				assert.equal(false, await instance.rateIsFrozen(iBTC));
				assert.equal(false, await instance.rateIsFrozen(iETH));
			});
			it('and canFreeze is false for the inverses as no rate yet given', async () => {
				assert.notOk(await instance.canFreezeRate(iBTC));
				assert.notOk(await instance.canFreezeRate(iETH));
			});
			it('and canFreeze is false for other pynths', async () => {
				assert.notOk(await instance.canFreezeRate(pEUR));
				assert.notOk(await instance.canFreezeRate(toBytes32('ABC')));
			});

			describe('when another pynth is added as frozen directly', () => {
				let txn;
				describe('with it set to freezeAtUpperLimit', () => {
					beforeEach(async () => {
						txn = await instance.setInversePricing(
							iBTC,
							toUnit(4000),
							toUnit(6500),
							toUnit(2300),
							true,
							false,
							{
								from: owner,
							}
						);
					});
					it('then the pynth is frozen', async () => {
						assert.equal(true, await instance.rateIsFrozen(iBTC));
						assert.equal(false, await instance.rateIsFrozen(iETH));
					});
					it('and it emits a frozen event', () => {
						assert.eventEqual(txn.logs[0], 'InversePriceFrozen', {
							currencyKey: iBTC,
							rate: toUnit(6500),
							roundId: '0',
							initiator: owner,
						});
					});
					it('yet the rate is 0 because there is no initial rate', async () => {
						assert.equal(await instance.ratesForCurrencies([iBTC]), '0');
					});
					it('and the inverse pricing struct is configured', async () => {
						const {
							entryPoint,
							upperLimit,
							lowerLimit,
							frozenAtUpperLimit,
							frozenAtLowerLimit,
						} = await instance.inversePricing(iBTC);

						assert.bnEqual(entryPoint, toUnit(4000));
						assert.bnEqual(upperLimit, toUnit(6500));
						assert.bnEqual(lowerLimit, toUnit(2300));
						assert.equal(frozenAtUpperLimit, true);
						assert.equal(frozenAtLowerLimit, false);
					});

					it('and canFreeze is false for the currency key is now frozen', async () => {
						assert.notOk(await instance.canFreezeRate(iBTC));
					});

					describe('when updateRates is called with an in-bounds update', () => {
						let txn;
						beforeEach(async () => {
							const rates = [toUnit('4500')];
							const timeSent = await currentTime();
							txn = await instance.updateRates([iBTC], rates, timeSent, {
								from: oracle,
							});
						});
						it('the inverted rate remains frozen at upper limit', async () => {
							await assertRatesAreCorrect({
								txn,
								currencyKeys: [iBTC],
								expectedRates: [toUnit('6500')],
							});
							assert.equal(true, await instance.rateIsFrozen(iBTC));
						});
						it('and canFreeze is still false for the currency key is now frozen', async () => {
							assert.notOk(await instance.canFreezeRate(iBTC));
						});
					});
				});
				describe('with it set to freezeAtLowerLimit', () => {
					beforeEach(async () => {
						txn = await instance.setInversePricing(
							iBTC,
							toUnit(4000),
							toUnit(6500),
							toUnit(2300),
							false,
							true,
							{
								from: owner,
							}
						);
					});
					it('then the pynth is frozen', async () => {
						assert.equal(true, await instance.rateIsFrozen(iBTC));
						assert.equal(false, await instance.rateIsFrozen(iETH));
					});
					it('yet the rate is 0 because there is no initial rate', async () => {
						assert.equal(await instance.ratesForCurrencies([iBTC]), '0');
					});
					it('and it emits a frozen event', () => {
						assert.eventEqual(txn.logs[0], 'InversePriceFrozen', {
							currencyKey: iBTC,
							rate: toUnit(2300),
							roundId: '0',
							initiator: owner,
						});
					});
					it('and the inverse pricing struct is configured', async () => {
						const {
							entryPoint,
							upperLimit,
							lowerLimit,
							frozenAtUpperLimit,
							frozenAtLowerLimit,
						} = await instance.inversePricing(iBTC);

						assert.bnEqual(entryPoint, toUnit(4000));
						assert.bnEqual(upperLimit, toUnit(6500));
						assert.bnEqual(lowerLimit, toUnit(2300));
						assert.equal(frozenAtUpperLimit, false);
						assert.equal(frozenAtLowerLimit, true);
					});
					it('and canFreeze is false for the currency key is now frozen', async () => {
						assert.notOk(await instance.canFreezeRate(iBTC));
					});
					describe('when updateRates is called with an in-bounds update', () => {
						let txn;
						beforeEach(async () => {
							const rates = [toUnit('4500')];
							const timeSent = await currentTime();
							txn = await instance.updateRates([iBTC], rates, timeSent, {
								from: oracle,
							});
						});
						it('the inverted rate remains frozen at lower limit', async () => {
							await assertRatesAreCorrect({
								txn,
								currencyKeys: [iBTC],
								expectedRates: [toUnit('2300')],
							});
							assert.equal(true, await instance.rateIsFrozen(iBTC));
						});
						it('and canFreeze is false for the currency key is now frozen', async () => {
							assert.notOk(await instance.canFreezeRate(iBTC));
						});
					});
				});
			});
			describe('when updateRates is called with an in-bounds update', () => {
				let txn;
				beforeEach(async () => {
					const rates = [4500.553, 225, 1.12].map(toUnit);
					const timeSent = await currentTime();
					txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
						from: oracle,
					});
				});
				it('regular and inverted rates should be updated correctly', async () => {
					await assertRatesAreCorrect({
						txn,
						currencyKeys: [iBTC, iETH, pEUR],
						expectedRates: [3499.447, 175, 1.12].map(toUnit),
					});
				});
				it('rateIsFrozen must be false for both', async () => {
					assert.equal(false, await instance.rateIsFrozen(iBTC));
					assert.equal(false, await instance.rateIsFrozen(iETH));
				});
				it('and canFreeze is false for the currency keys as the rate is valid', async () => {
					assert.notOk(await instance.canFreezeRate(iBTC));
					assert.notOk(await instance.canFreezeRate(iETH));
				});
				describe('when setInversePricing is called to freeze a pynth with a rate', () => {
					beforeEach(async () => {
						await instance.setInversePricing(
							iBTC,
							toUnit(4000),
							toUnit(6500),
							toUnit(2300),
							true,
							false,
							{
								from: owner,
							}
						);
					});
					it('then the pynth is frozen', async () => {
						assert.equal(true, await instance.rateIsFrozen(iBTC));
						assert.equal(false, await instance.rateIsFrozen(iETH));
					});
					it('and the rate for the pynth is the upperLimit - regardless of its old value', async () => {
						const actual = await instance.ratesForCurrencies([iBTC]);
						assert.bnEqual(actual, toUnit(6500));
					});
					it('and canFreeze is false for the currency keys as the rate is frozen', async () => {
						assert.notOk(await instance.canFreezeRate(iBTC));
					});
				});
			});
			describe('when updateRates is called with a lower out-of-bounds update', () => {
				let txn;
				beforeEach(async () => {
					const rates = [8050, 400, 1.12].map(toUnit);
					const timeSent = await currentTime();
					txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
						from: oracle,
					});
				});
				it('inverted rates return at the lower bounds', async () => {
					await assertRatesAreCorrect({
						txn,
						currencyKeys: [iBTC, iETH, pEUR],
						expectedRates: [2300, 75, 1.12].map(toUnit),
						outOfBounds: [iBTC, iETH],
					});
				});
				it('and canFreeze is true for the currency keys as the rate is invalid', async () => {
					assert.ok(await instance.canFreezeRate(iBTC));
					assert.ok(await instance.canFreezeRate(iETH));
				});

				describe('when freezeRate is invoked for both', () => {
					beforeEach(async () => {
						await instance.freezeRate(iBTC, { from: accounts[2] });
						await instance.freezeRate(iETH, { from: accounts[3] });
					});
					describe('when another updateRates is called with an in bounds update', () => {
						beforeEach(async () => {
							const rates = [3500, 300, 2.12].map(toUnit);
							const timeSent = await currentTime();
							txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
								from: oracle,
							});
						});

						it('inverted rates must remain frozen at the lower bounds', async () => {
							await assertRatesAreCorrect({
								txn,
								currencyKeys: [iBTC, iETH, pEUR],
								expectedRates: [2300, 75, 2.12].map(toUnit),
							});
						});
					});

					describe('when another updateRates is called with an out of bounds update the other way', () => {
						beforeEach(async () => {
							const rates = [1000, 50, 2.3].map(toUnit);
							const timeSent = await currentTime();
							txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
								from: oracle,
							});
						});

						it('inverted rates must remain frozen at the lower bounds', async () => {
							await assertRatesAreCorrect({
								txn,
								currencyKeys: [iBTC, iETH, pEUR],
								expectedRates: [2300, 75, 2.3].map(toUnit),
							});
						});
					});

					describe('when setInversePricing is called again for one of the frozen pynths', () => {
						let setTxn;
						beforeEach(async () => {
							setTxn = await instance.setInversePricing(
								iBTC,
								toUnit(5000),
								toUnit(8900),
								toUnit(3000),
								false,
								false,
								{
									from: owner,
								}
							);
						});

						it('it emits a InversePriceConfigured event', async () => {
							const currencyKey = 'iBTC';
							assert.eventEqual(setTxn, 'InversePriceConfigured', {
								currencyKey: toBytes32(currencyKey),
								entryPoint: toUnit(5000),
								upperLimit: toUnit(8900),
								lowerLimit: toUnit(3000),
							});
						});

						it('and the list of invertedKeys still lists them both', async () => {
							assert.equal('iBTC', bytesToString(await instance.invertedKeys(0)));
							assert.equal('iETH', bytesToString(await instance.invertedKeys(1)));
							await assert.invalidOpcode(instance.invertedKeys(2));
						});

						describe('when a price is received within bounds', () => {
							let txn;
							beforeEach(async () => {
								const rates = [1250, 201, 1.12].map(toUnit);
								const timeSent = await currentTime();
								txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
									from: oracle,
								});
							});
							it('then the inverted pynth updates as it is no longer frozen and respects new entryPoint and limits', async () => {
								await assertRatesAreCorrect({
									txn,
									currencyKeys: [iBTC, iETH, pEUR],
									expectedRates: [8750, 75, 1.12].map(toUnit),
								});
							});
							it('and canFreeze is false for the unfrozen and the already frozen one', async () => {
								assert.notOk(await instance.canFreezeRate(iBTC));
								assert.notOk(await instance.canFreezeRate(iETH));
							});

							describe('when a price is received out of bounds', () => {
								let txn;
								beforeEach(async () => {
									const rates = [1000, 201, 1.12].map(toUnit);
									const timeSent = await currentTime();
									txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
										from: oracle,
									});
								});
								it('then the inverted shows at new upper limit', async () => {
									await assertRatesAreCorrect({
										txn,
										currencyKeys: [iBTC, iETH, pEUR],
										expectedRates: [8900, 75, 1.12].map(toUnit),
									});
								});
								it('and canFreeze is true for the currency key as the rate is invalid', async () => {
									assert.ok(await instance.canFreezeRate(iBTC));
								});
								it('but false for the already frozen one', async () => {
									assert.notOk(await instance.canFreezeRate(iETH));
								});
							});
						});
					});
				});
			});
			describe('when updateRates is called with an upper out-of-bounds update', () => {
				let txn;
				beforeEach(async () => {
					const rates = [1200, 45, 1.12].map(toUnit);
					const timeSent = await currentTime();
					txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
						from: oracle,
					});
				});
				it('inverted rates must be set to the upper bounds', async () => {
					await assertRatesAreCorrect({
						txn,
						currencyKeys: [iBTC, iETH, pEUR],
						expectedRates: [6500, 350, 1.12].map(toUnit),
						outOfBounds: [iBTC, iETH],
					});
				});

				describe('when freezeRate is invoked', () => {
					beforeEach(async () => {
						await instance.freezeRate(iBTC, { from: accounts[2] });
						await instance.freezeRate(iETH, { from: accounts[2] });
					});
					describe('when another updateRates is called with an in bounds update', () => {
						beforeEach(async () => {
							const rates = [3500, 300, 2.12].map(toUnit);
							const timeSent = await currentTime();
							txn = await instance.updateRates([iBTC, iETH, pEUR], rates, timeSent, {
								from: oracle,
							});
						});
						it('inverted rates must remain frozen at the upper bounds', async () => {
							await assertRatesAreCorrect({
								txn,
								currencyKeys: [iBTC, iETH, pEUR],
								expectedRates: [6500, 350, 2.12].map(toUnit),
							});
						});
					});
				});

				describe('when iBTC is attempted removal by a non owner', () => {
					it('ensure only the owner can invoke', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.removeInversePricing,
							args: [iBTC],
							accounts,
							address: owner,
							reason: 'Only the contract owner may perform this action',
						});
					});
				});

				describe('when a regular (non-inverse) pynth is removed by the owner', () => {
					it('then it reverts', async () => {
						await assert.revert(
							instance.removeInversePricing(pEUR, {
								from: owner,
							}),
							'No inverted price exists'
						);
					});
				});

				describe('when iBTC is removed by the owner', () => {
					let removeTxn;
					beforeEach(async () => {
						removeTxn = await instance.removeInversePricing(iBTC, {
							from: owner,
						});
					});
					it('it emits a InversePriceConfigured event', async () => {
						assert.eventEqual(removeTxn, 'InversePriceConfigured', {
							currencyKey: iBTC,
							entryPoint: 0,
							upperLimit: 0,
							lowerLimit: 0,
						});
					});
					it('and the list of invertedKeys contains only iETH', async () => {
						assert.equal('iETH', bytesToString(await instance.invertedKeys(0)));
						await assert.invalidOpcode(instance.invertedKeys(1));
					});

					it('and inversePricing for iBTC returns an empty struct', async () => {
						const {
							entryPoint,
							upperLimit,
							lowerLimit,
							frozenAtUpperLimit,
							frozenAtLowerLimit,
						} = await instance.inversePricing(iBTC);

						assert.equal(entryPoint, '0');
						assert.equal(upperLimit, '0');
						assert.equal(lowerLimit, '0');
						assert.equal(frozenAtUpperLimit, false);
						assert.equal(frozenAtLowerLimit, false);
					});
				});
			});
		});
	});

	describe('when the flags interface is set', () => {
		beforeEach(async () => {
			// replace the FlagsInterface mock with a fully fledged mock that can
			// return arrays of information

			await systemSettings.setAggregatorWarningFlags(mockFlagsInterface.address, { from: owner });
		});
		describe('aggregatorWarningFlags', () => {
			it('is set correctly', async () => {
				assert.equal(await instance.aggregatorWarningFlags(), mockFlagsInterface.address);
			});
		});
	});

	describe('roundIds for historical rates', () => {
		it('getCurrentRoundId() by default is 0 for all pynths except pUSD which is 1', async () => {
			// Note: rates that were set in the truffle migration will be at 1, so we need to check
			// other pynths
			assert.equal(await instance.getCurrentRoundId(pUSD), '1');
		});

		it('ratesAndUpdatedTimeForCurrencyLastNRounds() shows first entry for pUSD', async () => {
			const timeOfpUSDRateSetOnInit = await instance.lastRateUpdateTimes(pUSD);
			assert.deepEqual(await instance.ratesAndUpdatedTimeForCurrencyLastNRounds(pUSD, '3'), [
				[toUnit('1'), '0', '0'],
				[timeOfpUSDRateSetOnInit, '0', '0'],
			]);
		});
		it('ratesAndUpdatedTimeForCurrencyLastNRounds() returns 0s for other currency keys', async () => {
			const fiveZeros = new Array(5).fill('0');
			assert.deepEqual(await instance.ratesAndUpdatedTimeForCurrencyLastNRounds(pAUD, '5'), [
				fiveZeros,
				fiveZeros,
			]);
		});
	});
});
