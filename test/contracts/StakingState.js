'use strict';

const { artifacts, contract } = require('hardhat');
const { assert } = require('./common');

const StakingState = artifacts.require('StakingState');
const MockToken = artifacts.require('MockToken');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');
const { currentTime, toUnit, fastForward } = require('../utils')();

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
				const staker_1 = accounts[5];
				const stakingAmount_1 = toUnit('100');

				await stakingState.stake(USDC, staker_1, stakingAmount_1, { from: Issuer });

				const stakedAmount_1 = await stakingState.stakedAmountOf(USDC, staker_1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_1, stakingAmount_1);
				assert.bnEqual(totalStakedAmount, stakingAmount_1);
				assert.bnEqual(totalStakerCount, web3.utils.toBN('1'));

				const staker_2 = accounts[6];
				const stakingAmount_2 = toUnit('10');

				await stakingState.stake(USDC, staker_2, stakingAmount_2, { from: Issuer });

				const stakedAmount_2 = await stakingState.stakedAmountOf(USDC, staker_2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_2, stakingAmount_2);
				assert.bnEqual(totalStakedAmount2, stakingAmount_1.add(stakingAmount_2));
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
				const staker_1 = accounts[5];
				const stakingAmount_1 = toUnit('100');

				await stakingState.stake(USDC, staker_1, stakingAmount_1, { from: Issuer });

				const stakedAmount_1 = await stakingState.stakedAmountOf(USDC, staker_1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_1, stakingAmount_1);
				assert.bnEqual(totalStakedAmount, stakingAmount_1);
				assert.bnEqual(totalStakerCount, web3.utils.toBN('1'));

				const staker_2 = accounts[6];
				const stakingAmount_2 = toUnit('10');

				await stakingState.stake(USDC, staker_2, stakingAmount_2, { from: Issuer });

				const stakedAmount_2 = await stakingState.stakedAmountOf(USDC, staker_2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_2, stakingAmount_2);
				assert.bnEqual(totalStakedAmount2, stakingAmount_1.add(stakingAmount_2));
				assert.bnEqual(totalStakerCount2, web3.utils.toBN('2'));

				const stakingAmount_3 = toUnit('1');

				await stakingState.stake(DAI, staker_2, stakingAmount_3, { from: Issuer });

				const stakedAmount_3 = await stakingState.stakedAmountOf(DAI, staker_2);
				const totalStakedAmount3 = await stakingState.totalStakedAmount(DAI);
				const totalStakerCount3 = await stakingState.totalStakerCount(DAI);

				assert.bnEqual(stakedAmount_3, stakingAmount_3);
				assert.bnEqual(totalStakedAmount3, stakingAmount_3);
				assert.bnEqual(totalStakerCount3, web3.utils.toBN('1'));
			});
		});

		describe('unstake', async () => {
			let staker_1, staker_2, stakingAmount_1, stakingAmount_2;

			beforeEach(async () => {
				staker_1 = accounts[5];
				staker_2 = accounts[6];
				stakingAmount_1 = toUnit('100');
				stakingAmount_2 = toUnit('10');

				await Promise.all([
					stakingState.stake(USDC, staker_1, stakingAmount_1, { from: Issuer }),
					stakingState.stake(USDC, staker_2, stakingAmount_2, { from: Issuer }),
				]);
			});

			it('should unstake', async () => {
				const unstakingAmount_1 = toUnit('3');
				const unstakingAmount_2 = toUnit('10');

				await stakingState.unstake(USDC, staker_1, unstakingAmount_1, { from: Issuer });

				const stakedAmount_1 = await stakingState.stakedAmountOf(USDC, staker_1);
				const totalStakedAmount = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_1, stakingAmount_1.sub(unstakingAmount_1));
				assert.bnEqual(
					totalStakedAmount,
					stakingAmount_1.add(stakingAmount_2).sub(unstakingAmount_1)
				);
				assert.bnEqual(totalStakerCount, web3.utils.toBN('2'));

				await stakingState.unstake(USDC, staker_2, unstakingAmount_2, { from: Issuer });

				const stakedAmount_2 = await stakingState.stakedAmountOf(USDC, staker_2);
				const totalStakedAmount2 = await stakingState.totalStakedAmount(USDC);
				const totalStakerCount2 = await stakingState.totalStakerCount(USDC);

				assert.bnEqual(stakedAmount_2, web3.utils.toBN('0'));
				assert.bnEqual(totalStakedAmount2, totalStakedAmount.sub(unstakingAmount_2));
				assert.bnEqual(totalStakerCount2, web3.utils.toBN('1'));
			});

			it('should NOT unstake', async () => {
				// not associated contract
				const unstakingAmount_2 = toUnit('11');

				await assert.revert(
					stakingState.unstake(USDC, staker_2, 1, { from: owner }),
					'Only the associated contract can perform this action'
				);

				// not enough staked amount
				await assert.revert(
					stakingState.unstake(USDC, staker_2, unstakingAmount_2, { from: Issuer }),
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
				const refundAmount_usdc = toUnit('5');
				const refundAmount_dai = toUnit('3');

				const balance_usdc_recipient_before = await usdc.balanceOf(recipient);
				const balance_usdc_stakingState_before = await usdc.balanceOf(stakingState.address);
				const balance_dai_recipient_before = await dai.balanceOf(recipient);
				const balance_dai_stakingState_before = await dai.balanceOf(stakingState.address);

				await stakingState.refund(USDC, recipient, refundAmount_usdc, { from: Issuer });
				await stakingState.refund(DAI, recipient, refundAmount_dai, { from: Issuer });

				const balance_usdc_recipient_after = await usdc.balanceOf(recipient);
				const balance_usdc_stakingState_after = await usdc.balanceOf(stakingState.address);
				const balance_dai_recipient_after = await dai.balanceOf(recipient);
				const balance_dai_stakingState_after = await dai.balanceOf(stakingState.address);

				assert.bnEqual(
					balance_usdc_recipient_before.add(refundAmount_usdc.div(web3.utils.toBN(10 ** 12))),
					balance_usdc_recipient_after
				);
				assert.bnEqual(
					balance_usdc_stakingState_before.sub(refundAmount_usdc.div(web3.utils.toBN(10 ** 12))),
					balance_usdc_stakingState_after
				);
				assert.bnEqual(
					balance_dai_recipient_before.add(refundAmount_dai),
					balance_dai_recipient_after
				);
				assert.bnEqual(
					balance_dai_stakingState_before.sub(refundAmount_dai),
					balance_dai_stakingState_after
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
