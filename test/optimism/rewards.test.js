const ethers = require('ethers');
const { assert } = require('../contracts/common');
const { connectContract } = require('./utils/connectContract');

const itCanPerformRewardDeposits = ({ ctx }) => {
	describe('[REWARDS] when migrating PERI rewards from L1 to L2', () => {
		const amountToDeposit = ethers.utils.parseEther('100');

		let PeriFinanceL1, PeriFinanceBridgeToOptimismL1, SystemStatusL1;
		let FeePoolL2, PeriFinanceBridgeToBaseL2;

		// --------------------------
		// Setup
		// --------------------------

		before('connect to contracts', async () => {
			// L1
			PeriFinanceL1 = connectContract({ contract: 'PeriFinance', provider: ctx.providerL1 });
			PeriFinanceBridgeToOptimismL1 = connectContract({
				contract: 'PeriFinanceBridgeToOptimism',
				provider: ctx.providerL1,
			});
			SystemStatusL1 = connectContract({
				contract: 'SystemStatus',
				provider: ctx.providerL1,
			});

			// L2
			FeePoolL2 = connectContract({
				contract: 'FeePool',
				useOvm: true,
				provider: ctx.providerL2,
			});
			PeriFinanceBridgeToBaseL2 = connectContract({
				contract: 'PeriFinanceBridgeToBase',
				useOvm: true,
				provider: ctx.providerL2,
			});
		});

		// --------------------------
		// No approval
		// --------------------------

		describe('before the owner approves the L1 bridge to transfer its PERI', () => {
			before('make sure approval is zero', async () => {
				PeriFinanceL1 = PeriFinanceL1.connect(ctx.ownerL1);

				const tx = await PeriFinanceL1.approve(
					PeriFinanceBridgeToOptimismL1.address,
					ethers.utils.parseEther('0')
				);
				await tx.wait();
			});

			it('reverts if the user attempts to initiate a deposit', async () => {
				PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(ctx.ownerL1);

				await assert.revert(
					PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit),
					'subtraction overflow'
				);
			});
		});

		// --------------------------
		// Approval
		// --------------------------

		describe('when the owner approves the L1 bridge to transfer its PERI', () => {
			before('approve', async () => {
				PeriFinanceL1 = PeriFinanceL1.connect(ctx.ownerL1);

				const tx = await PeriFinanceL1.approve(
					PeriFinanceBridgeToOptimismL1.address,
					ethers.utils.parseEther('100000000')
				);
				await tx.wait();
			});

			// --------------------------
			// Suspended
			// --------------------------

			describe('when the system is suspended in L1', () => {
				before('suspend the system', async () => {
					SystemStatusL1 = SystemStatusL1.connect(ctx.ownerL1);

					await SystemStatusL1.suspendSystem(1);
				});

				after('resume the system', async () => {
					SystemStatusL1 = SystemStatusL1.connect(ctx.ownerL1);

					await SystemStatusL1.resumeSystem();
				});

				it('reverts when the user attempts to initiate a deposit', async () => {
					PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(ctx.ownerL1);

					await assert.revert(
						PeriFinanceBridgeToOptimismL1.initiateRewardDeposit(amountToDeposit),
						'PeriFinance is suspended'
					);
				});
			});

			// --------------------------
			// Deposit rewards
			// --------------------------

			describe('when the owner deposits PERI in the L1 bridge', () => {
				let ownerBalanceL1, bridgeBalanceL1;
				let rewardsToDistributeL2;
				let rewardDepositReceipt;
				let mintedSecondaryEvent;

				const eventListener = (value, event) => {
					if (event && event.event === 'MintedSecondaryRewards') {
						mintedSecondaryEvent = event;
					}
				};

				before('listen to events on l2', async () => {
					PeriFinanceBridgeToBaseL2.on('MintedSecondaryRewards', eventListener);
				});

				before('record current values', async () => {
					bridgeBalanceL1 = await PeriFinanceL1.balanceOf(PeriFinanceBridgeToOptimismL1.address);
					ownerBalanceL1 = await PeriFinanceL1.balanceOf(ctx.ownerAddress);

					const period = await FeePoolL2.recentFeePeriods(0);
					rewardsToDistributeL2 = period.rewardsToDistribute;
				});

				before('deposit rewards', async () => {
					PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(ctx.ownerL1);

					const tx = await PeriFinanceBridgeToOptimismL1.initiateRewardDeposit(amountToDeposit);
					rewardDepositReceipt = await tx.wait();
				});

				it('emitted a RewardsDeposit event', async () => {
					const event = rewardDepositReceipt.events.find(e => e.event === 'RewardDeposit');
					assert.exists(event);

					assert.bnEqual(event.args.amount, amountToDeposit);
					assert.equal(event.args.account, ctx.ownerAddress);
				});

				it('shows that the owners new balance L1 is reduced', async () => {
					assert.bnEqual(
						await PeriFinanceL1.balanceOf(ctx.ownerAddress),
						ownerBalanceL1.sub(amountToDeposit)
					);
				});

				it('shows that the L1 bridge received the PERI', async () => {
					assert.bnEqual(
						await PeriFinanceL1.balanceOf(PeriFinanceBridgeToOptimismL1.address),
						bridgeBalanceL1.add(amountToDeposit)
					);
				});

				// --------------------------
				// Wait...
				// --------------------------

				describe('when waiting for the tx to complete on L2', () => {
					before('listen for completion', async () => {
						const [transactionHashL2] = await ctx.watcher.getMessageHashesFromL1Tx(
							rewardDepositReceipt.transactionHash
						);
						await ctx.watcher.getL2TransactionReceipt(transactionHashL2);
					});

					before('stop listening to events on L2', async () => {
						PeriFinanceBridgeToBaseL2.off('MintedSecondaryRewards', eventListener);
					});

					it('emitted a MintedSecondary event', async () => {
						assert.exists(mintedSecondaryEvent);
						assert.bnEqual(mintedSecondaryEvent.args.amount, amountToDeposit);
					});

					it('shows that the fee pool has registered rewards to distribute', async () => {
						const period = await FeePoolL2.recentFeePeriods(0);

						assert.bnEqual(period.rewardsToDistribute, rewardsToDistributeL2.add(amountToDeposit));
					});
				});
			});
		});
	});
};

module.exports = {
	itCanPerformRewardDeposits,
};
