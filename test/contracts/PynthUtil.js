'use strict';

const { contract } = require('hardhat');
const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { toBytes32 } = require('../..');
const { toUnit, currentTime } = require('../utils')();
const { setExchangeFeeRateForPynths } = require('./helpers');

const { setupAllContracts } = require('./setup');
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

contract('PynthUtil', accounts => {
	const [, ownerAccount, oracle, account2] = accounts;
	let pynthUtil, pUSDContract, periFinance, exchangeRates, timestamp, systemSettings, debtCache;

	const [PERI, pUSD, pBTC, iBTC] = ['PERI', 'pUSD', 'pBTC', 'iBTC'].map(toBytes32);
	const pynthKeys = [pUSD, pBTC, iBTC];
	const pynthPrices = [toUnit('1'), toUnit('5000'), toUnit('5000')];

	before(async () => {
		({
			PynthUtil: pynthUtil,
			PynthpUSD: pUSDContract,
			PeriFinance: periFinance,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
			DebtCache: debtCache,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pBTC', 'iBTC'],
			contracts: [
				'PynthUtil',
				'PeriFinance',
				'Exchanger',
				'ExchangeRates',
				'ExchangeState',
				'FeePoolState',
				'FeePoolEternalStorage',
				'SystemSettings',
				'DebtCache',
				'Issuer',
				'CollateralManager',
				'RewardEscrowV2', // required for issuer._collateral to read collateral
				'StakingStateUSDC',
				'CrossChainManager',
			],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timestamp = await currentTime();
		await exchangeRates.updateRates([pBTC, iBTC], ['5000', '5000'].map(toUnit), timestamp, {
			from: oracle,
		});
		await debtCache.takeDebtSnapshot();

		// set a 0% default exchange fee rate for test purpose
		const exchangeFeeRate = toUnit('0');
		await setExchangeFeeRateForPynths({
			owner: ownerAccount,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});
	});

	describe('given an instance', () => {
		const pUSDMinted = toUnit('10000');
		const amountToExchange = toUnit('50');
		const pUSDAmount = toUnit('100');
		beforeEach(async () => {
			await periFinance.issuePynths(PERI, pUSDMinted, {
				from: ownerAccount,
			});
			await pUSDContract.transfer(account2, pUSDAmount, { from: ownerAccount });
			await periFinance.exchange(pUSD, amountToExchange, pBTC, { from: account2 });
		});
		describe('totalPynthsInKey', () => {
			it('should return the total balance of pynths into the specified currency key', async () => {
				assert.bnEqual(await pynthUtil.totalPynthsInKey(account2, pUSD), pUSDAmount);
			});
		});
		describe('pynthsBalances', () => {
			it('should return the balance and its value in pUSD for every pynth in the wallet', async () => {
				const effectiveValue = await exchangeRates.effectiveValue(pUSD, amountToExchange, pBTC);
				assert.deepEqual(await pynthUtil.pynthsBalances(account2), [
					[pUSD, pBTC, iBTC],
					[toUnit('50'), effectiveValue, 0],
					[toUnit('50'), toUnit('50'), 0],
				]);
			});
		});
		describe('frozenPynths', () => {
			it('should not return any currency keys when no pynths are frozen', async () => {
				assert.deepEqual(
					await pynthUtil.frozenPynths(),
					pynthKeys.map(pynth => ZERO_BYTES32)
				);
			});
			it('should return currency keys of frozen pynths', async () => {
				await exchangeRates.setInversePricing(
					iBTC,
					toUnit('100'),
					toUnit('150'),
					toUnit('90'),
					true,
					false,
					{
						from: ownerAccount,
					}
				);
				assert.deepEqual(
					await pynthUtil.frozenPynths(),
					pynthKeys.map(pynth => (pynth === iBTC ? iBTC : ZERO_BYTES32))
				);
			});
		});
		describe('pynthsRates', () => {
			it('should return the correct pynth rates', async () => {
				assert.deepEqual(await pynthUtil.pynthsRates(), [pynthKeys, pynthPrices]);
			});
		});
		describe('pynthsTotalSupplies', () => {
			it('should return the correct pynth total supplies', async () => {
				const effectiveValue = await exchangeRates.effectiveValue(pUSD, amountToExchange, pBTC);
				assert.deepEqual(await pynthUtil.pynthsTotalSupplies(), [
					pynthKeys,
					[pUSDMinted.sub(amountToExchange), effectiveValue, 0],
					[pUSDMinted.sub(amountToExchange), amountToExchange, 0],
				]);
			});
		});
	});
});
