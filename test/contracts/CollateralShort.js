'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const {
	fastForward,
	toUnit,
	fromUnit,
	toBN,
	multiplyDecimal,
	divideDecimal,
} = require('../utils')();

const { setupAllContracts } = require('./setup');

const {
	ensureOnlyExpectedMutativeFunctions,
	setExchangeFeeRateForPynths,
	setupPriceAggregators,
	updateAggregatorRates,
} = require('./helpers');

const {
	toBytes32,
	defaults: { LIQUIDATION_PENALTY },
} = require('../..');

contract('CollateralShort', async accounts => {
	const YEAR = 31556926;

	const pUSD = toBytes32('pUSD');
	const pETH = toBytes32('pETH');
	const pBTC = toBytes32('pBTC');

	const [, owner, , , account1, account2] = accounts;

	let short,
		managerState,
		feePool,
		exchanger,
		exchangeRates,
		addressResolver,
		pUSDPynth,
		pBTCPynth,
		pETHPynth,
		pynths,
		manager,
		issuer,
		debtCache,
		systemSettings,
		FEE_ADDRESS;

	let tx, loan, id;

	const getid = tx => {
		const event = tx.logs.find(log => log.event === 'LoanCreated');
		return event.args.id;
	};

	const fastForwardAndUpdateRates = async seconds => {
		await fastForward(seconds);
		await updateRatesWithDefaults();
	};

	const issue = async (pynth, issueAmount, receiver) => {
		await pynth.issue(receiver, issueAmount, { from: owner });
	};

	const updateRatesWithDefaults = async () => {
		const pBTC = toBytes32('pBTC');

		await updateAggregatorRates(exchangeRates, null, [pETH, pBTC], [100, 10000].map(toUnit));
	};

	const setupShort = async () => {
		pynths = ['pUSD', 'pBTC', 'pETH'];
		({
			ExchangeRates: exchangeRates,
			Exchanger: exchanger,
			PynthpUSD: pUSDPynth,
			PynthpBTC: pBTCPynth,
			PynthpETH: pETHPynth,
			FeePool: feePool,
			AddressResolver: addressResolver,
			Issuer: issuer,
			DebtCache: debtCache,
			CollateralShort: short,
			SystemSettings: systemSettings,
			CollateralManager: manager,
			CollateralManagerState: managerState,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'FeePool',
				'AddressResolver',
				'Exchanger',
				'ExchangeRates',
				'SystemStatus',
				'Issuer',
				'DebtCache',
				'SystemSettings',
				'CollateralUtil',
				'CollateralShort',
				'CollateralManager',
				'CollateralManagerState',
				'StakingState',
				'CrossChainManager',
			],
		}));

		await setupPriceAggregators(exchangeRates, owner, [pBTC, pETH]);

		await managerState.setAssociatedContract(manager.address, { from: owner });

		FEE_ADDRESS = await feePool.FEE_ADDRESS();

		await addressResolver.importAddresses(
			[toBytes32('CollateralShort'), toBytes32('CollateralManager')],
			[short.address, manager.address],
			{
				from: owner,
			}
		);

		await feePool.rebuildCache();
		await manager.rebuildCache();
		await issuer.rebuildCache();
		await debtCache.rebuildCache();

		await manager.addCollaterals([short.address], { from: owner });

		await short.addPynths(
			['PynthpBTC', 'PynthpETH'].map(toBytes32),
			['pBTC', 'pETH'].map(toBytes32),
			{ from: owner }
		);

		await manager.addPynths(
			[toBytes32('PynthpUSD'), toBytes32('PynthpBTC'), toBytes32('PynthpETH')],
			[toBytes32('pUSD'), toBytes32('pBTC'), toBytes32('pETH')],
			{
				from: owner,
			}
		);

		await manager.addShortablePynths(
			['PynthpBTC', 'PynthpETH'].map(toBytes32),
			['pBTC', 'pETH'].map(toBytes32),
			{ from: owner }
		);

		// check pynths are set and currencyKeys set
		assert.isTrue(
			await manager.arePynthsAndCurrenciesSet(
				['PynthpUSD', 'PynthpBTC', 'PynthpETH'].map(toBytes32),
				['pUSD', 'pBTC', 'pETH'].map(toBytes32)
			)
		);

		assert.isTrue(
			await short.arePynthsAndCurrenciesSet(
				['PynthpBTC', 'PynthpETH'].map(toBytes32),
				['pBTC', 'pETH'].map(toBytes32)
			)
		);

		assert.isTrue(await manager.isPynthManaged(pUSD));
		assert.isTrue(await manager.isPynthManaged(pETH));
		assert.isTrue(await manager.isPynthManaged(pBTC));

		assert.isTrue(await manager.hasAllCollaterals([short.address]));

		await pUSDPynth.approve(short.address, toUnit(100000), { from: account1 });
	};

	before(async () => {
		await setupShort();
		await updateRatesWithDefaults();

		// set a 0.15% default exchange fee rate on each pynth
		const exchangeFeeRate = toUnit('0.0015');
		const pynthKeys = [pETH, pUSD];
		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});

		await issue(pUSDPynth, toUnit(100000), owner);
		await issue(pBTCPynth, toUnit(1), owner);
		await issue(pETHPynth, toUnit(1), owner);
		await debtCache.takeDebtSnapshot();
	});

	describe('logic', () => {
		addSnapshotBeforeRestoreAfterEach();

		it('should ensure only expected functions are mutative', async () => {
			ensureOnlyExpectedMutativeFunctions({
				abi: short.abi,
				ignoreParents: ['Owned', 'Pausable', 'MixinResolver', 'Proxy', 'Collateral'],
				expected: [
					'open',
					'close',
					'deposit',
					'repay',
					'repayWithCollateral',
					'closeWithCollateral',
					'withdraw',
					'liquidate',
					'draw',
				],
			});
		});

		it('should set constructor params on deployment', async () => {
			assert.equal(await short.owner(), owner);
			assert.equal(await short.resolver(), addressResolver.address);
			assert.equal(await short.collateralKey(), pUSD);
			assert.equal(await short.pynths(0), toBytes32('PynthpBTC'));
			assert.equal(await short.pynths(1), toBytes32('PynthpETH'));
			assert.bnEqual(await short.minCratio(), toUnit(1.2));
			assert.bnEqual(await systemSettings.liquidationPenalty(), LIQUIDATION_PENALTY); // 10% penalty
		});

		it('should access its dependencies via the address resolver', async () => {
			assert.equal(await addressResolver.getAddress(toBytes32('PynthpUSD')), pUSDPynth.address);
			assert.equal(await addressResolver.getAddress(toBytes32('FeePool')), feePool.address);
			assert.equal(
				await addressResolver.getAddress(toBytes32('ExchangeRates')),
				exchangeRates.address
			);
		});

		describe('opening shorts', async () => {
			describe('should open a btc short', async () => {
				const oneBTC = toUnit(1);
				const pusdCollateral = toUnit(15000);

				beforeEach(async () => {
					await issue(pUSDPynth, pusdCollateral, account1);

					tx = await short.open(pusdCollateral, oneBTC, pBTC, { from: account1 });

					id = getid(tx);
					loan = await short.loans(id);
				});

				it('should emit the event properly', async () => {
					assert.eventEqual(tx, 'LoanCreated', {
						account: account1,
						id: id,
						amount: oneBTC,
						collateral: pusdCollateral,
						currency: pBTC,
					});
				});

				it('should create the short correctly', async () => {
					assert.equal(loan.account, account1);
					assert.equal(loan.collateral, pusdCollateral.toString());
					assert.equal(loan.currency, pBTC);
					assert.equal(loan.short, true);
					assert.equal(loan.amount, oneBTC.toString());
					assert.bnEqual(loan.accruedInterest, toUnit(0));
				});

				it('should correclty issue the right balance to the shorter', async () => {
					const pUSDProceeds = toUnit(10000);

					assert.bnEqual(await pUSDPynth.balanceOf(account1), pUSDProceeds);
				});

				it('should tell the manager about the short', async () => {
					assert.bnEqual(await manager.short(pBTC), oneBTC);
				});

				it('should transfer the pUSD to the contract', async () => {
					assert.bnEqual(await pUSDPynth.balanceOf(short.address), pusdCollateral);
				});
			});

			describe('should open an eth short', async () => {
				const oneETH = toUnit(1);
				const pusdCollateral = toUnit(1000);

				beforeEach(async () => {
					await issue(pUSDPynth, pusdCollateral, account1);

					tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

					id = getid(tx);

					loan = await short.loans(id);
				});

				it('should emit the event properly', async () => {
					assert.eventEqual(tx, 'LoanCreated', {
						account: account1,
						id: id,
						amount: oneETH,
						collateral: pusdCollateral,
						currency: pETH,
					});
				});

				it('should create the short correctly', async () => {
					assert.equal(loan.account, account1);
					assert.equal(loan.collateral, pusdCollateral.toString());
					assert.equal(loan.currency, pETH);
					assert.equal(loan.short, true);
					assert.equal(loan.amount, oneETH.toString());
					assert.bnEqual(loan.accruedInterest, toUnit(0));
				});

				it('should correclty issue the right balance to the shorter', async () => {
					const pUSDProceeds = toUnit(100);

					assert.bnEqual(await pUSDPynth.balanceOf(account1), pUSDProceeds);
				});

				it('should tell the manager about the short', async () => {
					assert.bnEqual(await manager.short(pETH), oneETH);
				});
			});
		});

		describe('Repaying shorts', async () => {
			const pusdCollateral = toUnit(1000);
			const ethAmountToShort = toUnit(1);

			let ethAmountToRepay;

			let beforeFeePoolBalance, beforeUserBalance, beforeShortBalance, beforeLoanCollateral;
			let beforeInteractionTime;

			const accrueInterest = async () => {
				const interestIncreaseInTick = toBN(2112584307); // Value from tests

				// create the conditions to get some accruedInterest
				await manager.setMaxSkewRate(toUnit(0.2), { from: owner });
				await issue(pUSDPynth, pusdCollateral, account1);

				// open another short to set a long/short skew
				tx = await short.open(pusdCollateral, ethAmountToShort, pETH, { from: account1 });

				// Adjust before* balances
				beforeShortBalance = beforeShortBalance.add(pusdCollateral);
				beforeUserBalance = beforeUserBalance.add(toUnit(100));

				// after a year we should have accrued 6.67%.
				await fastForwardAndUpdateRates(YEAR);

				// deposit some collateral to trigger the interest accrual.
				tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

				// Adjust before* balances
				beforeLoanCollateral = pusdCollateral.add(toUnit(1));
				beforeShortBalance = beforeShortBalance.add(toUnit(1));
				beforeUserBalance = beforeUserBalance.sub(toUnit(1));

				loan = await short.loans(id);

				const accruedInterest = loan.accruedInterest;

				const interest = Math.round(parseFloat(fromUnit(accruedInterest)) * 10000) / 10000;

				// check we have interest accrued
				assert.equal(interest, 0.0667);

				return accruedInterest.add(interestIncreaseInTick);
			};

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, ethAmountToShort, pETH, { from: account1 });

				id = getid(tx);

				loan = await short.loans(id);

				beforeInteractionTime = loan.lastInteraction;

				beforeFeePoolBalance = await pUSDPynth.balanceOf(FEE_ADDRESS);
				beforeShortBalance = await pUSDPynth.balanceOf(short.address);
				beforeUserBalance = await pUSDPynth.balanceOf(account1);
				beforeLoanCollateral = 0;

				await fastForwardAndUpdateRates(3600);
			});

			it('should get the short amount and collateral', async () => {
				const { principal, collateral } = await short.getShortAndCollateral(account1, id);

				assert.bnEqual(principal, ethAmountToShort);
				assert.bnEqual(collateral, pusdCollateral);
			});

			it('should repay with collateral and update the loan', async () => {
				ethAmountToRepay = toUnit(0.5);

				tx = await short.repayWithCollateral(id, ethAmountToRepay, {
					from: account1,
				});

				loan = await short.loans(id);

				assert.eventEqual(tx, 'LoanRepaymentMade', {
					account: account1,
					repayer: account1,
					id: id,
					amountRepaid: ethAmountToRepay,
					amountAfter: loan.amount,
				});

				assert.isAbove(parseInt(loan.lastInteraction), parseInt(beforeInteractionTime));

				const {
					amountReceived: pusdAmountRepaidMinusFees,
					fee: exchangeFee,
				} = await exchanger.getAmountsForExchange(ethAmountToRepay, pETH, pUSD);

				// The collateral to use is the equivalent amount used while repaying + fees.
				const collateralToUse = pusdAmountRepaidMinusFees.add(exchangeFee).add(exchangeFee);

				// The fee pool should have received fees
				assert.deepEqual(
					await pUSDPynth.balanceOf(FEE_ADDRESS),
					beforeFeePoolBalance.add(exchangeFee),
					'The fee pool did not receive enough fees'
				);

				// The loan amount should have been reduced by the expected amount
				assert.deepEqual(
					loan.amount,
					ethAmountToShort.sub(ethAmountToRepay),
					'The loan amount was not reduced correctly'
				);

				// The loan collateral should have been reduced by the expected amount
				assert.deepEqual(
					loan.collateral,
					pusdCollateral.sub(collateralToUse),
					'The loan collateral was not reduced correctly'
				);

				// The contract pUSD balance should have been reduced by the expected amount
				assert.deepEqual(
					await pUSDPynth.balanceOf(short.address),
					beforeShortBalance.sub(collateralToUse),
					'The short contracts holds excess pUSD'
				);

				// The user pUSD balance should remain unchanged
				assert.deepEqual(
					await pUSDPynth.balanceOf(account1),
					beforeUserBalance,
					'The user pUSD balance is unexpected'
				);
			});

			it('should repay the entire loan amount', async () => {
				// In case the loan accrues interest, this option won't pay it full.
				ethAmountToRepay = ethAmountToShort;

				tx = await short.repayWithCollateral(id, ethAmountToRepay, {
					from: account1,
				});

				loan = await short.loans(id);

				assert.isAbove(parseInt(loan.lastInteraction), parseInt(beforeInteractionTime));

				assert.eventEqual(tx, 'LoanRepaymentMade', {
					account: account1,
					repayer: account1,
					id: id,
					amountRepaid: toUnit(1),
					amountAfter: loan.amount,
				});

				const {
					amountReceived: pusdAmountRepaidMinusFees,
					fee: exchangeFee,
				} = await exchanger.getAmountsForExchange(ethAmountToRepay, pETH, pUSD);

				// The collateral to use is the equivalent amount used while repaying + fees.
				const collateralToUse = pusdAmountRepaidMinusFees.add(exchangeFee).add(exchangeFee);

				// The fee pool should have received fees
				assert.deepEqual(
					await pUSDPynth.balanceOf(FEE_ADDRESS),
					beforeFeePoolBalance.add(exchangeFee),
					'The fee pool did not receive enough fees'
				);

				// The loan amount should have been reduced by the expected amount
				assert.deepEqual(
					loan.amount,
					ethAmountToShort.sub(ethAmountToRepay),
					'The loan amount was not reduced correctly'
				);

				// The loan collateral should have been reduced by the expected amount
				assert.deepEqual(
					loan.collateral,
					pusdCollateral.sub(collateralToUse),
					'The loan collateral was not reduced correctly'
				);

				// The contract pUSD balance should have been reduced by the expected amount
				assert.deepEqual(
					await pUSDPynth.balanceOf(short.address),
					pusdCollateral.sub(collateralToUse),
					'The short contracts holds excess pUSD'
				);

				// The user pUSD balance should remain unchanged
				assert.deepEqual(
					await pUSDPynth.balanceOf(account1),
					beforeUserBalance,
					'The user pUSD balance is unexpected'
				);
			});

			it('should repay with collateral and update the loan considering interest accrued', async () => {
				const accruedInterest = await accrueInterest();

				ethAmountToRepay = toUnit(0.5);

				tx = await short.repayWithCollateral(id, ethAmountToRepay, {
					from: account1,
				});

				loan = await short.loans(id);

				const pUSDAccruedInterest = await exchangeRates.effectiveValue(
					loan.currency,
					accruedInterest,
					pUSD
				);
				const amountRepaid = ethAmountToRepay.sub(accruedInterest);

				assert.eventEqual(tx, 'LoanRepaymentMade', {
					account: account1,
					repayer: account1,
					id: id,
					amountRepaid: ethAmountToRepay,
					amountAfter: loan.amount,
				});

				assert.isAbove(parseInt(loan.lastInteraction), parseInt(beforeInteractionTime));

				const {
					amountReceived: pusdAmountRepaidMinusFees,
					fee: exchangeFee,
				} = await exchanger.getAmountsForExchange(ethAmountToRepay, pETH, pUSD); // ethAmountToRepay

				// The collateral to use is the equivalent amount used while repaying + fees.
				const collateralToUse = pusdAmountRepaidMinusFees.add(exchangeFee).add(exchangeFee);

				// The fee pool should have received fees (exchange + accrued interest)
				assert.deepEqual(
					await pUSDPynth.balanceOf(FEE_ADDRESS),
					beforeFeePoolBalance.add(pUSDAccruedInterest).add(exchangeFee),
					'The fee pool did not receive enough fees'
				);

				// The loan amount should have been reduced by the expected amount
				// amountRepaid might be less than ethAmountToRepay if there's accrued interest
				assert.deepEqual(
					loan.amount,
					ethAmountToShort.sub(amountRepaid),
					'The loan amount was not reduced correctly'
				);

				// The loan collateral should have been reduced by the expected amount
				assert.deepEqual(
					loan.collateral,
					beforeLoanCollateral.sub(collateralToUse),
					'The loan collateral was not reduced correctly'
				);

				// The contract pUSD balance should have been reduced by the expected amount
				assert.deepEqual(
					await pUSDPynth.balanceOf(short.address),
					beforeShortBalance.sub(collateralToUse),
					'The short contracts holds excess pUSD'
				);

				// The user pUSD balance should remain unchanged
				assert.deepEqual(
					await pUSDPynth.balanceOf(account1),
					beforeUserBalance,
					'The user pUSD balance is unexpected'
				);
			});

			it('should only let the borrower repay with collateral', async () => {
				await assert.revert(
					short.repayWithCollateral(id, toUnit(0.1), { from: account2 }),
					'Must be borrower'
				);
			});

			it('should not let them repay too much', async () => {
				await assert.revert(
					short.repayWithCollateral(id, toUnit(2000), { from: account1 }),
					'Payment too high'
				);
			});
		});

		describe('Closing shorts', () => {
			const pusdCollateral = toUnit(1000);
			const ethAmountToShort = toUnit(1);

			let ethAmountToRepay;

			let beforeFeePoolBalance, beforeShortBalance, beforeUserBalance, beforeUserShortBalance;
			let beforeInteractionTime;

			const accrueInterest = async () => {
				const interestIncreaseInTick = toBN(2112584307); // Value from tests

				// create the conditions to get some accruedInterest
				await manager.setMaxSkewRate(toUnit(0.2), { from: owner });
				await issue(pUSDPynth, pusdCollateral, account1);

				// open another short to set a long/short skew
				await short.open(pusdCollateral, ethAmountToShort, pETH, { from: account1 });

				// Adjust before* balances
				beforeUserBalance = beforeUserBalance.add(toUnit(100));
				beforeUserShortBalance = beforeUserShortBalance.add(toUnit(100));
				beforeShortBalance = beforeShortBalance.add(pusdCollateral);

				// after a year we should have accrued 6.67%.
				await fastForwardAndUpdateRates(YEAR);

				// deposit some collateral to trigger the interest accrual.
				await short.deposit(account1, id, toUnit(1), { from: account1 });

				// Adjust before* balances
				beforeUserBalance = beforeUserBalance.sub(toUnit(1));

				loan = await short.loans(id);

				const accruedInterest = loan.accruedInterest;

				const interest = Math.round(parseFloat(fromUnit(accruedInterest)) * 10000) / 10000;

				// check we have interest accrued
				assert.equal(interest, 0.0667);

				return accruedInterest.add(interestIncreaseInTick);
			};

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, ethAmountToShort, pETH, { from: account1 });

				id = getid(tx);

				loan = await short.loans(id);

				beforeInteractionTime = loan.lastInteraction;

				beforeFeePoolBalance = await pUSDPynth.balanceOf(FEE_ADDRESS);
				beforeShortBalance = await pUSDPynth.balanceOf(short.address);
				beforeUserBalance = await pUSDPynth.balanceOf(account1);
				beforeUserShortBalance = pusdCollateral;

				await fastForwardAndUpdateRates(3600);
			});

			it('should repay with collateral and close the loan', async () => {
				ethAmountToRepay = ethAmountToShort;

				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(100));

				const { fee: exchangeFee } = await exchanger.getAmountsForExchange(
					ethAmountToRepay,
					pETH,
					pUSD
				);

				// Close the short and identify it
				await short.closeWithCollateral(id, { from: account1 });
				loan = await short.loans(id);

				// Interaction time increased
				assert.isAbove(parseInt(loan.lastInteraction), parseInt(beforeInteractionTime));

				// Short state should be zeroed out
				assert.equal(loan.interestIndex, toUnit(0).toString());
				assert.equal(loan.amount, toUnit(0).toString());
				assert.equal(loan.collateral, toUnit(0).toString());

				// The fee pool should have received fees
				assert.deepEqual(
					await pUSDPynth.balanceOf(FEE_ADDRESS),
					beforeFeePoolBalance.add(exchangeFee),
					'The fee pool did not receive enough fees'
				);

				// The loan amount should have been reduced by the expected amount
				assert.deepEqual(
					loan.amount,
					ethAmountToShort.sub(ethAmountToRepay),
					'The loan amount was not reduced correctly'
				);

				// The loan collateral should have been reduced to zero
				assert.deepEqual(
					loan.collateral,
					toUnit(0),
					'The loan collateral was not reduced correctly'
				);

				// The contract pUSD balance should have been reduced by the expected amount
				assert.deepEqual(
					await pUSDPynth.balanceOf(short.address),
					beforeShortBalance.sub(pusdCollateral),
					'The short contracts holds excess pUSD'
				);

				// The user pUSD balance should increase
				assert.deepEqual(
					await pUSDPynth.balanceOf(account1),
					pusdCollateral.sub(exchangeFee),
					'The user pUSD balance is unexpected'
				);
			});

			it('should repay with collateral and close the loan considering interest accrued', async () => {
				const accruedInterest = await accrueInterest();

				const pUSDAccruedInterest = await exchangeRates.effectiveValue(
					loan.currency,
					accruedInterest,
					pUSD
				);

				ethAmountToRepay = ethAmountToShort;

				assert.bnEqual(await pUSDPynth.balanceOf(account1), beforeUserBalance);

				const { fee: exchangeFee } = await exchanger.getAmountsForExchange(
					ethAmountToRepay.add(accruedInterest),
					pETH,
					pUSD
				);

				// Close the short and identify it
				await short.closeWithCollateral(id, { from: account1 });
				loan = await short.loans(id);

				// Interaction time increased
				assert.isAbove(parseInt(loan.lastInteraction), parseInt(beforeInteractionTime));

				// Short state should be zeroed out
				assert.deepEqual(loan.interestIndex, toUnit(0).toString());
				assert.deepEqual(loan.amount, toUnit(0).toString());
				assert.deepEqual(loan.collateral, toUnit(0).toString());

				// The fee pool should have received fees
				assert.deepEqual(
					await pUSDPynth.balanceOf(FEE_ADDRESS),
					beforeFeePoolBalance.add(exchangeFee).add(pUSDAccruedInterest),
					'The fee pool did not receive enough fees'
				);

				// The loan amount should have been reduced by the expected amount
				assert.deepEqual(
					loan.amount,
					ethAmountToShort.sub(ethAmountToRepay),
					'The loan amount was not reduced correctly'
				);

				// The loan collateral should have been reduced to zero
				assert.deepEqual(
					loan.collateral,
					toUnit(0),
					'The loan collateral was not reduced correctly'
				);

				// The contract pUSD balance should have been reduced by the expected amount
				assert.deepEqual(
					await pUSDPynth.balanceOf(short.address),
					beforeShortBalance.sub(pusdCollateral),
					'The short contracts holds excess pUSD'
				);

				// The user pUSD balance should reduce by the fees paid
				assert.deepEqual(
					await pUSDPynth.balanceOf(account1),
					beforeUserShortBalance.sub(exchangeFee).sub(pUSDAccruedInterest),
					'The user pUSD balance is unexpected'
				);
			});
		});

		describe('Drawing shorts', async () => {
			const oneETH = toUnit(1);
			const pusdCollateral = toUnit(1000);

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

				id = getid(tx);

				await fastForwardAndUpdateRates(3600);

				await short.draw(id, toUnit(5), { from: account1 });
			});

			it('should update the loan', async () => {
				loan = await short.loans(id);
				assert.equal(loan.amount, toUnit(6).toString());
			});

			it('should transfer the proceeds to the user', async () => {
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(600));
			});

			it('should not let them draw too much', async () => {
				await fastForwardAndUpdateRates(3600);
				await assert.revert(short.draw(id, toUnit(8), { from: account1 }), 'Cratio too low');
			});
		});

		describe('Withdrawing shorts', async () => {
			const oneETH = toUnit(1);
			const pusdCollateral = toUnit(1000);
			let previousBalance;

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

				id = getid(tx);

				previousBalance = await pUSDPynth.balanceOf(account1);

				await fastForwardAndUpdateRates(3600);

				await short.withdraw(id, toUnit(100), { from: account1 });
			});

			it('should update the loan', async () => {
				loan = await short.loans(id);
				assert.equal(loan.collateral, toUnit(900).toString());
			});

			it('should transfer the withdrawn collateral to the user', async () => {
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(100).add(previousBalance));
			});

			it('should not let them withdraw too much', async () => {
				await fastForwardAndUpdateRates(3600);
				await assert.revert(short.withdraw(id, toUnit(900), { from: account1 }), 'Cratio too low');
			});
		});

		describe('Closing shorts', async () => {
			const oneETH = toUnit(1);
			const pusdCollateral = toUnit(1000);

			it('if the eth price goes down, the shorter makes profit', async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

				id = getid(tx);

				await fastForwardAndUpdateRates(3600);

				await updateAggregatorRates(exchangeRates, null, [pETH], [toUnit(50)]);

				// simulate buying pETH for 50 pusd.
				await pUSDPynth.transfer(owner, toUnit(50), { from: account1 });
				await issue(pETHPynth, oneETH, account1);

				// now close the short
				await short.close(id, { from: account1 });

				// shorter has made 50 pUSD profit
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(1050));
			});

			it('if the eth price goes up, the shorter makes a loss', async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

				id = getid(tx);

				await fastForwardAndUpdateRates(3600);

				await updateAggregatorRates(exchangeRates, null, [pETH], [toUnit(150)]);

				// simulate buying pETH for 150 pusd.
				await pUSDPynth.transfer(owner, toUnit(150), { from: account1 });
				await issue(pETHPynth, oneETH, account1);

				// now close the short
				await short.close(id, { from: account1 });

				// shorter has made 50 pUSD loss
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(950));
			});
		});

		describe('Liquidating shorts', async () => {
			const oneETH = toUnit(1);
			const initialLoan = oneETH;
			const pusdCollateral = toUnit('130');

			// getExpectedValues takes into account penalty, rate and cratio
			const getExpectedValues = async ({
				initialCollateral,
				initialLoan,
				currentDebt,
				cratio,
				penalty,
				exchangeRates,
			}) => {
				const one = toUnit(1);

				// apply formula to get collateralUtil formula to get liquidationAmount
				const dividend = currentDebt.sub(divideDecimal(initialCollateral, cratio));
				const divisor = one.sub(divideDecimal(one.add(penalty), cratio));
				const liquidatedAmountpUSD = divideDecimal(dividend, divisor);

				const liquidatedLoan = await exchangeRates.effectiveValue(pUSD, liquidatedAmountpUSD, pETH);
				const remainingLoan = initialLoan.sub(liquidatedLoan);
				const liquidatedCollateral = multiplyDecimal(
					await exchangeRates.effectiveValue(pETH, liquidatedLoan, pUSD),
					one.add(penalty)
				);
				const remainingCollateral = initialCollateral.sub(liquidatedCollateral);

				return { liquidatedCollateral, remainingCollateral, liquidatedLoan, remainingLoan };
			};

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, initialLoan, pETH, { from: account1 });

				id = getid(tx);
				await fastForwardAndUpdateRates(3600);
			});

			it('liquidation should be capped to only fix the c ratio', async () => {
				const penalty = await systemSettings.liquidationPenalty();
				const cratio = await short.minCratio();
				const currentEthRate = toUnit(110);
				const currentDebt = multiplyDecimal(initialLoan, currentEthRate);

				await updateAggregatorRates(exchangeRates, null, [pETH], [currentEthRate]);

				const {
					liquidatedCollateral,
					remainingCollateral,
					liquidatedLoan,
					remainingLoan,
				} = await getExpectedValues({
					initialCollateral: pusdCollateral,
					initialLoan,
					currentDebt,
					cratio,
					penalty,
					exchangeRates,
				});

				// When the ETH price increases 10% to $110, the short
				// which started at 130% should allow 0.18 ETH
				// to be liquidated to restore its c ratio and no more.

				await issue(pETHPynth, oneETH, account2);

				tx = await short.liquidate(account1, id, oneETH, { from: account2 });

				assert.eventEqual(tx, 'LoanPartiallyLiquidated', {
					account: account1,
					id: id,
					liquidator: account2,
					amountLiquidated: liquidatedLoan,
					collateralLiquidated: liquidatedCollateral,
				});

				loan = await short.loans(id);

				assert.bnEqual(loan.amount, remainingLoan);
				assert.bnEqual(loan.collateral, remainingCollateral);

				const ratio = await short.collateralRatio(id);

				assert.bnClose(ratio, await short.minCratio(), '100');
			});
		});

		describe('System debt', async () => {
			const oneETH = toUnit(1);
			const twoETH = toUnit(2);
			const pusdCollateral = toUnit(1000);

			it('If there is 1 ETH and 1 short ETH, then the system debt is constant before and after a price change', async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				await debtCache.takeDebtSnapshot();
				let result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

				id = getid(tx);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				await fastForwardAndUpdateRates(3600);

				await updateAggregatorRates(exchangeRates, null, [pETH], [toUnit(150)]);
				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				// simulate buying pETH for 150 pusd.
				await pUSDPynth.burn(account1, toUnit(150));
				await issue(pETHPynth, oneETH, account1);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				// now close the short
				await short.close(id, { from: account1 });

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				// shorter has made 50 pUSD loss
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(950));
			});

			it('If there is 1 ETH and 2 short ETH, then the system debt decreases if the price goes up', async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				await debtCache.takeDebtSnapshot();
				let result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				tx = await short.open(toUnit(500), twoETH, pETH, { from: account1 });

				id = getid(tx);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				await fastForwardAndUpdateRates(3600);

				await updateAggregatorRates(exchangeRates, null, [pETH], [toUnit(150)]);

				// 111100 + 50 - (2 * 50) = 111,050

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111050));

				// simulate buying 2 pETH for 300 pusd.
				await pUSDPynth.burn(account1, toUnit(300));
				await issue(pETHPynth, twoETH, account1);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111050));

				// now close the short
				await short.close(id, { from: account1 });

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111050));

				// shorter has made 50 pUSD loss
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(900));
			});

			it('If there is 1 ETH and 2 short ETH, then the system debt increases if the price goes down', async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				await debtCache.takeDebtSnapshot();
				let result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				tx = await short.open(toUnit(500), twoETH, pETH, { from: account1 });

				id = getid(tx);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111100));

				await fastForwardAndUpdateRates(3600);

				await updateAggregatorRates(exchangeRates, null, [pETH], [toUnit(50)]);

				// 111100 - 50 + (2 * 50) = 111,150

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111150));

				// simulate buying 2 pETH for 100 pusd.
				await pUSDPynth.burn(account1, toUnit(100));
				await issue(pETHPynth, twoETH, account1);

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111150));

				// now close the short
				await short.close(id, { from: account1 });

				await debtCache.takeDebtSnapshot();
				result = await debtCache.cachedDebt();
				assert.bnEqual(result, toUnit(111150));

				// shorter has made 100 pUSD profit
				assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(1100));
			});
		});

		describe('Determining the skew and interest rate', async () => {
			beforeEach(async () => {
				await manager.setMaxSkewRate(toUnit(0.2), { from: owner });

				// Open a short to make the long/short supply balanced.
				const oneBTC = toUnit(1);
				const pusdCollateral = toUnit(15000);

				await issue(pUSDPynth, pusdCollateral, account1);

				await short.open(pusdCollateral, oneBTC, pBTC, { from: account1 });
			});

			it('should correctly determine the interest on a short', async () => {
				const oneBTC = toUnit(1);
				const pusdCollateral = toUnit(15000);

				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, oneBTC, pBTC, { from: account1 });
				id = getid(tx);

				// after a year we should have accrued 6.67%.

				await fastForwardAndUpdateRates(YEAR);

				// deposit some collateral to trigger the interest accrual.

				tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

				loan = await short.loans(id);

				let interest = Math.round(parseFloat(fromUnit(loan.accruedInterest)) * 10000) / 10000;

				assert.equal(interest, 0.0667);

				await fastForwardAndUpdateRates(3600);

				tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

				// after two years we should have accrued about 13.33%, give or take the 5 minutes we skipped.

				await fastForwardAndUpdateRates(YEAR);

				// deposit some collateral to trigger the interest accrual.

				tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

				loan = await short.loans(id);

				interest = Math.round(parseFloat(fromUnit(loan.accruedInterest)) * 10000) / 10000;

				assert.equal(interest, 0.1333);
			});
		});
	});
});
