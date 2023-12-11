const ethers = require('ethers');
const { assert } = require('../contracts/common');
const { connectContract } = require('./utils/connectContract');
const { toBytes32, getUsers } = require('../..');
const { toUnit } = require('../utils')();
const { assertRevertOptimism } = require('./utils/revertOptimism');

const itCanPerformPynthExchange = ({ ctx }) => {
	describe('[PYNTEXCHANGE] when exchanging pynths on L2', () => {
		const amountToDeposit = ethers.utils.parseEther('100');

		const [pUSD, pETH] = ['pUSD', 'pETH'].map(toBytes32);
		let user1L1, user1L2;

		let PeriFinanceL1, PeriFinanceBridgeToOptimismL1;
		let PeriFinanceL2,
			PeriFinanceBridgeToBaseL2,
			PynthpUSDL2,
			PynthpETHL2,
			ExchangerL2,
			ExchangeRatesL2,
			ExchangeStateL2,
			FeePoolL2,
			SystemSettingsL2;

		// --------------------------
		// Setup
		// --------------------------

		const itCanSettleL2 = async (canSettle, pynth) => {
			describe('When the user tries to settle', () => {
				before('connect user to contract', async () => {
					PeriFinanceL2 = PeriFinanceL2.connect(user1L2);
				});
				if (canSettle) {
					it('settles correctly', async () => {
						const tx = await PeriFinanceL2.settle(pynth);
						const receipt = await tx.wait();
						if (!receipt) {
							throw new Error(`Transaction reverted, even though it was not supposed to.`);
						}
					});
				} else {
					it('settling reverts', async () => {
						const tx = await PeriFinanceL2.settle(pynth);

						await assertRevertOptimism({
							tx,
							reason: 'Cannot settle during waiting',
							provider: ctx.providerL2,
						});
					});
				}
			});
		};

		const itHasExchangeEntriesL2 = async numEntries => {
			describe('When checking ExhangeState', () => {
				it(`${numEntries} exchange state entries should have been created`, async () => {
					assert.bnEqual(
						await ExchangeStateL2.getLengthOfEntries(user1L2.address, pETH),
						numEntries
					);
				});
			});
		};

		const itCanSetTheWaitingPeriodL2 = async waitingPeriod => {
			describe(`When setting the waiting period to ${waitingPeriod}`, () => {
				before('setWaitingPeriod', async () => {
					SystemSettingsL2 = SystemSettingsL2.connect(ctx.ownerL2);
					const tx = await SystemSettingsL2.setWaitingPeriodSecs(waitingPeriod);
					await tx.wait();
				});

				it('waiting is set correctly', async () => {
					assert.bnEqual(await ExchangerL2.waitingPeriodSecs(), waitingPeriod);
				});
			});
		};

		const itCanExchangeUsdToEthL2 = async pUSDtoBeExchanged => {
			describe('when the user exchanges pUSD for pETH', () => {
				let received;
				let normalizedFee;
				let feeAddresspUSDBalanceL2;
				let feesToDistributeL2;
				let user1pETHBalanceL2, user1pUSDBalanceL2;
				const feeAddress = getUsers({ network: 'mainnet', user: 'fee' }).address;

				before('record current values', async () => {
					user1pETHBalanceL2 = await PynthpETHL2.balanceOf(user1L2.address);
					user1pUSDBalanceL2 = await PynthpUSDL2.balanceOf(user1L2.address);
					feeAddresspUSDBalanceL2 = await PynthpUSDL2.balanceOf(feeAddress);
					const feePeriodZero = await FeePoolL2.recentFeePeriods(0);
					feesToDistributeL2 = feePeriodZero.feesToDistribute;
				});

				before('connect user to contract', async () => {
					PeriFinanceL2 = PeriFinanceL2.connect(user1L2);
				});

				before('pUSD to pETH exchange', async () => {
					const tx = await PeriFinanceL2.exchange(pUSD, pUSDtoBeExchanged, pETH);
					await tx.wait();
					const { amountReceived, fee } = await ExchangerL2.getAmountsForExchange(
						pUSDtoBeExchanged,
						pUSD,
						pETH
					);
					received = amountReceived;
					normalizedFee = await ExchangeRatesL2.effectiveValue(pETH, fee, pUSD);
				});

				it('shows that the user L2 pUSD balance has decreased', async () => {
					assert.bnEqual(
						await PynthpUSDL2.balanceOf(user1L2.address),
						user1pUSDBalanceL2.sub(pUSDtoBeExchanged)
					);
				});
				it('shows that the user L2 pETH balance has increased', async () => {
					assert.bnEqual(
						await PynthpETHL2.balanceOf(user1L2.address),
						user1pETHBalanceL2.add(received)
					);
				});
				it('shows that the user fees have been recorded correctly', async () => {
					const firstPeriod = await FeePoolL2.recentFeePeriods(0);

					assert.bnEqual(firstPeriod.feePeriodId, '1');
					assert.bnEqual(firstPeriod.feesToDistribute, feesToDistributeL2.add(normalizedFee));
					assert.bnEqual(firstPeriod.feesClaimed, '0');
				});
				it('shows that the fees are initially remitted to the right address(0xfeEFEEfeefEeFeefEEFEEfEeFeefEEFeeFEEFEeF)', async () => {
					// fee remittance
					assert.bnEqual(
						await PynthpUSDL2.balanceOf(feeAddress),
						feeAddresspUSDBalanceL2.add(normalizedFee)
					);
				});
			});
		};

		const itCanIssueL2 = async pUSDIssued => {
			describe('When the user issues pUSD', () => {
				let user1pETHBalanceL2, user1pUSDBalanceL2;
				before('connect user to contract', async () => {
					PeriFinanceL2 = PeriFinanceL2.connect(user1L2);
				});
				before('record current values', async () => {
					user1pETHBalanceL2 = await PynthpETHL2.balanceOf(user1L2.address);
					user1pUSDBalanceL2 = await PynthpUSDL2.balanceOf(user1L2.address);
				});

				before(`issue ${pUSDIssued} pUSD`, async () => {
					const tx = await PeriFinanceL2.issuePynthsAndStakeUSDC(pUSDIssued, toUnit('0'));
					await tx.wait();
				});

				it('shows that the user L2 pUSD balance has increased (while all other pynth balacnes remain the same)', async () => {
					assert.bnEqual(
						await PynthpUSDL2.balanceOf(user1L2.address),
						user1pUSDBalanceL2.add(pUSDIssued)
					);
					assert.bnEqual(await PynthpETHL2.balanceOf(user1L2.address), user1pETHBalanceL2);
				});
			});
		};

		before('identify signers', async () => {
			user1L1 = ctx.providerL1.getSigner(ctx.user1Address);
			user1L1.address = ctx.user1Address;
			user1L2 = new ethers.Wallet(ctx.user1PrivateKey, ctx.providerL2);
			user1L2.address = ctx.user1Address;
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
			PynthpUSDL2 = connectContract({
				contract: 'ProxypUSD',
				source: 'Pynth',
				useOvm: true,
				provider: ctx.providerL2,
			});
			PynthpETHL2 = connectContract({
				contract: 'ProxypETH',
				source: 'Pynth',
				useOvm: true,
				provider: ctx.providerL2,
			});
			ExchangerL2 = connectContract({
				contract: 'Exchanger',
				useOvm: true,
				provider: ctx.providerL2,
			});
			ExchangeRatesL2 = connectContract({
				contract: 'ExchangeRates',
				source: 'ExchangeRatesWithoutInvPricing',
				useOvm: true,
				provider: ctx.providerL2,
			});
			ExchangeStateL2 = connectContract({
				contract: 'ExchangeState',
				useOvm: true,
				provider: ctx.providerL2,
			});
			FeePoolL2 = connectContract({
				contract: 'FeePool',
				useOvm: true,
				provider: ctx.providerL2,
			});
			SystemSettingsL2 = connectContract({
				contract: 'SystemSettings',
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
				// No debt
				// --------------------------

				describe('when a user doesnt have debt in L1', () => {
					let depositReceipt;

					describe('when a user deposits PERI in the L1 bridge', () => {
						let user1BalanceL2;
						let bridgeBalanceL1;

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

						const eventListener = (from, value, event) => {};

						before('listen to events on l2', async () => {
							PeriFinanceBridgeToBaseL2.on('MintedSecondary', eventListener);
						});

						before('deposit', async () => {
							PeriFinanceBridgeToOptimismL1 = PeriFinanceBridgeToOptimismL1.connect(user1L1);

							const tx = await PeriFinanceBridgeToOptimismL1.initiateDeposit(amountToDeposit);
							depositReceipt = await tx.wait();
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

							it('shows that the users L2 PERI balance increased', async () => {
								assert.bnEqual(
									await PeriFinanceL2.balanceOf(user1L1.address),
									user1BalanceL2.add(amountToDeposit)
								);
							});

							describe('When the waiting period is 0', () => {
								const pUSDIssued = ethers.utils.parseEther('10');
								itCanSetTheWaitingPeriodL2('0');
								itCanIssueL2(pUSDIssued);
								itCanExchangeUsdToEthL2(pUSDIssued);
								// since the waiting period is 0 is should skip cerating exchange entries (SIP-118)
								itHasExchangeEntriesL2('0');
								// since the waiting period is 0 it settle should not fail, it just has no effect
								itCanSettleL2(true, pETH);
							});

							describe('When the waiting period is greater than 0', () => {
								const pUSDIssued = ethers.utils.parseEther('10');
								itCanSetTheWaitingPeriodL2('360');
								itCanIssueL2(pUSDIssued);
								itCanExchangeUsdToEthL2(pUSDIssued);
								// since the waiting period is gt 0 it should have created exchange entries
								itHasExchangeEntriesL2('1');
								// since the waiting period is gt 0 it should not be possible to settle immediately, hence the fist argument is false
								itCanSettleL2(false, pETH);
								// since settlement fails, the entries should persist
								itHasExchangeEntriesL2('1');
								// set the waiting period to 0
								itCanSetTheWaitingPeriodL2('0');
								// it should be able to settle now!
								itCanSettleL2(true, pETH);
							});
						});
					});
				});
			});
		});
	});
};

module.exports = {
	itCanPerformPynthExchange,
};
