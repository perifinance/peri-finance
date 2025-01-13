const { artifacts, contract, web3 } = require('hardhat');
const { assert } = require('./common');
const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const { toBytes32 } = require('../..');
const { smockit } = require('@eth-optimism/smock');

const PeriFinanceBridgeToBase = artifacts.require('PeriFinanceBridgeToBase');

contract('PeriFinanceBridgeToBase (unit tests)', accounts => {
	const [owner, user1, periBridgeToOptimism, smockedMessenger, randomAddress] = accounts;

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: PeriFinanceBridgeToBase.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'completeDeposit',
				'completeEscrowMigration',
				'completeRewardDeposit',
				'initiateWithdrawal',
			],
		});
	});

	const getDataOfEncodedFncCall = ({ fnc, args = [] }) =>
		web3.eth.abi.encodeFunctionCall(
			artifacts.require('PeriFinanceBridgeToOptimism').abi.find(({ name }) => name === fnc),
			args
		);

	describe.skip('when all the deps are (s)mocked', () => {
		let messenger;
		let mintablePeriFinance;
		let resolver;
		let rewardEscrow;
		let flexibleStorage;
		beforeEach(async () => {
			messenger = await smockit(artifacts.require('iOVM_BaseCrossDomainMessenger').abi, {
				address: smockedMessenger,
			});

			rewardEscrow = await smockit(
				artifacts.require('contracts/interfaces/IRewardEscrowV2.sol:IRewardEscrowV2').abi
			);

			mintablePeriFinance = await smockit(artifacts.require('MintablePeriFinance').abi);
			flexibleStorage = await smockit(artifacts.require('FlexibleStorage').abi);
			// now add to address resolver
			resolver = await artifacts.require('AddressResolver').new(owner);
			await resolver.importAddresses(
				[
					'FlexibleStorage',
					'ext:Messenger',
					'PeriFinance',
					'base:PeriFinanceBridgeToOptimism',
					'RewardEscrowV2',
				].map(toBytes32),
				[
					flexibleStorage.address,
					messenger.address,
					mintablePeriFinance.address,
					periBridgeToOptimism,
					rewardEscrow.address,
				],
				{ from: owner }
			);
		});

		beforeEach(async () => {
			// stubs
			mintablePeriFinance.smocked.burnSecondary.will.return.with(() => {});
			mintablePeriFinance.smocked.mintSecondary.will.return.with(() => {});
			mintablePeriFinance.smocked.balanceOf.will.return.with(() => web3.utils.toWei('1'));
			mintablePeriFinance.smocked.transferablePeriFinance.will.return.with(() =>
				web3.utils.toWei('1')
			);
			messenger.smocked.sendMessage.will.return.with(() => {});
			messenger.smocked.xDomainMessageSender.will.return.with(() => periBridgeToOptimism);
			rewardEscrow.smocked.importVestingEntries.will.return.with(() => {});
			flexibleStorage.smocked.getUIntValue.will.return.with(() => '3000000');
		});

		describe('when the target is deployed', () => {
			let instance;
			const escrowedAmount = 100;
			beforeEach(async () => {
				instance = await artifacts.require('PeriFinanceBridgeToBase').new(owner, resolver.address);
				await instance.rebuildCache();
			});

			describe('importVestingEntries', async () => {
				const emptyArray = [];

				describe('failure modes', () => {
					it('should only allow the relayer (aka messenger) to call importVestingEntries()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.completeEscrowMigration,
							args: [user1, escrowedAmount, emptyArray],
							accounts,
							address: smockedMessenger,
							reason: 'Only the relayer can call this',
						});
					});

					it('should only allow the L1 bridge to invoke importVestingEntries() via the messenger', async () => {
						// 'smock' the messenger to return a random msg sender
						messenger.smocked.xDomainMessageSender.will.return.with(() => randomAddress);
						await assert.revert(
							instance.completeEscrowMigration(user1, escrowedAmount, emptyArray, {
								from: smockedMessenger,
							}),
							'Only the L1 bridge can invoke'
						);
					});
				});

				describe('when invoked by the messenger (aka relayer)', async () => {
					let importVestingEntriesTx;
					beforeEach('importVestingEntries is called', async () => {
						importVestingEntriesTx = await instance.completeEscrowMigration(
							user1,
							escrowedAmount,
							emptyArray,
							{
								from: smockedMessenger,
							}
						);
					});

					it('importVestingEntries is called (via rewardEscrowV2)', async () => {
						assert.equal(rewardEscrow.smocked.importVestingEntries.calls[0][0], user1);
						assert.bnEqual(rewardEscrow.smocked.importVestingEntries.calls[0][1], escrowedAmount);
						assert.bnEqual(rewardEscrow.smocked.importVestingEntries.calls[0][2], emptyArray);
					});

					it('should emit a ImportedVestingEntries event', async () => {
						assert.eventEqual(importVestingEntriesTx, 'ImportedVestingEntries', {
							account: user1,
							escrowedAmount: escrowedAmount,
							vestingEntries: emptyArray,
						});
					});
				});
			});

			describe('initiateWithdrawal', () => {
				describe('failure modes', () => {
					it('does not work when user has less trasferable peri than the withdrawal amount', async () => {
						mintablePeriFinance.smocked.transferablePeriFinance.will.return.with(() => '0');
						await assert.revert(instance.initiateWithdrawal('1'), 'Not enough transferable PERI');
					});
				});

				describe('when invoked by a user', () => {
					let withdrawalTx;
					const amount = 100;
					const gasLimit = 3e6;
					beforeEach('user tries to withdraw 100 tokens', async () => {
						withdrawalTx = await instance.initiateWithdrawal(amount, { from: user1 });
					});

					it('then PERI is burned via mintablePeriFinance.burnSecondary', async () => {
						assert.equal(mintablePeriFinance.smocked.burnSecondary.calls.length, 1);
						assert.equal(mintablePeriFinance.smocked.burnSecondary.calls[0][0], user1);
						assert.equal(mintablePeriFinance.smocked.burnSecondary.calls[0][1].toString(), amount);
					});

					it('the message is relayed', async () => {
						assert.equal(messenger.smocked.sendMessage.calls.length, 1);
						assert.equal(messenger.smocked.sendMessage.calls[0][0], periBridgeToOptimism);
						const expectedData = getDataOfEncodedFncCall({
							fnc: 'completeWithdrawal',
							args: [user1, amount],
						});

						assert.equal(messenger.smocked.sendMessage.calls[0][1], expectedData);
						assert.equal(messenger.smocked.sendMessage.calls[0][2], gasLimit.toString());
					});

					it('and a WithdrawalInitiated event is emitted', async () => {
						assert.eventEqual(withdrawalTx, 'WithdrawalInitiated', {
							account: user1,
							amount: amount,
						});
					});
				});
			});

			describe('completeDeposit', async () => {
				describe('failure modes', () => {
					it('should only allow the relayer (aka messenger) to call completeDeposit()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.completeDeposit,
							args: [user1, 100],
							accounts,
							address: smockedMessenger,
							reason: 'Only the relayer can call this',
						});
					});

					it('should only allow the L1 bridge to invoke completeDeposit() via the messenger', async () => {
						// 'smock' the messenger to return a random msg sender
						messenger.smocked.xDomainMessageSender.will.return.with(() => randomAddress);
						await assert.revert(
							instance.completeDeposit(user1, 100, {
								from: smockedMessenger,
							}),
							'Only the L1 bridge can invoke'
						);
					});
				});

				describe('when invoked by the messenger (aka relayer)', async () => {
					let completeDepositTx;
					const completeDepositAmount = 100;
					beforeEach('completeDeposit is called', async () => {
						completeDepositTx = await instance.completeDeposit(user1, completeDepositAmount, {
							from: smockedMessenger,
						});
					});

					it('should emit a MintedSecondary event', async () => {
						assert.eventEqual(completeDepositTx, 'MintedSecondary', {
							account: user1,
							amount: completeDepositAmount,
						});
					});

					it('then PERI is minted via MintablePeriFinance.mintSecondary', async () => {
						assert.equal(mintablePeriFinance.smocked.mintSecondary.calls.length, 1);
						assert.equal(mintablePeriFinance.smocked.mintSecondary.calls[0][0], user1);
						assert.equal(
							mintablePeriFinance.smocked.mintSecondary.calls[0][1].toString(),
							completeDepositAmount
						);
					});
				});
			});

			describe('completeRewardDeposit', async () => {
				describe('failure modes', () => {
					it('should only allow the relayer (aka messenger) to call completeRewardDeposit()', async () => {
						await onlyGivenAddressCanInvoke({
							fnc: instance.completeRewardDeposit,
							args: [100],
							accounts,
							address: smockedMessenger,
							reason: 'Only the relayer can call this',
						});
					});

					it('should only allow the L1 bridge to invoke completeRewardDeposit() via the messenger', async () => {
						// 'smock' the messenger to return a random msg sender
						messenger.smocked.xDomainMessageSender.will.return.with(() => randomAddress);
						await assert.revert(
							instance.completeRewardDeposit(100, {
								from: smockedMessenger,
							}),
							'Only the L1 bridge can invoke'
						);
					});
				});

				describe('when invoked by the bridge on the other layer', async () => {
					let completeRewardDepositTx;
					const completeRewardDepositAmount = 100;
					beforeEach('completeRewardDeposit is called', async () => {
						completeRewardDepositTx = await instance.completeRewardDeposit(
							completeRewardDepositAmount,
							{
								from: smockedMessenger,
							}
						);
					});

					it('should emit a MintedSecondaryRewards event', async () => {
						assert.eventEqual(completeRewardDepositTx, 'MintedSecondaryRewards', {
							amount: completeRewardDepositAmount,
						});
					});

					it('then PERI is minted via MintbalePeriFinance.mintSecondary', async () => {
						assert.equal(mintablePeriFinance.smocked.mintSecondaryRewards.calls.length, 1);
						assert.equal(
							mintablePeriFinance.smocked.mintSecondaryRewards.calls[0][0].toString(),
							completeRewardDepositAmount
						);
					});
				});
			});
		});
	});
});
