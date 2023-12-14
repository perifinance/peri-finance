'use strict';

const { artifacts, contract, web3 } = require('hardhat');
const { assert } = require('./common');

const StakingState = artifacts.require('StakingState');
const MockToken = artifacts.require('MockToken');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');
const { toUnit } = require('../utils')();

const [USDC, DAI, KRW] = [toBytes32('USDC'), toBytes32('DAI'), toBytes32('KRW')];

const tokenInfos = {
	USDC: { currencyKey: USDC, decimals: 6 },
	DAI: { currencyKey: DAI, decimals: 18 },
	KRW: { currencyKey: KRW, decimals: 18 },
};

contract('StakingState', accounts => {
	const [deployerAccount, owner, Issuer] = accounts;

	let stakingState, usdc, dai, krw;

	beforeEach(async () => {
		stakingState = await StakingState.new(owner, Issuer, { from: deployerAccount });

		[usdc, dai, krw] = await Promise.all([
			MockToken.new('USD Coin', 'USDC', 6, { from: deployerAccount }),
			MockToken.new('Dai Stablecoin', 'DAI', 18, { from: deployerAccount }),
			MockToken.new('KRW Coin', 'KRW', 18, { from: deployerAccount }),
		]);
	});

	describe('deploy', () => {
		it('should deploy', async () => {
			const _owner = await stakingState.owner();
			const associatedContract = await stakingState.associatedContract();

			assert.equal(_owner, owner);
			assert.equal(associatedContract, Issuer);
		});
	});

	describe('setTargetToken', () => {
		let tokenContracts = {};

		beforeEach(async () => {
			tokenContracts = {
				USDC: usdc,
				DAI: dai,
				KRW: krw,
			};
		});

		it('should set target tokens', async () => {
			await Promise.all(
				['USDC', 'DAI', 'KRW'].map(_token =>
					stakingState.setTargetToken(
						tokenInfos[_token].currencyKey,
						tokenContracts[_token].address,
						tokenInfos[_token].decimals,
						{ from: owner }
					)
				)
			);

			const tokenList = await stakingState.getTokenCurrencyKeys();
			const addresses = await Promise.all(
				[USDC, DAI, KRW].map(_currencyKey => stakingState.tokenAddress(_currencyKey))
			);
			const decimals = await Promise.all(
				[USDC, DAI, KRW].map(_currencyKey => stakingState.tokenDecimals(_currencyKey))
			);
			const activated = await Promise.all(
				[USDC, DAI, KRW].map(_currencyKey => stakingState.tokenActivated(_currencyKey))
			);

			assert.equal(tokenList.length, 3);
			assert.equal(tokenList[0], USDC);
			assert.equal(tokenList[1], DAI);
			assert.equal(tokenList[2], KRW);
			['USDC', 'DAI', 'KRW'].forEach((_currency, idx) =>
				assert.equal(addresses[idx], tokenContracts[_currency].address)
			);
			['USDC', 'DAI', 'KRW'].forEach((_currency, idx) =>
				assert.equal(decimals[idx], tokenInfos[_currency].decimals)
			);
			activated.forEach(_el => assert.equal(_el, true));
		});

		it('should NOT set target tokens', async () => {
			// not owner
			await assert.revert(
				stakingState.setTargetToken(
					tokenInfos['USDC'].currencyKey,
					tokenContracts['USDC'].address,
					tokenInfos['USDC'].decimals,
					{ from: deployerAccount }
				),
				'Only the contract owner may perform this action'
			);

			// zero address
			await assert.revert(
				stakingState.setTargetToken(
					tokenInfos['USDC'].currencyKey,
					ZERO_ADDRESS,
					tokenInfos['USDC'].decimals,
					{ from: owner }
				),
				'Address cannot be empty'
			);
		});
	});

	describe('setTokenActivation', async () => {
		beforeEach(async () => {
			await stakingState.setTargetToken(
				tokenInfos['USDC'].currencyKey,
				usdc.address,
				tokenInfos['USDC'].decimals,
				{ from: owner }
			);
		});

		it('should deactivate token', async () => {
			await stakingState.setTokenActivation(USDC, false, { from: owner });

			const deactivation = await stakingState.tokenActivated(USDC);

			assert.equal(deactivation, false);

			await stakingState.setTokenActivation(USDC, true, { from: owner });

			const activation = await stakingState.tokenActivated(USDC);

			assert.equal(activation, true);
		});

		it('should NOT deactivate token', async () => {
			// not owner
			await assert.revert(
				stakingState.setTokenActivation(USDC, false, { from: deployerAccount }),
				'Only the contract owner may perform this action'
			);

			// not registered token
			await assert.revert(
				stakingState.setTokenActivation(toBytes32('HAHA'), false, { from: owner }),
				'Target token is not registered'
			);
		});
	});

	describe('main functions', () => {
		beforeEach(async () => {
			const tokenContracts = {
				USDC: usdc,
				DAI: dai,
				KRW: krw,
			};

			await Promise.all(
				['USDC', 'DAI', 'KRW'].map(_token =>
					stakingState.setTargetToken(
						tokenInfos[_token].currencyKey,
						tokenContracts[_token].address,
						tokenInfos[_token].decimals,
						{ from: owner }
					)
				)
			);
		});

		describe('stake', async () => {
			it('should stake', async () => {
				const staker1 = accounts[5];
				const stakingAmount1 = toUnit('100');

				await stakingState.stake(USDC, staker1, stakingAmount1, { from: Issuer });

				const stakedAmount1 = await stakingState.stakedAmountOf(USDC, staker1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount1, stakingAmount1);
				assert.bnEqual(totalStakedAmount, stakingAmount1);
				assert.bnEqual(totalStakerCount, web3.utils.toBN('1'));

				const staker2 = accounts[6];
				const stakingAmount2 = toUnit('10');

				await stakingState.stake(USDC, staker2, stakingAmount2, { from: Issuer });

				const stakedAmount2 = await stakingState.stakedAmountOf(USDC, staker2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount2, stakingAmount2);
				assert.bnEqual(totalStakedAmount2, stakingAmount1.add(stakingAmount2));
				assert.bnEqual(totalStakerCount2, web3.utils.toBN('2'));
			});

			it('should NOT stake', async () => {
				// Not associated contract
				await assert.revert(
					stakingState.stake(USDC, accounts[5], 1, { from: owner }),
					'Only the associated contract can perform this action'
				);

				// Token is not registered
				await assert.revert(
					stakingState.stake(toBytes32('HAHA'), accounts[5], 1, { from: Issuer }),
					'Target token is not registered'
				);

				// Token is not activated
				await stakingState.setTokenActivation(USDC, false, { from: owner });
				await assert.revert(
					stakingState.stake(USDC, accounts[5], 1, { from: Issuer }),
					'Target token is not activated'
				);
			});

			it('should stake multiple tokens', async () => {
				const staker1 = accounts[5];
				const stakingAmount1 = toUnit('100');

				await stakingState.stake(USDC, staker1, stakingAmount1, { from: Issuer });

				const stakedAmount1 = await stakingState.stakedAmountOf(USDC, staker1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount1, stakingAmount1);
				assert.bnEqual(totalStakedAmount, stakingAmount1);
				assert.bnEqual(totalStakerCount, web3.utils.toBN('1'));

				const staker2 = accounts[6];
				const stakingAmount2 = toUnit('10');

				await stakingState.stake(USDC, staker2, stakingAmount2, { from: Issuer });

				const stakedAmount2 = await stakingState.stakedAmountOf(USDC, staker2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount2, stakingAmount2);
				assert.bnEqual(totalStakedAmount2, stakingAmount1.add(stakingAmount2));
				assert.bnEqual(totalStakerCount2, web3.utils.toBN('2'));

				const stakingAmount3 = toUnit('1');

				await stakingState.stake(DAI, staker2, stakingAmount3, { from: Issuer });

				const stakedAmount3 = await stakingState.stakedAmountOf(DAI, staker2);
				const totalStakedAmount3 = await stakingState.totalStakedAmount(DAI);
				const totalStakerCount3 = await stakingState.totalStakerCount(DAI);

				assert.bnEqual(stakedAmount3, stakingAmount3);
				assert.bnEqual(totalStakedAmount3, stakingAmount3);
				assert.bnEqual(totalStakerCount3, web3.utils.toBN('1'));
			});
		});

		describe('unstake', async () => {
			let staker1, staker2, stakingAmount1, stakingAmount2;

			beforeEach(async () => {
				staker1 = accounts[5];
				staker2 = accounts[6];
				stakingAmount1 = toUnit('100');
				stakingAmount2 = toUnit('10');

				await Promise.all([
					stakingState.stake(USDC, staker1, stakingAmount1, { from: Issuer }),
					stakingState.stake(USDC, staker2, stakingAmount2, { from: Issuer }),
				]);
			});

			it('should unstake', async () => {
				const unstakingAmount1 = toUnit('3');
				const unstakingAmount2 = toUnit('10');

				await stakingState.unstake(USDC, staker1, unstakingAmount1, { from: Issuer });

				const stakedAmount1 = await stakingState.stakedAmountOf(USDC, staker1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount1, stakingAmount1.sub(unstakingAmount1));
				assert.bnEqual(totalStakedAmount, stakingAmount1.add(stakingAmount2).sub(unstakingAmount1));
				assert.bnEqual(totalStakerCount, web3.utils.toBN('2'));

				await stakingState.unstake(USDC, staker2, unstakingAmount2, { from: Issuer });

				const stakedAmount2 = await stakingState.stakedAmountOf(USDC, staker2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount2, web3.utils.toBN('0'));
				assert.bnEqual(totalStakedAmount2, totalStakedAmount.sub(unstakingAmount2));
				assert.bnEqual(totalStakerCount2, web3.utils.toBN('1'));
			});

			it('should NOT unstake', async () => {
				// not associated contract
				const unstakingAmount2 = toUnit('11');

				await assert.revert(
					stakingState.unstake(USDC, staker2, 1, { from: owner }),
					'Only the associated contract can perform this action'
				);

				// not enough staked amount
				await assert.revert(
					stakingState.unstake(USDC, staker2, unstakingAmount2, { from: Issuer }),
					"Account doesn't have enough staked amount"
				);
			});
		});

		describe('refund', async () => {
			beforeEach(async () => {
				await usdc.transfer(stakingState.address, '10000' + '0'.repeat(6), {
					from: deployerAccount,
				});
				await dai.transfer(stakingState.address, toUnit('10000'), { from: deployerAccount });

				assert.bnEqual(await usdc.balanceOf(stakingState.address), '10000' + '0'.repeat(6));
				assert.bnEqual(await dai.balanceOf(stakingState.address), toUnit('10000'));
			});

			it('should refund', async () => {
				const recipient = accounts[5];
				const refundAmountUsdc = toUnit('5');
				const refundAmountDai = toUnit('3');

				const balanceUsdcRecipientBefore = await usdc.balanceOf(recipient);
				const balanceUsdcStakingStateBefore = await usdc.balanceOf(stakingState.address);
				const balanceDaiRecipientBefore = await dai.balanceOf(recipient);
				const balanceDaiStakingStateBefore = await dai.balanceOf(stakingState.address);

				await stakingState.refund(USDC, recipient, refundAmountUsdc, { from: Issuer });
				await stakingState.refund(DAI, recipient, refundAmountDai, { from: Issuer });

				const balanceUsdcRecipientAfter = await usdc.balanceOf(recipient);
				const balanceUsdcStakingStateAfter = await usdc.balanceOf(stakingState.address);
				const balanceDaiRecipientAfter = await dai.balanceOf(recipient);
				const balanceDaiStakingStateAfter = await dai.balanceOf(stakingState.address);

				assert.bnEqual(
					balanceUsdcRecipientBefore.add(refundAmountUsdc.div(web3.utils.toBN(10 ** 12))),
					balanceUsdcRecipientAfter
				);
				assert.bnEqual(
					balanceUsdcStakingStateBefore.sub(refundAmountUsdc.div(web3.utils.toBN(10 ** 12))),
					balanceUsdcStakingStateAfter
				);
				assert.bnEqual(balanceDaiRecipientBefore.add(refundAmountDai), balanceDaiRecipientAfter);
				assert.bnEqual(
					balanceDaiStakingStateBefore.sub(refundAmountDai),
					balanceDaiStakingStateAfter
				);
			});

			it('should NOT refund', async () => {
				// not associated contract
				await assert.revert(
					stakingState.refund(USDC, accounts[5], 1, { from: deployerAccount }),
					'Only the associated contract can perform this action'
				);
			});
		});
	});
});
