'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { currentTime, toUnit, fromUnit } = require('../utils')();

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

	describe('increasing or decreasing debt to MultiChain contract should effect to current debt', () => {
		const accounts = [account1, account2, account3];

		beforeEach(async () => {
			const issueDebtForAccount = async (account, balance) => {
				await periFinance.transfer(account, toUnit(balance), { from: owner });
				await periFinance.issueMaxPynths({ from: account });
			};

			for (let index = 0; index < accounts.length; index++) {
				const account = accounts[index];
				await issueDebtForAccount(account, 100 * (index + 1));
			}
		});

		it('check if account`s debtBalance increased, c-ratio decreased', async () => {
			const isDecreased = false;
			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('500'), isDecreased, {
				from: owner,
			});

			const debtBefore = accounts.map(async account =>
				(await periFinance.debtBalanceOf(account, pUSD)).toString()
			);
			const cRatioBefore = accounts.map(async account =>
				(await periFinance.collateralisationRatio(account)).toString()
			);

			const debtBeforeArr = await Promise.all(debtBefore);
			const cRatioBeforeArr = await Promise.all(cRatioBefore);

			// apply changed debt value to current system cached debt
			await debtCache.takeDebtSnapshot();

			const debtAfter = accounts.map(async account =>
				(await periFinance.debtBalanceOf(account, pUSD)).toString()
			);
			const cRatioAfter = accounts.map(async account =>
				(await periFinance.collateralisationRatio(account)).toString()
			);

			const debtAfterArr = await Promise.all(debtAfter);
			const cRatioAfterArr = await Promise.all(cRatioAfter);

			// account debt ratio and collateral ratio should be changed along with the changes above
			for (let index = 0; index < accounts.length; index++) {
				const prevDebt = Number(debtBeforeArr[index]);
				const nextDebt = Number(debtAfterArr[index]);

				assert.isBelow(
					prevDebt,
					nextDebt,
					'The debt after snapshot taken should be more than prev debt'
				);

				const prevCRatio = 100 / fromUnit(cRatioBeforeArr[index]);
				const nextCRatio = 100 / fromUnit(cRatioAfterArr[index]);

				assert.isAbove(
					prevCRatio,
					nextCRatio,
					'The cRatio after snapshot taken should be lower than prev cRatio'
				);
			}
		});

		it('check if account`s debtBalance decreased, c-ratio increased', async () => {
			const isDecreased = true;
			await multiChainDebtShareManager.setCurrentExternalDebtEntry(toUnit('200'), isDecreased, {
				from: owner,
			});

			const debtBefore = accounts.map(async account =>
				(await periFinance.debtBalanceOf(account, pUSD)).toString()
			);
			const cRatioBefore = accounts.map(async account =>
				(await periFinance.collateralisationRatio(account)).toString()
			);

			const debtBeforeArr = await Promise.all(debtBefore);
			const cRatioBeforeArr = await Promise.all(cRatioBefore);

			// apply changed debt value to current system cached debt
			await debtCache.takeDebtSnapshot();

			const debtAfter = accounts.map(async account =>
				(await periFinance.debtBalanceOf(account, pUSD)).toString()
			);
			const cRatioAfter = accounts.map(async account =>
				(await periFinance.collateralisationRatio(account)).toString()
			);

			const debtAfterArr = await Promise.all(debtAfter);
			const cRatioAfterArr = await Promise.all(cRatioAfter);

			// account debt ratio and collateral ratio should be changed along with the changes above
			for (let index = 0; index < accounts.length; index++) {
				const prevDebt = Number(debtBeforeArr[index]);
				const nextDebt = Number(debtAfterArr[index]);

				assert.isAbove(
					prevDebt,
					nextDebt,
					'The debt after snapshot taken should be less than prev debt'
				);

				const prevCRatio = 100 / fromUnit(cRatioBeforeArr[index]);
				const nextCRatio = 100 / fromUnit(cRatioAfterArr[index]);

				assert.isBelow(
					prevCRatio,
					nextCRatio,
					'The cRatio after snapshot taken should be greater than prev cRatio'
				);
			}
		});
	});
});
