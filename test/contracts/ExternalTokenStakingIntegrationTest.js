'use strict';

const { artifacts, contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { setupAllContracts } = require('./setup');

const MockToken = artifacts.require('MockToken');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');
const { utf8ToHex } = require('web3-utils');
const {
	currentTime,
	toUnit,
	fastForward,
	multiplyDecimal,
	divideDecimal,
	multiplyDecimalRound,
	divideDecimalRound,
} = require('../utils')();

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

	const updateRates = async (_keys, _rates) => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates(_keys, _rates.map(toUnit), timestamp, { from: oracle });

		await debtCache.takeDebtSnapshot();
	};

	beforeEach(async () => {
		await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);
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

		describe('Only PERI staking', () => {
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

			it('should NOT issue pynths', async () => {
				// Over the target ratio (IR: 400%, 0.2 [USD/PERI])
				// With 10000 PERI, 500 pUSD is maximum can be issued.
				await periFinance.issuePynths(PERI, toUnit('500'), { from: users[0] });

				const balance_0_pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance_0_pUSD, toUnit('500'));

				await assert.revert(
					periFinance.issuePynths(PERI, 1, { from: users[0] }),
					'Amount too large'
				);
			});

			it('should issue max pynths', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				const balance_0_pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance_0_pUSD, toUnit('500'));
			});

			it('should change c-ratio if price is changed', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				const balance_0_pUSD_before = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance_0_pUSD_before, toUnit('500'));

				const targetRatio = await issuer.issuanceRatio();
				const initialRatio = await periFinance.collateralisationRatio(users[0]);
				assert.bnEqual(targetRatio, initialRatio);

				await updateRates([PERI], [0.1]);
				const loweredRatio = await periFinance.collateralisationRatio(users[0]);
				assert.bnEqual(targetRatio.mul(toBN('2')), loweredRatio);

				await assert.revert(
					periFinance.issuePynths(PERI, 1, { from: users[0] }),
					'Amount too large'
				);

				await updateRates([PERI], [0.4]);
				const raisedRatio = await periFinance.collateralisationRatio(users[0]);
				assert.bnEqual(targetRatio.div(toBN('2')), raisedRatio);

				await periFinance.issuePynths(PERI, toUnit('500'), { from: users[0] });

				const balance_0_pUSD_after = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance_0_pUSD_after, toUnit('1000'));

				const finalRatio = await periFinance.collateralisationRatio(users[0]);
				assert.bnEqual(targetRatio, finalRatio);
			});

			it('should issue more if issuance ratio increased', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				await systemSettings.setIssuanceRatio(toUnit('0.5'), { from: owner });

				await periFinance.issueMaxPynths({ from: users[0] });

				const balance_0_pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance_0_pUSD, toUnit('1000'));
			});
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
							tokenInfos.USDC.contract.approve(
								externalTokenStakeManager.address,
								toUnit(toUnit('1')),
								{ from: _user }
							),
							tokenInfos.DAI.contract.approve(
								externalTokenStakeManager.address,
								toUnit(toUnit('1')),
								{ from: _user }
							),
							tokenInfos.KRW.contract.approve(
								externalTokenStakeManager.address,
								toUnit(toUnit('1')),
								{ from: _user }
							),
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

			it('should stake external token', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				// User currently have 500 pUSD(debt), if issue 125 pUSD amount with staking external token,
				// then it reaches quota limit.
				const balance_0_DAI_before = await dai.balanceOf(users[0]);
				const balance_state_DAI_before = await dai.balanceOf(stakingState.address);

				await periFinance.issuePynths(DAI, toUnit('125'), { from: users[0] });

				const [
					balance_0_pUSD_after,
					balance_0_DAI_after,
					balance_state_DAI_after,
					stakedAmount_0_DAI_after,
					combinedStakedAmount_0_after,
					exTokenQuota_0_after,
					targetRatio,
					quotaLimit,
				] = await Promise.all([
					pUSDContract.balanceOf(users[0]),
					dai.balanceOf(users[0]),
					dai.balanceOf(stakingState.address),
					externalTokenStakeManager.stakedAmountOf(users[0], DAI, DAI),
					externalTokenStakeManager.combinedStakedAmountOf(users[0], pUSD),
					issuer.externalTokenQuota(users[0], 0, 0, true),
					issuer.issuanceRatio(),
					issuer.externalTokenLimit(),
				]);
				const daiStakedAmountEstimated = divideDecimalRound(
					divideDecimalRound(toUnit('125'), targetRatio),
					toUnit('1.001')
				);

				assert.bnEqual(balance_0_pUSD_after, toUnit('625'));
				assert.bnClose(stakedAmount_0_DAI_after, daiStakedAmountEstimated, '1');
				assert.bnEqual(balance_0_DAI_after, balance_0_DAI_before.sub(stakedAmount_0_DAI_after));
				assert.bnEqual(
					balance_state_DAI_after,
					balance_state_DAI_before.add(stakedAmount_0_DAI_after)
				);
				assert.bnClose(
					combinedStakedAmount_0_after,
					divideDecimalRound(toUnit('125'), targetRatio),
					'1'
				);
				assert.bnEqual(exTokenQuota_0_after, quotaLimit);
			});

			it('should NOT stake if there is no debt (no PERI locked)', async () => {
				await assert.revert(
					periFinance.issuePynths(USDC, '1000000', { from: users[0] }),
					'User does not have any debt yet'
				);
			});

			it('should NOT stake if it exceeds quota limit', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				// Maximum staking upto quota limit
				await periFinance.issuePynths(DAI, toUnit('125'), { from: users[0] });

				// Increase PERI price to make pUSD issuable
				await updateRates([PERI], ['0.4']);

				// Irrelavant to issuable state, external token staked amount is still on quota limit.
				await assert.revert(
					periFinance.issuePynths(USDC, toUnit('1'), { from: users[0] }),
					'External token staking amount exceeds quota limit'
				);
			});

			it('should stake multiple tokens', async () => {
				await periFinance.issuePynths(PERI, toUnit('300'), { from: users[0] });

				await periFinance.issuePynths(USDC, toUnit('20'), { from: users[0] });

				const roundingUp = (_amount, _decimals) => {
					const powered = toBN('1' + '0'.repeat(Number(_decimals)));

					let amount = toBN(_amount);
					if (amount.mod(powered).gt(toBN('0'))) {
						amount = amount.add(powered);
					}

					return amount.div(powered).mul(powered);
				};

				await periFinance.issuePynths(DAI, toUnit('55'), { from: users[0] });

				const quota_0_after = await periFinance.externalTokenQuota(users[0], 0, 0, true);

				await assert.revert(
					periFinance.issuePynths(KRW, toUnit('1'), { from: users[0] }),
					'External token staking amount exceeds quota limit'
				);
				assert.bnClose(quota_0_after, toUnit('0.2'), '1' + '0'.repeat(12));
			});
		});
	});
});
