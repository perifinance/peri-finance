const ethers = require('ethers');
const { assert, toUnit } = require('../contracts/common');
const { connectContract } = require('./utils/connectContract');
const { takeSnapshot, restoreSnapshot } = require('./utils/rpc');

const itCanPerformDeposits = ({ ctx }) => {
	describe('[DEPOSITS] when migrating PERI from L1 to L2', () => {
		const amountToDeposit = ethers.utils.parseEther('100');

		let user1L1;

		let PeriFinanceL1, PeriFinanceBridgeToOptimismL1, SystemStatusL1;
		let PeriFinanceL2, PeriFinanceBridgeToBaseL2;

		let snapshotId;

		// --------------------------
		// Setup
		// --------------------------

		before('identify signers', async () => {
			user1L1 = ctx.providerL1.getSigner(ctx.user1Address);
			user1L1.address = ctx.user1Address;
		});

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
		});

		// --------------------------
		// Get PERI
		// --------------------------

		describe('when a user has the expected amount of PERI in L1', () => {
			let user1BalanceL1;

			before('record current values', async () => {
				user1BalanceL1 = await PeriFinanceL1.balanceOf(user1L1.address);
			});

			before('ensure that the user has the expected PERI balance', async () => {
				PeriFinanceL1 = PeriFinanceL1.connect(ctx.ownerL1);

				const tx = await PeriFinanceL1.transfer(user1L1.address, amountToDeposit);
				await tx.wait();
			});

			it('shows the user has PERI', async () => {
				assert.bnEqual(
					await PeriFinanceL1.balanceOf(user1L1.address),
					user1BalanceL1.add(amountToDeposit)
				);
			});

			// --------------------------
			// No approval
			// --------------------------

			describe('before a user approves the L1 bridge to transfer its PERI', () => {
				before('make sure approval is zero', async () => {
					PeriFinanceL1 = PeriFinanceL1.connect(user1L1);

					const tx = await PeriFinanceL1.approve(
						PeriFinanceBridgeToOptimismL1.address,
						ethers.utils.parseEther('0')
					);
					await tx.wait();
				});

				it('reverts if the user attempts to initiate a deposit', async () => {
					PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(user1L1);

					await assert.revert(
						PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit),
						'subtraction overflow'
					);
				});
			});

			// --------------------------
			// Approval
			// --------------------------

			describe('when a user approves the L1 bridge to transfer its PERI', () => {
				before('approve', async () => {
					PeriFinanceL1 = PeriFinanceL1.connect(user1L1);

					const tx = await PeriFinanceL1.approve(
						PeriFinanceBridgeToOptimismL1.address,
						ethers.utils.parseEther('100000000')
					);
					await tx.wait();
				});

				// --------------------------
				// With debt
				// --------------------------

				describe('when a user has debt in L1', () => {
					before('take snapshot in L1', async () => {
						snapshotId = await takeSnapshot({ provider: ctx.providerL1 });
					});

					after('restore snapshot in L1', async () => {
						await restoreSnapshot({ id: snapshotId, provider: ctx.providerL1 });
					});

					before('issue pUSD', async () => {
						PeriFinanceL1 = PeriFinanceL1.connect(user1L1);

						const tx = await PeriFinanceL1.issuePynthsAndStakeUSDC(1, toUnit('0'));
						await tx.wait();
					});

					it('reverts when the user attempts to deposit', async () => {
						PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(user1L1);

						await assert.revert(
							PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit),
							'Cannot deposit or migrate with debt'
						);
					});
				});

				// --------------------------
				// No debt
				// --------------------------

				describe('when a user doesnt have debt in L1', () => {
					let depositReceipt;

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
							PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(user1L1);

							await assert.revert(
								PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit),
								'PeriFinance is suspended'
							);
						});
					});

					// --------------------------
					// Not suspended
					// --------------------------

					describe('when a user deposits PERI in the L1 bridge', () => {
						let user1BalanceL2;
						let bridgeBalanceL1;
						let mintedSecondaryEvent;

						before('record current values', async () => {
							bridgeBalanceL1 = await PeriFinanceL1.balanceOf(
								PeriFinanceBridgeToOptimismL1.address
							);

							user1BalanceL1 = await PeriFinanceL1.balanceOf(user1L1.address);
							user1BalanceL2 = await PeriFinanceL2.balanceOf(user1L1.address);
						});

						// --------------------------
						// Deposit
						// --------------------------

						const eventListener = (from, value, event) => {
							if (event && event.event === 'MintedSecondary') {
								mintedSecondaryEvent = event;
							}
						};

						before('listen to events on l2', async () => {
							PeriFinanceBridgeToBaseL2.on('MintedSecondary', eventListener);
						});

						before('deposit', async () => {
							PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(user1L1);

							const tx = await PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit);
							depositReceipt = await tx.wait();
						});

						it('emitted a Deposit event', async () => {
							const event = depositReceipt.events.find(e => e.event === 'Deposit');
							assert.exists(event);

							assert.bnEqual(event.args.amount, amountToDeposit);
							assert.equal(event.args.account, user1L1.address);
						});

						it('shows that the users new balance L1 is reduced', async () => {
							assert.bnEqual(
								await PeriFinanceL1.balanceOf(user1L1.address),
								user1BalanceL1.sub(amountToDeposit)
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
									depositReceipt.transactionHash
								);
								await ctx.watcher.getL2TransactionReceipt(transactionHashL2);
							});

							before('stop listening to events on L2', async () => {
								PeriFinanceBridgeToBaseL2.off('MintedSecondary', eventListener);
							});

							it('emitted a MintedSecondary event', async () => {
								assert.exists(mintedSecondaryEvent);
								assert.bnEqual(mintedSecondaryEvent.args.amount, amountToDeposit);
								assert.equal(mintedSecondaryEvent.args.account, user1L1.address);
							});

							it('shows that the users L2 balance increased', async () => {
								assert.bnEqual(
									await PeriFinanceL2.balanceOf(user1L1.address),
									user1BalanceL2.add(amountToDeposit)
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
	itCanPerformDeposits,
};
