'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupAllContracts } = require('./setup');

const { currentTime, toUnit, fromUnit, divideDecimal } = require('../utils')();

const {
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setExchangeFeeRateForPynths,
} = require('./helpers');

const { toBytes32 } = require('../..');

contract('CrossChainManager', async accounts => {
	const [, owner, oracle, , debtManager, account1, account2, account3] = accounts;

	const [pUSD, pETH, pBTC, PERI] = ['pUSD', 'pETH', 'pBTC', 'PERI'].map(toBytes32);
	const pynthKeys = [pUSD, pETH, pBTC];

	let timeStamp;

	let crossChainManager,
		crossChainState,
		debtCache,
		periFinance,
		periFinanceState,
		exchangeRates,
		systemSettings,
		issuer,
		bridgeStatepUSD;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async () => {
		({
			BridgeStatepUSD: bridgeStatepUSD,
			CrossChainManager: crossChainManager,
			CrossChainState: crossChainState,
			DebtCache: debtCache,
			PeriFinance: periFinance,
			PeriFinanceState: periFinanceState,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pETH', 'pBTC'],
			contracts: [
				'AddressResolver',
				'DebtCache',
				'BridgeStatepUSD',
				'CrossChainState',
				'CrossChainManager',
				'Issuer',
				'PeriFinance',
				'PeriFinanceState',
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
			abi: crossChainManager.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'setCrossChainState',
				'setDebtManager',
				'addTotalNetworkDebt',
				'setCrossNetworkUserDebt',
				'clearCrossNetworkUserDebt',
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

		it('appendTotalNetworkDebt() only can be called by debtManager', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: crossChainManager.appendTotalNetworkDebt,
				accounts,
				args: [toUnit(10)],
				address: debtManager,
				reason: 'Only the debt manager may perform this action',
			});
		});

		it('setCrossNetworkUserDebt() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: crossChainManager.setCrossNetworkUserDebt,
				args: [account1, toUnit('1')],
				accounts,
				reason: 'Only the issuer contract can perform this action',
			});
		});

		it('clearCrossNetworkUserDebt() only can be called by owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: crossChainManager.clearCrossNetworkUserDebt,
				args: [account1],
				accounts,
				reason: 'Only the issuer contract can perform this action',
			});
		});
	});

	describe('should fetch the data from contract', () => {
		const networkTotalDebt = toUnit(10);
		before(async () => {
			await crossChainManager.appendTotalNetworkDebt(networkTotalDebt, {
				from: debtManager,
			});
		});

		it('should get the value of current total network system debt', async () => {
			const result = await crossChainManager.currentTotalNetworkDebt();

			assert.equal(networkTotalDebt, result.toString());
		});
	});

	describe('increasing or decreasing debt to CrossChain contract should effect to current debt', () => {
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
			const { debt } = await debtCache.currentDebt();
			console.log('currentDebt : ', fromUnit(debt).toString());

			await crossChainManager.appendTotalNetworkDebt(toUnit('225'), {
				from: debtManager,
			});

			const currentTotalNetworkDebt = await crossChainManager.currentTotalNetworkDebt();
			console.log('currentTotalNetworkDebt : ' + fromUnit(currentTotalNetworkDebt).toString());

			const currentNetworkDebtPercentage = await crossChainManager.currentNetworkDebtPercentage();
			console.log(
				'currentNetworkDebtPercentage : ' + fromUnit(currentNetworkDebtPercentage).toString()
			);

			const expectedNetworkDebtPercentage = divideDecimal(debt, currentTotalNetworkDebt);
			console.log(
				'expectedNetworkDebtPercentage : ' + fromUnit(expectedNetworkDebtPercentage).toString()
			);
		});

		it('check if account`s debtBalance decreased, c-ratio increased', async () => {
			const isDecreased = true;
			await crossChainManager.setCrossChainState(toUnit('200'), isDecreased, {
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
