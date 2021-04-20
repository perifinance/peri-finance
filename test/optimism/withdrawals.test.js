const ethers = require('ethers');
const { assert } = require('../contracts/common');
const { assertRevertOptimism } = require('./utils/revertOptimism');
const { connectContract } = require('./utils/connectContract');

const itCanPerformWithdrawals = ({ ctx }) => {
	describe('[WITHDRAWALS] when migrating PERI from L2 to L1', () => {
		const amountToWithdraw = ethers.utils.parseEther('100');

		let user1L2;

		let PeriFinanceL1, PeriFinanceBridgeToOptimismL1;
		let PeriFinanceL2, PeriFinanceBridgeToBaseL2, SystemStatusL2;
		let depositReceipt;
		// --------------------------
		// Setup
		// --------------------------

		before('identify signers', async () => {
			user1L2 = new ethers.Wallet(ctx.user1PrivateKey, ctx.providerL2);
		});

		before('connect to contracts', async () => {
			// L1
			PeriFinanceL1 = connectContract({ contract: 'PeriFinance', provider: ctx.providerL1 });
			PeriFinanceBridgeToOptimismL1 = connectContract({
				contract: 'PeriFinanceBridgeToOptimism',
				provider: ctx.providerL1,
			});

			// L2
			PeriFinanceL2 = connectContract({
				contract: 'PeriFinance',
				source: 'MintablePeriFinance',
				useOvm: true,
				provider: ctx.providerL2,
			});
			PeriFinanceBridgeToBaseL2 = connectContract({
				contract: 'PeriFinanceBridgeToBase',
				useOvm: true,
				provider: ctx.providerL2,
			});
			SystemStatusL2 = connectContract({
				contract: 'SystemStatus',
				useOvm: true,
				provider: ctx.providerL2,
			});
		});

		const eventListener = (from, value, event) => {};

		before('listen to events on l2', async () => {
			PeriFinanceBridgeToBaseL2.on('MintedSecondary', eventListener);
		});

		before('make a deposit', async () => {
			// Make a deposit so that
			// 1. There is PERI in the bridge for withdrawals,
			// 2. Counter a known bug in Optimism, where "now" is always 0 unless a message has been relayed

			PeriFinanceL1 = PeriFinanceL1.connect(ctx.ownerL1);
			await PeriFinanceL1.approve(
				PeriFinanceBridgeToOptimismL1.address,
				ethers.utils.parseEther(amountToWithdraw.toString())
			);

			PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(ctx.ownerL1);
			const tx = await PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToWithdraw);
			depositReceipt = await tx.wait();
		});

		// --------------------------
		// Get PERI
		// --------------------------

		describe('when waiting for the tx to complete on L2', () => {
			before('listen for completion', async () => {
				const [transactionHashL2] = await ctx.watcher.getMessageHashesFromL1Tx(
					depositReceipt.transactionHash
				);
				await ctx.watcher.getL2TransactionReceipt(transactionHashL2);
			});

			before('stop listening to events on L2', async () => {
				PeriFinanceBridgeToBaseL2.off('MintedSecondary', eventListener);
			});

			describe('when a user has the expected amount of PERI in L2', () => {
				let user1BalanceL2;

				before('record current values', async () => {
					user1BalanceL2 = await PeriFinanceL2.balanceOf(user1L2.address);
				});

				before('ensure that the user has the expected PERI balance', async () => {
					PeriFinanceL2 = PeriFinanceL2.connect(ctx.ownerL2);

					const tx = await PeriFinanceL2.transfer(user1L2.address, amountToWithdraw);
					await tx.wait();
				});

				it('shows the user has PERI', async () => {
					assert.bnEqual(
						await PeriFinanceL2.balanceOf(user1L2.address),
						user1BalanceL2.add(amountToWithdraw)
					);
				});

				// --------------------------
				// At least one issuance
				// --------------------------

				describe('when the PERI rate has been updated', () => {
					// --------------------------
					// Suspended
					// --------------------------

					describe('when the system is suspended in L2', () => {
						before('suspend the system', async () => {
							SystemStatusL2 = SystemStatusL2.connect(ctx.ownerL2);

							await SystemStatusL2.suspendSystem(1);
						});

						after('resume the system', async () => {
							SystemStatusL2 = SystemStatusL2.connect(ctx.ownerL2);

							await SystemStatusL2.resumeSystem();
						});

						it('reverts when the user attempts to initiate a withdrawal', async () => {
							PeriFinanceBridgeToBaseL2 = PeriFinanceBridgeToBaseL2.connect(user1L2);

							const tx = await PeriFinanceBridgeToBaseL2.initiateWithdrawal(1);

							await assertRevertOptimism({
								tx,
								reason: 'PeriFinance is suspended',
								provider: ctx.providerL2,
							});
						});
					});

					// --------------------------
					// Not suspended
					// --------------------------

					describe('when a user initiates a withdrawal on L2', () => {
						let user1BalanceL1;
						let withdrawalReceipt;
						let withdrawalCompletedEvent;

						const eventListener = (from, value, event) => {
							if (event && event.event === 'WithdrawalCompleted') {
								withdrawalCompletedEvent = event;
							}
						};

						before('listen to events on l1', async () => {
							PeriFinanceBridgeToOptimismL1.on('WithdrawalCompleted', eventListener);
						});

						before('record current values', async () => {
							user1BalanceL1 = await PeriFinanceL1.balanceOf(user1L2.address);
							user1BalanceL2 = await PeriFinanceL2.balanceOf(user1L2.address);
						});

						before('initiate withdrawal', async () => {
							PeriFinanceBridgeToBaseL2 = PeriFinanceBridgeToBaseL2.connect(user1L2);

							const tx = await PeriFinanceBridgeToBaseL2.initiateWithdrawal(amountToWithdraw);
							withdrawalReceipt = await tx.wait();
						});

						it('emitted a Withdrawal event', async () => {
							const event = withdrawalReceipt.events.find(e => e.event === 'WithdrawalInitiated');
							assert.exists(event);

							assert.bnEqual(event.args.amount, amountToWithdraw);
							assert.equal(event.args.account, user1L2.address);
						});

						it('reduces the users balance', async () => {
							assert.bnEqual(
								await PeriFinanceL2.balanceOf(user1L2.address),
								user1BalanceL2.sub(amountToWithdraw)
							);
						});

						describe('when waiting for the tx to complete on L1', () => {
							before('listen for completion', async () => {
								const [transactionHashL1] = await ctx.watcher.getMessageHashesFromL2Tx(
									withdrawalReceipt.transactionHash
								);
								await ctx.watcher.getL1TransactionReceipt(transactionHashL1);
							});

							before('stop listening to events on L1', async () => {
								PeriFinanceBridgeToOptimismL1.off('WithdrawalCompleted', eventListener);
							});

							it('emitted a WithdrawalCompleted event', async () => {
								assert.exists(withdrawalCompletedEvent);
								assert.bnEqual(withdrawalCompletedEvent.args.amount, amountToWithdraw);
								assert.equal(withdrawalCompletedEvent.args.account, user1L2.address);
							});

							it('shows that the users L1 balance increased', async () => {
								assert.bnEqual(
									await PeriFinanceL1.balanceOf(user1L2.address),
									user1BalanceL1.add(amountToWithdraw)
								);
							});
						});
					});
				});
			});
		});
	});
};

module.exports = {
	itCanPerformWithdrawals,
};
