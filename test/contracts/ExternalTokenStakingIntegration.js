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
// const { lte } = require('semver');

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

const [pUSD, PERI, USDC, DAI, PAXG] = [
	toBytes32('pUSD'),
	toBytes32('PERI'),
	toBytes32('USDC'),
	toBytes32('DAI'),
	toBytes32('PAXG'),
];

const tokenInfos = {
	USDC: { currencyKey: USDC, decimals: 6, contract: {} },
	DAI: { currencyKey: DAI, decimals: 18, contract: {} },
	PAXG: { currencyKey: PAXG, decimals: 18, contract: {} },
};

const keys = ['USDC', 'DAI', 'PAXG'];

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
		exTokenManager,
		stakingState,
		// blacklistManager,
		usdc,
		dai,
		paxg;

	before(async () => {
		pynths = ['pUSD', 'PERI'];
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
			PAXG: paxg,
			FeePool: feePool,
			DebtCache: debtCache,
			Issuer: issuer,
			// DelegateApprovals: delegateApprovals,
			// AddressResolver: addressResolver,
			StakingState: stakingState,
			ExternalTokenStakeManager: exTokenManager,
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

		// [usdc, dai, paxg] = await Promise.all([
		// 	MockToken.new('Mocked USDC', 'USDC', 6, { from: deployerAccount }),
		// 	MockToken.new('Dai Stablecoin', 'DAI', 18, { from: deployerAccount }),
		// 	MockToken.new('PAXG Coin', 'PAXG', 18, { from: deployerAccount }),
		// ]);

		tokenInfos['USDC'].contract = usdc;
		tokenInfos['DAI'].contract = dai;
		tokenInfos['PAXG'].contract = paxg;

		// await Promise.all(
		// 	['USDC', 'DAI', 'PAXG'].map(_key =>
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
		await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '2000']);
	});

	describe('Deployment settings', () => {
		it('should ExternalTokenStakeManager deployed', async () => {
			const stakingStateAddress = await exTokenManager.stakingState();

			assert.equal(stakingStateAddress, stakingState.address);
		});

		it('should set token on stakingState', async () => {
			const tokenList = await exTokenManager.getTokenList();

			assert.equal(tokenList.length, 3);
			assert.equal(tokenList[0], USDC);
			assert.equal(tokenList[1], DAI);
			assert.equal(tokenList[2], PAXG);

			const addresses = await Promise.all(tokenList.map(_key => stakingState.tokenAddress(_key)));
			const decimals = await Promise.all(tokenList.map(_key => stakingState.tokenDecimals(_key)));

			assert.equal(addresses[0], usdc.address);
			assert.equal(addresses[1], dai.address);
			assert.equal(addresses[2], paxg.address);
			assert.equal(decimals[0], 6);
			assert.equal(decimals[1], 18);
			assert.equal(decimals[2], 18);
		});

		it('should set issuance ratios for external tokens', async () => {
			const issuanceRatios = await Promise.all(
				keys.map(toBytes32).map(_key => systemSettings.exTokenIssuanceRatio(_key))
			);

			assert.bnEqual(issuanceRatios[0], toUnit('1'));
			assert.bnEqual(issuanceRatios[1], toUnit('1'));
			assert.bnEqual(issuanceRatios[2], toUnit('0.75'));
		});
	});

	describe('ExternalTokenStakeManager authorization', () => {
		it('should only issuer is allowed to invoke', async () => {
			it('should only issuer is allowed to invoke', async () => {
				await assert.revert(
					exTokenManager.stake(users[0], 0, 10, USDC, pUSD, { from: users[0] }),
					'Sender is not Issuer'
				);

				await assert.revert(
					exTokenManager.unstake(users[0], 0, 10, USDC, pUSD, { from: users[0] }),
					'Sender is not Issuer'
				);

				await assert.revert(
					exTokenManager.proRataUnstake(users[0], 10, 100, pUSD, true, {
						from: users[0],
					}),
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

				/* const price = await exchangeRates.rateForCurrency(PERI);

				console.log(price.toString());

				const issuanceRatio = await systemSettings.issuanceRatio();

				console.log(issuanceRatio.toString());

				const targetRatio = await issuer.getTargetRatio(users[0]);

				console.log(targetRatio.toString());

				const maxIssuablePynths = await periFinance.maxIssuablePynths(users[0]);

				console.log(maxIssuablePynths.toString());

				const debtBalanceOfAndTotalDebt = await issuer.debtBalanceOfAndTotalDebt(users[0], pUSD);

				console.log(
					debtBalanceOfAndTotalDebt[0].toString(),
					debtBalanceOfAndTotalDebt[1].toString()
				);

				const remainingIssuablePynths = await periFinance.remainingIssuablePynths(users[0]);

				console.log(remainingIssuablePynths[0].toString(), remainingIssuablePynths[1].toString());
 				*/
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
							'Check Transferable'
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
				const quotas = await Promise.all(issuers.map(_issuer => issuer.exStakingRatio(_issuer)));
				quotas.forEach(_quota => assert.bnEqual(_quota.exSR, toBN('0')));
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
							tokenInfos.PAXG.contract.transfer(_user, toUnit(unitBal), { from: owner }),
							tokenInfos.USDC.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
								from: _user,
							}),
							tokenInfos.DAI.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
								from: _user,
							}),
							tokenInfos.PAXG.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
								from: _user,
							}),
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

			it.skip('should stake external token', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				// It should derive back user's active debt properly
				const balancespUSD = await pUSDContract.balanceOf(users[0]);

				console.log(balancespUSD.toString());

				// User currently have 500 pUSD(debt), if issue 500 pUSD amount with staking DAI token,
				// then it reaches quota limit.
				const balance0DAIBefore = await dai.balanceOf(users[0]);
				const balanceStateDAIBefore = await dai.balanceOf(stakingState.address);
				const tr1 = await issuer.getTargetRatio(users[0]);

				console.log(tr1.toString());

				// const issuables = await issuer.maxExIssuablePynths(users[0], DAI);
				// console.log(issuables.toString());

				// const ratios = await exTokenManager.expectedTargetRatios(
				// 	users[0],
				// 	balancespUSD,
				// 	toUnit('1000'),
				// 	DAI,
				// 	true
				// );

				// console.log(ratios.map(_ratio => _ratio.toString()));

				await periFinance.issuePynths(DAI, toUnit('1000'), { from: users[0] });
				const tr2 = await issuer.getTargetRatio(users[0]);
				console.log(tr2.toString());
				/* const { otherIR, otherEA, tokenIR, tokenEA } = await exTokenManager.otherTokenIREA(
					users[0],
					DAI
				);

				console.log(otherIR.toString(), otherEA.toString(), tokenIR.toString(), tokenEA.toString()); */

				const balance0pUSDAfter = await pUSDContract.balanceOf(users[0]);
				/* const { tRatio, exTRatio, eaSaGap } = await exTokenManager.calcTRatio(
					users[0],
					balance0pUSDAfter,
					DAI
				);

				console.log(tRatio.toString(), exTRatio.toString(), eaSaGap.toString()); */

				const [
					balance0DAIAfter,
					balanceStateDAIAfter,
					stakedAmount0DAIAfter,
					// combinedStakedAmount_0_after,
					targetRatio,
				] = await Promise.all([
					dai.balanceOf(users[0]),
					dai.balanceOf(stakingState.address),
					exTokenManager.stakedAmountOf(users[0], DAI, DAI),
					// exTokenManager.combinedStakedAmountOf(users[0], pUSD),
					// exTokenManager.exStakingRatio(users[0]),
					systemSettings.exTokenIssuanceRatio(DAI),
				]);

				const daiStakedAmountEstimated = divideDecimalRound(
					divideDecimalRound(toUnit('1000'), targetRatio),
					toUnit('1.001')
				);

				assert.bnEqual(balance0pUSDAfter, toUnit('1500'));
				assert.bnClose(stakedAmount0DAIAfter, daiStakedAmountEstimated, '1');
				assert.bnEqual(balance0DAIAfter, balance0DAIBefore.sub(stakedAmount0DAIAfter));
				assert.bnEqual(balanceStateDAIAfter, balanceStateDAIBefore.add(stakedAmount0DAIAfter));
			});

			it.skip('should NOT stake if there is no debt (no PERI locked)', async () => {
				await assert.revert(
					periFinance.issuePynths(USDC, '1000000', { from: users[0] }),
					'User does not have any debt yet'
				);
			});
			it.skip('should NOT stake if it exceeds quota limit', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				// Maximum staking upto quota limit
				await periFinance.issuePynths(DAI, toUnit('1000'), { from: users[0] });

				// Increase PERI price to make pUSD issuable
				await updateRates([PERI], ['0.4']);

				const targetRatio = await issuer.getTargetRatio(users[0]);

				console.log(targetRatio.toString());

				// Irrelavant to issuable state, external token staked amount is still on quota limit.
				await assert.revert(
					periFinance.issuePynths(USDC, toUnit('1'), { from: users[0] }),
					'Over max external quota'
				);
			});

			it.skip('should NOT stake if token is not registered', async () => {
				await periFinance.issueMaxPynths({ from: users[0] });

				await updateRates([toBytes32('AUD')], ['0.9']);

				await assert.revert(
					periFinance.issuePynths(toBytes32('AUD'), toUnit('1'), { from: users[0] }),
					'Target token is not registered'
				);
			});

			it.skip('should NOT stake if token is not activated', async () => {
				await stakingState.setTokenActivation(USDC, false, { from: owner });

				await periFinance.issueMaxPynths({ from: users[0] });

				const activationUSDC = await stakingState.tokenActivated(USDC);
				assert.equal(activationUSDC, false);

				await assert.revert(
					periFinance.issuePynths(USDC, toUnit('1'), { from: users[0] }),
					'Target token is not activated'
				);
			});

			it.skip('should NOT stake pUSD', async () => {
				await assert.revert(
					periFinance.issuePynths(pUSD, toUnit('10'), { from: users[0] }),
					'pUSD is not staking coin'
				);
			});

			it('should stake multiple tokens', async () => {
				await periFinance.issuePynths(PERI, toUnit('400'), { from: users[0] });

				/* let targetRatio = await issuer.getTargetRatio(users[0]);

				console.log(targetRatio.toString()); */

				await periFinance.issuePynths(USDC, toUnit('100'), { from: users[0] });

				/* targetRatio = await issuer.getTargetRatio(users[0]);

				console.log(targetRatio.toString()); */

				/* const usdcSA = await exTokenManager.stakedAmountOf(users[0], USDC, USDC);

				console.log('usdcSA :', usdcSA.toString());

				let debt = await pUSDContract.balanceOf(users[0]);

				console.log('debt :', debt.toString());

				const { tokenEA } = await exTokenManager.otherTokenIREA(users[0], USDC);

				console.log('tokenSate :', tokenEA.toString()); */

				// const roundingUp = (_amount, _decimals) => {
				// 	const powered = toBN('1' + '0'.repeat(Number(_decimals)));

				// 	let amount = toBN(_amount);
				// 	if (amount.mod(powered).gt(toBN('0'))) {
				// 		amount = amount.add(powered);
				// 	}

				// 	return amount.div(powered).mul(powered);
				// };

				await periFinance.issuePynths(DAI, toUnit('100'), { from: users[0] });

				/* targetRatio = await issuer.getTargetRatio(users[0]);

				console.log(targetRatio.toString()); */

				/* debt = await pUSDContract.balanceOf(users[0]);

				console.log('debt :', debt.toString()); */

				await periFinance.issuePynths(PAXG, toUnit('900'), { from: users[0] });

				const { debt, periCol } = await issuer.debtsCollateral(users[0], false);

				const { tRatio, exTRatio, exEA } = await exTokenManager.getTargetRatio(users[0], debt);
				console.log('debt :', debt.toString());
				console.log('periCol :', periCol.toString(), 'exEA :', exEA.toString());
				console.log('exStakingRatio :', divideDecimal(exEA, periCol.add(exEA)).toString());

				const { exDebt } = await exTokenManager.getExEADebt(users[0]);

				const periIR = await systemSettings.issuanceRatio();

				const periSA = divideDecimal(debt.sub(exDebt), periIR);

				const exSRatio = divideDecimal(exEA, periSA.add(exEA));

				const { exSR, maxSR } = await issuer.exStakingRatio(users[0]);

				assert.bnClose(exSRatio, exSR, 10);

				console.log(exSR.toString(), maxSR.toString());

				const targetRatio = periIR.add(multiplyDecimal(exTRatio.sub(periIR), exSR));

				assert.bnClose(targetRatio, tRatio, 10);
			});

			it('should stake to max quota', async () => {
				// 10000 PERI is being staked
				// As price is 0.2 USD/PERI, the value of staked PERI is 2000[USD]
				await periFinance.issueMaxPynths({ from: users[0] });

				let tr = await issuer.getTargetRatio(users[0]);
				const quotaBefore = await issuer.exStakingRatio(users[0]);
				const cRatioBefore = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalanceBefore = await pUSDContract.balanceOf(users[0]);
				const usdcBalanceBefore = (await usdc.balanceOf(users[0])).mul(toBN(1e12));
				const paxgBalanceBefore = await paxg.balanceOf(users[0]);

				assert.bnEqual(quotaBefore.exSR, toBN('0'));
				assert.bnLte(cRatioBefore, tr);
				assert.bnEqual(pUSDBalanceBefore, toUnit('500'));

				await periFinance.issuePynths(USDC, toUnit('200'), { from: users[0] });

				tr = await issuer.getTargetRatio(users[0]);

				console.log('TargetRatio(After USDC stake):', tr.toString());

				const usdcBalanceAfter = (await usdc.balanceOf(users[0])).mul(toBN(1e12));

				// const { tokenEA, minDecimals } = await exTokenManager.otherTokenIREA(users[0], PAXG);

				// console.log('tokenSate :', tokenEA.toString(), 'minDecimals :', minDecimals.toString());

				// const tokenList = await exTokenManager.getTokenList();

				// tokenList.forEach(async _token => {
				// 	const stakedAmtOf = await exTokenManager.stakedAmountOf(users[0], _token, pUSD);

				// 	console.log('stakedAmtOf :', _token, stakedAmtOf.toString());
				// });

				const fagxIssuanceRatio = await systemSettings.exTokenIssuanceRatio(PAXG);
				// const maxPAXG = await issuer.maxExIssuablePynths(users[0], PAXG);

				// console.log('max issuable pUSD:', maxPAXG.toString());

				// It should derive back user's active debt properly
				// const balancespUSD = await pUSDContract.balanceOf(users[0]);

				// console.log('pUSD balance:', balancespUSD.toString());

				/* const { targetRatio, changedAmt } = await exTokenManager.expectedTargetRatios(
					users[0],
					balancespUSD,
					divideDecimal(maxPAXG, fagxIssuanceRatio),
					PAXG,
					true
				);

				console.log(targetRatio.toString(), changedAmt.toString()); */

				/* const { maxAmount, tRatio } = await exTokenManager.maxStakableAmountOf(
					users[0],
					balancespUSD,
					PAXG,
					pUSD
				);
				console.log(
					'maxAmount:',
					maxAmount.toString(),
					'tRatio:',
					tRatio.toString()
				); */

				await periFinance.issuePynthsToMaxQuota(PAXG, { from: users[0] });

				const cRatioAfter = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalanceAfter = await pUSDContract.balanceOf(users[0]);
				const combinedSA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);

				const paxgBalanceAfter = await paxg.balanceOf(users[0]);
				tr = await issuer.getTargetRatio(users[0]);
				const usdcIssuanceRatio = await systemSettings.exTokenIssuanceRatio(USDC);

				assert.bnLte(cRatioAfter, tr);
				assert.bnClose(pUSDBalanceAfter, toUnit('1900'), '1' + '0'.repeat(12));
				assert.bnClose(combinedSA, toUnit('1800'), '1' + '0'.repeat(12));
				const estimatedUsdc = usdcBalanceBefore.sub(
					divideDecimal(divideDecimal(toUnit('200'), toUnit('0.999')), usdcIssuanceRatio)
				);
				assert.bnClose(usdcBalanceAfter, estimatedUsdc, '1' + '0'.repeat(12));
				const debtPaxg = divideDecimal(toUnit('1200'), toUnit('2000'));
				const stakedPaxg = divideDecimal(debtPaxg, fagxIssuanceRatio);
				const estimatedPaxg = paxgBalanceBefore.sub(stakedPaxg);
				assert.bnClose(paxgBalanceAfter, estimatedPaxg, '1' + '0'.repeat(12));
			});

			it('should stake up to user balance if balance is not enough to fit the max target ratio(200% ~ 400%)', async () => {
				// As 0.2 USD/PERI exchange rate,
				// PERI staked 2000 [USD], issued pUSD 500
				await periFinance.issueMaxPynths({ from: users[0] });

				const daiBalance = await dai.balanceOf(users[0]);
				await dai.transfer(deployerAccount, daiBalance.sub(toUnit('5')), { from: users[0] });

				// For convinient calculation
				await updateRates([DAI], ['1']);

				const { debt, periCol } = await issuer.debtsCollateral(users[0], false);

				const maxAmount = await exTokenManager.maxStakableAmountOf(users[0], debt, periCol, DAI);

				console.log('maxAmount:', maxAmount.toString());

				// It will stake 5 DAI, and issue 5 pUSD
				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[0] });

				// const quotaAfter = await exTokenManager.exStakingRatio(users[0]);
				// const targetRatio = await feePool.issuanceRatio();
				const cRatioAfter = await periFinance.collateralisationRatio(users[0]);
				const pUSDBalanceAfter = await pUSDContract.balanceOf(users[0]);
				const combinedSA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
				const daiBalanceAfter = await dai.balanceOf(users[0]);
				const targetRatio = await issuer.getTargetRatio(users[0]);

				// assert.bnClose(
				// 	quotaAfter,
				// 	divideDecimal(multiplyDecimal(toUnit('5'), targetRatio), toUnit('505'))
				// );
				assert.bnClose(cRatioAfter, targetRatio, '1');
				assert.bnEqual(pUSDBalanceAfter, toUnit('505'));
				assert.bnEqual(combinedSA, toUnit('5'));
				assert.bnEqual(daiBalanceAfter, toBN('0'));
			});

			it('should NOT stake to max quota', async () => {
				// User already meets or violates quota limit
				await periFinance.issueMaxPynths({ from: users[1] });
				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[1] });

				await assert.revert(
					periFinance.issuePynthsToMaxQuota(DAI, { from: users[1] }),
					'No available ex-tokens to stake'
				);
			});
			describe('when the user has issued pynths against a range of different collateral types', () => {
				beforeEach(async () => {
					await periFinance.issueMaxPynths({ from: users[0] });
					await periFinance.issuePynths(USDC, toUnit('20'), { from: users[0] });
					await periFinance.issuePynths(PAXG, toUnit('20'), { from: users[0] });
				});
				describe('and the price of all collateral drops to 10%', () => {
					beforeEach(async () => {
						// from [PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '2000'] to
						await updateRates([PERI, USDC, PAXG], ['0.18', '0.9', '1800']);
					});
					it('then the user should be able to issue up to their maxExIssuablePynths by PAXG', async () => {
						const oldDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('oldDebt:', oldDebt.toString());
						// const collateral = await periFinance.collateral(users[0]);
						// console.log('collateral:', collateral.toString());
						// const periAmt = multiplyDecimal(collateral, toUnit('0.18'));
						// const combinedSA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
						// console.log('combinedSA:', combinedSA.toString());
						// const expectedIssuable = periAmt.add(combinedSA);
						// console.log('expectedIssuable:', expectedIssuable.toString());
						// const oldTR = await issuer.getTargetRatio(users[0]);
						const {
							maxIssuable /* , alreadyIssued  */,
						} = await periFinance.remainingIssuablePynths(users[0]);

						assert.bnEqual(maxIssuable, toUnit('0'));
						// console.log('maxIssuable:', maxIssuable.toString());
						// console.log('alreadyIssued:', alreadyIssued.toString());
						// const maxPusd = await periFinance.maxIssuablePynths(users[0]);
						// console.log('maxPusd:', maxPusd.toString());
						const issuable = await issuer.maxExIssuablePynths(users[0], PAXG);
						await periFinance.issuePynths(PAXG, issuable, { from: users[0] });
						const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('newDebt:', newDebt.toString());
						const newTR = await issuer.getTargetRatio(users[0]);
						const debtGap = multiplyDecimal(oldDebt, toUnit('0.1'));
						// console.log('newTR:', newTR.toString());
						assert.bnGt(newDebt.sub(oldDebt).add(debtGap), issuable);
						assert.bnLte(newTR, await systemSettings.externalTokenQuota());
						// assert.bnLt(newTR, oldTR);
					});
					it('then the user should be able to issue pUSD by staking ex-tokens upto limit target ratio and stake ex-tokens meet the target ratio', async () => {
						// await periFinance.issuePynths(USDC, toUnit('20'), { from: users[0] });
						// const usdcDebt1 = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('usdcDebt1:', usdcDebt1.toString());
						// const usdcTR1 = await issuer.getTargetRatio(users[0]);
						// console.log('usdcTR1:', usdcTR1.toString());
						// await periFinance.issuePynths(PAXG, toUnit('20'), { from: users[0] });
						// await updateRates([PERI, USDC, PAXG], ['0.18', '0.9', '1650']);
						// const paxgDebt1 = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('paxgDebt1:', paxgDebt1.toString());
						// const paxgTR1 = await issuer.getTargetRatio(users[0]);
						// console.log('paxgTR1:', paxgTR1.toString());
						// const exEAs = await exTokenManager.otherTokenIREA(users[0], PAXG);
						// console.log(
						// 	'tokenEA :',
						// 	exEAs.tokenEA.toString(),
						// 	'otherEA :',
						// 	exEAs.otherEA.toString()
						// );

						const maxIssuables = await issuer.maxExIssuablePynths(users[0], PAXG);
						// console.log('maxIssuables:', maxIssuables.toString());
						// const { debt, periCol } = await issuer.debtsCollateral(users[0]);
						// console.log('debt:', debt.toString(), 'periCol:', periCol.toString());
						// const maxAmount = await exTokenManager.maxStakableAmountOf(
						// 	users[0],
						// 	debt,
						// 	periCol,
						// 	PAXG
						// );
						// console.log('maxAmount:', maxAmount.toString());

						await periFinance.issuePynths(PAXG, maxIssuables, { from: users[0] });

						const newTR = await issuer.getTargetRatio(users[0]);
						console.log('targetRatio:', newTR.toString());
						// const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('newDebt:', newDebt.toString());
						// const { tokenEA, otherEA } = await exTokenManager.otherTokenIREA(users[0], PAXG);
						// console.log('tokenEA :', tokenEA.toString(), 'otherEA :', otherEA.toString());

						const exQuota = await systemSettings.externalTokenQuota();

						assert.bnLte(newTR, exQuota);
					});
					it('then debt is not increased if the user does not enough pUSD to cover the loss with ex-tokens', async () => {
						const oldDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('oldDebt:', oldDebt.toString());
						await periFinance.issuePynths(USDC, toUnit('1'), { from: users[0] });
						const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('newDebt:', newDebt.toString());
						assert.bnEqual(newDebt, oldDebt);
					});
					it('but the debt is increased if the user has enough pUSD to cover the loss with ex-tokens', async () => {
						// const oldUsdcEA = await exTokenManager.stakedAmountOf(users[0], USDC, pUSD);
						// console.log('oldUsdcEA:', oldUsdcEA.toString());
						const oldDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('oldDebt:', oldDebt.toString());
						const oldTR = await issuer.getTargetRatio(users[0]);
						// console.log('oldTR:', oldTR.toString());
						await periFinance.issuePynths(USDC, toUnit('4'), { from: users[0] });
						// const newUsdcEA0 = await exTokenManager.stakedAmountOf(users[0], USDC, pUSD);
						// console.log('newUsdcEA0:', newUsdcEA0.toString());
						// const paxgEA = await exTokenManager.stakedAmountOf(users[0], PAXG, pUSD);
						// console.log('paxgEA:', paxgEA.toString());
						const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('newDebt:', newDebt.toString());
						const newTR = await issuer.getTargetRatio(users[0]);
						// console.log('newTR:', newTR.toString());
						assert.bnEqual(newDebt, oldDebt);
						assert.bnGte(newTR, oldTR);
						await periFinance.issuePynths(USDC, toUnit('2'), { from: users[0] });
						// const newUsdcEA = await exTokenManager.stakedAmountOf(users[0], USDC, pUSD);
						// console.log('newUsdcEA:', newUsdcEA.toString());
						// const newDebt1 = await periFinance.debtBalanceOf(users[0], pUSD);
						// console.log('newDebt1:', newDebt1.toString());
						// const paxgEA = await exTokenManager.stakedAmountOf(users[0], PAXG, pUSD);
						// console.log('paxgEA:', paxgEA.toString());
						const newTR2 = await issuer.getTargetRatio(users[0]);
						// console.log('newTR2:', newTR2.toString());
						assert.bnGt(newTR2, newTR);
					});
				});
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
						tokenInfos.PAXG.contract.transfer(_user, toUnit(unitBal), { from: owner }),
						tokenInfos.USDC.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
							from: _user,
						}),
						tokenInfos.DAI.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
							from: _user,
						}),
						tokenInfos.PAXG.contract.approve(exTokenManager.address, toUnit(toUnit('1')), {
							from: _user,
						}),
					]);
				})
			);
		});

		describe('unstaking only PERI Token', async () => {
			beforeEach(async () => {
				// It locks 4000 PERI with IR: 0.25, exRate: 0.2 [USD/PERI]
				await periFinance.issuePynths(PERI, toUnit('200'), { from: users[0] });

				// await assert.revert(
				// 	periFinance.burnPynths(PERI, toUnit('1'), { from: users[0] }),
				// 	'Minimum stake time not reached'
				// );

				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.98', '1.001', '1100']);
			});

			it('should burn pUSD and unlock PERI', async () => {
				const balancePUSDBefore = await pUSDContract.balanceOf(users[0]);
				const transferableBefore = await periFinance.transferablePeriFinance(users[0]);

				// Burns 50 pUSD, it should unlock 1000 PERI
				await periFinance.burnPynths(PERI, toUnit('50'), { from: users[0] });

				const balancePUSDAfter = await pUSDContract.balanceOf(users[0]);
				const transferableAfter = await periFinance.transferablePeriFinance(users[0]);

				assert.bnEqual(balancePUSDBefore, balancePUSDAfter.add(toUnit('50')));
				assert.bnEqual(transferableBefore, toUnit('6000'));
				assert.bnEqual(transferableAfter, toUnit('7000'));
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
					'Not enough pUSD to burn'
				);
			});
		});

		describe('unstaking external token', () => {
			beforeEach(async () => {
				await periFinance.issuePynths(PERI, toUnit('200'), { from: users[0] });
				await periFinance.issuePynths(USDC, toUnit('5'), { from: users[0] });
				await periFinance.issuePynths(DAI, toUnit('20'), { from: users[0] });
				await periFinance.issuePynths(PAXG, toUnit('25'), { from: users[0] });
				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '2000']);
			});

			it('should unstake', async () => {
				const daiBfSA = await exTokenManager.stakedAmountOf(users[0], DAI, DAI);

				const daiBfBlance = await dai.balanceOf(users[0]);
				const targetRatio = await systemSettings.exTokenIssuanceRatio(DAI);

				// await fastForward(86401);

				// await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '2000']);

				await periFinance.burnPynths(DAI, toUnit('2'), { from: users[0] });

				const daiAfSA = await exTokenManager.stakedAmountOf(users[0], DAI, DAI);
				const daiAfBlance = await dai.balanceOf(users[0]);

				const expectedUnstaked = divideDecimal(toUnit('2'), targetRatio);

				assert.bnClose(
					daiAfSA,
					daiBfSA.sub(divideDecimal(expectedUnstaked, toUnit('1.001'))),
					'10'
				);
				assert.bnClose(
					daiAfBlance,
					daiBfBlance.add(divideDecimal(expectedUnstaked, toUnit('1.001'))),
					'10'
				);
			});

			it('should NOT unstake if it exceeds quota limit after PERI unstaked', async () => {
				await periFinance.issuePynthsToMaxQuota(DAI, { from: users[0] });
				await fastForward(86401);

				await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '2000']);

				// if it exceeds limit quota after unstake PERI
				await assert.revert(
					periFinance.burnPynths(PERI, toUnit('1'), { from: users[0] }),
					'Over max external quota'
				);
			});

			it('should NOT unstake when the user tries to unstake more than staked amount', async () => {
				// it exceeds available staked amount
				await assert.revert(
					periFinance.burnPynths(USDC, toUnit('6'), { from: users[0] }),
					"Account doesn't have enough staked amount"
				);
			});

			describe('fit to claimable', () => {
				beforeEach(async () => {
					await periFinance.issueMaxPynths({ from: users[0] });

					await periFinance.issuePynths(PAXG, toUnit('1000'), { from: users[0] });
					// await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '1500']);

					// const cRatio = await periFinance.collateralisationRatio(users[0]);
					// const targetRatio = await feePool.issuanceRatio();
					// assert.bnEqual(cRatio, targetRatio);
				});

				it('should fit to claimable if ratio violates target ratio', async () => {
					// const TRatio1 = await issuer.getTargetRatio(users[0]);
					await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '0.999', '1.001', '1000']);

					// const oldTRatio = await issuer.getTargetRatio(users[0]);
					// const oldCRatio = await periFinance.collateralisationRatio(users[0]);
					// const oldExEA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
					const oldDebt = await periFinance.debtBalanceOf(users[0], pUSD);
					// const periColAmt = multiplyDecimal(await periFinance.collateral(users[0]), toUnit('0.1'));
					// assert.bnGt(oldCRatio, oldTRatio);

					// const toburn = await exTokenManager.burnAmtToFitTR(users[0], oldDebt, periColAmt);

					// await exTokenManager.proRataUnstake(users[0], users[0], toburn[1], pUSD);

					await periFinance.fitToClaimable({ from: users[0] });

					// after fit,
					// No unstaking for external token
					const newTRatio = await issuer.getTargetRatio(users[0]);
					console.log('newTRatio:', newTRatio.toString());
					const newCRatio = await periFinance.collateralisationRatio(users[0]);
					// const balance = await pUSDContract.balanceOf(users[0]);
					// const newExEA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);

					const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
					// const exQuota = await systemSettings.externalTokenQuota();
					assert.bnLte(newCRatio, newTRatio);
					// assert.bnLte(newTRatio, exQuota);
					// assert.bnClose(balance, toUnit('287.5'), '1' + '0'.repeat(12));
					// assert.bnEqual(oldExEA, newExEA);
					assert.bnClose(newDebt, oldDebt.sub(toUnit('512.5')), '1' + '0'.repeat(12));
				});

				it('should fit to claimable if quota violates target ratio', async () => {
					await periFinance.issuePynthsToMaxQuota(PAXG, { from: users[0] });
					// Increase external tokens price for increasing its quota
					await updateRates([PERI, USDC, DAI, PAXG], ['0.2', '2', '2.5', '3000']);

					// Current debt: 550000000179999999975, StakedAmounts[USD]: 513343800527472527200, Quota: 0.23333809107248596
					// const oldTRatio = await issuer.getTargetRatio(users[0]);
					// const stakedAmounts_0_before = await Promise.all(
					// 	keys.map(_key =>
					// 		exTokenManager.stakedAmountOf(
					// 			users[0],
					// 			tokenInfos[_key].currencyKey,
					// 			tokenInfos[_key].currencyKey
					// 		)
					// 	)
					// );
					// Staked Amounts:
					// USDC: 20408164000000000000, DAI: 79920079920079920080, PAXG: 90909090909090909
					// const oldExEA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
					// const oldDebt = await periFinance.debtBalanceOf(users[0], pUSD);
					// const oldCRatio = await periFinance.collateralisationRatio(users[0]);

					// assert.bnLt(oldCRatio, oldTRatio);

					// const { burnAmount, exRefundAmt } = await exTokenManager.burnAmtToFitTR(
					// 	users[0],
					// 	oldDebt,
					// 	oldExEA
					// );
					// console.log('burnAmount:', burnAmount.toString(), 'exRefundAmt:', exRefundAmt.toString());

					await periFinance.fitToClaimable({ from: users[0] });

					// const { tRatio } = await issuer.maxIssuablePynths(users[0]);

					// Expected values::
					// burnAmount: 22919937619835160000, unstakeAmount: 91679750479340640000
					// await Promise.all(
					// 	keys.map(_key =>
					// 		exTokenManager.stakedAmountOf(
					// 			users[0],
					// 			tokenInfos[_key].currencyKey,
					// 			tokenInfos[_key].currencyKey
					// 		)
					// 	)
					// );
					// Staked Amounts:
					// // USDC: 20408164000000000000, DAI: 79920079920079920080, PAXG: 90909090909090909
					// const newExEA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
					// const newDebt = await periFinance.debtBalanceOf(users[0], pUSD);
					const newCRatio = await periFinance.collateralisationRatio(users[0]);
					const newTRatio = await issuer.getTargetRatio(users[0]);

					// assert.bnClose(
					// 	newExEA,
					// 	oldExEA.sub(toBN('91679750479340640000')),
					// 	'1' + '0'.repeat(12)
					// );
					// assert.bnClose(newDebt, oldDebt.sub(toBN('22919937619835160000')), '10000');
					assert.bnClose(newCRatio, newTRatio, '1' + '0'.repeat(12));
				});

				it('should fit to claimable if quota violates target ratio and quota limit', async () => {
					await updateRates([PERI, USDC, DAI, PAXG], ['0.01', '2', '2.5', '3000']);

					const targetRatio = await await issuer.getTargetRatio(users[0]);
					// const combinedStakedAmount_0_before = await exTokenManager.combinedStakedAmountOf(
					// 	users[0],
					// 	pUSD
					// );
					// const debtBalance_0_before = await periFinance.debtBalanceOf(users[0], pUSD);
					// const balance_pUSD_0_before = await pUSDContract.balanceOf(users[0]);
					const oldCRatio = await periFinance.collateralisationRatio(users[0]);

					assert.bnGt(oldCRatio, targetRatio);

					await periFinance.fitToClaimable({ from: users[0] });

					// Expected values::
					// burnAmount: 518.75000018, stakedAmount: 488.3438005274726
					// const newExEA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
					// const debtBalance_0_after = await periFinance.debtBalanceOf(users[0], pUSD);
					// const balance_pUSD_0_after = await pUSDContract.balanceOf(users[0]);
					const newCRatio = await periFinance.collateralisationRatio(users[0]);
					const newTRatio = await issuer.getTargetRatio(users[0]);

					console.log('newCRatio:', newCRatio.toString(), 'newTRatio:', newTRatio.toString());

					// assert.bnClose(
					// 	newExEA,
					// 	combinedStakedAmount_0_before.sub(toUnit('488.3438005274726')),
					// 	'1' + '0'.repeat(12)
					// );
					// assert.bnClose(
					// 	debtBalance_0_after,
					// 	debtBalance_0_before.sub(toUnit('518.75000018')),
					// 	'10000'
					// );
					// assert.bnClose(
					// 	balance_pUSD_0_after,
					// 	balance_pUSD_0_before.sub(toUnit('518.75000018')),
					// 	'10000'
					// );
					assert.bnClose(newCRatio, newTRatio, '1' + '0'.repeat(12));
				});

				it('should NOT run if user is already claimable', async () => {
					await updateRates([PERI, USDC, DAI, PAXG], ['0.3', '0.98', '1.001', '2000']);

					const targetRatio = await issuer.getTargetRatio(users[0]);
					const oldCRatio = await periFinance.collateralisationRatio(users[0]);
					assert.bnLte(oldCRatio, targetRatio);

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
				await periFinance.issuePynths(PAXG, toUnit('25'), { from: users[0] });
				await fastForward(86401);

				// Set the status to fit to claimable violation set
				await updateRates([PERI, USDC, DAI, PAXG], ['0.01', '2', '2.5', '3000']);
			});

			it('should exit at no violation status', async () => {
				await periFinance.exit({ from: users[0] });

				const combinedSA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
				const stakedAmounts = await Promise.all(
					keys.map(_key =>
						exTokenManager.stakedAmountOf(
							users[0],
							tokenInfos[_key].currencyKey,
							tokenInfos[_key].currencyKey
						)
					)
				);
				const debeBalance = await periFinance.debtBalanceOf(users[0], pUSD);
				const balances = await Promise.all(
					keys.map(_key => tokenInfos[_key].contract.balanceOf(users[0]))
				);
				const transferable = await periFinance.transferablePeriFinance(users[0]);
				const periBalance = await periFinance.balanceOf(users[0]);

				assert.bnEqual(combinedSA, toBN('0'));
				stakedAmounts.forEach(_stakedAmount => assert.bnEqual(_stakedAmount, toBN('0')));
				assert.bnEqual(debeBalance, toBN('0'));
				balances.forEach((_balance, _idx) =>
					assert.bnEqual(_balance, '10000' + '0'.repeat(tokenInfos[keys[_idx]].decimals))
				);
				assert.bnEqual(transferable, periBalance);
			});

			it('should exit at the violation status', async () => {
				const targetRatio = await issuer.getTargetRatio(users[0]);
				const cRatio = await periFinance.collateralisationRatio(users[0]);

				assert.bnGt(cRatio, targetRatio);

				await periFinance.exit({ from: users[0] });

				const combinedSA = await exTokenManager.combinedStakedAmountOf(users[0], pUSD);
				const stakedAmounts = await Promise.all(
					keys.map(_key =>
						exTokenManager.stakedAmountOf(
							users[0],
							tokenInfos[_key].currencyKey,
							tokenInfos[_key].currencyKey
						)
					)
				);
				const debtBalance = await periFinance.debtBalanceOf(users[0], pUSD);
				const balances = await Promise.all(
					keys.map(_key => tokenInfos[_key].contract.balanceOf(users[0]))
				);
				const transferable_0 = await periFinance.transferablePeriFinance(users[0]);
				const balance_0_PERI = await periFinance.balanceOf(users[0]);

				assert.bnEqual(combinedSA, toBN('0'));
				stakedAmounts.forEach(_stakedAmount => assert.bnEqual(_stakedAmount, toBN('0')));
				assert.bnEqual(debtBalance, toBN('0'));
				balances.forEach((_balance, _idx) =>
					assert.bnEqual(_balance, '10000' + '0'.repeat(tokenInfos[keys[_idx]].decimals))
				);
				assert.bnEqual(transferable_0, balance_0_PERI);
			});
			it('should NOT exit if the user has not enough pUSD amount', async () => {
				await pUSDContract.transfer(users[1], toUnit('10'), { from: users[0] });

				await assert.revert(periFinance.exit({ from: users[0] }), 'Not enough pUSD to burn');
			});
		});
	});
});
