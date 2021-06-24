'use strict';

const { artifacts, contract } = require('hardhat');
const { assert } = require('./common');

const ExternalRateAggregator = artifacts.require('ExternalRateAggregator');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');
const { currentTime, toUnit, fastForward } = require('../utils')();

const [PERI, USDC, ETH] = [toBytes32('PERI'), toBytes32('USDC'), toBytes32('ETH')];

contract('ExternalRateAggregator', accounts => {
	const [deployerAccount, owner, oracle] = accounts;

	let externalRateAggregator;

	beforeEach(async () => {
		externalRateAggregator = await ExternalRateAggregator.new(owner, oracle, {
			from: deployerAccount,
		});
	});

	describe('deploy', () => {
		it('should deploy properly', async () => {
			const _oracle = await externalRateAggregator.oracle();
			const _owner = await externalRateAggregator.owner();

			assert.equal(_oracle, oracle);
			assert.equal(_owner, owner);
		});
	});

	describe('setting oracle', async () => {
		it('should set oracle', async () => {
			await externalRateAggregator.setOracle(accounts[8], { from: owner });

			const _oracle = await externalRateAggregator.oracle();

			assert.equal(_oracle, accounts[8]);
		});

		it('should NOT set oracle', async () => {
			await assert.revert(
				externalRateAggregator.setOracle(accounts[8], { from: oracle }),
				'Only the contract owner may perform this action'
			);

			await assert.revert(
				externalRateAggregator.setOracle(ZERO_ADDRESS, { from: owner }),
				'Address cannot be empty'
			);
		});
	});

	describe('update rates', async () => {
		it('should update rates', async () => {
			const now = await currentTime();

			await externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000, 3000], now, {
				from: oracle,
			});

			const rates = await Promise.all(
				[PERI, USDC, ETH].map(_currency => externalRateAggregator.getRateAndUpdatedTime(_currency))
			);

			assert.equal(rates[0][0], 100);
			assert.bnClose(rates[0][1], now, '10');
			assert.equal(rates[1][0], 20000);
			assert.bnClose(rates[1][1], now, '10');
			assert.equal(rates[2][0], 3000);
			assert.bnClose(rates[2][1], now, '10');
		});

		it('should NOT update rates', async () => {
			const now = await currentTime();

			// not oracle
			await assert.revert(
				externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000, 3000], now, {
					from: owner,
				}),
				'Only the oracle can perform this action'
			);

			// length is not match
			await assert.revert(
				externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000], now, { from: oracle }),
				'Currency key array length must match rates array length'
			);

			// Time is too far
			await assert.revert(
				externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000, 3000], now + 864000, {
					from: oracle,
				}),
				'Time is too far into the future'
			);

			// Rate is zero
			await assert.revert(
				externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000, 0], now, {
					from: oracle,
				}),
				'Zero is not a valid rate, please call deleteRate instead'
			);

			// currency is pUSD
			await assert.revert(
				externalRateAggregator.updateRates([PERI, USDC, toBytes32('pUSD')], [100, 20000, 30], now, {
					from: oracle,
				}),
				"Rate of pUSD cannot be updated, it's always UNIT"
			);
		});
	});

	describe('delete rate', async () => {
		beforeEach(async () => {
			const now = await currentTime();

			await externalRateAggregator.updateRates([PERI, USDC, ETH], [100, 20000, 3000], now, {
				from: oracle,
			});
		});

		it('should delete rate', async () => {
			await externalRateAggregator.deleteRate(USDC, { from: oracle });

			const rate = await externalRateAggregator.getRateAndUpdatedTime(USDC);

			assert.bnEqual(rate[0], '0');
			assert.bnEqual(rate[1], '0');
		});

		it('should NOT delete rate', async () => {
			await assert.revert(
				externalRateAggregator.deleteRate(USDC, { from: owner }),
				'Only the oracle can perform this action'
			);
		});
	});
});
