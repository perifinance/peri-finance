/* eslint-disable camelcase */
'use strict';

const { web3, contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');
const { setupAllContracts } = require('./setup');

// const MockToken = artifacts.require('MockToken');

const {
	toBytes32,
	// constants: { ZERO_ADDRESS },
} = require('../..');

const {
	currentTime,
	toUnit,
	// fromUnit,
	fastForward,
	multiplyDecimal,
	divideDecimal,
	// multiplyDecimalRound,
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

contract('External token staking integration', async accounts => {
	const [deployerAccount, owner, oracle] = accounts;
	const users = new Array(7).fill(null).map((_el, idx) => accounts[idx + 3]);

	let periFinance,
		exchangeRates,
		// periFinanceState,
		feePool,
		// delegateApprovals,
		// systemStatus,
		systemSettings,
		pUSDContract,
		// escrow,
		// rewardEscrowV2,
		// timestamp,
		debtCache,
		issuer,
		pynths,
		// addressResolver,
		externalTokenStakeManager,
		stakingState,
		// blacklistManager,
		usdc,
		dai,
		krw;

	before(async () => {
		pynths = ['pUSD', 'PERI', 'USDC'];
		({
			PeriFinance: periFinance,
			// PeriFinanceState: periFinanceState,
			// SystemStatus: systemStatus,
			SystemSettings: systemSettings,
			ExchangeRates: exchangeRates,
			// PeriFinanceEscrow: escrow,
			// RewardEscrowV2: rewardEscrowV2,
			PynthpUSD: pUSDContract,
			USDC: usdc,
			DAI: dai,
			KRW: krw,
			FeePool: feePool,
			DebtCache: debtCache,
			Issuer: issuer,
			// DelegateApprovals: delegateApprovals,
			// AddressResolver: addressResolver,
			StakingState: stakingState,
			ExternalTokenStakeManager: externalTokenStakeManager,
			// BlacklistManager: blacklistManager,
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
				'Issuer',
				'Exchanger',
				'DebtCache',
				'FlexibleStorage',
				'FeePoolStateUSDC',
				'StakingState',
				'ExternalTokenStakeManager',
				'CrossChainManager',
			],
			stables: keys,
		}));

		// [usdc, dai, krw] = await Promise.all([
		// 	MockToken.new('Mocked USDC', 'USDC', 6, { from: deployerAccount }),
		// 	MockToken.new('Dai Stablecoin', 'DAI', 18, { from: deployerAccount }),
		// 	MockToken.new('KRW Coin', 'KRW', 18, { from: deployerAccount }),
		// ]);

		tokenInfos['USDC'].contract = usdc;
		tokenInfos['DAI'].contract = dai;
		tokenInfos['KRW'].contract = krw;

		// await Promise.all(
		// 	['USDC', 'DAI', 'KRW'].map(_key =>
		// 		stakingState.setTargetToken(
		// 			tokenInfos[_key].currencyKey,
		// 			tokenInfos[_key].contract.address,
		// 			tokenInfos[_key].decimals,
		// 			{ from: owner }
		// 		)
		// 	)
		// );
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

			assert.equal(stakingStateAddress, stakingState.address);
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
		it('should only issuer is allowed to invoke', async () => {
			it('should only issuer is allowed to invoke', async () => {
				await assert.revert(
					externalTokenStakeManager.stake(users[0], 10, USDC, pUSD, { from: users[0] }),
					'Sender is not Issuer'
				);

				await assert.revert(
					externalTokenStakeManager.unstake(users[0], 10, USDC, pUSD, { from: users[0] }),
					'Sender is not Issuer'
				);

				await assert.revert(
					externalTokenStakeManager.unstakeMultipleTokens(users[0], 10, pUSD, { from: users[0] }),
					'Sender is not Issuer'
				);
			});
		});
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
				const balancesPERIAfter = await Promise.all(
					issuers.map(_issuer => periFinance.balanceOf(_issuer))
				);
				balancesPERIAfter.forEach(_el => assert.bnEqual(_el, toUnit(unitBal)));

				// It should derive back user's active debt properly
				const balancespUSD = await Promise.all(
					issuers.map(_issuer => pUSDContract.balanceOf(_issuer))
				);
				balancespUSD.map((_balance, _idx) => assert.bnEqual(_balance, issueAmounts[_idx]));

				const userDebts = await Promise.all(
					issuers.map(_issuer => periFinance.debtBalanceOf(_issuer, pUSD))
				);
				userDebts.forEach((_debt, _idx) => assert.bnEqual(_debt, balancespUSD[_idx]));

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
						// eslint-disable-next-line havven/no-assert-revert-without-await
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
					issuers.map(_issuer => issuer.externalTokenQuota(_issuer, 0, 0, true))
				);
				quotas.forEach(_quota => assert.bnEqual(_quota, toBN('0')));
			});

			it('should NOT issue pynths', async () => {
				// Over the target ratio (IR: 400%, 0.2 [USD/PERI])
				// With 10000 PERI, 500 pUSD is maximum can be issued.
				await periFinance.issuePynths(PERI, toUnit('500'), { from: users[0] });

				const balance0pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance0pUSD, toUnit('500'));

				await assert.revert(
					periFinance.issuePynths(PERI, 1, { from: users[0] }),
					'Amount too large'
				);
			});

			it('should issue max pynths', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				const balance0pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance0pUSD, toUnit('500'));
			});

			it('should change c-ratio if price is changed', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				const balance0pUSDBefore = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance0pUSDBefore, toUnit('500'));

				const targetRatio = await feePool.issuanceRatio();
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

				const balance0pUSDAfter = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance0pUSDAfter, toUnit('1000'));

				const finalRatio = await periFinance.collateralisationRatio(users[0]);
				assert.bnEqual(targetRatio, finalRatio);
			});

			it('should issue more if issuance ratio increased', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				await systemSettings.setIssuanceRatio(toUnit('0.5'), { from: owner });

				await periFinance.issueMaxPynths({ from: users[0] });

				const balance0pUSD = await pUSDContract.balanceOf(users[0]);
				assert.bnEqual(balance0pUSD, toUnit('1000'));
			});
		});

		describe('staking external tokens', () => {
			beforeEach(async () => {
				await Promise.all(
					users.map(_user => {
						return Promise.all([
							tokenInfos.USDC.contract.transfer(_user, unitBal + '0'.repeat(6), {
								from: owner,
							}),
							tokenInfos.DAI.contract.transfer(_user, toUnit(unitBal), { from: owner }),
							tokenInfos.KRW.contract.transfer(_user, toUnit(unitBal), { from: owner }),
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
					_balances.map((_balancesUser, idx) =>
						assert.bnEqual(
							_balancesUser,
							toBN(unitBal + '0'.repeat(Number(tokenInfos[keys[idx]].decimals)))
						)
					)
				);
			});

			it('should stake external token', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				// User currently have 500 pUSD(debt), if issue 125 pUSD amount with staking external token,
				// then it reaches quota limit.
				const balance0DAIBefore = await dai.balanceOf(users[0]);
				const balanceStateDAIBefore = await dai.balanceOf(stakingState.address);

				await periFinance.issuePynths(DAI, toUnit('125'), { from: users[0] });

				const [
					balance0pUSDAfter,
					balance0DAIAfter,
					balanceStateDAIAfter,
					stakedAmount0DAIAfter,
					// combinedStakedAmount_0_after,
					// exTokenQuota_0_after,
					targetRatio,
				] = await Promise.all([
					pUSDContract.balanceOf(users[0]),
					dai.balanceOf(users[0]),
					dai.balanceOf(stakingState.address),
					externalTokenStakeManager.stakedAmountOf(users[0], DAI, DAI),
					// externalTokenStakeManager.combinedStakedAmountOf(users[0], pUSD),
					// issuer.externalTokenQuota(users[0], 0, 0, true),
					feePool.issuanceRatio(),
				]);
				const daiStakedAmountEstimated = divideDecimalRound(
					divideDecimalRound(toUnit('125'), targetRatio),
					toUnit('1.001')
				);

				assert.bnEqual(balance0pUSDAfter, toUnit('625'));
				assert.bnClose(stakedAmount0DAIAfter, daiStakedAmountEstimated, '1');
				assert.bnEqual(balance0DAIAfter, balance0DAIBefore.sub(stakedAmount0DAIAfter));
				assert.bnEqual(balanceStateDAIAfter, balanceStateDAIBefore.add(stakedAmount0DAIAfter));
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

			it('should NOT stake if token is not registered', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				await updateRates([toBytes32('AUD')], ['0.9']);

				await assert.revert(
					periFinance.issuePynths(toBytes32('AUD'), toUnit('1'), { from: users[0] }),
					'Target token is not registered'
				);
			});

			it('should NOT stake if token is not activated', async () => {
				await stakingState.setTokenActivation(USDC, false, { from: owner });

				await periFinance.issueMaxPynths({ from: users[0] });

				const activationUSDC = await stakingState.tokenActivated(USDC);
				assert.equal(activationUSDC, false);

				await assert.revert(
					periFinance.issuePynths(USDC, toUnit('1'), { from: users[0] }),
					'Target token is not activated'
				);
			});

			it('should NOT stake pUSD', async () => {
				await assert.revert(
					periFinance.issuePynths(pUSD, toUnit('10'), { from: users[0] }),
					'pUSD is not staking coin'
				);
			});

			it('should stake multiple tokens', async () => {
				await periFinance.issuePynths(PERI, toUnit('300'), { from: users[0] });

				await periFinance.issuePynths(USDC, toUnit('20'), { from: users[0] });

				// const roundingUp = (_amount, _decimals) => {
				// 	const powered = toBN('1' + '0'.repeat(Number(_decimals)));

				// 	let amount = toBN(_amount);
				// 	if (amount.mod(powered).gt(toBN('0'))) {
				// 		amount = amount.add(powered);
				// 	}

				// 	return amount.div(powered).mul(powered);
				// };

				await periFinance.issuePynths(DAI, toUnit('55'), { from: users[0] });

				const quota0After = await issuer.externalTokenQuota(users[0], 0, 0, true);

				await assert.revert(
					periFinance.issuePynths(KRW, toUnit('1'), { from: users[0] }),
					'External token staking amount exceeds quota limit'
				);
				assert.bnClose(quota0After, toUnit('0.2'), '1' + '0'.repeat(12));
			});

			it('should stake to max quota', async () => {
				// 10000 PERI is being staked
				// As price is 0.2 USD/PERI, the value of staked PERI is 2000[USD]
				await periFinance.issueMaxPynths({ from: users[0] });

				const targetRatio = await feePool.issuanceRatio();
				const quota_0_before = await issuer.externalTokenQuota(users[0], 0, 0, true);
				const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalance_0_before = await pUSDContract.balanceOf(users[0]);
				const usdcBalance_0_before = await usdc.balanceOf(users[0]);
				const daiBalance_0_before = await dai.balanceOf(users[0]);

				assert.bnEqual(quota_0_before, toBN('0'));
				assert.bnLte(cRatio_0_before, targetRatio);
				assert.bnEqual(pUSDBalance_0_before, toUnit('500'));

				await periFinance.issuePynths(USDC, toUnit('5'), { from: users[0] });

				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[0] });

				const cRatio_0_after = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalance_0_after = await pUSDContract.balanceOf(users[0]);
				const combinedStakedAmount_0_after = await externalTokenStakeManager.combinedStakedAmountOf(
					users[0],
					pUSD
				);
				const usdcBalance_0_after = await usdc.balanceOf(users[0]);
				const daiBalance_0_after = await dai.balanceOf(users[0]);

				assert.bnLte(cRatio_0_after, targetRatio);
				assert.bnClose(pUSDBalance_0_after, toUnit('625'), '1' + '0'.repeat(12));
				assert.bnClose(combinedStakedAmount_0_after, toUnit('500'), '1' + '0'.repeat(12));
				assert.bnClose(
					usdcBalance_0_after,
					usdcBalance_0_before.sub(
						divideDecimal(divideDecimal(toUnit('5'), toUnit('0.98')), targetRatio).div(
							toBN(10 ** 12)
						)
					),
					'1' + '0'.repeat(12)
				);
				assert.bnClose(
					daiBalance_0_after,
					daiBalance_0_before.sub(
						divideDecimal(divideDecimal(toUnit('120'), toUnit('1.001')), targetRatio)
					),
					'1' + '0'.repeat(12)
				);
			});

			it('should stake upto user balance if balance is not enough', async () => {
				// As 0.2 USD/PERI exchange rate,
				// PERI staked 2000 [USD], issued pUSD 500
				await periFinance.issueMaxPynths({ from: users[0] });

				const daiBalance = await dai.balanceOf(users[0]);
				await dai.transfer(deployerAccount, daiBalance.sub(toUnit('5')), { from: users[0] });

				// For convinient calculation
				await updateRates([DAI], ['1']);

				// It will stake 5 DAI, and issue 1.25 pUSD
				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[0] });

				const quota_0_after = await issuer.externalTokenQuota(users[0], 0, 0, true);
				const targetRatio = await feePool.issuanceRatio();
				const cRatio_0_after = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalance_0_after = await pUSDContract.balanceOf(users[0]);
				const combinedStakedAmount_0_after = await externalTokenStakeManager.combinedStakedAmountOf(
					users[0],
					pUSD
				);
				const daiBalance_0_after = await dai.balanceOf(users[0]);

				assert.bnClose(
					quota_0_after,
					divideDecimal(multiplyDecimal(toUnit('5'), targetRatio), toUnit('501.25'))
				);
				assert.bnEqual(cRatio_0_after, targetRatio);
				assert.bnEqual(pUSDBalance_0_after, toUnit('501.25'));
				assert.bnEqual(combinedStakedAmount_0_after, toUnit('5'));
				assert.bnEqual(daiBalance_0_after, toBN('0'));
			});

			it('should NOT stake to max quota', async () => {
				// User already meets or violates quota limit
				await periFinance.issueMaxPynths({ from: users[1] });
				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[1] });

				await assert.revert(
					periFinance.issuePynthsToMaxQuota(DAI, { from: users[1] }),
					'No available external token staking amount'
				);
			});
		});
	});

	describe('Burning', () => {
		const unitBal = '10000';

		beforeEach(async () => {
			await Promise.all(
				users.map(_user => periFinance.transfer(_user, toUnit(unitBal), { from: owner }))
			);

			await Promise.all(
				users.map(_user => {
					return Promise.all([
						tokenInfos.USDC.contract.transfer(_user, unitBal + '0'.repeat(6), {
							from: owner,
						}),
						tokenInfos.DAI.contract.transfer(_user, toUnit(unitBal), { from: owner }),
						tokenInfos.KRW.contract.transfer(_user, toUnit(unitBal), { from: owner }),
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
		});

		describe('unstaking only PERI Token', async () => {
			beforeEach(async () => {
				// It locks 4000 PERI with IR: 0.25, exRate: 0.2 [USD/PERI]
				await periFinance.issuePynths(PERI, toUnit('200'), { from: users[0] });

				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('1'), { from: users[0] }),
					'Minimum stake time not reached'
				);

				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);
			});

			it('should burn pUSD and unlock PERI', async () => {
				const balance_0_pUSD_before = await pUSDContract.balanceOf(users[0]);
				const transferable_0_before = await periFinance.transferablePeriFinance(users[0]);

				// Burns 50 pUSD, it should unlock 1000 PERI
				await periFinance.burnPynths(PERI, toUnit('50'), { from: users[0] });

				const balance_0_pUSD_after = await pUSDContract.balanceOf(users[0]);
				const transferable_0_after = await periFinance.transferablePeriFinance(users[0]);

				assert.bnEqual(balance_0_pUSD_before, balance_0_pUSD_after.add(toUnit('50')));
				assert.bnEqual(transferable_0_before, toUnit('6000'));
				assert.bnEqual(transferable_0_after, toUnit('7000'));
			});

			it('should NOT burn pynths', async () => {
				// No debt
				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('1'), { from: users[1] }),
					'No debt to forgive'
				);

				// Burn max then debt
				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('201'), { from: users[0] }),
					'Trying to burn more than debt'
				);

				// Not enough pUSD
				await pUSDContract.transfer(users[1], toUnit('151'), { from: users[0] });

				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('50'), { from: users[0] }),
					'SafeMath: subtraction overflow'
				);
			});
		});

		describe('unstaking external token', () => {
			beforeEach(async () => {
				await periFinance.issuePynths(PERI, toUnit('200'), { from: users[0] });
				await periFinance.issuePynths(USDC, toUnit('5'), { from: users[0] });
				await periFinance.issuePynths(DAI, toUnit('20'), { from: users[0] });
				await periFinance.issuePynths(KRW, toUnit('25'), { from: users[0] });
			});

			it('should unstake', async () => {
				const stakedAmount_DAI_0_before = await externalTokenStakeManager.stakedAmountOf(
					users[0],
					DAI,
					DAI
				);

				const balance_DAI_0_before = await dai.balanceOf(users[0]);
				const targetRatio = await feePool.issuanceRatio();

				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);

				await periFinance.burnPynths(DAI, toUnit('2'), { from: users[0] });

				const stakedAmount_DAI_0_after = await externalTokenStakeManager.stakedAmountOf(
					users[0],
					DAI,
					DAI
				);
				// const quota_0_after = await issuer.externalTokenQuota(users[0], 0, 0, true);
				const balance_DAI_0_after = await dai.balanceOf(users[0]);

				const expectedUnstaked = divideDecimal(toUnit('2'), targetRatio);

				assert.bnClose(
					stakedAmount_DAI_0_after,
					stakedAmount_DAI_0_before.sub(divideDecimal(expectedUnstaked, toUnit('1.001'))),
					'10'
				);
				/* assert.bnClose(
					quota_0_after,
					divideDecimal(toUnit('48'), toUnit('248')),
					'1' + '0'.repeat(12)
				); */
				assert.bnClose(
					balance_DAI_0_after,
					balance_DAI_0_before.add(divideDecimal(expectedUnstaked, toUnit('1.001'))),
					'10'
				);
			});

			it('should NOT unstake if it exceeds quota limit after PERI unstaked', async () => {
				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);

				// if it exceeds limit quota after unstake PERI
				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('1'), { from: users[0] }),
					'External token staking amount exceeds quota limit'
				);
			});

			it('should NOT unstake if it tries to unstake more than staked amount', async () => {
				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);

				// it exceeds available staked amount
				await assert.revert(
					periFinance.burnPynths(USDC, toUnit('6'), { from: users[0] }),
					"Account doesn't have enough staked amount"
				);
			});

			it('should NOT unstake if the token is not registered', async () => {
				await fastForward(86401);

				await updateRates(
					[PERI, USDC, DAI, KRW, toBytes32('AUD')],
					['0.2', '0.98', '1.001', '1100', '0.9']
				);

				await assert.revert(
					periFinance.burnPynths(toBytes32('AUD'), toUnit('1'), { from: users[0] }),
					'Target token is not registered'
				);
			});

			describe('Settings', () => {
				it('should set currency key order', async () => {
					const orderKeys_before = await externalTokenStakeManager.getCurrencyKeyOrder();

					// There is no order defined if it is not set
					assert.equal(orderKeys_before.length, 0);

					await externalTokenStakeManager.setUnstakingOrder([KRW, USDC, DAI], { from: owner });

					const orderKeys_after = await externalTokenStakeManager.getCurrencyKeyOrder();

					assert.equal(orderKeys_after[0], KRW);
					assert.equal(orderKeys_after[1], USDC);
					assert.equal(orderKeys_after[2], DAI);
				});

				it('should NOT set currency key order', async () => {
					// not owner
					await assert.revert(
						externalTokenStakeManager.setUnstakingOrder([KRW, USDC, DAI], {
							from: deployerAccount,
						}),
						'Only the contract owner may perform this action'
					);

					// length is not matched with registered currency keys
					await assert.revert(
						externalTokenStakeManager.setUnstakingOrder([KRW, USDC, DAI, DAI], { from: owner }),
						'Given currency keys are not available'
					);

					// different currency key
					await assert.revert(
						externalTokenStakeManager.setUnstakingOrder([KRW, USDC, PERI], { from: owner }),
						'Given currency keys are not available'
					);
				});
			});

			describe('fit to claimable', () => {
				beforeEach(async () => {
					await periFinance.issueMaxPynths({ from: users[0] });

					const cRatio = await periFinance.collateralisationRatio(users[0]);
					const targetRatio = await feePool.issuanceRatio();
					assert.bnEqual(cRatio, targetRatio);
				});

				it('should fit to claimable if ratio violates target ratio', async () => {
					await updateRates([PERI, USDC, DAI, KRW], ['0.1', '0.98', '1.001', '1100']);

					// Debt: 550, USDC: 200, PERI: 1000
					// C-Ratio: 218.1818181818182, Current Quota: 0.09090909090909091
					const targetRatio = await feePool.issuanceRatio();
					const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);
					const combinedStakedAmount_0_before = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_before = await periFinance.debtBalanceOf(users[0], pUSD);
					assert.bnGt(cRatio_0_before, targetRatio);

					await periFinance.fitToClaimable({ from: users[0] });

					// after fit,
					// burn amount would be 250 pUSD.
					// The debt would be 300, external token staking quota going to be: 0.16666666....
					// No unstaking for external token
					const cRatio_0_after = await periFinance.collateralisationRatio(users[0]);
					const balance_pUSD_0_after = await pUSDContract.balanceOf(users[0]);
					const quota_0_after = await issuer.externalTokenQuota(users[0], 0, 0, true);
					const combinedStakedAmount_0_after = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_after = await periFinance.debtBalanceOf(users[0], pUSD);
					assert.bnEqual(cRatio_0_after, targetRatio);
					assert.bnClose(balance_pUSD_0_after, toUnit('300'), '1' + '0'.repeat(12));
					assert.bnClose(quota_0_after, '166666666666666666', '1' + '0'.repeat(12));
					assert.bnEqual(combinedStakedAmount_0_before, combinedStakedAmount_0_after);
					assert.bnEqual(debtBalance_0_after, debtBalance_0_before.sub(toUnit('250')));
				});

				it('should fit to claimable if quota violates target ratio', async () => {
					// Increase external tokens price for increasing its quota
					await updateRates([PERI, USDC, DAI, KRW], ['0.2', '2', '2.5', '3000']);

					// Current debt: 550000000179999999975, StakedAmounts[USD]: 513343800527472527200, Quota: 0.23333809107248596
					const targetRatio = await feePool.issuanceRatio();
					// const stakedAmounts_0_before = await Promise.all(
					// 	keys.map(_key =>
					// 		externalTokenStakeManager.stakedAmountOf(
					// 			users[0],
					// 			tokenInfos[_key].currencyKey,
					// 			tokenInfos[_key].currencyKey
					// 		)
					// 	)
					// );
					// Staked Amounts:
					// USDC: 20408164000000000000, DAI: 79920079920079920080, KRW: 90909090909090909
					const combinedStakedAmount_0_before = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_before = await periFinance.debtBalanceOf(users[0], pUSD);
					const balance_pUSD_0_before = await pUSDContract.balanceOf(users[0]);
					const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);

					assert.bnLt(cRatio_0_before, targetRatio);

					await periFinance.fitToClaimable({ from: users[0] });

					// Expected values::
					// burnAmount: 22919937619835160000, unstakeAmount: 91679750479340640000
					await Promise.all(
						keys.map(_key =>
							externalTokenStakeManager.stakedAmountOf(
								users[0],
								tokenInfos[_key].currencyKey,
								tokenInfos[_key].currencyKey
							)
						)
					);
					// Staked Amounts:
					// USDC: 20408164000000000000, DAI: 79920079920079920080, KRW: 90909090909090909
					const combinedStakedAmount_0_after = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_after = await periFinance.debtBalanceOf(users[0], pUSD);
					const balance_pUSD_0_after = await pUSDContract.balanceOf(users[0]);
					const cRatio_0_after = await periFinance.collateralisationRatio(users[0]);

					assert.bnClose(
						combinedStakedAmount_0_after,
						combinedStakedAmount_0_before.sub(toBN('91679750479340640000')),
						'1' + '0'.repeat(12)
					);
					assert.bnClose(
						debtBalance_0_after,
						debtBalance_0_before.sub(toBN('22919937619835160000')),
						'10000'
					);
					assert.bnClose(
						balance_pUSD_0_after,
						balance_pUSD_0_before.sub(toBN('22919937619835160000')),
						'10000'
					);
					assert.bnLt(cRatio_0_after, targetRatio);
				});

				it('should fit to claimable if quota violates target ratio and quota limit', async () => {
					await updateRates([PERI, USDC, DAI, KRW], ['0.01', '2', '2.5', '3000']);

					const targetRatio = await feePool.issuanceRatio();
					const combinedStakedAmount_0_before = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_before = await periFinance.debtBalanceOf(users[0], pUSD);
					const balance_pUSD_0_before = await pUSDContract.balanceOf(users[0]);
					const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);

					assert.bnGt(cRatio_0_before, targetRatio);

					await periFinance.fitToClaimable({ from: users[0] });

					// Expected values::
					// burnAmount: 518.75000018, stakedAmount: 488.3438005274726
					const combinedStakedAmount_0_after = await externalTokenStakeManager.combinedStakedAmountOf(
						users[0],
						pUSD
					);
					const debtBalance_0_after = await periFinance.debtBalanceOf(users[0], pUSD);
					const balance_pUSD_0_after = await pUSDContract.balanceOf(users[0]);
					const cRatio_0_after = await periFinance.collateralisationRatio(users[0]);

					assert.bnClose(
						combinedStakedAmount_0_after,
						combinedStakedAmount_0_before.sub(toUnit('488.3438005274726')),
						'1' + '0'.repeat(12)
					);
					assert.bnClose(
						debtBalance_0_after,
						debtBalance_0_before.sub(toUnit('518.75000018')),
						'10000'
					);
					assert.bnClose(
						balance_pUSD_0_after,
						balance_pUSD_0_before.sub(toUnit('518.75000018')),
						'10000'
					);
					assert.bnClose(cRatio_0_after, targetRatio);
				});

				it('should NOT run if user is already claimable', async () => {
					await updateRates([PERI, USDC, DAI, KRW], ['0.2', '0.98', '1.001', '1100']);

					const targetRatio = await feePool.issuanceRatio();
					const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);
					assert.bnLte(cRatio_0_before, targetRatio);

					await assert.revert(
						periFinance.fitToClaimable({ from: users[0] }),
						'Account is already claimable'
					);
				});
			});
		});

		describe('exit', () => {
			beforeEach(async () => {
				await periFinance.issuePynths(PERI, toUnit('200'), { from: users[0] });
				await periFinance.issuePynths(USDC, toUnit('5'), { from: users[0] });
				await periFinance.issuePynths(DAI, toUnit('20'), { from: users[0] });
				await periFinance.issuePynths(KRW, toUnit('25'), { from: users[0] });
				await fastForward(86401);

				// Set the status to fit to claimable violation set
				await updateRates([PERI, USDC, DAI, KRW], ['0.01', '2', '2.5', '3000']);
			});

			it('should exit at no violation status', async () => {
				await periFinance.exit({ from: users[0] });

				const combinedStakedAmount_0 = await externalTokenStakeManager.combinedStakedAmountOf(
					users[0],
					pUSD
				);
				const stakedAmounts_0 = await Promise.all(
					keys.map(_key =>
						externalTokenStakeManager.stakedAmountOf(
							users[0],
							tokenInfos[_key].currencyKey,
							tokenInfos[_key].currencyKey
						)
					)
				);
				const debtBalance_0 = await periFinance.debtBalanceOf(users[0], pUSD);
				const balance_pUSD_0 = await pUSDContract.balanceOf(users[0]);
				const balances_0 = await Promise.all(
					keys.map(_key => tokenInfos[_key].contract.balanceOf(users[0]))
				);
				const transferable_0 = await periFinance.transferablePeriFinance(users[0]);
				const balance_0_PERI = await periFinance.balanceOf(users[0]);

				assert.bnEqual(combinedStakedAmount_0, toBN('0'));
				stakedAmounts_0.forEach(_stakedAmount => assert.bnEqual(_stakedAmount, toBN('0')));
				assert.bnEqual(debtBalance_0, toBN('0'));
				assert.bnEqual(balance_pUSD_0, toBN('0'));
				balances_0.forEach((_balance, _idx) =>
					assert.bnEqual(_balance, '10000' + '0'.repeat(tokenInfos[keys[_idx]].decimals))
				);
				assert.bnEqual(transferable_0, balance_0_PERI);
			});

			it('should exit at the violation status', async () => {
				const targetRatio = await feePool.issuanceRatio();
				const cRatio_0_before = await periFinance.collateralisationRatio(users[0]);

				assert.bnGt(cRatio_0_before, targetRatio);

				await periFinance.exit({ from: users[0] });

				const combinedStakedAmount_0 = await externalTokenStakeManager.combinedStakedAmountOf(
					users[0],
					pUSD
				);
				const stakedAmounts_0 = await Promise.all(
					keys.map(_key =>
						externalTokenStakeManager.stakedAmountOf(
							users[0],
							tokenInfos[_key].currencyKey,
							tokenInfos[_key].currencyKey
						)
					)
				);
				const debtBalance_0 = await periFinance.debtBalanceOf(users[0], pUSD);
				const balance_pUSD_0 = await pUSDContract.balanceOf(users[0]);
				const balances_0 = await Promise.all(
					keys.map(_key => tokenInfos[_key].contract.balanceOf(users[0]))
				);
				const transferable_0 = await periFinance.transferablePeriFinance(users[0]);
				const balance_0_PERI = await periFinance.balanceOf(users[0]);

				assert.bnEqual(combinedStakedAmount_0, toBN('0'));
				stakedAmounts_0.forEach(_stakedAmount => assert.bnEqual(_stakedAmount, toBN('0')));
				assert.bnEqual(debtBalance_0, toBN('0'));
				assert.bnEqual(balance_pUSD_0, toBN('0'));
				balances_0.forEach((_balance, _idx) =>
					assert.bnEqual(_balance, '10000' + '0'.repeat(tokenInfos[keys[_idx]].decimals))
				);
				assert.bnEqual(transferable_0, balance_0_PERI);
			});
		});
	});
});
