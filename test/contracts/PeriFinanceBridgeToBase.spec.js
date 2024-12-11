const { contract, web3 } = require('hardhat');
const { setupAllContracts } = require('./setup');
const { assert } = require('./common');
const { toBN } = web3.utils;
const {
	defaults: {
		CROSS_DOMAIN_DEPOSIT_GAS_LIMIT,
		CROSS_DOMAIN_ESCROW_GAS_LIMIT,
		CROSS_DOMAIN_REWARD_GAS_LIMIT,
		CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT,
	},
} = require('../../');

contract('PeriFinanceBridgeToBase (spec tests) @ovm-skip', accounts => {
	const [, owner, user, randomAddress] = accounts;

	let mintablePeriFinance, periFinanceBridgeToBase, systemSettings;

	describe('when deploying the system', () => {
		before('deploy all contracts', async () => {
			({
				PeriFinance: mintablePeriFinance, // we request PeriFinance instead of MintablePeriFinance because it is renamed in setup.js
				PeriFinanceBridgeToBase: periFinanceBridgeToBase,
				SystemSettings: systemSettings,
			} = await setupAllContracts({
				accounts,
				pynths: ['pUSD', 'pBTC', 'pETH'],
				contracts: [
					'MintablePeriFinance'
					, 'PeriFinanceBridgeToBase'
					, 'SystemSettings'
					, 'CrossChainManager'
				]

			}));
		});

		describe('when a user does not have the required balance', () => {
			it('the withdrawal should fail', async () => {
				await assert.revert(
					periFinanceBridgeToBase.initiateWithdrawal('1', { from: user }),
					'Not enough transferable PERI'
				);
			});
		});

		it('returns the expected cross domain message gas limit', async () => {
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(0),
				CROSS_DOMAIN_DEPOSIT_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(1),
				CROSS_DOMAIN_ESCROW_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(2),
				CROSS_DOMAIN_REWARD_GAS_LIMIT
			);
			assert.bnEqual(
				await systemSettings.crossDomainMessageGasLimit(3),
				CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT
			);
		});

		describe('when a user has the required balance', () => {
			const amountToWithdraw = 1;
			let userBalanceBefore;
			let initialSupply;

			describe('when requesting a withdrawal', () => {
				before('record user balance and initial total supply', async () => {
					userBalanceBefore = await mintablePeriFinance.balanceOf(owner);
					initialSupply = await mintablePeriFinance.totalSupply();
				});

				before('initiate a withdrawal', async () => {
					await periFinanceBridgeToBase.initiateWithdrawal(amountToWithdraw, {
						from: owner,
					});
				});

				it('reduces the user balance', async () => {
					const userBalanceAfter = await mintablePeriFinance.balanceOf(owner);
					assert.bnEqual(userBalanceBefore.sub(toBN(amountToWithdraw)), userBalanceAfter);
				});

				it('reduces the total supply', async () => {
					const supplyAfter = await mintablePeriFinance.totalSupply();
					assert.bnEqual(initialSupply.sub(toBN(amountToWithdraw)), supplyAfter);
				});
			});

			describe('when requesting a withdrawal to a different address', () => {
				before('record user balance and initial total supply', async () => {
					userBalanceBefore = await mintablePeriFinance.balanceOf(owner);
					initialSupply = await mintablePeriFinance.totalSupply();
				});

				before('inititate a withdrawal', async () => {
					await periFinanceBridgeToBase.initiateWithdrawal(amountToWithdraw, {
						from: owner,
					});
				});

				it('reduces the user balance', async () => {
					const userBalanceAfter = await mintablePeriFinance.balanceOf(owner);
					assert.bnEqual(userBalanceBefore.sub(toBN(amountToWithdraw)), userBalanceAfter);
				});

				it('reduces the total supply', async () => {
					const supplyAfter = await mintablePeriFinance.totalSupply();
					assert.bnEqual(initialSupply.sub(toBN(amountToWithdraw)), supplyAfter);
				});
			});
		});
	});
});
