'use strict';

const { artifacts, contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { setupAllContracts } = require('./setup');

const MockToken = artifacts.require('MockToken');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');
const { currentTime, toUnit, fastForward, multiplyDecimal, divideDecimal } = require('../utils')();

const toBN = _val => web3.utils.toBN(String(_val));

const [pUSD, PERI, USDC, DAI, KRW] = [
	toBytes32('pUSD'),
	toBytes32('PERI'),
	toBytes32('USDC'),
	toBytes32('DAI'),
	toBytes32('KRW'),
];

const tokenInfos = {
	USDC: { currencyKey: USDC, decimals: 6, contract: {} },
	DAI: { currencyKey: DAI, decimals: 18, contract: {} },
	KRW: { currencyKey: KRW, decimals: 18, contract: {} },
};

const keys = ['USDC', 'DAI', 'KRW'];

contract('External token staking integrating test', async accounts => {
	const [deployerAccount, owner, oracle] = accounts;
	const users = new Array(7).fill(null).map((_el, idx) => accounts[idx + 3]);

	let periFinance,
		exchangeRates,
		periFinanceState,
		feePool,
		delegateApprovals,
		systemStatus,
		systemSettings,
		pUSDContract,
		escrow,
		rewardEscrowV2,
		timestamp,
		debtCache,
		issuer,
		pynths,
		addressResolver,
		stakingStateUSDC,
		externalTokenStakeManager,
		stakingState,
		externalRateAggregator,
		usdc,
		dai,
		krw;

	before(async () => {
		pynths = ['pUSD', 'PERI', 'USDC'];
		({
			PeriFinance: periFinance,
			PeriFinanceState: periFinanceState,
			SystemStatus: systemStatus,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			PeriFinanceEscrow: escrow,
			RewardEscrowV2: rewardEscrowV2,
			PynthpUSD: pUSDContract,
			FeePool: feePool,
			DebtCache: debtCache,
			Issuer: issuer,
			DelegateApprovals: delegateApprovals,
			AddressResolver: addressResolver,
			ExternalRateAggregator: externalRateAggregator,
			StakingStateUSDC: stakingStateUSDC,
			StakingState: stakingState,
			ExternalTokenStakeManager: externalTokenStakeManager,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'ExchangeRates',
				'FeePool',
				'FeePoolEternalStorage',
				'AddressResolver',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'SystemSettings',
				'Issuer',
				'DebtCache',
				'Exchanger', // necessary for burnPynths to check settlement of pUSD
				'DelegateApprovals', // necessary for *OnBehalf functions
				'FlexibleStorage',
				'CollateralManager',
				'FeePoolStateUSDC',
				'ExternalRateAggregator',
				'StakingStateUSDC',
				'StakingState',
				'ExternalTokenStakeManager',
			],
		}));

		[usdc, dai, krw] = await Promise.all([
			MockToken.new('Mocked USDC', 'USDC', 6, { from: deployerAccount }),
			MockToken.new('Dai Stablecoin', 'DAI', 18, { from: deployerAccount }),
			MockToken.new('KRW Coin', 'KRW', 18, { from: deployerAccount }),
		]);

		tokenInfos['USDC'].contract = usdc;
		tokenInfos['DAI'].contract = dai;
		tokenInfos['KRW'].contract = krw;

		await Promise.all(
			['USDC', 'DAI', 'KRW'].map(_key =>
				stakingState.setTargetToken(
					tokenInfos[_key].currencyKey,
					tokenInfos[_key].contract.address,
					tokenInfos[_key].decimals,
					{ from: owner }
				)
			)
		);

		await systemSettings.setIssuanceRatio(toUnit('0.25'), { from: owner });
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		timestamp = await currentTime();

		await exchangeRates.updateRates(
			[PERI, USDC, DAI, KRW],
			['0.2', '0.98', '1.001', '1100'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);

		await debtCache.takeDebtSnapshot();
	});

	describe('Deployment settings', () => {
		it('should ExternalTokenStakeManager deployed', async () => {
			const stakingStateAddress = await externalTokenStakeManager.stakingState();
			const stakingStateUSDCAddress = await externalTokenStakeManager.stakingStateUSDC();

			assert.equal(stakingStateAddress, stakingState.address);
			assert.equal(stakingStateUSDCAddress, stakingStateUSDC.address);
		});

		it('should set token on stakingState', async () => {
			const tokenList = await externalTokenStakeManager.getTokenList();

			assert.equal(tokenList.length, 3);
			assert.equal(tokenList[0], USDC);
			assert.equal(tokenList[1], DAI);
			assert.equal(tokenList[2], KRW);

			const addresses = await Promise.all(tokenList.map(_key => stakingState.tokenAddress(_key)));
			const decimals = await Promise.all(tokenList.map(_key => stakingState.tokenDecimals(_key)));

			assert.equal(addresses[0], usdc.address);
			assert.equal(addresses[1], dai.address);
			assert.equal(addresses[2], krw.address);
			assert.equal(decimals[0], 6);
			assert.equal(decimals[1], 18);
			assert.equal(decimals[2], 18);
		});
	});

	describe('ExternalTokenStakeManager authorization', () => {
		it('should only issuer is allowed to invoke', async () => {});
	});

	describe('Issuance', () => {
		const unitBal = '10000';

		beforeEach(async () => {
			await Promise.all(
				users.map(_user => periFinance.transfer(_user, toUnit(unitBal), { from: owner }))
			);

			const balances = await Promise.all(users.map(_user => periFinance.balanceOf(_user)));

			balances.map(_balance => assert.bnEqual(_balance, toUnit(unitBal)));
		});

		it('should issue pynths', async () => {
			// user0, user1, user2 will get pUSD by locking PERI
			// user0: 100, user1: 200, user2: 300
			const issuers = [users[0], users[1], users[2]];
			const issueAmounts = [toUnit('100'), toUnit('200'), toUnit('300')];

			await Promise.all(
				issuers.map((_issuer, _idx) =>
					periFinance.issuePynths(PERI, issueAmounts[_idx], { from: _issuer })
				)
			);

			// PERI balance should not be changed
			const balances_PERI_after = await Promise.all(
				issuers.map(_issuer => periFinance.balanceOf(_issuer))
			);
			balances_PERI_after.forEach(_el => assert.bnEqual(_el, toUnit(unitBal)));

			// It should derive back user's active debt properly
			const balances_pUSD = await Promise.all(
				issuers.map(_issuer => pUSDContract.balanceOf(_issuer))
			);
			balances_pUSD.map((_balance, _idx) => assert.bnEqual(_balance, issueAmounts[_idx]));

			const userDebts = await Promise.all(
				issuers.map(_issuer => periFinance.debtBalanceOf(_issuer, pUSD))
			);
			userDebts.forEach((_debt, _idx) => assert.bnEqual(_debt, balances_pUSD[_idx]));

			// PERI should be locked (IR: 400%, 0.2 [USD/PERI])
			// Expecting user0: 2000 PERI, user1: 4000 PERI, user2: 6000 PERI
			const expectedLock = [toUnit('2000'), toUnit('4000'), toUnit('6000')];
			const transferables = await Promise.all(
				issuers.map(_issuer => periFinance.transferablePeriFinance(_issuer))
			);
			transferables.forEach((_transferable, _idx) =>
				assert.bnEqual(_transferable, toUnit(unitBal).sub(expectedLock[_idx]))
			);

			await Promise.all(
				issuers.map((_issuer, _idx) =>
					assert.revert(
						periFinance.transfer(
							owner,
							toUnit(unitBal)
								.sub(expectedLock[_idx])
								.add(toBN(1)),
							{ from: _issuer }
						),
						'Cannot transfer staked or escrowed PERI'
					)
				)
			);

			// Expecting C-Ratio user0: 500/10000, user1: 1000/10000, user2: 1500/10000
			const divideByUnitBal = _val => divideDecimal(_val, toUnit(unitBal));
			const expectedCRatios = [
				divideByUnitBal(toUnit('500')),
				divideByUnitBal(toUnit('1000')),
				divideByUnitBal(toUnit('1500')),
			];
			const cRatios = await Promise.all(
				issuers.map(_issuer => periFinance.collateralisationRatio(_issuer))
			);
			cRatios.forEach((_cRatio, _idx) => assert.bnClose(_cRatio, expectedCRatios[_idx], '10'));

			// No external token quota should exist
			const quotas = await Promise.all(
				issuers.map(_issuer => periFinance.externalTokenQuota(_issuer, 0, 0, true))
			);
			quotas.forEach(_quota => assert.bnEqual(_quota, toBN('0')));
		});

		describe('staking external tokens', () => {
			beforeEach(async () => {
				await Promise.all(
					users.map(_user => {
						return Promise.all([
							tokenInfos.USDC.contract.transfer(_user, unitBal + '0'.repeat(6), {
								from: deployerAccount,
							}),
							tokenInfos.DAI.contract.transfer(_user, toUnit(unitBal), { from: deployerAccount }),
							tokenInfos.KRW.contract.transfer(_user, toUnit(unitBal), { from: deployerAccount }),
						]);
					})
				);

				const balances = await Promise.all(
					users.map(_user => {
						return Promise.all(keys.map(_key => tokenInfos[_key].contract.balanceOf(_user)));
					})
				);

				balances.map(_balances =>
					_balances.map((_balances_user, idx) =>
						assert.bnEqual(
							_balances_user,
							toBN(unitBal + '0'.repeat(Number(tokenInfos[keys[idx]].decimals)))
						)
					)
				);
			});
		});
	});
});
