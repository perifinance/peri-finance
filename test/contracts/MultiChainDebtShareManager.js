'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { currentTime, toUnit } = require('../utils')();

const {
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setExchangeFeeRateForPynths,
} = require('./helpers');

const { toBytes32 } = require('../..');

contract('MultiChainDebtShareManager', async accounts => {
	const [, owner, oracle, account1, account2, account3] = accounts;

	const [pUSD, pETH, pBTC, PERI] = ['pUSD', 'pETH', 'pBTC', 'PERI'].map(toBytes32);
	const pynthKeys = [pUSD, pETH, pBTC];

	let timeStamp;

	let multiChainDebtShareManager,
		multiChainDebtShareState,
		debtCache,
		periFinance,
		exchangeRates,
		systemSettings;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			MultiChainDebtShareManager: multiChainDebtShareManager,
			MultiChainDebtShareState: multiChainDebtShareState,
			DebtCache: debtCache,
			PeriFinance: periFinance,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pETH', 'pBTC'],
			contracts: [
				'MultiChainDebtShareManager',
				'MultiChainDebtShareState',
				'Issuer',
				'DebtCache',
				'PeriFinance',
				'ExchangeRates',
				'StakingState',
				'SystemSettings',
				'CollateralManager',
				'RewardEscrowV2',
			],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timeStamp = await currentTime();

		await exchangeRates.updateRates(
			[PERI, pETH, pBTC],
			['1.5', '300', '5000'].map(toUnit),
			timeStamp,
			{ from: oracle }
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
			abi: multiChainDebtShareManager.abi,
			ignoreParents: ['Owned'],
			expected: [
				'setCurrentExternalDebtEntry',
				'removeCurrentExternalDebtEntry',
				'setMultiChainDebtShareState',
			],
		});
	});

	describe('only owner can call', () => {
		beforeEach(async () => {
			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('1'), false, {
				from: owner,
			});
		});

		it('setCurrentExternalDebtEntry() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareManager.setCurrentExternalDebtEntry,
				accounts,
				args: [toUnit('1'), false],
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('removeCurrentExternalDebtEntry() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareManager.removeCurrentExternalDebtEntry,
				accounts,
				args: [],
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('setMultiChainDebtShareState() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: multiChainDebtShareManager.setMultiChainDebtShareState,
				accounts,
				args: [multiChainDebtShareState.address],
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});
	});

	describe('should fetch the data from contract', () => {
		beforeEach(async () => {
			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('1'), false, {
				from: owner,
			});
		});

		it('should get the value of current ExtenralDebtEntry', async () => {
			const result = await multiChainDebtShareManager.getCurrentExternalDebtEntry();

			assert.equal(toUnit('1'), result.debtShare.toString());
			assert.equal(false, result.isDecreased);
		});
	});

	describe('increasing debt to MultiChain contract should effect to current debt', () => {
		beforeEach(async () => {
			await periFinance.transfer(account1, toUnit('200'), { from: owner });
			await periFinance.issueMaxPynths({ from: account1 });
		});

		it.only('after issuing pynth', async () => {
			let balance = await periFinance.balanceOf(account1);
			let debtBalance = await periFinance.debtBalanceOf(account1, pUSD);
			let cratio = await periFinance.collateralisationRatio(account1);
			let currentDebt = await debtCache.currentDebt();

			console.log(balance.toString());
			console.log(debtBalance.toString());
			console.log(cratio.toString());
			console.log(currentDebt.debt.toString());

			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('1000'), false, {
				from: owner,
			});

			await debtCache.takeDebtSnapshot();

			balance = await periFinance.balanceOf(account1);
			debtBalance = await periFinance.debtBalanceOf(account1, pUSD);
			cratio = await periFinance.collateralisationRatio(account1);
			currentDebt = await debtCache.currentDebt();

			console.log(balance.toString());
			console.log(debtBalance.toString());
			console.log(cratio.toString());
			console.log(currentDebt.debt.toString());
		});
	});
});
